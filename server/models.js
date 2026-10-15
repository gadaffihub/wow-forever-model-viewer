'use strict';
const {Reader,chunks,xyz}=require('./binary');
const ANIM_NAMES={0:'Stand',1:'Death',2:'Spell',4:'Walk',5:'Run',6:'Dead',8:'Stand wound',9:'Combat wound',13:'Walk backwards',14:'Stun',16:'Attack',17:'Attack one-handed',18:'Attack two-handed',25:'Combat ready',30:'Dodge',37:'Jump start',38:'Jump',39:'Land',40:'Fall',41:'Swim idle',42:'Swim',55:'Battle roar',60:'Talk',61:'Eat',64:'Exclaim',65:'Question',66:'Bow',67:'Wave',68:'Cheer',69:'Dance',70:'Laugh',71:'Sleep',74:'Roar',91:'Mount',92:'Run right',93:'Run left',97:'Kick',114:'Sit',115:'Sleep down',116:'Sleep',117:'Sleep up',118:'Sit down',119:'Sit ground',120:'Sit up',153:'Fly',158:'Flight idle',159:'Flight walk'};
function arrayAt(b,pair,read,size){const [n,offset]=pair;if(n>1000000||offset+n*size>b.length)throw new Error('Invalid model array');const r=new Reader(b,offset);return Array.from({length:n},(_,i)=>read(r,i));}
function animationList(b,pair){return arrayAt(b,pair,r=>{const a={id:r.u16(),variation:r.u16(),duration:r.u32()};r.skip(4);a.flags=r.u32();r.skip(44);a.next=r.i16();a.alias=r.u16();a.name=(ANIM_NAMES[a.id]||`Animation ${a.id}`)+(a.variation?` · ${a.variation+1}`:'');return a;},64);}
function track(r,type){return {interpolation:r.u16(),global:r.u16(),times:r.pair(),values:r.pair(),type};}
function boneList(b,pair){return arrayAt(b,pair,r=>{const bone={id:r.i32(),flags:r.u32(),parent:r.i16()};r.skip(6);bone.translation=track(r,'translation');bone.rotation=track(r,'rotation');bone.scale=track(r,'scale');bone.pivot=xyz(r.vec());return bone;},88);}
function readTrack(b,t,index,external,globals){
  const slot=t.global!==65535?0:index;let times=[],values=[];
  if(slot>=t.times[0]||slot>=t.values[0])return {times,values,global:t.global};
  const ta=new Reader(b,t.times[1]+slot*8).pair(),va=new Reader(b,t.values[1]+slot*8).pair();const source=external&&t.global===65535?external:b;
  if(ta[0]>100000||va[0]>100000||ta[1]+ta[0]*4>source.length||va[1]+va[0]*(t.type==='rotation'?8:12)>source.length)return {times,values,global:t.global};
  times=arrayAt(source,ta,r=>r.u32(),4);
  values=arrayAt(source,va,r=>{if(t.type==='rotation'){const q=Array.from({length:4},()=>((r.u16()-32767)/32768));return [q[0],q[2],-q[1],q[3]];}const v=r.vec();return t.type==='scale'?[v[0],v[2],v[1]]:xyz(v);},t.type==='rotation'?8:12);
  return {times,values,interpolation:t.interpolation,globalDuration:globals[t.global]||0};
}
function parseSkin(b){
  const r=new Reader(b);if(r.text(4)!=='SKIN')throw new Error('Missing model skin geometry');const iv=r.pair(),tv=r.pair();r.skip(8);const sv=r.pair(),uv=r.pair();
  const lookup=arrayAt(b,iv,r=>r.u16(),2),triangles=arrayAt(b,tv,r=>r.u16(),2).map(v=>lookup[v]);
  const sections=arrayAt(b,sv,r=>{const id=r.u16(),level=r.u16();r.skip(4);const start=r.u16()+level*65536,count=r.u16();r.skip(36);return {id,start,count};},48);
  const units=arrayAt(b,uv,r=>{const flags=r.u8(),priority=r.i8(),shader=r.u16(),section=r.u16();r.skip(2);const color=r.i16(),material=r.u16(),layer=r.u16(),count=r.u16(),texture=r.u16();r.skip(6);return {flags,priority,shader,section,color,material,layer,count,texture};},24);
  return {triangles,sections,units};
}
async function parseM2(archive,id){
  const raw=await archive.getFile(id),parts=raw.toString('ascii',0,4)==='MD20'?new Map([['MD21',raw]]):chunks(raw),b=parts.get('MD21');
  if(!b||b.toString('ascii',0,4)!=='MD20')throw new Error('This file does not contain an M2 mesh');
  const r=new Reader(b,8),namePair=r.pair();const internalName=namePair[0]?b.toString('utf8',namePair[1],namePair[1]+namePair[0]).replaceAll('\0',''):'';const flags=r.u32(),globalPair=r.pair(),animPair=r.pair();r.skip(8);const bonePair=r.pair();r.skip(8);const vertexPair=r.pair(),views=r.u32();r.skip(8);const texPair=r.pair();r.skip(24);const matPair=r.pair();r.skip(8);const comboPair=r.pair();
  const positions=[],normals=[],uv=[],weights=[],boneIndices=[];
  arrayAt(b,vertexPair,r=>{positions.push(...xyz(r.vec()));for(let i=0;i<4;i++)weights.push(r.u8()/255);for(let i=0;i<4;i++)boneIndices.push(r.u8());normals.push(...xyz(r.vec()));uv.push(...r.vec(2));r.skip(8);},48);
  if(!positions.length)throw new Error('This asset contains effects but no visible mesh.');
  const texIDs=parts.get('TXID');const textures=arrayAt(b,texPair,(r,i)=>{const type=r.u32(),flags=r.u32(),p=r.pair();let id=texIDs&&i*4+4<=texIDs.length?texIDs.readUInt32LE(i*4):0;if(!id&&p[0])id=archive.ids.get(b.toString('utf8',p[1],p[1]+p[0]).replaceAll('\0','').replaceAll('\\','/').toLowerCase())||0;return {id,type,flags};},16);
  const materials=arrayAt(b,matPair,r=>({flags:r.u16(),blend:r.u16()}),4),combos=arrayAt(b,comboPair,r=>r.u16(),2);
  const sfid=parts.get('SFID');const skinID=sfid?.readUInt32LE(0)||archive.ids.get((archive.names.get(id)||'').replace(/\.m2$/,'00.skin'));if(!skinID)throw new Error('This model has no installed skin mesh');const skin=parseSkin(await archive.getFile(skinID));
  const groups=skin.sections.map((s,i)=>{const unit=skin.units.filter(u=>u.section===i).sort((a,b)=>a.layer-b.layer)[0];return {...s,texture:unit?combos[unit.texture]??-1:-1,material:unit?materials[unit.material]:{flags:0,blend:0}};});
  let source={b,bones:boneList(b,bonePair),animations:animationList(b,animPair),globals:arrayAt(b,globalPair,r=>r.u32(),4),parts};const warnings=[];
  if(parts.has('SKID')){try{const seen=new Set();async function skeleton(id){if(seen.has(id))throw new Error('Skeleton cycle');seen.add(id);const parts=chunks(await archive.getFile(id));const boneData=parts.get('SKB1'),seq=parts.get('SKS1');const s={b:boneData,bones:boneData?boneList(boneData,new Reader(boneData).pair()):[],animations:[],globals:[],parts};if(seq){const sr=new Reader(seq);s.globals=arrayAt(seq,sr.pair(),r=>r.u32(),4);s.animations=animationList(seq,sr.pair());s.seq=seq;}const parent=parts.get('SKPD');if(parent){const pid=parent.readUInt32LE(8);if(pid){const p=await skeleton(pid);s.parent=p;if(!s.bones.length)s.bones=p.bones;}}return s;}source=await skeleton(parts.get('SKID').readUInt32LE(0));}catch(e){warnings.push('External skeleton: '+e.message);}}
  return {id,type:'m2',internalName,positions,normals,uv,weights,boneIndices,indices:skin.triangles,groups,textures,bones:source.bones.map(b=>({pivot:b.pivot,parent:b.parent})),animations:source.animations,source,warnings,flags,views};
}
async function animation(archive,model,index){
  let source=model.source;let a=source.animations[index];if(!a)throw new Error('Animation not found');const seen=new Set();while(a.flags&64){if(seen.has(index))throw new Error('Cyclic animation alias');seen.add(index);index=a.alias;a=source.animations[index];if(!a)throw new Error('Invalid animation alias');}
  let external=null;
  if(!(a.flags&32)){const afid=source.parts.get('AFID');if(afid){for(let p=0;p+8<=afid.length;p+=8)if(afid.readUInt16LE(p)===a.id&&afid.readUInt16LE(p+2)===a.variation){const id=afid.readUInt32LE(p+4);if(id){external=await archive.getFile(id);const tag=external.toString('ascii',0,4);if(['AFM2','AFSB','AFSA'].includes(tag)){const c=chunks(external);external=c.get('AFSB')||c.get('AFM2')||external;}break;}}}if(!external)throw new Error('Animation data is not available in the local files for this sequence.');}
  const bones=source.bones.map(bone=>Object.fromEntries(['translation','rotation','scale'].map(k=>[k,readTrack(source.b,bone[k],index,external,source.globals)])));
  return {duration:a.duration,bones,name:a.name};
}
async function parseWMO(archive,id){
  const parts=chunks(await archive.getFile(id),0,undefined,true),header=parts.get('MOHD');if(!header)throw new Error('This WMO is a group mesh; choose its root building model.');
  const groupCount=header.readUInt32LE(4),textures=[],materials=[];const mt=parts.get('MOMT'),names=parts.get('MOTX');for(let p=0;mt&&p+64<=mt.length;p+=64){let texture=mt.readUInt32LE(p+12);if(names){const end=names.indexOf(0,texture);texture=archive.ids.get(names.toString('utf8',texture,end<0?names.length:end).replaceAll('\\','/').toLowerCase())||0;}textures.push({id:texture,type:0,flags:3});materials.push({flags:mt.readUInt32LE(p),blend:mt.readUInt32LE(p+8)});}
  const model={id,type:'wmo',positions:[],normals:[],uv:[],indices:[],groups:[],textures,bones:[],animations:[],warnings:[]};const gf=parts.get('GFID');
  for(let i=0;i<groupCount;i++){try{const fileID=gf?gf.readUInt32LE(i*4):archive.ids.get((archive.names.get(id)||'').replace('.wmo',`_${String(i).padStart(3,'0')}.wmo`));const raw=await archive.getFile(fileID);const outer=chunks(raw,0,undefined,true);const gp=outer.get('MOGP');if(!gp)continue;const c=chunks(gp,68,undefined,true),v=c.get('MOVT'),n=c.get('MONR'),uv=c.get('MOTV'),indices=c.get('MOVI'),batches=c.get('MOBA');const base=model.positions.length/3,start=model.indices.length;if(!v||!indices)continue;for(let j=0;j<v.length;j+=12)model.positions.push(...xyz(new Reader(v,j).vec()));for(let j=0;n&&j<n.length;j+=12)model.normals.push(...xyz(new Reader(n,j).vec()));for(let j=0;uv&&j<uv.length;j+=4)model.uv.push(uv.readFloatLE(j));for(let j=0;j<indices.length;j+=2)model.indices.push(indices.readUInt16LE(j)+base);for(let j=0;batches&&j+24<=batches.length;j+=24){const m=batches[j+22]&2?batches.readUInt16LE(j+10):batches[j+23];model.groups.push({id:i,start:start+batches.readUInt32LE(j+12),count:batches.readUInt16LE(j+16),texture:m,material:materials[m]||{flags:0,blend:0}});}}catch(e){model.warnings.push(`Group ${i}: ${e.message}`);}}
  if(!model.positions.length)throw new Error('No readable geometry in this world model');return model;
}
module.exports={parseM2,parseWMO,animation,parseSkin,readTrack};
