'use strict';
const fs=require('node:fs');
const fsp=fs.promises;
const path=require('node:path');
const zlib=require('node:zlib');
const crypto=require('node:crypto');
const readline=require('node:readline');
const v8=require('node:v8');
const ROOT=path.resolve(__dirname,'..');
const normalize=s=>s.replaceAll('\\','/').toLowerCase();

const {decodeBLTE}=require('./blte');
const {resolveInstallation}=require('./installation');

class Archive {
  constructor(gamePath){this.gamePath=gamePath;this.files=new Map();this.names=new Map();this.ids=new Map();this.handles=new Map();this.keys=new Map();this.status={phase:'opening',message:'Opening the installed Forever Beta…'};}
  async loadKeys(){
    try{const text=await fsp.readFile(path.join(ROOT,'.cache/tact-keys.txt'),'utf8');for(const line of text.split('\n')){const m=line.match(/^([0-9a-f]{16})\s+([0-9a-f]{32})/i);if(m)this.keys.set(m[1].toUpperCase(),Buffer.from(m[2],'hex'));}}catch{}
    const {readDB}=require('./db2');
    try{const keyTable=await readDB(this,'TactKey'),lookup=await readDB(this,'TactKeyLookup');for(const [id,row]of keyTable.rows){const name=lookup.rows.get(id)?.TACTID;if(name&&row.Key?.length===16&&row.Key.some(Boolean))this.keys.set(Buffer.from(name).reverse().toString('hex').toUpperCase(),Buffer.from(row.Key));}}catch(error){this.keyWarning=error.message;}
    this.keyFingerprint=crypto.createHash('sha256').update([...this.keys].map(([name,key])=>name+key.toString('hex')).sort().join('')).digest('hex').slice(0,16);
  }
  async open(){
    const installation=await resolveInstallation({explicitPath:this.gamePath});this.gamePath=installation.path;const b=installation.build;
    this.build={version:b.Version,key:b['Build Key'],product:b.Product,path:this.gamePath};
    this.cacheDir=path.join(ROOT,'.cache',this.build.key);await fsp.mkdir(this.cacheDir,{recursive:true});
    this.dataDir=path.join(this.gamePath,'Data/data');
    const idxs=(await fsp.readdir(this.dataDir)).filter(n=>/^[0-9a-f]+\.idx$/i.test(n)).sort().reverse();
    const fingerprint=crypto.createHash('sha256');for(const n of idxs){const s=await fsp.stat(path.join(this.dataDir,n));fingerprint.update(`${n}:${s.size}:${s.mtimeMs}`);}this.fingerprint=fingerprint.digest('hex').slice(0,16);
    const cache=path.join(this.cacheDir,`index-v2-${this.fingerprint}.bin`);
    try{const saved=v8.deserialize(await fsp.readFile(cache));this.files=saved.files;this.names=saved.names;this.ids=new Map([...this.names].map(([id,n])=>[normalize(n),id]));this.status={phase:'catalog',message:'Reading the beta creature tables…'};await this.loadKeys();return this;}catch{}
    this.status={phase:'indexing',message:'Reading local CASC storage indexes…'};
    const local=new Map();
    for(const n of idxs){const b=await fsp.readFile(path.join(this.dataDir,n));const p=(8+b.readUInt32LE(0)+15)&~15;const length=b.readUInt32LE(p);for(let o=p+8;o<p+8+length;o+=18){const key=b.toString('hex',o,o+9);if(local.has(key))continue;const packed=b.readUIntBE(o+9,5);const size=b.readUInt32LE(o+14);if(size>=30)local.set(key,{archive:Math.floor(packed/0x40000000),offset:packed%0x40000000,compressed:size});}}
    const configText=await fsp.readFile(path.join(this.gamePath,'Data/config',b['Build Key'].slice(0,2),b['Build Key'].slice(2,4),b['Build Key']),'utf8');
    const config=Object.fromEntries(configText.split('\n').filter(s=>s.includes(' = ')).map(s=>s.split(' = ')));
    this.build.name=config['build-name'];
    this.status={phase:'indexing',message:'Resolving the installed build’s content keys…'};
    const encodingKey=config.encoding.split(' ')[1];const encEntry=local.get(encodingKey.slice(0,18));if(!encEntry)throw new Error('The local encoding table is missing. Finish the Battle.net download.');
    const enc=decodeBLTE(await this.readEntry(encEntry));if(enc.toString('ascii',0,2)!=='EN')throw new Error('Invalid encoding table');
    if(crypto.createHash('md5').update(enc).digest('hex')!==config.encoding.split(' ')[0])throw new Error('Encoding table does not match the selected beta build.');
    const ckeyLen=enc[3],ekeyLen=enc[4],pageSize=enc.readUInt16BE(5)*1024,count=enc.readUInt32BE(9),start=22+enc.readUInt32BE(18)+count*(ckeyLen+16);
    const contents=new Map();
    for(let page=0;page<count;page++){let p=start+page*pageSize;const end=p+pageSize;while(p<end&&enc[p]){const keys=enc[p++],size=enc.readUIntBE(p,5);p+=5;const ckey=enc.toString('hex',p,p+ckeyLen);p+=ckeyLen;let entry;for(let i=0;i<keys;i++){const ekey=enc.toString('hex',p,p+ekeyLen);p+=ekeyLen;entry=entry||local.get(ekey.slice(0,18));}contents.set(ckey,entry?{...entry,size,local:true}:{size,local:false});}}
    const rootEntry=contents.get(config.root);if(!rootEntry?.local)throw new Error('The installed build’s root manifest is unavailable locally.');
    const root=decodeBLTE(await this.readEntry(rootEntry));
    if(crypto.createHash('md5').update(root).digest('hex')!==config.root)throw new Error('Root manifest does not match the selected beta build.');
    if(root.toString('ascii',0,4)!=='TSFM')throw new Error('Unsupported root manifest signature');
    const header=root.readUInt32LE(4),version=header===24?root.readUInt32LE(8):0;
    let p=version?header:12;const total=root.readUInt32LE(version?12:4),named=root.readUInt32LE(version?16:8);
    while(p<root.length){const n=root.readUInt32LE(p);p+=4;let content,locale;if(version===2){locale=root.readUInt32LE(p);content=root.readUInt32LE(p+4)|root.readUInt32LE(p+8)|(root[p+12]<<17);p+=13;}else{content=root.readUInt32LE(p);locale=root.readUInt32LE(p+4);p+=8;}const ids=[];let id=0;for(let i=0;i<n;i++){id+=root.readUInt32LE(p);p+=4;ids.push(id++);}const use=locale===0||!!(locale&2);for(let i=0;i<n;i++){const key=root.toString('hex',p,p+16);p+=16;if(!use)continue;const e=contents.get(key)||{local:false,size:0};const old=this.files.get(ids[i]);if(!old||(!old.local&&e.local))this.files.set(ids[i],{...e,contentKey:key});}if(!(total!==named&&(content&0x10000000)))p+=n*8;}
    this.status={phase:'indexing',message:'Labelling installed files with optional community filenames…'};
    const input=readline.createInterface({input:fs.createReadStream(path.join(ROOT,'.cache/listfile.csv')),crlfDelay:Infinity});
    for await(const line of input){const sep=line.indexOf(';'),id=Number(line.slice(0,sep));if(this.files.has(id)){const name=line.slice(sep+1);this.names.set(id,name);this.ids.set(normalize(name),id);}}
    await fsp.writeFile(cache,v8.serialize({files:this.files,names:this.names}));
    this.status={phase:'catalog',message:'Reading the beta creature tables…'};await this.loadKeys();return this;
  }
  async readEntry(e,head=false){
    const name=path.join(this.dataDir,`data.${String(e.archive).padStart(3,'0')}`);
    // Cache the pending open too: concurrent textures often share an archive.
    // Replacing an already-open handle leaks it and crashes Node 25 during GC.
    if(!this.handles.has(name))this.handles.set(name,fsp.open(name,'r'));
    const handle=await this.handles.get(name);
    // HEAD only needs the first compressed block; avoids loading huge cinematics during discovery.
    let size=e.compressed-30;
    if(head){const h=Buffer.alloc(64);await handle.read(h,0,64,e.offset+30);const hs=h.readUInt32BE(4);if(hs>0)size=Math.min(size,hs+h.readUInt32BE(12));}
    if(size>512*1024*1024)throw new Error('File exceeds the viewer’s 512 MB per-file limit.');
    const b=Buffer.alloc(size);const result=await handle.read(b,0,size,e.offset+30);if(result.bytesRead!==size)throw new Error('Local archive record is incomplete.');return b;
  }
  async getFile(id,options={}){id=Number(id);const e=this.files.get(id);if(!e)throw new Error(`File ${id} is not in installed build ${this.build.version}.`);if(!e.local)throw new Error(`File ${id} is not installed locally. Finish the Battle.net download.`);const data=decodeBLTE(await this.readEntry(e,options.head),{...options,keys:this.keys});if(!options.head&&!options.partial&&crypto.createHash('md5').update(data).digest('hex')!==e.contentKey)throw new Error(`File ${id} does not match this beta build's content hash.`);return data;}
  getFileByName(name,options){const id=this.ids.get(normalize(name));if(!id)throw new Error(`File not indexed: ${name}`);return this.getFile(id,options);}
  async close(){const handles=[...this.handles.values()];this.handles.clear();await Promise.all(handles.map(async p=>(await p).close()));}
}
module.exports={Archive,ROOT,decodeBLTE};
