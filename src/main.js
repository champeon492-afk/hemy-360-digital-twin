import * as THREE from 'three';
import * as OBC from '@thatopen/components';
import * as OBF from '@thatopen/components-front';
import { createDashboard } from './dashboard.js';
import { createOntology } from './ontology.js';
import './style.css';
import './orion.css';
import './ontology.css';

const $=(id)=>document.getElementById(id);
const assetUrl=(path)=>new URL(path,new URL(import.meta.env.BASE_URL,window.location.href)).href;
function errorScreen(error){console.error(error);$('loading-message').textContent=`Viewer error: ${error?.message||error}`;$('loading').classList.add('error')}

async function main(){
  const [indexResponse,telemetryResponse,ontologyResponse]=await Promise.all([fetch(assetUrl('elements.json')),fetch(assetUrl('sample-telemetry.json')),fetch(assetUrl('ifc-relationships.json'))]);
  if(!indexResponse.ok||!telemetryResponse.ok||!ontologyResponse.ok)throw new Error('Model index, IFC relationships, or sample data unavailable');
  const manifest=await indexResponse.json();
  const telemetry=await telemetryResponse.json();
  const relationships=await ontologyResponse.json();
  const components=new OBC.Components();
  const world=components.get(OBC.Worlds).create();
  world.scene=new OBC.SimpleScene(components);world.scene.setup();world.scene.three.background=new THREE.Color('#8c978d');
  world.scene.three.add(new THREE.HemisphereLight(0xf3fff0,0x647567,1.75));
  world.renderer=new OBF.PostproductionRenderer(components,$('viewer'));
  world.renderer.showLogo=false;
  // The viewport can span a high-DPI display. Keep its render target bounded;
  // the source geometry remains at full resolution for picking and inspection.
  world.renderer.three.setPixelRatio(Math.min(window.devicePixelRatio||1,1.25));
  world.camera=new OBC.OrthoPerspectiveCamera(components);
  await world.camera.controls.setLookAt(80,58,80,0,0,0);
  components.init();
  new ResizeObserver(()=>{world.renderer.resize();world.camera.updateAspect()}).observe($('viewer'));
  const fragments=components.get(OBC.FragmentsManager);
  fragments.init(assetUrl('fragments-worker.mjs'));
  // Camera controls can emit updates faster than the fragment worker can answer.
  // Coalesce them instead of building a backlog that continues after orbiting.
  let fragmentUpdateRunning=false,fragmentUpdateWanted=false,fragmentUpdateTimer=null,lastFragmentUpdate=0;
  function scheduleFragmentUpdate(){
    fragmentUpdateWanted=true;
    if(fragmentUpdateRunning||fragmentUpdateTimer!==null)return;
    fragmentUpdateTimer=setTimeout(async()=>{
      fragmentUpdateTimer=null;
      if(!fragmentUpdateWanted)return;
      fragmentUpdateWanted=false;
      fragmentUpdateRunning=true;
      lastFragmentUpdate=performance.now();
      try{await fragments.core.update()}catch(error){console.error('Fragment camera update failed',error)}
      finally{fragmentUpdateRunning=false;if(fragmentUpdateWanted)scheduleFragmentUpdate()}
    },Math.max(0,100-(performance.now()-lastFragmentUpdate)));
  }
  let restoreEffectsTimer=null;
  world.camera.controls.addEventListener('update',()=>{
    scheduleFragmentUpdate();
    // Postprocessing draws the whole viewport again for each outline pass.
    // Use the direct renderer during motion, then restore the edge glow.
    if(world.renderer.postproduction.enabled)world.renderer.postproduction.enabled=false;
    clearTimeout(restoreEffectsTimer);
    restoreEffectsTimer=setTimeout(()=>{world.renderer.postproduction.enabled=true;world.renderer.needsUpdate=true;scheduleFragmentUpdate()},220);
  });
  fragments.list.onItemSet.add(({value:model})=>{model.useCamera(world.camera.three);world.scene.three.add(model.object);fragments.core.update(true)});
  const raycaster=components.get(OBC.Raycasters).get(world);
  world.renderer.postproduction.enabled=true;
  const outliner=components.get(OBF.Outliner);
  outliner.world=world;
  outliner.create('selection-glow',{color:new THREE.Color('#baff16'),thickness:6,fillOpacity:0,priority:0});
  outliner.create('selection-edge',{color:new THREE.Color('#e0ff9a'),thickness:2,fillOpacity:0,priority:1});
  outliner.enabled=true;
  // Serialize outline work. Otherwise an older async tile request can finish
  // after a new pick and leave an unrelated element glowing.
  let selectionRevision=0,outlineTask=Promise.resolve();
  function outlineIds(ids){
    const revision=++selectionRevision;
    const snapshot=ids.length?{[model.modelId]:new Set(ids)}:null;
    outlineTask=outlineTask.catch(console.error).then(async()=>{
      if(revision!==selectionRevision)return;
      outliner.clean();
      if(!snapshot)return;
      await outliner.addItems(snapshot,'selection-glow');
      if(revision!==selectionRevision)return;
      await outliner.addItems(snapshot,'selection-edge');
    });
    return outlineTask;
  }
  const response=await fetch(assetUrl('three-storey-demo.frag'));
  if(!response.ok)throw new Error(`Optimized model HTTP ${response.status}`);
  const fragmentBuffer=await response.arrayBuffer();
  const fragmentBytes=new Uint8Array(fragmentBuffer.slice(0));
  const model=await fragments.core.load(fragmentBuffer,{modelId:'SAMPLE'});
  await fragments.core.update(true);
  const box=new THREE.Box3().setFromObject(model.object),center=box.getCenter(new THREE.Vector3()),size=box.getSize(new THREE.Vector3());
  const distance=Math.max(70,size.length()*.7);
  await world.camera.controls.setLookAt(center.x+distance*.65,center.y+distance*.48,center.z+distance*.65,center.x,center.y,center.z,true);
  await world.camera.controls.fitToBox(model.object,true);
  $('loading').hidden=true;

  const scene={model,center,size,fragmentBuffer,exploded:false,explodeModels:[],section:false,mesh:false,meshGroup:null,category:null,floor:'all',visibleElements:manifest.elements};
  const hider=components.get(OBC.Hider);
  const clipper=components.get(OBC.Clipper);
  clipper.enabled=true;
  clipper.visible=false;
  const elevations=manifest.elements.map(e=>(e.bounds[0][2]+e.bounds[1][2])/2).sort((a,b)=>a-b);
  const lowerLimit=elevations[Math.floor(elevations.length/3)],upperLimit=elevations[Math.floor(elevations.length*2/3)];
  function bandFor(e){if(!e?.bounds)return 'unknown';const z=(e.bounds[0][2]+e.bounds[1][2])/2;return z<lowerLimit?'lower':z<upperLimit?'middle':'upper'}
  const storeys=relationships.spatial.filter(node=>node.ifcClass==='IfcBuildingStorey');
  const buildings=relationships.spatial.filter(node=>node.ifcClass==='IfcBuilding');
  const buildingByStorey=new Map(relationships.spatialEdges.filter(edge=>buildings.some(building=>building.guid===edge.from)).map(edge=>[edge.to,edge.from]));
  const storeyByGuid=new Map(relationships.elements.map(element=>[element.guid,element.storey]));
  const floorSelect=$('floor-select');
  buildings.forEach((building,index)=>{
    const group=document.createElement('optgroup');
    group.label=`Building ${index+1} · ${building.name||'Unnamed'}`;
    storeys.filter(storey=>buildingByStorey.get(storey.guid)===building.guid).sort((a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true})).forEach(storey=>{
      const option=document.createElement('option');option.value=storey.guid;option.textContent=`Level ${storey.name}`;group.append(option);
    });
    floorSelect.append(group);
  });
  async function idsForGuids(guids,target=model){return (await target.getLocalIdsByGuids(guids)).filter(x=>x!=null)}
  async function isolateGuids(guids){const ids=await idsForGuids(guids);await hider.isolate({[model.modelId]:new Set(ids)});await fragments.core.update(true)}
  async function applyFilter(){if(scene.exploded)await toggleExplode();if(scene.mesh){scene.mesh=false;if(scene.meshGroup)scene.meshGroup.visible=false;$('mesh-overlay').setAttribute('aria-pressed','false')}let filtered=manifest.elements;if(scene.category)filtered=filtered.filter(e=>e.type===scene.category);if(scene.floor!=='all')filtered=filtered.filter(e=>storeyByGuid.get(e.guid)===scene.floor);scene.visibleElements=filtered;if(filtered.length===manifest.elements.length)await hider.set(true);else await isolateGuids(filtered.map(e=>e.guid));await fragments.core.update(true)}
  async function fitVisible(){
    if(scene.visibleElements.length===manifest.elements.length)return world.camera.controls.fitToBox(model.object,true);
    if(!scene.visibleElements.length)return;
    const ids=await idsForGuids(scene.visibleElements.map(e=>e.guid));
    const boxes=await model.getBoxes(ids);
    const visibleBox=new THREE.Box3();
    for(const box of boxes)if(box&&!box.isEmpty())visibleBox.union(box);
    if(!visibleBox.isEmpty()){
      visibleBox.expandByScalar(3);
      if(scene.floor!=='all'){
        const target=visibleBox.getCenter(new THREE.Vector3());
        const span=Math.max(visibleBox.getSize(new THREE.Vector3()).length(),20);
        await world.camera.controls.setLookAt(target.x+span*.65,target.y+span*.8,target.z+span*.65,target.x,target.y,target.z,false);
      }
      await world.camera.controls.fitToBox(visibleBox,true);
    }
  }
  async function frameGuid(guid){
    const [id]=await idsForGuids([guid]);if(id==null)return;
    const [targetBox]=await model.getBoxes([id]);if(!targetBox||targetBox.isEmpty())return;
    const assetSize=targetBox.getSize(new THREE.Vector3());
    const margin=Math.max(2,Math.min(4,assetSize.length()*.15));
    const focusBox=targetBox.clone().expandByScalar(margin);
    await world.camera.controls.fitToBox(focusBox,true);
  }
  let selectionIntent=0;
  const callbacks={
    category:async(type)=>{scene.category=type;await applyFilter()},
    isolate:async(guids)=>{await isolateGuids(guids)},
    select:async(guid)=>{const intent=++selectionIntent;const [id]=await idsForGuids([guid]);if(intent!==selectionIntent)return;if(id!=null){await outlineIds([id]);if(intent!==selectionIntent)return;dashboard.setSelected(guid);ontology.setSelected(guid)}},
    highlightMany:async(guids)=>{const intent=++selectionIntent;const ids=await idsForGuids(guids);if(intent!==selectionIntent)return 0;await outlineIds(ids);return ids.length},
    clearSelection:()=>{selectionIntent++;outlineIds([])},
    focus:frameGuid
  };
  const dashboard=createDashboard({manifest,telemetry,relationships,actions:callbacks});
  const ontology=createOntology({data:relationships,manifest,actions:callbacks,dashboard,resetModel:async()=>{scene.category=null;scene.floor='all';$('floor-select').value='all';await applyFilter()}});
  callbacks.clearSelection=()=>{selectionIntent++;outlineIds([]);dashboard.setSelected(null);ontology.clearSelection()};
  const searchInput=$('global-search'),suggestionList=$('global-search-suggestions');
  const indexedEntries=manifest.elements.map(entry=>({entry,name:entry.name.toLowerCase(),guid:entry.guid.toLowerCase(),type:entry.type.toLowerCase()}));
  let suggestions=[],activeSuggestion=-1;
  function closeSuggestions(){suggestionList.hidden=true;searchInput.setAttribute('aria-expanded','false');searchInput.removeAttribute('aria-activedescendant');activeSuggestion=-1}
  function matchesFor(query){
    const buckets=[[],[],[],[],[]];
    for(const item of indexedEntries){
      const rank=item.guid===query?0:item.name.startsWith(query)?1:item.guid.startsWith(query)?2:item.name.includes(query)?3:item.type.includes(query)?4:-1;
      if(rank>=0&&buckets[rank].length<8)buckets[rank].push(item.entry);
    }
    return buckets.flat().slice(0,8);
  }
  function renderSuggestions(){
    const query=searchInput.value.trim().toLowerCase();
    if(!query){suggestions=[];suggestionList.replaceChildren();closeSuggestions();return}
    suggestions=matchesFor(query);activeSuggestion=-1;suggestionList.replaceChildren();
    if(!suggestions.length){const empty=document.createElement('div');empty.className='search-suggestions__empty';empty.textContent='No matching IFC assets';suggestionList.append(empty)}
    suggestions.forEach((entry,index)=>{
      const option=document.createElement('button');option.type='button';option.id=`global-suggestion-${index}`;option.className='search-suggestions__item';option.setAttribute('role','option');option.setAttribute('aria-selected','false');
      const name=document.createElement('strong');name.textContent=entry.name;
      const detail=document.createElement('small');detail.textContent=`${entry.type} · ${entry.guid}`;
      option.append(name,detail);option.addEventListener('click',()=>runSearch(entry));suggestionList.append(option);
    });
    suggestionList.hidden=false;searchInput.setAttribute('aria-expanded','true');
  }
  function setActiveSuggestion(index){
    activeSuggestion=index;
    [...suggestionList.querySelectorAll('[role="option"]')].forEach((option,i)=>option.setAttribute('aria-selected',String(i===index)));
    if(index>=0){searchInput.setAttribute('aria-activedescendant',`global-suggestion-${index}`);suggestionList.children[index]?.scrollIntoView({block:'nearest'})}
    else searchInput.removeAttribute('aria-activedescendant');
  }
  async function runSearch(match){
    if(!match){dashboard.toast('No matching IFC asset. Try a name or GUID.');return}
    searchInput.value=match.name;closeSuggestions();
    try{scene.category=null;scene.floor='all';floorSelect.value='all';await applyFilter();dashboard.setView('spatial');await callbacks.select(match.guid);await callbacks.focus(match.guid)}
    catch(error){console.error(error);dashboard.toast('Could not focus the matching IFC asset.')}
  }
  searchInput.addEventListener('input',renderSuggestions);
  searchInput.addEventListener('focus',()=>{if(searchInput.value.trim())renderSuggestions()});
  searchInput.addEventListener('keydown',event=>{
    if(event.key==='Escape'){closeSuggestions();return}
    if(event.key==='ArrowDown'||event.key==='ArrowUp'){
      if(!suggestions.length)return;
      event.preventDefault();setActiveSuggestion(event.key==='ArrowDown'?(activeSuggestion+1)%suggestions.length:(activeSuggestion-1+suggestions.length)%suggestions.length);
    }
  });
  suggestionList.addEventListener('mousedown',event=>event.preventDefault());
  document.addEventListener('pointerdown',event=>{if(!$('global-search-form').contains(event.target))closeSuggestions()});
  $('global-search-form').addEventListener('submit',event=>{event.preventDefault();const query=searchInput.value.trim().toLowerCase();if(!query)return;const match=suggestionList.hidden?matchesFor(query)[0]:suggestions[activeSuggestion>=0?activeSuggestion:0];runSearch(match)});
  const viewerCanvas=world.renderer.three.domElement;
  let pointerStart=null,pickRevision=0;
  viewerCanvas.addEventListener('pointerdown',event=>{if(event.button===0)pointerStart={x:event.clientX,y:event.clientY,id:event.pointerId}});
  viewerCanvas.addEventListener('pointerup',async event=>{
    if(event.button!==0||!pointerStart||pointerStart.id!==event.pointerId)return;
    const moved=Math.hypot(event.clientX-pointerStart.x,event.clientY-pointerStart.y);
    pointerStart=null;
    if(moved>5)return;
    const revision=++pickRevision;
    const bounds=viewerCanvas.getBoundingClientRect();
    const position=new THREE.Vector2((event.clientX-bounds.left)/bounds.width*2-1,1-(event.clientY-bounds.top)/bounds.height*2);
    try{
      const hit=await raycaster.castRay({position,items:[]});
      if(revision!==pickRevision)return;
      if(hit?.localId==null||!hit.fragments){callbacks.clearSelection();return}
      const [guid]=await hit.fragments.getGuidsByLocalIds([hit.localId]);
      if(revision!==pickRevision)return;
      if(guid)await callbacks.select(guid);else callbacks.clearSelection();
    }catch(error){console.error(error);dashboard.toast('Could not inspect this IFC element.')}
  });

  async function toggleExplode(){
    scene.exploded=!scene.exploded;
    if(scene.mesh){scene.mesh=false;if(scene.meshGroup)scene.meshGroup.visible=false;$('mesh-overlay').setAttribute('aria-pressed','false')}
    if(scene.exploded){
      dashboard.toast('Building three elevation bands for an exploded model view…');
      if(!scene.explodeModels.length){
        for(const name of ['lower','middle','upper']){
          const copy=await fragments.core.load(fragmentBytes.slice().buffer,{modelId:`SAMPLE-${name}`});
          const exclude=manifest.elements.filter(e=>bandFor(e)!==name).map(e=>e.guid);
          const ids=await idsForGuids(exclude,copy);
          await copy.setVisible(ids,false);
          copy.object.position.y+=name==='lower'?-9:name==='upper'?9:0;
          scene.explodeModels.push(copy);
        }
      }
      model.object.visible=false;scene.explodeModels.forEach(x=>x.object.visible=true);
      $('stage-mode').textContent='EXPLODED · ELEVATION BANDS';
    }else{model.object.visible=true;scene.explodeModels.forEach(x=>x.object.visible=false);$('stage-mode').textContent='MODEL VIEW'}
    $('explode').setAttribute('aria-pressed',String(scene.exploded));await fragments.core.update(true)
  }
  $('explode').addEventListener('click',()=>toggleExplode().catch(e=>{console.error(e);dashboard.toast('Could not create exploded view.')}));
  $('section').addEventListener('click',async()=>{try{scene.section=!scene.section;if(scene.section){clipper.createFromNormalAndCoplanarPoint(world,new THREE.Vector3(0,-1,0),new THREE.Vector3(center.x,center.y+size.y*.17,center.z));for(const [,plane] of clipper.list)plane.visible=false;$('stage-mode').textContent='SECTION CUT'}else{clipper.deleteAll();$('stage-mode').textContent=scene.exploded?'EXPLODED · ELEVATION BANDS':'MODEL VIEW'}$('section').setAttribute('aria-pressed',String(scene.section));await fragments.core.update(true)}catch(e){console.error(e);dashboard.toast('Section cut unavailable for this model.')}});
  $('mesh-overlay').addEventListener('click',async()=>{
    scene.mesh=!scene.mesh;
    if(scene.mesh&&!scene.meshGroup){
      model.object.updateMatrixWorld(true);
      const group=new THREE.Group();
      const material=new THREE.LineBasicMaterial({color:0x8faeff,transparent:true,opacity:.56,depthWrite:false});
      model.object.traverse(object=>{
        if(!object.isMesh||!object.geometry?.getAttribute?.('position'))return;
        try{const edges=new THREE.EdgesGeometry(object.geometry,35);const outline=new THREE.LineSegments(edges,material);outline.matrixAutoUpdate=false;outline.matrix.copy(object.matrixWorld);group.add(outline)}catch(error){console.warn('Skipped unsupported mesh geometry',error)}
      });
      scene.meshGroup=group;world.scene.three.add(group);
    }
    if(scene.meshGroup)scene.meshGroup.visible=scene.mesh;
    $('mesh-overlay').setAttribute('aria-pressed',String(scene.mesh));
    dashboard.toast(scene.mesh?'Mesh wireframe overlay enabled.':'Mesh overlay hidden.');
  });
  $('floor-select').addEventListener('change',async e=>{try{scene.floor=e.target.value;await applyFilter();await fitVisible();const storey=storeys.find(node=>node.guid===scene.floor);dashboard.toast(storey?`Showing IFC level ${storey.name}.`:'Showing all IFC levels.')}catch(error){console.error(error);dashboard.toast('Could not show this IFC level.')}});
  $('fit-model').addEventListener('click',()=>fitVisible().catch(console.error));
  $('top-view').addEventListener('click',()=>{const p=world.camera.controls.getTarget(new THREE.Vector3());world.camera.controls.setLookAt(p.x,p.y+Math.max(120,size.length()),p.z,p.x,p.y,p.z,true)});
  for(const mode of ['vr','ar'])$(''+mode+'-mode').addEventListener('click',()=>dashboard.toast(`${mode.toUpperCase()} requires a compatible WebXR device and secure deployment. This local preview remains in desktop mode.`));
  console.info('Sample That Open workspace ready',{elements:manifest.elements.length,modelId:model.modelId});
}
main().catch(errorScreen);
