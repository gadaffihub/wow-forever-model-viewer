import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {selectModels,modelRoots,miscRoots,allRoots,buildFolderTree,referenceLabel} from './catalog.mjs';
const $=id=>document.getElementById(id),num=n=>Number(n||0).toLocaleString();
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icon=name=>`<svg><use href="#icon-${name}"/></svg>`;
const appVersion=document.querySelector('meta[name="viewer-version"]').content;
function saved(key,fallback){try{return JSON.parse(localStorage.getItem(key))??fallback;}catch{return fallback;}}
const preferences=saved('wow.preferences',{});
const state={category:'all',folder:preferences.folder||'creature/',favoritesOnly:false,q:'',table:preferences.table||'all',sort:preferences.sort||'folder',direction:preferences.direction||'asc',catalog:[],revision:null,total:0,items:[],selected:null,index:-1,favorites:new Set(saved('wilds.favorites',[])),info:null,model:null,appearance:0,loading:false};
let folders=buildFolderTree([]);const expandedFolders=new Set();
let sounds=null,soundLibraryRequest;
const soundMode=()=>state.folder.startsWith('sound/');
let modelToken=0,animationToken=0,controller,toastTimer;
function toast(text){$('toast').textContent=text;$('toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('show'),2800);}
async function api(path,signal){const response=await fetch(path,{signal,cache:'no-store'}),data=await response.json();if(!response.ok)throw Object.assign(new Error(data.error||`Request failed (${response.status})`),{code:data.code});return data;}
function message(title,body=''){$('stage-message').classList.remove('hidden');$('stage-message').innerHTML=`<h3>${esc(title)}</h3>${body?`<p>${esc(body)}</p>`:''}`;}
const rowHeight=38;
function renderList(){
 const list=$('results'),scroll=list.scrollTop;
 const start=Math.max(0,Math.min(state.items.length-1,Math.floor(scroll/rowHeight))-12),end=Math.min(state.items.length,start+Math.ceil(list.clientHeight/rowHeight)+24);
 list.innerHTML=state.items.length?`<div aria-hidden="true" style="height:${start*rowHeight}px"></div>`+state.items.slice(start,end).map((model,offset)=>`<button class="model-row ${model.id===state.selected?'selected':''}" data-id="${model.id}" data-index="${start+offset}" title="${esc(model.unavailableReason||model.name)}"><span class="model-label"><strong>${esc(model.name)}</strong></span>${state.favorites.has(model.id)?'<span class="row-star">☆</span>':''}</button>`).join('')+`<div aria-hidden="true" style="height:${(state.items.length-end)*rowHeight}px"></div>`:`<div class="empty-results">${folders.index.get(state.folder)?.count?soundMode()?'No sounds match these filters.':'No models match these filters.':`No ${soundMode()?'sounds':'viewable models'} in ${esc(state.folder)}`}</div>`;
 list.scrollTop=scroll;$('result-count').textContent=soundMode()&&sounds===null?'Loading sounds…':`${num(state.total)} ${soundMode()?(state.total===1?'sound':'sounds'):(state.total===1?'model':'models')}`;updatePosition();
}
let listFrame;
$('results').addEventListener('scroll',()=>{cancelAnimationFrame(listFrame);listFrame=requestAnimationFrame(renderList);},{passive:true});
new ResizeObserver(renderList).observe($('results'));
function highlightSelection(){
 const list=$('results'),top=state.index*rowHeight;
 if(state.index>=0){if(top<list.scrollTop)list.scrollTop=top;else if(top+rowHeight>list.scrollTop+list.clientHeight)list.scrollTop=top+rowHeight-list.clientHeight;}
 renderList();
}
function updatePosition(){
 $('position').textContent=state.index>=0?`${num(state.index+1)} / ${num(state.total)}`:'';
 $('prev-model').disabled=state.index<=0;$('next-model').disabled=state.total===0||state.index>=state.total-1;
 $('favorite').classList.toggle('saved',state.favorites.has(state.selected));$('favorite').setAttribute('aria-pressed',String(state.favorites.has(state.selected)));
}
function clearSelection(){
 stopSound();
 ++modelToken;++animationToken;controller?.abort();state.selected=null;state.index=-1;state.model=null;state.loading=false;playing=false;disposeModel();updatePlay();
 $('model-name').textContent='';$('model-info').textContent='';selectedInfo=null;$('appearances').innerHTML='';$('appearance-count').textContent='0';$('model-warnings').textContent='';$('animation-note').textContent='';$('animation').innerHTML='<option value="-1">No animation</option>';$('stage-message').classList.add('hidden');updatePosition();
}
function filterCatalog({preferred=state.selected,resetScroll=false}={}){
 if(soundMode()&&sounds===null){state.items=[];state.total=0;clearSelection();renderList();$('results').innerHTML='<div class="empty-results">Loading sounds…</div>';loadSoundLibrary();return;}
 try{state.items=selectModels(soundMode()?sounds:state.catalog,{...state,table:soundMode()?'all':state.table,category:state.favoritesOnly?'favorites':'all',favorites:[...state.favorites]});}
 catch{state.category='all';state.table='all';state.sort='name';state.items=selectModels(soundMode()?sounds:state.catalog,{folder:state.folder});syncFilters();}
 state.total=state.items.length;state.index=state.items.findIndex(model=>model.id===preferred);
 if(resetScroll)$('results').scrollTop=0;renderList();
 if(!state.items.length){clearSelection();return;}
 const index=state.index>=0?state.index:0,model=state.items[index];
 if(model.id!==state.selected||!state.model)loadModel(model.id,index);else{state.index=index;highlightSelection();}
}
function syncFilters(){
 const audio=soundMode();$('table-filter').hidden=audio;document.querySelector('[data-sort="skins"]').hidden=audio;
 document.querySelector('.animation-panel').hidden=audio;document.querySelector('.view-controls').hidden=audio;$('snapshot').hidden=audio;$('reset-camera').hidden=audio;
 document.querySelector('[data-panel="skins"]').hidden=audio;$('results').setAttribute('aria-label',audio?'Sounds':'Models');$('search').placeholder=audio?'Search sounds…':'Search models…';$('search').setAttribute('aria-label',audio?'Search sounds':'Search models');
 for(const [id,label]of [['prev-model','Previous'],['next-model','Next']]){$(id).setAttribute('aria-label',`${label} ${audio?'sound':'model'}`);$(id).title=`${label} ${audio?'sound':'model'} (${id==='prev-model'?'←':'→'})`;}
 $('favorite').setAttribute('aria-label',audio?'Favorite sound':'Favorite model');
 const rootPath=allRoots.find(path=>state.folder.startsWith(path))||'creature/';
 $('misc-button').classList.toggle('active',!modelRoots.includes(rootPath));
 document.querySelectorAll('[data-misc-root]').forEach(button=>button.classList.toggle('active',button.dataset.miscRoot===rootPath));
 const summary=$('subfolders').querySelector('summary');summary.textContent=state.folder===rootPath&&modelRoots.includes(rootPath)?'Subfolders':state.folder;summary.title=state.folder;
 document.querySelectorAll('[data-root]').forEach(button=>{const active=state.folder.startsWith(button.dataset.root);button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));});
 document.querySelectorAll('[data-folder]').forEach(button=>{const active=button.dataset.folder===state.folder;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));});$('only-favorites').classList.toggle('active',state.favoritesOnly);$('only-favorites').setAttribute('aria-pressed',String(state.favoritesOnly));
 const tableKind=referenceLabel(state.folder);$('table-filter').options[1].textContent=`In ${tableKind} tables`;$('table-filter').options[2].textContent=`Not in ${tableKind} tables`;$('table-filter').value=state.table;
 document.querySelectorAll('[data-sort]').forEach(button=>{const active=button.dataset.sort===state.sort;button.classList.toggle('active',active);button.textContent={folder:'Folder',name:'Name',id:'File ID',skins:'Skins',size:'Size',table:'Beta table'}[button.dataset.sort]+(active?(state.direction==='asc'?' ↑':' ↓'):'');});
}
function changeFilter(){
 localStorage.setItem('wow.preferences',JSON.stringify({folder:state.folder,table:state.table,sort:state.sort,direction:state.direction}));syncFilters();filterCatalog({resetScroll:true});
}
function next(direction){const index=state.index<0?0:state.index+direction;if(index>=0&&index<state.items.length)loadModel(state.items[index].id,index,{autoplay:true});}
function chooseRoot(path){
 if(!allRoots.includes(path))return;
 state.folder=path;
 if(soundMode()&&['skins','table'].includes(state.sort))state.sort='folder';
 if(!modelRoots.includes(path))state.table='all';
 expandedFolders.clear();$('subfolders').open=false;closeMisc();renderFolderTree();changeFilter();
}
function closeMisc(){$('misc-menu').hidden=true;$('misc-button').setAttribute('aria-expanded','false');}
$('misc-menu').innerHTML=miscRoots.map(path=>`<button data-misc-root="${esc(path)}">${esc(path)}</button>`).join('');
$('misc-button').onclick=()=>{const open=$('misc-menu').hidden;$('misc-menu').hidden=!open;$('misc-button').setAttribute('aria-expanded',String(open));};
$('misc-menu').onclick=event=>{const button=event.target.closest('[data-misc-root]');if(button)chooseRoot(button.dataset.miscRoot);};
document.addEventListener('click',event=>{if(!event.target.closest('.misc-selector'))closeMisc();});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!$('misc-menu').hidden){closeMisc();$('misc-button').focus();}});
function favorite(){if(!state.selected)return;if(state.favorites.has(state.selected))state.favorites.delete(state.selected);else state.favorites.add(state.selected);localStorage.setItem('wilds.favorites',JSON.stringify([...state.favorites]));filterCatalog();}

const scene=new THREE.Scene();scene.background=new THREE.Color('#000000');
const camera=new THREE.PerspectiveCamera(36,1,.01,10000);camera.position.set(5,2,7);
const renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,preserveDrawingBuffer:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.15;$('viewport').appendChild(renderer.domElement);
const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.dampingFactor=.08;controls.minDistance=.2;controls.maxDistance=500;controls.target.set(0,1,0);
const hemi=new THREE.HemisphereLight(0xdde9db,0x263e30,2.1);scene.add(hemi);const key=new THREE.DirectionalLight(0xffe8c6,2.9);key.position.set(4,7,5);scene.add(key);const fill=new THREE.DirectionalLight(0x97b8cc,1.6);fill.position.set(-4,2,-5);scene.add(fill);
const grid=new THREE.GridHelper(30,60,0x385147,0x263d34);grid.material.transparent=true;grid.material.opacity=.28;grid.visible=false;scene.add(grid);
const ring=new THREE.Mesh(new THREE.RingGeometry(2.8,2.81,96),new THREE.MeshBasicMaterial({color:0x52715a,side:THREE.DoubleSide,transparent:true,opacity:.25}));ring.rotation.x=-Math.PI/2;ring.position.y=.002;ring.visible=false;scene.add(ring);
let root=null,meshes=[],boneNodes=[],boneMatrices=[],clip=null,elapsed=0,playing=false,dimensions=null,resources=[];
const trackV=new THREE.Vector3(),trackQ=new THREE.Quaternion(),trackS=new THREE.Vector3(),pivotV=new THREE.Vector3(),scratchM=new THREE.Matrix4(),negativePivot=new THREE.Matrix4();
const textureLoader=new THREE.TextureLoader();let texturePromises=new Map();
function disposeModel(){if(root)scene.remove(root);for(const r of resources)r.dispose?.();resources=[];root=null;meshes=[];boneNodes=[];boneMatrices=[];clip=null;elapsed=0;texturePromises=new Map();}
function resize(){const r=$('viewport').getBoundingClientRect();renderer.setSize(r.width,r.height);camera.aspect=r.width/r.height;camera.updateProjectionMatrix();}new ResizeObserver(resize).observe($('viewport'));
function fitCamera(){if(!root)return;const box=new THREE.Box3().setFromObject(root,true),size=box.getSize(new THREE.Vector3()),center=box.getCenter(new THREE.Vector3());const radius=Math.max(size.length()/2,.25);const distance=radius/Math.sin(THREE.MathUtils.degToRad(camera.fov/2))/Math.min(1,camera.aspect)*1.14;camera.position.copy(center).add(new THREE.Vector3(1,.36,1.2).normalize().multiplyScalar(distance));controls.target.copy(center);camera.near=Math.max(.001,radius/200);camera.far=Math.max(1000,radius*100);camera.updateProjectionMatrix();controls.maxDistance=distance*15;controls.minDistance=radius*.15;controls.update();}
async function getTexture(id,token){if(!id)return null;if(texturePromises.has(id))return texturePromises.get(id);const p=textureLoader.loadAsync(`/api/texture/${id}.png`).then(t=>{if(token!==modelToken){t.dispose();return null;}t.colorSpace=THREE.SRGBColorSpace;t.flipY=false;t.wrapS=t.wrapT=THREE.RepeatWrapping;t.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());resources.push(t);return t;}).catch(()=>null);texturePromises.set(id,p);return p;}
async function applyAppearance(index){
 state.appearance=index;const m=state.model;if(!m)return;const token=modelToken,appearance=m.appearances[index];$('appearances').querySelectorAll('.appearance').forEach((b,i)=>{b.classList.toggle('selected',i===index);b.setAttribute('aria-pressed',String(i===index));});const label=$('appearance-name');if(label)label.textContent=appearance?.label||'Original model textures';
 let missing=0;await Promise.all(meshes.map(async(mesh,i)=>{const slot=m.groups[i].texture,entry=m.textures[slot];if(!entry)return;let id=entry.id;if(entry.type>=11&&entry.type<=14)id=appearance?.textures[entry.type-11]||id;const t=await getTexture(id,token);if(token!==modelToken||index!==state.appearance)return;if(!t&&id)missing++;mesh.material.map=t;mesh.material.color.set(t?0xffffff:0x9eaa93);mesh.material.needsUpdate=true;}));
 if(token===modelToken){const unresolved=m.textures.filter(t=>t.type!==0&&!t.id&&!(t.type>=11&&t.type<=14&&appearance?.textures[t.type-11])).length;const notes=[...m.warnings];if(missing)notes.push(`${missing} texture slots could not be loaded locally.`);if(unresolved)notes.push(`${unresolved} replaceable texture slots have no mapped appearance. Shown in neutral material.`);$('model-warnings').textContent=notes.join(' ');}
}
function buildMesh(m){
 root=new THREE.Group();scene.add(root);const base=new THREE.BufferGeometry();base.setAttribute('position',new THREE.Float32BufferAttribute(m.positions,3));if(m.normals.length===m.positions.length)base.setAttribute('normal',new THREE.Float32BufferAttribute(m.normals,3));if(m.uv.length===m.positions.length/3*2)base.setAttribute('uv',new THREE.Float32BufferAttribute(m.uv,2));
 let skeleton;if(m.bones.length&&m.weights?.length){base.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(m.boneIndices,4));base.setAttribute('skinWeight',new THREE.Float32BufferAttribute(m.weights,4));boneNodes=m.bones.map(()=>new THREE.Bone());boneMatrices=m.bones.map(()=>new THREE.Matrix4());skeleton=new THREE.Skeleton(boneNodes,m.bones.map(()=>new THREE.Matrix4()));resources.push(skeleton);}
 const allIndices=new Uint32Array(m.indices);for(const g of m.groups){const geometry=new THREE.BufferGeometry();for(const [name,a]of Object.entries(base.attributes))geometry.setAttribute(name,a);geometry.setIndex(new THREE.BufferAttribute(allIndices.slice(g.start,g.start+g.count),1));if(!geometry.attributes.normal)geometry.computeVertexNormals();const mat=g.material||{};const material=new THREE.MeshStandardMaterial({color:0x9eaa93,roughness:1,metalness:0,side:(mat.flags&4)?THREE.DoubleSide:THREE.FrontSide,alphaTest:mat.blend===1?.4:0,transparent:mat.blend>=2,depthWrite:!(mat.blend>=2),wireframe:$('wireframe').checked});if(mat.blend===3||mat.blend===4)material.blending=THREE.AdditiveBlending;const mesh=skeleton?new THREE.SkinnedMesh(geometry,material):new THREE.Mesh(geometry,material);if(skeleton){mesh.bindMode='detached';mesh.bind(skeleton,new THREE.Matrix4());}mesh.frustumCulled=false;root.add(mesh);meshes.push(mesh);resources.push(geometry,material);}
 const box=new THREE.Box3().setFromObject(root,true),size=box.getSize(new THREE.Vector3());dimensions=size;const scale=4/Math.max(size.x,size.y,size.z,.001);root.scale.setScalar(scale);root.position.set(-(box.min.x+size.x/2)*scale,-box.min.y*scale,-(box.min.z+size.z/2)*scale);fitCamera();renderer.render(scene,camera);

}
async function loadModel(id,index,{autoplay=false}={}){
 if(state.items[index]?.type==='sound'){loadSound(id,index,autoplay);return;}
 soundPlayer.controls=false;soundPlayer.remove();
 stopSound();
 const token=++modelToken;++animationToken;controller?.abort();controller=new AbortController();state.selected=id;state.index=index;state.loading=true;loadInfo(id,token);state.model=null;playing=false;updatePlay();disposeModel();highlightSelection();const entry=state.items[index];$('model-name').textContent=entry?.name||`Model ${id}`;message('Loading…','',true);$('animation-note').textContent='';$('model-warnings').textContent='';$('appearances').innerHTML='';$('appearance-count').textContent='—';$('animation').innerHTML='<option value="-1">Bind pose</option>';
 try{if(entry&&!entry.readable)throw new Error(entry.unavailableReason);const m=await api(`/api/model/${id}`,controller.signal);if(token!==modelToken)return;state.model=m;state.loading=false;renderInfo();buildMesh(m);$('model-name').textContent=m.entry.name;$('appearance-count').textContent=m.appearances.length;$('appearances').innerHTML=m.appearances.length?m.appearances.map((a,i)=>`<button class="appearance" data-appearance="${i}" title="${esc(skinLabel(a.label,m.entry.name))}" aria-label="${esc(skinLabel(a.label,m.entry.name))}"><span class="skin-loading">Loading…</span><span class="skin-label">${esc(skinLabel(a.label,m.entry.name))}</span></button>`).join(''):'<p class="muted" style="grid-column:1/-1">No alternate skins in this client’s creature tables.</p>';
 $('animation').innerHTML='<option value="-1">Bind pose</option>'+m.animations.map((a,i)=>`<option value="${i}">${esc(a.name)}</option>`).join('');await applyAppearance(0);if(token!==modelToken)return;$('stage-message').classList.add('hidden');const idle=m.animations.findIndex(a=>a.id===0);const first=idle>=0?idle:m.animations.length?0:-1;$('animation').value=String(first);if(first>=0)await loadAnimation(first);if(token!==modelToken)return;fitCamera();generateSkinPreviews(m,token).catch(e=>{if(token===modelToken)$('model-warnings').textContent='Skin previews: '+e.message;});localStorage.setItem('wilds.lastModel',String(id));$('results').querySelector('.selected')?.scrollIntoView({block:'nearest'});
 }catch(e){if(e.name==='AbortError'||token!==modelToken)return;state.loading=false;if(e.code==='OUTSIDE_CATALOG'){await fetchCatalog();return;}message('This model couldn’t be opened',e.message+' Use → to continue exploring.');$('model-warnings').textContent=e.message;}
}
async function loadAnimation(index){const token=++animationToken,mt=modelToken;clip=null;elapsed=0;for(const bone of boneNodes)bone.matrixWorld.identity();if(index<0){$('animation-note').textContent='';return;}$('animation-note').textContent='Reading animation tracks…';try{const data=await api(`/api/animation/${state.selected}/${index}`);if(token!==animationToken||mt!==modelToken)return;clip=data;playing=false;animateBones(0);renderer.render(scene,camera);updatePlay();$('animation-note').textContent='';}catch(e){if(token===animationToken&&mt===modelToken)$('animation-note').textContent=e.message;}}
function updatePlay(){$('play').innerHTML=icon(playing?'pause':'play');$('play').setAttribute('aria-label',playing?'Pause animation':'Play animation');}
function sample(t,time,kind){const fallback=kind==='scale'?[1,1,1]:kind==='rotation'?[0,0,0,1]:[0,0,0];if(!t?.times?.length||!t.values?.length)return fallback;if(t.globalDuration)time%=t.globalDuration;const times=t.times,values=t.values;let lo=0,hi=Math.min(times.length,values.length)-1;if(time<=times[0])return values[0];if(time>=times[hi])return values[hi];while(hi-lo>1){const mid=(lo+hi)>>1;if(times[mid]<=time)lo=mid;else hi=mid;}if(t.interpolation===0)return values[lo];const f=(time-times[lo])/Math.max(1,times[hi]-times[lo]);if(kind==='rotation'){trackQ.fromArray(values[lo]).normalize();return trackQ.slerp(new THREE.Quaternion().fromArray(values[hi]).normalize(),f).toArray();}return values[lo].map((v,i)=>v+(values[hi][i]-v)*f);}
function animateBones(time){const m=state.model;if(!m||!clip)return;const done=new Uint8Array(m.bones.length);function update(i){if(done[i])return;done[i]=1;const bone=m.bones[i],tracks=clip.bones[i],parent=bone.parent;if(parent>=0&&parent<m.bones.length&&parent!==i)update(parent);const translation=sample(tracks?.translation,time,'translation'),rotation=sample(tracks?.rotation,time,'rotation'),scale=sample(tracks?.scale,time,'scale');trackV.fromArray(translation).add(pivotV.fromArray(bone.pivot));trackQ.fromArray(rotation).normalize();trackS.fromArray(scale);const mat=boneMatrices[i];mat.compose(trackV,trackQ,trackS);negativePivot.makeTranslation(-bone.pivot[0],-bone.pivot[1],-bone.pivot[2]);mat.multiply(negativePivot);if(parent>=0&&parent<m.bones.length&&parent!==i)mat.premultiply(boneMatrices[parent]);boneNodes[i].matrixWorld.copy(mat);}for(let i=0;i<m.bones.length;i++)update(i);}
let lastTime=performance.now(),lastUI=0;renderer.setAnimationLoop(time=>{const delta=Math.min((time-lastTime)/1000,.1);lastTime=time;if(clip){if(playing)elapsed=(elapsed+delta*Number($('speed').value))%Math.max(.001,clip.duration/1000);if(playing)animateBones(elapsed*1000);if(time-lastUI>100){$('timeline').value=String(elapsed/(clip.duration/1000||1));$('time-label').textContent=`${elapsed.toFixed(2)} / ${(clip.duration/1000).toFixed(2)} s`;lastUI=time;}}if(root&&$('rotate').checked)root.rotation.y+=delta*.23;controls.update();renderer.render(scene,camera);});

$('results').addEventListener('click',e=>{const b=e.target.closest('[data-id]');if(b)loadModel(Number(b.dataset.id),Number(b.dataset.index),{autoplay:true});});$('folder-buttons').onclick=event=>{const button=event.target.closest('[data-root]');if(button)chooseRoot(button.dataset.root);};$('folder-tree').onclick=event=>{const expand=event.target.closest('[data-expand]');if(expand){const path=expand.dataset.expand;expandedFolders.has(path)?expandedFolders.delete(path):expandedFolders.add(path);renderFolderTree();return;}const button=event.target.closest('[data-folder]');if(button){state.folder=button.dataset.folder;changeFilter();}};$('only-favorites').onclick=()=>{state.favoritesOnly=!state.favoritesOnly;changeFilter();};let searchTimer;$('search').oninput=()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>{state.q=$('search').value;changeFilter();},180);};document.querySelectorAll('[data-sort]').forEach(button=>button.onclick=()=>{const sort=button.dataset.sort;state.direction=state.sort===sort?(state.direction==='asc'?'desc':'asc'):(['folder','name'].includes(sort)?'asc':'desc');state.sort=sort;document.querySelectorAll('[data-sort]').forEach(b=>{const label={folder:'Folder',name:'Name',id:'File ID',skins:'Skins',size:'Size'}[b.dataset.sort];b.classList.toggle('active',b===button);b.textContent=label+(b===button?(state.direction==='asc'?' ↑':' ↓'):'');});changeFilter();});$('table-filter').onchange=()=>{state.table=$('table-filter').value;changeFilter();};$('prev-model').onclick=()=>next(-1);$('next-model').onclick=()=>next(1);$('favorite').onclick=favorite;$('reset-camera').onclick=()=>{if(root)root.rotation.y=0;fitCamera();};$('appearances').onclick=e=>{const b=e.target.closest('[data-appearance]');if(b)applyAppearance(Number(b.dataset.appearance));};$('animation').onchange=()=>loadAnimation(Number($('animation').value));$('play').onclick=()=>{playing=!playing;updatePlay();};$('timeline').oninput=()=>{if(clip)elapsed=Number($('timeline').value)*clip.duration/1000;};$('wireframe').onchange=()=>meshes.forEach(m=>m.material.wireframe=$('wireframe').checked);document.querySelectorAll('[data-bg]').forEach(b=>b.onclick=()=>{scene.background.set(b.dataset.bg);document.querySelectorAll('[data-bg]').forEach(x=>x.classList.toggle('selected',x===b));});
$('snapshot').onclick=()=>{if(!state.model)return;renderer.render(scene,camera);renderer.domElement.toBlob(blob=>{const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`wow-${state.selected}.png`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),5000);toast('Screenshot saved');},'image/png');};window.addEventListener('keydown',e=>{if(e.target.closest('input,select,textarea,audio,[contenteditable]')||e.metaKey||e.ctrlKey||e.altKey)return;if(e.key==='ArrowRight'){e.preventDefault();e.shiftKey?nextSkin(1):next(1);}else if(e.key==='ArrowLeft'){e.preventDefault();e.shiftKey?nextSkin(-1):next(-1);}else if(e.code==='Space'){e.preventDefault();if(soundMode()){if(state.selected)playSound(state.selected);}else{playing=!playing;updatePlay();}}else if(e.key.toLowerCase()==='f')favorite();else if(e.key==='0'){$('reset-camera').click();}else if(e.key==='/'){e.preventDefault();$('search').focus();}});
let initialized=false,polling=false;
async function fetchCatalog(){
 const snapshot=await api('/api/catalog');
 if(snapshot.appVersion!==appVersion){location.reload();return;}
 state.catalog=snapshot.items;state.revision=snapshot.revision;state.info=snapshot;populateFolders();
 const preferred=state.selected||Number(localStorage.getItem('wilds.lastModel')||126487);
 initialized=true;filterCatalog({preferred});
}
async function poll(){
 if(polling)return;polling=true;
 try{
   const info=await api('/api/status');
   if(info.appVersion&&info.appVersion!==appVersion){location.reload();return;}
   if(info.phase==='error'){message('Cannot open installation',info.error);return;}
   if(info.phase!=='ready'){if(!initialized)message('Opening beta files…',info.message||'');return;}
   if(!initialized||state.revision!==info.revision)await fetchCatalog();
 }catch(error){if(!initialized)message('Cannot reach local viewer',error.message);}
 finally{polling=false;}
}
syncFilters();updatePosition();poll();setInterval(poll,5000);

function skinLabel(label,modelName){
 let s=label.replace(/^.*?skin(?:s)?[ _-]*/i,'');
 if(s===label)s=s.replace(new RegExp('^'+modelName.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'i'),'');
 s=s.replace(/([a-z])(Black|White|Brown|Blue|Green|Red|Grey|Gray|Gold|Alpha)/g,'$1 $2').replace(/(reddish|dark|light|arctic|blue)(brown|grey|gray|alpha|blue|green|red)/gi,'$1 $2').replaceAll('_',' ').trim();
 return (s||label).replace(/\b\w/g,c=>c.toUpperCase());
}
function nextSkin(direction){const count=state.model?.appearances.length||0;if(!count)return;applyAppearance((state.appearance+direction+count)%count);}
$('skin-prev').onclick=()=>nextSkin(-1);$('skin-next').onclick=()=>nextSkin(1);
let previewRenderer;
async function generateSkinPreviews(m,token){
 if(!m.appearances.length)return;
 if(!previewRenderer){previewRenderer=new THREE.WebGLRenderer({antialias:true,alpha:false,preserveDrawingBuffer:true});previewRenderer.setSize(240,192);previewRenderer.setPixelRatio(1);previewRenderer.outputColorSpace=THREE.SRGBColorSpace;previewRenderer.toneMapping=renderer.toneMapping;previewRenderer.toneMappingExposure=renderer.toneMappingExposure;}
 const thumbCamera=new THREE.PerspectiveCamera(32,240/192,.01,1000);
 const box=new THREE.Box3().setFromObject(root,true),center=box.getCenter(new THREE.Vector3()),radius=box.getSize(new THREE.Vector3()).length()/2;
 thumbCamera.position.copy(center).add(new THREE.Vector3(1,.32,1.35).normalize().multiplyScalar(radius/Math.sin(THREE.MathUtils.degToRad(16))*1.02));thumbCamera.lookAt(center);
 for(let index=0;index<m.appearances.length;index++){
   const a=m.appearances[index];const textures=await Promise.all(m.groups.map(async g=>{const t=m.textures[g.texture];if(!t)return null;const id=t.type>=11&&t.type<=14?a.textures[t.type-11]||t.id:t.id;return getTexture(id,token);}));
   if(token!==modelToken)return;
   const maps=meshes.map(x=>x.material.map),colors=meshes.map(x=>x.material.color.clone()),wires=meshes.map(x=>x.material.wireframe),background=scene.background,rotation=root.rotation.y;
   scene.background=new THREE.Color('#000000');root.rotation.y=0;
   meshes.forEach((mesh,i)=>{mesh.material.map=textures[i];mesh.material.color.set(textures[i]?0xffffff:0xaaaaaa);mesh.material.wireframe=false;mesh.material.needsUpdate=true;});
   previewRenderer.render(scene,thumbCamera);const url=previewRenderer.domElement.toDataURL('image/png');
   meshes.forEach((mesh,i)=>{mesh.material.map=maps[i];mesh.material.color.copy(colors[i]);mesh.material.wireframe=wires[i];mesh.material.needsUpdate=true;});scene.background=background;root.rotation.y=rotation;
   const button=$('appearances').querySelector(`[data-appearance="${index}"]`);if(button){const img=new Image();img.src=url;img.alt=skinLabel(a.label,m.entry.name);button.querySelector('.skin-loading')?.replaceWith(img);}
   await new Promise(r=>setTimeout(r,15));
 }
}

let selectedInfo=null;
const soundPlayer=new Audio();soundPlayer.preload='none';
const soundURL=id=>`/api/sound/${id}${soundPlayer.canPlayType('audio/ogg; codecs="vorbis"')?'':'?format=wav'}`;
let selectedSoundID=null,soundToken=0;
function updateSoundButtons(){
 $('model-info').querySelectorAll('[data-sound]').forEach(button=>{
   const active=Number(button.dataset.sound)===selectedSoundID&&!soundPlayer.paused&&!soundPlayer.ended;
   button.setAttribute('aria-pressed',String(active));button.setAttribute('aria-label',`${active?'Pause':'Play'} sound ${button.dataset.sound}`);
   button.querySelector('.sound-state').textContent=active?'Ⅱ':'▶';
 });
}
function stopSound(){++soundToken;soundPlayer.pause();soundPlayer.removeAttribute('src');soundPlayer.load();selectedSoundID=null;updateSoundButtons();}
async function playSound(id){
 const token=++soundToken;
 if(id===selectedSoundID&&!soundPlayer.paused){soundPlayer.pause();return;}
 if(id!==selectedSoundID){soundPlayer.pause();selectedSoundID=id;soundPlayer.src=soundURL(id);}
 try{await soundPlayer.play();if(token===soundToken)updateSoundButtons();}
 catch(error){
   if(token!==soundToken||error.name==='AbortError')return;
   let reason='This sound could not be played.';
   try{const response=await fetch(soundURL(id));if(!response.ok)reason=(await response.json()).error||reason;}catch{}
   if(token===soundToken){soundPlayer.pause();updateSoundButtons();toast(reason);}
 }
}
for(const event of ['play','pause','ended'])soundPlayer.addEventListener(event,updateSoundButtons);
$('model-info').addEventListener('click',event=>{const button=event.target.closest('[data-sound]');if(button&&!button.disabled)playSound(Number(button.dataset.sound));});
function infoRow(label,value){return `<dt>${esc(label)}</dt><dd>${esc(value)}</dd>`;}
async function loadInfo(id,token){
 selectedInfo=null;$('model-info').textContent='Loading…';
 try{const info=await api(`/api/model/${id}/info`);if(token!==modelToken)return;selectedInfo=info;renderInfo();}
 catch(error){if(token===modelToken)$('model-info').textContent=error.message;}
}
function renderInfo(){
 const info=selectedInfo;if(!info||info.entry.id!==state.selected)return;const model=state.model?.id===state.selected?state.model:null;
 const rows=[infoRow('Exposed names',info.names.length?info.names.join(', '):'No name exposed'),infoRow('File ID',info.entry.id),infoRow('Path',info.entry.path)];
 if(info.generatedPath)rows.push(infoRow('Path label','Generated filename; not an exposed NPC name'));
 rows.push(infoRow('Beta table references',Object.entries(info.entry.tableReferences||{}).filter(([,linked])=>linked).map(([kind])=>kind).join(', ')||'None in the checked creature, item or character tables'));
 if(info.modelIDs.length||info.entry.tableReferenceKind==='creature')rows.push(infoRow('Creature-model records',info.modelIDs.join(', ')||'None'),infoRow('Display records',info.displayIDs.join(', ')||'None'));
 if(info.itemDisplayIDs?.length||info.entry.tableReferenceKind==='item')rows.push(infoRow('Item-display records',info.itemDisplayIDs?.join(', ')||'None'));
 if(info.characterModelIDs?.length||info.entry.tableReferenceKind==='character')rows.push(infoRow('Character-model records',info.characterModelIDs?.join(', ')||'None'));
 if(info.entry.mount)rows.push(infoRow('Mount classification',info.entry.mountSource==='beta-table'?'Beta mount table':'Inferred from filename'));
 if(model)rows.push(infoRow('Embedded model name',model.internalName||'Empty'),infoRow('Geometry',`${num(model.positions.length/3)} vertices · ${num(model.indices.length/3)} triangles · ${model.bones.length} bones`));
 if(!info.entry.readable)rows.push(infoRow('Availability',info.entry.unavailableReason));
 let html='<dl>'+rows.join('')+'</dl>';
 if(model?.textures.length)html+=`<details open><summary>Textures (${model.textures.length})</summary><ul>${model.textures.map(texture=>`<li>${esc(texture.id||'Replaceable slot')} · type ${texture.type}${texture.path?`<br>${esc(texture.path)}`:''}</li>`).join('')}</ul></details>`;
 if(model?.animations.length)html+=`<details><summary>Animations (${model.animations.length})</summary><ul>${model.animations.map(a=>`<li>${esc(a.name)} · ID ${a.id} · ${a.duration} ms</li>`).join('')}</ul></details>`;
 if(info.sounds.length)html+=`<details><summary>Sound files (${info.sounds.length})</summary><ul class="sound-files">${info.sounds.map(sound=>`<li><button class="sound-file" data-sound="${sound.id}" aria-label="Play sound ${sound.id}" aria-pressed="false" ${sound.installed?'':'disabled'}><span class="sound-state" aria-hidden="true">▶</span><span>${sound.id}<br>${esc(sound.path||'Unnamed sound')}</span></button><span class="info-note">${esc(sound.uses.join(', '))}${sound.installed?'':' · not installed'}</span></li>`).join('')}</ul></details>`;
 html+=`<details><summary>Raw client records</summary><pre>${esc(JSON.stringify(info.raw,null,2))}</pre></details>`;
 if(info.notes.length)html+=`<p class="info-note">${esc(info.notes.join(' '))}</p>`;
 $('model-info').innerHTML=html;updateSoundButtons();
}
document.querySelectorAll('[data-panel]').forEach(button=>button.onclick=()=>{document.querySelectorAll('[data-panel]').forEach(b=>b.classList.toggle('active',b===button));$('skins-panel').hidden=button.dataset.panel!=='skins';$('info-panel').hidden=button.dataset.panel!=='info';});

function populateFolders(){
 folders=buildFolderTree(sounds?[...state.catalog,...sounds]:state.catalog);
 if(!folders.index.has(state.folder)&&!soundMode())state.folder='creature/';
 renderFolderTree();syncFilters();
}
function renderFolderTree(){
 const rootPath=allRoots.find(path=>state.folder.startsWith(path))||'creature/';
 const rootNode=folders.index.get(rootPath),collator=new Intl.Collator('en',{numeric:true,sensitivity:'base'});
 const render=(nodes,depth)=>[...nodes.values()].sort((a,b)=>collator.compare(a.name,b.name)).map(node=>{
   const open=expandedFolders.has(node.path);
   return `<div class="folder-row" style="padding-left:${depth*12}px">${node.children.size?`<button class="folder-expand" data-expand="${esc(node.path)}" aria-label="${open?'Collapse':'Expand'} ${esc(node.path)}" aria-expanded="${open}">${open?'▾':'▸'}</button>`:'<span class="folder-indent"></span>'}<button class="folder-name" data-folder="${esc(node.path)}" title="${esc(node.path)}">${esc(node.name)}</button></div>`+(open?render(node.children,depth+1):'');
 }).join('');
 $('folder-tree').innerHTML=rootNode?.children.size?render(rootNode.children,0):'<span class="muted">No subfolders</span>';
 syncFilters();
}

async function loadSoundLibrary(){
 if(soundLibraryRequest)return soundLibraryRequest;
 soundLibraryRequest=(async()=>{
   try{
     const result=await api('/api/sounds');
     sounds=result.items.map(([id,path,size])=>({id,path,size,type:'sound',name:path.split('/').at(-1),inBetaTables:false,appearanceCount:0}));
     populateFolders();if(soundMode())filterCatalog({resetScroll:true});
   }catch(error){if(soundMode()){$('results').innerHTML=`<div class="empty-results">${esc(error.message)} <button id="retry-sounds">Retry</button></div>`;$('retry-sounds').onclick=()=>{soundLibraryRequest=null;filterCatalog();};}}
 })();
 return soundLibraryRequest;
}

function loadSound(id,index,autoplay){
 ++modelToken;++animationToken;controller?.abort();stopSound();disposeModel();playing=false;updatePlay();selectedInfo=null;
 const entry=state.items[index];state.selected=id;state.index=index;state.model=null;state.loading=false;highlightSelection();
 $('model-name').textContent=entry.name;$('animation-note').textContent='';$('model-warnings').textContent='';$('appearances').innerHTML='';$('appearance-count').textContent='0';
 message(entry.name);soundPlayer.controls=true;soundPlayer.setAttribute('aria-label','Sound playback');soundPlayer.src=soundURL(id);selectedSoundID=id;$('stage-message').appendChild(soundPlayer);
 $('model-info').innerHTML=`<dl>${infoRow('File',entry.name)}${infoRow('File ID',id)}${infoRow('Path',entry.path)}${infoRow('Size',num(entry.size)+' bytes')}${infoRow('Source','Installed beta '+(state.info?.build.version||''))}</dl>`;
 document.querySelector('[data-panel="info"]').click();
 if(autoplay)playSound(id);
}
