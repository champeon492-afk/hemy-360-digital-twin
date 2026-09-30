const $ = id => document.getElementById(id);
const svgNS = 'http://www.w3.org/2000/svg';
const compact = value => value.length > 25 ? `${value.slice(0, 23)}…` : value;
const countLabel = n => n.toLocaleString();

export function createOntology({data,manifest,actions,dashboard,resetModel}) {
  const spatialByGuid = new Map(data.spatial.map(node => [node.guid,node]));
  const typeByGuid = new Map(data.types.map(node => [node.guid,node]));
  const elementByGuid = new Map(data.elements.map(node => [node.guid,node]));
  const storeys = data.spatial.filter(node => node.ifcClass === 'IfcBuildingStorey');
  const storeyCounts = new Map(storeys.map(node => [node.guid,data.elements.filter(element => element.storey === node.guid).length]));
  const buildings = data.spatial.filter(node => node.ifcClass === 'IfcBuilding');
  const buildingByStorey = new Map(data.spatialEdges.filter(edge => buildings.some(building => building.guid === edge.from)).map(edge => [edge.to,edge.from]));
  const buildingCounts = new Map(buildings.map(building => [building.guid,storeys.filter(storey => buildingByStorey.get(storey.guid) === building.guid).reduce((sum,storey) => sum + (storeyCounts.get(storey.guid)||0),0)]));
  const sortedStoreys = buildingGuid => storeys.filter(storey => buildingByStorey.get(storey.guid) === buildingGuid).sort((a,b) => a.name.localeCompare(b.name,undefined,{numeric:true}));
  const firstBuilding = [...buildings].sort((a,b) => (buildingCounts.get(b.guid)||0)-(buildingCounts.get(a.guid)||0))[0]?.guid;
  const firstStorey = sortedStoreys(firstBuilding)[0]?.guid;
  const containedCount = data.elements.filter(element => element.container).length;
  const typedCount = data.elements.filter(element => element.type).length;
  const state = {mode:'spatial',building:firstBuilding,storey:firstStorey,category:null,family:null,type:null,selected:null,groupSelected:null,pages:{storey:0,class:0,type:0,element:0}};
  const canvas = $('ontology-canvas');
  const svg = $('ontology-links');
  const layer = $('ontology-nodes');
  const caption = $('ontology-caption');
  const pages = $('ontology-pages');
  const summary = $('ontology-summary');
  const relationExists = (from,to) => data.spatialEdges.some(edge => edge.from === from && edge.to === to && edge.relation === 'IfcRelAggregates');
  const defaultCaption = 'Flow width represents linked IFC elements · click a node to trace or focus';

  function groupsFor(items,key) {
    const groups = new Map();
    for (const item of items) {
      const value = key(item);
      if (!value) continue;
      if (!groups.has(value)) groups.set(value,[]);
      groups.get(value).push(item);
    }
    return [...groups].sort((a,b)=>b[1].length-a[1].length).map(([name,elements])=>({name,elements}));
  }

  function page(items,key,size,label) {
    const last=Math.max(0,Math.ceil(items.length/size)-1);
    state.pages[key]=Math.min(state.pages[key],last);
    const start=state.pages[key]*size;
    return {items:items.slice(start,start+size),pager:{key,label,start,total:items.length,size,page:state.pages[key]}};
  }

  function spatialGraph(width,height) {
    const nodes=[],edges=[];
    const project=data.spatial.find(node=>node.ifcClass==='IfcProject');
    const site=data.spatial.find(node=>node.ifcClass==='IfcSite');
    const put=(id,label,detail,x,y,kind,count,onClick)=>nodes.push({id,label,detail,x:width*x,y:height*y,kind,count,onClick});
    if(project)put('project',compact(project.name||'Project'),'IfcProject · source spatial root',.035,.5,'root',null,()=>showInfo(project.name));
    if(site)put('site',compact(site.name||'Site'),'IfcSite · related by IfcRelAggregates',.185,.5,'root',null,()=>showInfo(site.name));
    if(project&&site&&relationExists(project.guid,site.guid))edges.push({from:'project',to:'site',count:containedCount,relation:'IfcRelAggregates'});
    buildings.forEach((building,index)=>{
      const id=`building:${building.guid}`;
      const label=buildings.length>1?`${building.name||'Building'} · ${index+1}`:building.name||'Building';
      const count=buildingCounts.get(building.guid)||0;
      put(id,compact(label),`IfcBuilding · ${countLabel(count)} contained renderable elements · ${building.guid}`,.34,.34+index*(.32/Math.max(1,buildings.length-1)),'root',count,()=>{state.building=building.guid;state.storey=sortedStoreys(building.guid)[0]?.guid;state.category=null;state.groupSelected=null;state.pages.storey=0;state.pages.class=0;state.pages.element=0;actions.clearSelection();render();showInfo(`${label} · ${countLabel(count)} contained IFC elements`)});
      if(site&&relationExists(site.guid,building.guid))edges.push({from:'site',to:id,count,relation:'IfcRelAggregates'});
    });
    const selectedBuilding=buildings.find(building=>building.guid===state.building)||buildings[0];
    const allStoreys=sortedStoreys(selectedBuilding?.guid);
    const storeyPage=page(allStoreys,'storey',6,'Storeys');
    if(!storeyPage.items.some(storey=>storey.guid===state.storey))state.storey=storeyPage.items[0]?.guid;
    storeyPage.items.forEach((storey,index)=>{
      const id=`storey:${storey.guid}`;
      const n=storeyCounts.get(storey.guid)||0;
      const y=.14+index*(.59/Math.max(1,storeyPage.items.length-1));
      put(id,`Storey ${storey.name}`,`IfcBuildingStorey · ${countLabel(n)} linked renderable elements`,.53,y,'storey',n,()=>{state.storey=storey.guid;state.category=null;state.pages.class=0;state.pages.element=0;render();return highlightGroup(data.elements.filter(element=>element.storey===storey.guid),`Storey ${storey.name}`)});
      if(selectedBuilding&&relationExists(selectedBuilding.guid,storey.guid))edges.push({from:`building:${selectedBuilding.guid}`,to:id,count:n,relation:'IfcRelAggregates'});
    });
    const selectedStorey=spatialByGuid.get(state.storey)||storeyPage.items[0];
    if(!selectedStorey)return {nodes,edges,pagers:[storeyPage.pager]};
    const inStorey=data.elements.filter(element=>element.storey===selectedStorey.guid);
    const groups=groupsFor(inStorey,element=>element.ifcClass);
    const classPage=page(groups,'class',6,'Classes');
    if(!classPage.items.some(group=>group.name===state.category))state.category=classPage.items[0]?.name||null;
    classPage.items.forEach((group,index)=>{
      const id=`class:${group.name}`;
      const y=.14+index*(.59/Math.max(1,classPage.items.length-1));
      const allInClass=data.elements.filter(element=>element.ifcClass===group.name);
      put(id,group.name.replace(/^Ifc/,''),`${countLabel(group.elements.length)} in this storey · ${countLabel(allInClass.length)} across Sample Building · IFC class grouping`,.735,y,'class',group.elements.length,()=>{state.category=group.name;state.pages.element=0;render();return highlightGroup(allInClass,group.name.replace(/^Ifc/,''))});
      edges.push({from:`storey:${selectedStorey.guid}`,to:id,count:group.elements.length,relation:'IfcRelContainedInSpatialStructure · grouped by class'});
    });
    const activeGroup=groups.find(group=>group.name===state.category);
    const allInClass=data.elements.filter(element=>element.ifcClass===activeGroup?.name).sort((a,b)=>Number(b.storey===selectedStorey.guid)-Number(a.storey===selectedStorey.guid));
    const elementPage=page(allInClass,'element',5,'Elements');
    elementPage.items.forEach((element,index)=>{
      const id=`asset:${element.guid}`;
      const owner=spatialByGuid.get(element.container);
      const relation=owner?.ifcClass==='IfcSpace'?'IfcRelAggregates → IfcRelContainedInSpatialStructure':'IfcRelContainedInSpatialStructure';
      const actualStorey=spatialByGuid.get(element.storey);
      put(id,compact(element.name),`${element.ifcClass} · ${actualStorey?.name||'unassigned storey'} · ${relation} · ${element.guid}`,.925,.15+index*(.58/Math.max(1,elementPage.items.length-1)),'asset',null,()=>focusAsset(element.guid));
      edges.push({from:`class:${state.category}`,to:id,count:1,relation:'Same IFC class across Sample Building',crossStorey:element.storey!==selectedStorey.guid});
    });
    return {nodes,edges,pagers:[storeyPage.pager,classPage.pager,elementPage.pager]};
  }

  function typeGraph(width,height) {
    const nodes=[],edges=[];
    const typed=data.elements.filter(element=>element.type);
    const families=groupsFor(typed,element=>element.ifcClass);
    const classPage=page(families,'class',6,'Classes');
    if(!classPage.items.some(group=>group.name===state.family))state.family=classPage.items[0]?.name||null;
    const put=(id,label,detail,x,y,kind,count,onClick)=>nodes.push({id,label,detail,x:width*x,y:height*y,kind,count,onClick});
    put('type-root','IFC types',`IfcRelDefinesByType · ${countLabel(typedCount)} typed renderable elements`,.055,.5,'root',typedCount,()=>showInfo('IFC type assignments'));
    classPage.items.forEach((group,index)=>{
      const id=`family:${group.name}`;
      put(id,group.name.replace(/^Ifc/,''),`${countLabel(group.elements.length)} elements grouped by IFC entity class`,.31,.14+index*(.59/Math.max(1,classPage.items.length-1)),'class',group.elements.length,()=>{state.family=group.name;state.type=null;state.pages.type=0;state.pages.element=0;render();return highlightGroup(group.elements,group.name.replace(/^Ifc/,''))});
      edges.push({from:'type-root',to:id,count:group.elements.length,relation:'IFC entity class grouping'});
    });
    const family=families.find(group=>group.name===state.family);
    const byType=new Map();
    for(const element of family?.elements||[]){if(!byType.has(element.type))byType.set(element.type,[]);byType.get(element.type).push(element)}
    const ranked=[...byType].sort((a,b)=>b[1].length-a[1].length);
    const typePage=page(ranked,'type',5,'Types');
    if(!typePage.items.some(([guid])=>guid===state.type))state.type=typePage.items[0]?.[0]||null;
    typePage.items.forEach(([guid,items],index)=>{
      const type=typeByGuid.get(guid);
      const id=`type:${guid}`;
      put(id,compact(type?.name||'Unnamed type'),`${type?.ifcClass||'IfcTypeObject'} · ${countLabel(items.length)} elements · IfcRelDefinesByType`,.59,.15+index*(.58/Math.max(1,typePage.items.length-1)),'type',items.length,()=>{state.type=guid;state.pages.element=0;render();return highlightGroup(items,type?.name||'Unnamed type')});
      edges.push({from:`family:${state.family}`,to:id,count:items.length,relation:'IfcRelDefinesByType'});
    });
    const elementPage=page(byType.get(state.type)||[],'element',5,'Elements');
    elementPage.items.forEach((element,index)=>{
      const id=`asset:${element.guid}`;
      put(id,compact(element.name),`${element.ifcClass} · IfcRelDefinesByType · ${element.guid}`,.92,.15+index*(.58/Math.max(1,elementPage.items.length-1)),'asset',null,()=>focusAsset(element.guid));
      edges.push({from:`type:${state.type}`,to:id,count:1,relation:'IfcRelDefinesByType'});
    });
    return {nodes,edges,pagers:[classPage.pager,typePage.pager,elementPage.pager]};
  }

  async function focusAsset(guid) {
    try {
      await resetModel();
      dashboard.state.category=null;
      dashboard.setView('spatial');
      await actions.select(guid);
      dashboard.setSelected(guid);
      await actions.focus(guid);
      state.selected=guid;
      const element=elementByGuid.get(guid);
      showInfo(`${element?.name||guid} · selected and framed in 3D`);
      render();
    } catch(error) {console.error(error);dashboard.toast('Could not focus this IFC element.')}
  }

  async function highlightGroup(elements,label) {
    await resetModel();
    dashboard.state.category=null;
    dashboard.setView('spatial');
    dashboard.setSelected(null);
    state.selected=null;
    const highlighted=await actions.highlightMany(elements.map(element=>element.guid));
    state.groupSelected=label;
    showInfo(`${label} · ${countLabel(highlighted)} IFC elements highlighted across the model`);
    render();
  }

  function showInfo(message) {caption.textContent=message;caption.title=message}
  function revealSelected(guid) {
    const element=elementByGuid.get(guid);
    if(!element)return;
    state.selected=guid;
    state.groupSelected=null;
    if(state.mode==='spatial'&&element.storey&&storeyCounts.has(element.storey)){
      const buildingGuid=buildingByStorey.get(element.storey);
      if(buildingGuid){
        state.building=buildingGuid;
        const storeyIndex=sortedStoreys(buildingGuid).findIndex(storey=>storey.guid===element.storey);
        state.pages.storey=Math.max(0,Math.floor(storeyIndex/6));
      }
      state.storey=element.storey;
      const inStorey=data.elements.filter(item=>item.storey===element.storey);
      const classes=groupsFor(inStorey,item=>item.ifcClass);
      const classIndex=classes.findIndex(group=>group.name===element.ifcClass);
      state.pages.class=Math.max(0,Math.floor(classIndex/6));
      state.category=element.ifcClass;
      const allInClass=data.elements.filter(item=>item.ifcClass===element.ifcClass).sort((a,b)=>Number(b.storey===element.storey)-Number(a.storey===element.storey));
      state.pages.element=Math.max(0,Math.floor(allInClass.findIndex(item=>item.guid===guid)/5));
      render();
      const storey=spatialByGuid.get(element.storey);
      const owner=spatialByGuid.get(element.container);
      showInfo(`${element.name} · Storey ${storey?.name||'?'}${owner?.ifcClass==='IfcSpace'?` → Space ${owner.name||''}`:''} · IfcRelAggregates → IfcRelContainedInSpatialStructure`);
      return;
    }
    if(state.mode==='types'&&element.type){
      const families=groupsFor(data.elements.filter(item=>item.type),item=>item.ifcClass);
      const classIndex=families.findIndex(group=>group.name===element.ifcClass);
      state.pages.class=Math.max(0,Math.floor(classIndex/6));
      state.family=element.ifcClass;
      const family=families[classIndex];
      const byType=new Map();
      for(const item of family?.elements||[]){if(!byType.has(item.type))byType.set(item.type,[]);byType.get(item.type).push(item)}
      const ranked=[...byType].sort((a,b)=>b[1].length-a[1].length);
      state.pages.type=Math.max(0,Math.floor(ranked.findIndex(([type])=>type===element.type)/5));
      state.type=element.type;
      state.pages.element=Math.max(0,Math.floor((byType.get(element.type)||[]).findIndex(item=>item.guid===guid)/5));
      render();
      showInfo(`${element.ifcClass} → ${typeByGuid.get(element.type)?.name||'IFC type'} → ${element.name} · IfcRelDefinesByType`);
      return;
    }
    render();
    showInfo(state.mode==='spatial'?`${element.name} · no spatial containment relationship in this IFC`:`${element.name} · no IFC type relationship in this IFC`);
  }
  function render() {
    const width=Math.max(1,canvas.clientWidth),height=Math.max(1,canvas.clientHeight);
    const graph=state.mode==='spatial'?spatialGraph(width,height):typeGraph(width,height);
    summary.textContent=state.mode==='spatial'?`${countLabel(containedCount)} contained assets · ${storeys.length} storeys`:`${countLabel(typedCount)} typed assets · ${data.types.length} types`;
    $('ontology-spatial').setAttribute('aria-pressed',String(state.mode==='spatial'));
    $('ontology-types').setAttribute('aria-pressed',String(state.mode==='types'));
    svg.replaceChildren();layer.replaceChildren();pages.replaceChildren();
    svg.setAttribute('viewBox',`0 0 ${width} ${height}`);
    const defs=document.createElementNS(svgNS,'defs');const gradient=document.createElementNS(svgNS,'linearGradient');gradient.id='ontology-flow-gradient';gradient.setAttribute('gradientUnits','userSpaceOnUse');gradient.setAttribute('x1','0');gradient.setAttribute('x2',String(width));gradient.setAttribute('y1','0');gradient.setAttribute('y2','0');
    for(const [offset,color] of [['0%','#fa746d'],['25%','#ef60ad'],['65%','#8f3edf'],['100%','#aa67f6']]){const stop=document.createElementNS(svgNS,'stop');stop.setAttribute('offset',offset);stop.setAttribute('stop-color',color);gradient.append(stop)}
    defs.append(gradient);svg.append(defs);
    const byId=new Map(graph.nodes.map(node=>[node.id,node]));
    const selectedElement=elementByGuid.get(state.selected);
    const route=selectedElement&&byId.has(`asset:${state.selected}`)?new Set(state.mode==='spatial'?['site',`building:${buildingByStorey.get(selectedElement.storey)}`,`storey:${selectedElement.storey}`,`class:${selectedElement.ifcClass}`,`asset:${state.selected}`]:[`family:${selectedElement.ifcClass}`,`type:${selectedElement.type}`,`asset:${state.selected}`]):new Set();
    for(const edge of graph.edges){const from=byId.get(edge.from),to=byId.get(edge.to);if(!from||!to)continue;const dx=to.x-from.x;const path=document.createElementNS(svgNS,'path');path.setAttribute('d',`M ${from.x} ${from.y} C ${from.x+dx*.48} ${from.y}, ${to.x-dx*.48} ${to.y}, ${to.x} ${to.y}`);path.setAttribute('stroke-width',String(Math.min(16,1.4+Math.sqrt(edge.count)*.38)));path.setAttribute('class',`ontology-flow${edge.crossStorey?' is-cross-storey':''}${route.has(edge.to)?' is-selected-path':''}`);svg.append(path)}
    for(const node of graph.nodes){
      const button=document.createElement('button');button.type='button';const selectedNode=node.id===`asset:${state.selected}`||(state.selected!==null&&(node.id===`building:${state.building}`||node.id===`storey:${state.storey}`||node.id===`class:${state.category}`||node.id===`family:${state.family}`||node.id===`type:${state.type}`))||(state.groupSelected!==null&&node.label===compact(state.groupSelected));button.className=`ontology-node ontology-node--${node.kind}${selectedNode?' is-active':''}`;
      button.style.left=`${node.x}px`;button.style.top=`${node.y}px`;
      button.setAttribute('aria-label',`${node.label}. ${node.detail}`);button.title=node.detail;
      const bubble=document.createElement('span');bubble.className='ontology-bubble';
      const label=document.createElement('span');label.className='ontology-node-label';label.textContent=node.label;
      button.append(bubble,label);
      if(node.count!=null){const count=document.createElement('small');count.textContent=countLabel(node.count);button.append(count)}
      button.addEventListener('click',()=>Promise.resolve(node.onClick()).catch(error=>{console.error(error);dashboard.toast('Could not highlight this IFC group.')}));
      button.addEventListener('mouseenter',()=>showInfo(node.detail));button.addEventListener('focus',()=>showInfo(node.detail));
      button.addEventListener('mouseleave',()=>showInfo(defaultCaption));button.addEventListener('blur',()=>showInfo(defaultCaption));
      layer.append(button);
    }
    for(const pager of graph.pagers){
      const group=document.createElement('div');group.className='ontology-page';
      const label=document.createElement('strong');label.textContent=pager.label;
      const prev=document.createElement('button');prev.type='button';prev.textContent='‹';prev.disabled=pager.page===0;prev.setAttribute('aria-label',`Previous ${pager.label} page`);
      const range=document.createElement('span');range.textContent=pager.total?`${pager.start+1}–${Math.min(pager.total,pager.start+pager.size)} / ${countLabel(pager.total)}`:'0 / 0';
      const next=document.createElement('button');next.type='button';next.textContent='›';next.disabled=pager.start+pager.size>=pager.total;next.setAttribute('aria-label',`Next ${pager.label} page`);
      const change=delta=>{
        state.pages[pager.key]+=delta;
        if(pager.key==='storey'){state.storey=null;state.category=null;state.pages.class=0;state.pages.element=0}
        if(pager.key==='class'){state.category=null;state.family=null;state.type=null;state.pages.type=0;state.pages.element=0}
        if(pager.key==='type'){state.type=null;state.pages.element=0}
        if(pager.key!=='element'){actions.clearSelection();dashboard.setSelected(null);state.selected=null}
        render();
        showInfo(`${pager.label} page ${state.pages[pager.key]+1} · all ${countLabel(pager.total)} records available`);
      };
      prev.addEventListener('click',()=>change(-1));next.addEventListener('click',()=>change(1));
      group.append(label,prev,range,next);pages.append(group);
    }
  }

  function switchMode(mode) {
    const selected=state.selected;
    state.mode=mode;
    state.pages={storey:0,class:0,type:0,element:0};
    if(selected){
      revealSelected(selected);
      return;
    }
    showInfo(mode==='spatial'?'IfcRelAggregates → IfcRelContainedInSpatialStructure':'IfcRelDefinesByType connects type definitions to elements');
    render();
  }
  $('ontology-spatial').addEventListener('click',()=>switchMode('spatial'));
  $('ontology-types').addEventListener('click',()=>switchMode('types'));
  $('ontology-reset').addEventListener('click',()=>{state.building=firstBuilding;state.storey=firstStorey;state.category=null;state.family=null;state.type=null;state.selected=null;state.pages={storey:0,class:0,type:0,element:0};actions.clearSelection();dashboard.setSelected(null);showInfo(defaultCaption);render()});
  new ResizeObserver(()=>render()).observe(canvas);
  showInfo(defaultCaption);render();
  return {setSelected:revealSelected,clearSelection(){state.selected=null;state.groupSelected=null;showInfo(defaultCaption);render()}};
}
