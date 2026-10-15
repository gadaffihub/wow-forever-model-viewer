'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {Archive}=require('../server/archive'),{Catalog,modelPath,creaturePath,beastPath,mountPath}=require('../server/catalog');
const {readDB}=require('../server/db2'),{parseM2,parseWMO,animation}=require('../server/models');
const {decodeBLP,png}=require('../server/blp'),{salsa20}=require('../server/salsa20'),{decodeBLTE}=require('../server/blte');
const {audioType,audioRange,createAudioReader}=require('../server/audio');

test('audio formats and browser byte-range requests',()=>{
 assert.equal(audioType(Buffer.from('OggS1234')),'audio/ogg');assert.equal(audioType(Buffer.from('ID3test')),'audio/mpeg');assert.equal(audioType(Buffer.from('RIFF1234WAVE')),'audio/wav');
 assert.throws(()=>audioType(Buffer.from('MD21model')),/not a supported sound/);
 assert.deepEqual(audioRange('bytes=0-1',100),{start:0,end:1,partial:true});assert.deepEqual(audioRange('bytes=90-',100),{start:90,end:99,partial:true});assert.deepEqual(audioRange('bytes=-10',100),{start:90,end:99,partial:true});assert.deepEqual(audioRange('bytes=90-999',100),{start:90,end:99,partial:true});
 for(const range of ['bytes=100-','bytes=5-4','bytes=-0','bytes=0-1,4-5','bytes=-','foo'])assert.equal(audioRange(range,100),null,range);
});

test('Salsa20/20 matches independent 128- and 256-bit zero vectors',()=>{
 const vectors=[[16,'6513adaecfeb124c1cbe6bdaef690b4ffb00b0fcace33ce806792bb41480199834bfb1cfdd095802c6e95e251002989ac22ae588d32ae79320d9bd7732e00338'],[32,'9a97f65b9b4c721b960a672145fca8d4e32e67f9111ea979ce9c4826806aeee63de9c0da2bd7f91ebcb2639bf989c6251b29bf38d39a9bdce7c55f4b2ac12a39']];
 for(const [size,expected]of vectors)assert.equal(salsa20(Buffer.alloc(64),Buffer.alloc(size),Buffer.alloc(8)).toString('hex'),expected);
});
test('admission and categories reject the reported false positives',()=>{
 for(const path of ['world/nodxt/detail/6tjmushroom02.m2','world/expansion11/doodads/bloodelf/12be_bloodelf_crafting_pickaxe01_animspecial.m2','spells/10gfx_fire_tornado_state.m2','creature/spells/effect.m2'])assert.equal(creaturePath(path),false,path);
 assert.equal(creaturePath('creature/wolf/wolf.m2'),true);
 assert.equal(creaturePath('models/creature/unk_exp00_7935081/7935081.m2'),true);
 assert.equal(beastPath('creature/aggramar/aggramar.m2'),false);
 assert.equal(beastPath('creature/wolf/wolf.m2'),true);
 assert.equal(mountPath('creature/mountaingiant/mountaingiant.m2'),false);
 assert.equal(mountPath('creature/bearmountutility/bearmountutility_anvil.m2'),false);
 assert.equal(mountPath('creature/bearmount/bearmount.m2'),true);
 for(const path of ['creature/wolf/wolf.m2','character/human/male/humanmale.m2','item/objectcomponents/weapon/sword.m2','models/unknown/123.m2','world/house.wmo','spells/effect.m2','test/sphere.m2'])assert.equal(modelPath(path),true,path);
 for(const path of ['character/human/skin.blp','sound/wolf.ogg','dbfilesclient/creature.db2','wolf.m2'])assert.equal(modelPath(path),false,path);
});
test('folder navigation keeps primary roots and misc roots separate from descendants',async()=>{
 const {buildFolderTree,modelRoots,miscRoots,allRoots,selectModels,referenceLabel}=await import('../public/catalog.mjs');
 const models=[{id:1,name:'Wolf',path:'creature/wolf/wolf.m2'},{id:2,name:'Human',path:'character/human/male/humanmale.m2'},{id:3,name:'Sword',path:'item/objectcomponents/weapon/sword.m2'},{id:4,name:'Unknown wolf',path:'models/creature/wolf/wolf.m2'}];
 const tree=buildFolderTree(models);assert.deepEqual(tree.roots.map(n=>n.path),allRoots);assert.ok(tree.roots.filter(n=>modelRoots.includes(n.path)).every(n=>n.count===1));
 assert.equal(tree.index.get('sound/').count,0);assert.ok(miscRoots.includes('world/'));assert.ok(miscRoots.includes('wtf/'));assert.equal(allRoots.length,new Set(allRoots).size);
 assert.deepEqual([...tree.index.get('character/').children.keys()],['character/human/']);assert.ok(tree.index.has('character/human/male/'));
 assert.deepEqual(selectModels(models,{folder:'creature/'}).map(m=>m.id),[1]);assert.deepEqual(selectModels(models,{folder:'models/'}).map(m=>m.id),[4]);
 assert.equal(referenceLabel('item/objectcomponents/weapon/'),'item');assert.equal(referenceLabel('character/human/'),'character');assert.equal(referenceLabel('models/creature/'),'known');
});
test('installed beta pipeline: provenance, tables, continuous sorting, decryption and rendering data',{timeout:180000,skip:process.env.WOW_INTEGRATION!=='1'},async t=>{
 const a=await new Archive().open();t.after(()=>a.close());
 const c=await new Catalog(a).build(),{selectModels,allRoots}=await import('../public/catalog.mjs');
 assert.equal(a.build.product,'wow_classic_beta');assert.ok(c.items.length>1000);
 const wolfFolder=selectModels(c.items,{folder:'creature/wolf/'});assert.ok(wolfFolder.length>0);assert.ok(wolfFolder.every(m=>m.path.startsWith('creature/wolf/')));
 for(const m of c.items){assert.ok(modelPath(m.path));assert.ok(allRoots.includes(m.path.split('/')[0]+'/'));assert.ok(a.files.get(m.id)?.local);assert.equal(m.source.buildKey,a.build.key);assert.equal(m.source.contentKey,a.files.get(m.id).contentKey);}
 for(const root of ['creature/','character/','item/','models/','world/','spells/','interiors/','test/']){
  const list=selectModels(c.items,{folder:root});assert.ok(list.length>0);assert.ok(list.every(m=>m.path.startsWith(root)));
  assert.equal(c.query(new URLSearchParams({folder:root})).total,list.length);
 }
 assert.equal(selectModels(c.items,{folder:'sound/'}).length,0);assert.equal(selectModels(c.items,{folder:'fonts/'}).length,0);
 const itemModels=selectModels(c.items,{folder:'item/'}),referencedItems=itemModels.filter(m=>m.inBetaTables),unreferencedItems=itemModels.filter(m=>!m.inBetaTables);
 assert.ok(referencedItems.length>0);assert.ok(unreferencedItems.length>0);
 const resources=new Set([...c.tables.ItemDisplayInfo.values()].flatMap(row=>row.ModelResourcesID||[]).filter(Boolean));
 const expectedItems=new Set([...c.tables.ModelFileData.values()].filter(row=>resources.has(row.ModelResourcesID)).map(row=>row.FileDataID));
 for(const item of itemModels)assert.equal(item.inBetaTables,expectedItems.has(item.id));
 const chrFiles=new Set([...c.tables.ChrModel.values()].map(row=>c.tables.CreatureModelData.get(c.tables.CreatureDisplayInfo.get(row.DisplayID)?.ModelID)?.FileDataID));
 for(const character of selectModels(c.items,{folder:'character/'}))assert.equal(character.inBetaTables,chrFiles.has(character.id));
 const {Metadata}=require('../server/metadata'),metadata=new Metadata(a,c),itemInfo=await metadata.get(referencedItems[0].id);
 assert.ok(itemInfo.itemDisplayIDs.length>0);assert.equal(itemInfo.raw.ItemDisplayInfo.length,itemInfo.itemDisplayIDs.length);
 const readAudio=createAudioReader(a);
 const sounds=require('../server/sounds').soundIndex(a);assert.ok(sounds.length>100000);
 for(const [id,name]of sounds){assert.ok(a.files.get(id)?.local);assert.equal(a.names.get(id),name);assert.ok(name.startsWith('sound/'));}
 for(const [id,type] of [[53183,'audio/mpeg'],[537320,'audio/ogg']]){const sound=await readAudio(id);assert.equal(sound.type,type);assert.equal(crypto.createHash('md5').update(sound.data).digest('hex'),a.files.get(id).contentKey);assert.equal(await readAudio(id),sound);}
 const wav=await readAudio(548053,{wav:true});assert.equal(wav.type,'audio/wav');assert.equal(wav.data.toString('ascii',8,12),'WAVE');assert.equal(wav.data.readUInt32LE(4),wav.data.length-8);assert.equal(await readAudio(548053,{wav:true}),wav);
 await assert.rejects(readAudio(126487),/not a supported sound/);
 const all=selectModels(c.items),inside=selectModels(c.items,{table:'yes'}),outside=selectModels(c.items,{table:'no'});
 assert.equal(inside.length+outside.length,all.length);assert.ok(inside.every(m=>m.inBetaTables));assert.ok(outside.every(m=>!m.inBetaTables));assert.equal(new Set([...inside,...outside].map(m=>m.id)).size,all.length);
 for(const category of ['beast','mount','companion']){const list=selectModels(c.items,{category});assert.ok(list.length>0);assert.ok(list.every(m=>m[category]));}
 for(const sort of ['name','id','size','skins','table']){const asc=selectModels(c.items,{sort,direction:'asc'}),desc=selectModels(c.items,{sort,direction:'desc'});assert.equal(asc.length,all.length);assert.equal(desc.length,all.length);if(sort!=='name'){const key={id:'id',size:'size',skins:'appearanceCount',table:'inBetaTables'}[sort];assert.ok(asc.every((m,i)=>!i||Number(asc[i-1][key])<=Number(m[key])));assert.ok(desc.every((m,i)=>!i||Number(desc[i-1][key])>=Number(m[key])));}assert.ok(asc[59]&&asc[60]&&asc[61]&&asc.at(-1));}
 assert.throws(()=>selectModels(c.items,{category:'bogus'}),/Unknown category/);
 const mount=await readDB(a,'Mount'),links=await readDB(a,'MountXDisplay'),creature=await readDB(a,'Creature');
 assert.equal(mount.rows.get(6).Name_lang,'Brown Horse');assert.equal(links.rows.get(1).MountID,6);assert.equal(creature.rows.get(2671).Name_lang,'Mechanical Squirrel');
 for(const id of [126487,3636995,3071312,5930363,7935081]){const data=await a.getFile(id);assert.equal(crypto.createHash('md5').update(data).digest('hex'),a.files.get(id).contentKey);}
 const encrypted=await a.readEntry(a.files.get(7867342));assert.throws(()=>decodeBLTE(encrypted),e=>e.code==='MISSING_KEY');assert.equal(decodeBLTE(encrypted,{keys:a.keys}).toString('ascii',0,4),'MD21');
 await assert.rejects(a.getFile(7865686),e=>e.code==='MISSING_KEY');await assert.rejects(a.getFile(0),/not in installed build/);
 const wolf=await parseM2(a,126487);assert.equal(wolf.positions.length/3,557);assert.ok(wolf.indices.every(i=>i<557));assert.ok(c.appearances.get(126487).length>=12);
 const stand=await animation(a,wolf,wolf.animations.findIndex(x=>x.id===0));assert.ok(stand.duration>0);assert.equal(stand.bones.length,wolf.bones.length);
 const skin=c.appearances.get(126487)[0].textures.find(Boolean),texture=decodeBLP(await a.getFile(skin));assert.equal(png(texture.width,texture.height,texture.pixels).toString('hex',0,8),'89504e470d0a1a0a');
 const parallel=await Promise.all(Array.from({length:20},()=>a.getFile(126487)));assert.ok(parallel.every(b=>b.equals(parallel[0])));
 for(const root of ['character/','item/','models/']){
  const entry=c.items.find(m=>m.readable&&m.path.startsWith(root)),model=await parseM2(a,entry.id);
  assert.ok(model.positions.length>0);assert.ok(model.indices.length>0);assert.ok(model.indices.every(i=>i<model.positions.length/3));
 }
 const building=c.items.find(m=>m.type==='wmo'&&m.readable),worldModel=await parseWMO(a,building.id);
 assert.ok(worldModel.positions.length>0);assert.ok(worldModel.indices.length>0);assert.ok(worldModel.groups.length>0);assert.ok(worldModel.indices.every(i=>i<worldModel.positions.length/3));
 const worldProp=c.items.find(m=>m.type==='m2'&&m.readable&&m.path.startsWith('world/')),prop=await parseM2(a,worldProp.id);assert.ok(prop.positions.length>0);
 console.log(JSON.stringify({build:a.build.version,counts:c.status().counts,readable:c.items.filter(m=>m.readable).length,tableReferences:inside.length,itemReferences:referencedItems.length,characterReferences:selectModels(c.items,{folder:'character/',table:'yes'}).length,unavailable:c.items.filter(m=>!m.readable).length,building:building.path}));
});

test('UI IDs are unique and the playback control is not an SVG symbol',async()=>{
 const html=await require('node:fs/promises').readFile(require('node:path').join(__dirname,'../public/index.html'),'utf8');
 const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);assert.equal(ids.length,new Set(ids).size);
 assert.match(html,/<button id="play"/);assert.match(html,/<symbol id="icon-play"/);assert.doesNotMatch(html,/page-prev|page-next|id="family"/);
 assert.deepEqual([...html.matchAll(/data-root="([^"]+)"/g)].map(m=>m[1]),['creature/','character/','item/','models/']);assert.match(html,/<details id="subfolders">/);
 assert.match(html,/<button id="misc-button"[^>]*>misc /);assert.match(html,/id="misc-menu"[^>]*hidden/);
});
