'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const {ROOT}=require('./archive');
const {Reader}=require('./binary');

function schemaFromDBD(text,hash){
  const blocks=text.replaceAll('\r','').split(/\n\s*\n/);const types=new Map();
  for(const line of blocks[0].split('\n')){const m=line.match(/^(int|float|string|locstring)(?:<[^>]+>)?\s+(\w+)/);if(m)types.set(m[2],m[1]);}
  const block=blocks.find(b=>b.split('\n').some(l=>l.startsWith('LAYOUT ')&&l.slice(7).split(',').map(x=>x.trim()).includes(hash)));
  if(!block)throw new Error(`No matching schema for client table layout ${hash}`);
  const fields=[];for(const line of block.split('\n')){const m=line.match(/^(?:\$([^$]+)\$)?(\w+)(?:<(u?)(\d+)>)?(?:\[(\d+)\])?$/);if(!m||!types.has(m[2]))continue;const flags=(m[1]||'').split(',');fields.push({name:m[2],type:types.get(m[2]),signed:m[3]!=='u',bits:Number(m[4]||32),count:Number(m[5]||1),id:flags.includes('id'),inline:!flags.includes('noninline'),relation:flags.includes('relation')});}return fields;
}
function bits(b,byteOffset,bitOffset,width,signed=false){
  if(width===0)return 0;if(width>32)throw new Error(`Unsupported ${width}-bit database scalar`);
  const pos=byteOffset+Math.floor(bitOffset/8),shift=bitOffset%8,n=Math.ceil((shift+width)/8);let value=0;
  for(let i=0;i<n;i++)value+=b[pos+i]*2**(i*8);value=Math.floor(value/2**shift)%2**width;
  return signed&&value>=2**(width-1)?value-2**width:value;
}
async function readDB(archive,name){
  const b=await archive.getFileByName(`dbfilesclient/${name.toLowerCase()}.db2`,{partial:true});
  const magic=b.toString('ascii',0,4);if(!['WDC3','WDC4','WDC5'].includes(magic))throw new Error(`Unsupported ${name} database ${magic}`);
  const r=new Reader(b,magic==='WDC5'?136:4);const recordCount=r.u32(),fieldCount=r.u32(),recordSize=r.u32();r.skip(8);const hash=r.u32().toString(16).toUpperCase().padStart(8,'0');r.skip(12);const flags=r.u16(),idIndex=r.u16(),totalFieldCount=r.u32();r.skip(8);const fieldStorage=r.u32(),commonSize=r.u32(),paletteSize=r.u32(),sectionCount=r.u32();
  if(flags&1)throw new Error(`${name} uses sparse database records; this table is not required for geometry.`);
  const schemaPath=path.join(ROOT,'.cache/dbd',name+'.dbd');let text;try{text=await fs.readFile(schemaPath,'utf8');}catch{const response=await fetch(`https://raw.githubusercontent.com/wowdev/WoWDBDefs/master/definitions/${name}.dbd`,{signal:AbortSignal.timeout(20000)});if(!response.ok)throw new Error(`Schema unavailable for ${name}`);text=await response.text();await fs.mkdir(path.dirname(schemaPath),{recursive:true});await fs.writeFile(schemaPath,text);}
  const schema=schemaFromDBD(text,hash),headers=[];
  for(let i=0;i<sectionCount;i++){const key=b.readBigUInt64LE(r.p);r.skip(8);headers.push({key,offset:r.u32(),count:r.u32(),strings:r.u32(),end:r.u32(),ids:r.u32(),relations:r.u32(),mapCount:r.u32(),copies:r.u32()});}
  r.skip(totalFieldCount*4);const fields=[];
  for(let i=0;i<fieldStorage/24;i++)fields.push({offset:r.u16(),size:r.u16(),extra:r.u32(),compression:r.u32(),a:r.u32(),c:r.u32(),d:r.u32()});
  let p=r.p;for(const f of fields)if(f.compression===3||f.compression===4){f.palette=[];for(let i=0;i<f.extra;i+=4)f.palette.push(b.readUInt32LE(p+i));p+=f.extra;}
  if(p!==r.p+paletteSize)throw new Error('Invalid database palette sizes');
  for(const f of fields)if(f.compression===2){f.common=new Map();for(let i=0;i<f.extra;i+=8)f.common.set(b.readUInt32LE(p+i),b.readUInt32LE(p+i+4));p+=f.extra;}
  if(p!==r.p+paletteSize+commonSize)throw new Error('Invalid database common-data sizes');
  const cast=Buffer.alloc(4);const scalar=(n,s)=>{if(s.type==='float'){cast.writeUInt32LE(n>>>0);return cast.readFloatLE();}if(!Number.isFinite(n))throw new Error('Invalid database scalar');const value=((n%2**s.bits)+2**s.bits)%2**s.bits;return s.signed&&value>=2**(s.bits-1)?value-2**s.bits:value;};
  const raw=(f,offset,id,j=0,s)=>{switch(f.compression){case 0:return bits(b,offset,f.offset+j*s.bits,s.bits,s.signed&&s.type==='int');case 1:case 5:return bits(b,offset,f.offset,f.c,f.compression===5);case 2:return f.common.get(id)??f.a;case 3:return f.palette[bits(b,offset,f.offset,f.c)];case 4:return f.palette[bits(b,offset,f.offset,f.c)*f.d+j];default:throw new Error(`Unknown database compression ${f.compression}`);}};
  const out=new Map();let skipped=0;
  let previousRecords=0,previousStrings=0;
  for(const h of headers){
    // String offsets address the virtual concatenation of every section's records,
    // followed by every section's strings, rather than the on-disk section layout.
    const stringAdjustment=-(recordCount-previousRecords-h.count)*recordSize-previousStrings;
    previousRecords+=h.count;previousStrings+=h.strings;
    const tail=h.offset+h.count*recordSize+h.strings;if(tail+h.ids+h.copies*8>b.length){if(h.key){skipped+=h.count;continue;}throw new Error(`${name} has truncated records`);}if(h.key&&b.subarray(h.offset,tail).every(x=>x===0)){skipped+=h.count;continue;}
    const relations=new Map();
    if(h.relations){const start=tail+h.ids+h.copies*8+h.mapCount*6;const count=b.readUInt32LE(start);for(let n=0;n<count;n++)relations.set(b.readUInt32LE(start+16+n*8),b.readUInt32LE(start+12+n*8));}
    for(let n=0;n<h.count;n++){const offset=h.offset+n*recordSize;let id=h.ids?b.readUInt32LE(tail+n*4):raw(fields[idIndex],offset,0,0,{bits:32,signed:false,type:'int'});const row={};let fi=0;
      for(const s of schema){if(!s.inline){row[s.name]=s.id?id:s.relation?(relations.get(n)||0):0;continue;}const f=fields[fi++];if(!f)throw new Error(`Schema mismatch in ${name}`);const values=[];for(let j=0;j<s.count;j++){let value=raw(f,offset,id,j,s);if(s.type==='string'||s.type==='locstring'){const at=offset+Math.floor(f.offset/8)+j*4+(value|0)+stringAdjustment;const end=b.indexOf(0,at);value=value&&at>=0&&end>=at&&end<b.length?b.toString('utf8',at,end):'';}else value=scalar(value,s);values.push(value);}row[s.name]=s.count===1?values[0]:values;if(s.id)id=row[s.name];}
      out.set(id,row);
    }
    for(let n=0;n<h.copies;n++){const at=tail+h.ids+n*8,dst=b.readUInt32LE(at),src=b.readUInt32LE(at+4);const original=out.get(src);if(original){const row={...original};const field=schema.find(f=>f.id);if(field)row[field.name]=dst;out.set(dst,row);}}
  }
  return {rows:out,skipped,hash,recordCount};
}
module.exports={readDB,schemaFromDBD,bits};
