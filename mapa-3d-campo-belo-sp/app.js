const canvas = document.querySelector('#map');
const ctx = canvas.getContext('2d');
const leftRail = document.querySelector('#left-categories');
const rightRail = document.querySelector('#right-categories');
const list = document.querySelector('#places');
const search = document.querySelector('#search');
const status = document.querySelector('#status');
const loadStatus = document.querySelector('#load-status');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const icon = {
  'Comer & Beber':'🍽', 'Casa & Decoração':'⌂', 'Serviços Profissionais':'⚒',
  'Beleza & Salões':'✂', 'Fitness & Esportes':'⚽', 'Lazer, Viagens & Eventos':'✦',
  'Saúde & Bem-estar':'✚', 'Moda & Acessórios':'◈', 'Mobilidade & Automotivo':'🚗',
  'Pets':'🐕', 'Compras & Conveniência':'▣', 'Imóveis':'⌖', 'Educação & Cultura':'✎'
};
const categoryColors=['#f5a623','#0edbce','#d28aff','#ff719d','#95dc47','#ffb655','#41c7ff','#f285e2','#ff8263','#b8e65e','#54dcc5','#a5adff','#f8d34d'];
let colors={},data,projected,selectedCategory='Todos',selectedPlace=null,city=null,movement=null;
let width=0,height=0,dpr=1,frame=0,initialZoom=.32,cityDirty=true;
const view={x:0,y:0,zoom:.32};
const pointers=new Map();
let gesture=null,animation=null,motionTimer=0,motionPaused=false,motionTime=0,lastMotionAt=0;
let motionLoadFailed=false;
let lastFrameAt=0,fps=24,slowFrames=0;
const metrics={frameMs:[],intervalMs:[],readyAt:0,firstMapAt:0,firstCityAt:0,draws:0};
const origin={lat:-23.62008,lng:-46.67225};
const metersLng=111320*Math.cos(origin.lat*Math.PI/180);
function local([lng,lat]) {return [(lng-origin.lng)*metersLng,-(lat-origin.lat)*111320];}
let surface=null;
function elevation(p) {return surface?surface.elevation(p):0;}
function world(coord) {const [x,z]=local(coord);return [x+.23*z,.72*z-.1*x-.64*elevation([x,z])];}
function screen(p) {return [width/2+(p[0]-view.x)*view.zoom,height/2+(p[1]-view.y)*view.zoom];}
function projectData(raw) {
  return {roads:raw.roads.map(r=>({...r,p:r.p.map(world)})),boundary:raw.boundary.map(world),places:raw.places.map(p=>({...p,p:world([p.lng,p.lat])}))};
}
function resize() {
  width=innerWidth;height=innerHeight;dpr=Math.min(devicePixelRatio||1,2);
  canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);
  if(projected){
    const xs=projected.boundary.map(p=>p[0]),ys=projected.boundary.map(p=>p[1]);
    const old=initialZoom;
    initialZoom=Math.max(.035,Math.min((width-135)/(Math.max(...xs)-Math.min(...xs)),(height-140)/(Math.max(...ys)-Math.min(...ys))));
    if(!resize.initialized){view.zoom=startZoom();const target=overviewTarget();view.x=target[0];view.y=target[1];resize.initialized=true;}
    else view.zoom=Math.max(initialZoom*.7,Math.min(3,view.zoom*initialZoom/old));
    requestDraw();
  }
}
function startZoom() { return Math.min(3,initialZoom*(width<650?2.05:1.15)); }
function trace(points,close=false) {
  if(!points.length)return;const first=screen(points[0]);ctx.moveTo(...first);
  for(let i=1;i<points.length;i++)ctx.lineTo(...screen(points[i]));if(close)ctx.closePath();
}
function fallbackMap() {
  ctx.fillStyle='#c4d3d3';ctx.fillRect(0,0,width,height);
  ctx.beginPath();trace(projected.boundary,true);ctx.fillStyle='#d8dfd6';ctx.fill();
  ctx.lineCap='round';ctx.lineJoin='round';
  for(const r of projected.roads){ctx.beginPath();trace(r.p);ctx.lineWidth=Math.max(1,(r.c==='prim'?16:7.5)*view.zoom);ctx.strokeStyle='#aeb8b6';ctx.stroke();}
}
function wantsMovement() {return !!(city&&!city.lost&&movement&&!motionPaused&&!reducedMotion.matches&&!document.hidden&&view.zoom>=.5);}
function draw(now=performance.now()) {
  frame=0;clearTimeout(motionTimer);
  if(document.hidden)return;
  const start=performance.now(),moving=wantsMovement();
  if(moving&&lastMotionAt)motionTime+=Math.min(.1,(now-lastMotionAt)/1000);
  lastMotionAt=moving?now:0;
  if(city&&(cityDirty||moving)) {
    if(movement&&cityDirty)movement.exclusions=[...document.querySelectorAll('.rail,.topbar,.panel,.map-controls,.map-info,footer')].map(el=>el.getBoundingClientRect());
    const actors=movement&&view.zoom>=.5?movement.geometry(motionTime,view,width,height,width<650,city.stats.quality):null;
    city.draw(width,height,view,actors);cityDirty=false;
  }
  ctx.clearRect(0,0,width,height);
  if(!city||city.lost||!city.meshes.length)fallbackMap();
  const categoryMode=selectedCategory!=='Todos';
  const points=projected.places.slice().sort((a,b)=>Number(a.id===selectedPlace?.id)-Number(b.id===selectedPlace?.id));
  for(const p of points) {
    const [x,y]=screen(p.p);if(x< -30||x>width+30||y< -60||y>height+30)continue;
    const selected=selectedPlace?.id===p.id,filtered=categoryMode;
    const color=selected?'#f6d554':filtered?(colors[p.categoria]||'#54dcc5'):'#132d51';
    if(filtered||selected){
      const glow=ctx.createRadialGradient(x,y,1,x,y,selected?29:20);glow.addColorStop(0,color+'bb');glow.addColorStop(1,color+'00');
      ctx.fillStyle=glow;ctx.beginPath();ctx.ellipse(x,y,selected?29:20,selected?16:11,0,0,Math.PI*2);ctx.fill();
    }
    ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x,y-(selected?6:3));ctx.strokeStyle=color;ctx.lineWidth=2;ctx.stroke();
    ctx.beginPath();ctx.arc(x,y-(selected?14:9),selected?11:6,0,Math.PI*2);ctx.fillStyle=color;ctx.fill();
    ctx.strokeStyle='#fff';ctx.lineWidth=selected?2.5:1.8;ctx.stroke();
    if(filtered&&!selected){ctx.beginPath();ctx.arc(x,y-9,7.5,0,Math.PI*2);ctx.strokeStyle='#102347';ctx.lineWidth=1;ctx.stroke();}
    if(selected){
      ctx.font='700 12px system-ui';const maxWidth=Math.max(60,width-160);let label=p.nome;
      while(ctx.measureText(label).width>maxWidth&&label.length>4)label=label.slice(0,-2)+'…';
      const tw=ctx.measureText(label).width,tx=Math.max(68,Math.min(width-tw-78,x-tw/2));
      ctx.fillStyle='#102347';ctx.fillRect(tx-7,y-49,tw+14,25);ctx.fillStyle='#fff';ctx.fillText(label,tx,y-32);
    }
  }
  metrics.draws++;metrics.frameMs.push(performance.now()-start);if(metrics.frameMs.length>240)metrics.frameMs.shift();
  if(moving&&lastFrameAt){const dt=now-lastFrameAt;metrics.intervalMs.push(dt);if(metrics.intervalMs.length>240)metrics.intervalMs.shift();
    if(dt>80)slowFrames++;else slowFrames=Math.max(0,slowFrames-1);
    if(slowFrames>12){fps=15;if(city)city.stats.quality=1;slowFrames=0;}
  }
  lastFrameAt=moving?now:0;
  document.querySelector('#motion-note').textContent=motionLoadFailed?'Movimento ilustrativo indisponível':city&&!movement?'Carregando movimento ilustrativo…':reducedMotion.matches?'Movimento reduzido respeitado':motionPaused?'Animação pausada':view.zoom<.5?'Aproxime para ver carros e pedestres':'Carros e pedestres ilustrativos';
  if(moving)motionTimer=setTimeout(()=>requestDraw(false),1000/fps);
}
function requestDraw(dirty=true) {if(dirty)cityDirty=true;if(!frame&&projected&&!document.hidden)frame=requestAnimationFrame(draw);}
function animateTo(target, zoom) {
  if (animation) cancelAnimationFrame(animation);
  if (reducedMotion.matches) { Object.assign(view, { x: target[0], y: target[1], zoom }); requestDraw(); return; }
  const start = performance.now(); const from = { ...view };
  const duration = 700;
  function step(now) {
    const t = Math.min(1, (now - start) / duration), ease = 1 - (1 - t) ** 3;
    view.x = from.x + (target[0] - from.x) * ease;
    view.y = from.y + (target[1] - from.y) * ease;
    view.zoom = from.zoom + (zoom - from.zoom) * ease;
    requestDraw();
    if (t < 1) animation = requestAnimationFrame(step); else animation = null;
  }
  animation = requestAnimationFrame(step);
}
function setCategory(category) {
  selectedCategory = category; selectedPlace = null;
  document.documentElement.style.setProperty('--category-color',colors[category]||'#e9c955');
  document.querySelectorAll('.rail button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.category === category)));
  document.querySelector('#panel-title').textContent = category === 'Todos' ? 'Todos os pontos' : category;
  document.querySelector('.panel').classList.remove('collapsed');
  document.querySelector('#panel-toggle').setAttribute('aria-expanded', 'true');
  document.querySelector('#panel-toggle').setAttribute('aria-label','Recolher lista');
  document.querySelector('#panel-toggle').textContent='⌄';
  refreshList();
  if(category!=='Todos') animateTo(overviewTarget(),initialZoom);
  requestDraw();
  status.textContent = `Categoria ${category} selecionada`;
}
function focusPlace(place) {
  selectedPlace = place;
  document.querySelectorAll('.place').forEach(b => {const active=Number(b.dataset.id)===place.id;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));});
  const zoom=Math.max(view.zoom,width<650?1.15:1.4);
  // Focus above the bottom sheet so the establishment remains visible on touch screens.
  const panelTop=document.querySelector('.panel').getBoundingClientRect().top;
  const targetY=Math.min(height/2,Math.max(165,(90+panelTop)/2));
  animateTo([place.p[0],place.p[1]+(height/2-targetY)/zoom],zoom);
  status.textContent = `Mapa focado em ${place.nome}, ${place.endereco}`;
  requestDraw();
}
function refreshList() {
  const term = search.value.trim().toLocaleLowerCase('pt-BR');
  const shown = projected.places.filter(p => (selectedCategory === 'Todos' || p.categoria === selectedCategory)
    && (!term || p.nome.toLocaleLowerCase('pt-BR').includes(term)));
  document.querySelector('#count').textContent = `${shown.length} estabelecimento${shown.length === 1 ? '' : 's'} com ponto no mapa`;
  list.replaceChildren();
  for (const place of shown) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'place';
    button.dataset.id = place.id;button.setAttribute('aria-pressed',String(selectedPlace?.id===place.id));
    const name = document.createElement('b'), address = document.createElement('span');
    name.textContent = place.nome; address.textContent = place.endereco;
    button.append(name, address); button.addEventListener('click', () => focusPlace(place));
    list.append(button);
  }
  if (selectedPlace) document.querySelectorAll('.place').forEach(b => b.classList.toggle('active', Number(b.dataset.id) === selectedPlace.id));
}
function makeCategories() {
  const categories = ['Todos', ...new Set(projected.places.map(p => p.categoria))];
  categories.forEach((category, index) => {
    if(category!=='Todos')colors[category]=categoryColors[(index-1)%categoryColors.length];
    const button = document.createElement('button'); button.type = 'button'; button.dataset.category = category;
    button.setAttribute('aria-label', category); button.setAttribute('aria-pressed', String(category === 'Todos'));
    button.title = category;
    const glyph = document.createElement('span'), label = document.createElement('span');
    glyph.className = 'icon'; glyph.setAttribute('aria-hidden', 'true'); glyph.textContent = category === 'Todos' ? '●' : icon[category] || '◆';
    label.className = 'name'; label.textContent = category;
    button.append(glyph, label); button.addEventListener('click', () => setCategory(category));
    (index < Math.ceil(categories.length / 2) ? leftRail : rightRail).append(button);
  });
}
function zoomBy(factor) { if(animation){cancelAnimationFrame(animation);animation=null;} view.zoom = Math.max(initialZoom * .7, Math.min(3, view.zoom * factor)); requestDraw(); }
function overviewTarget(){
  if(width>=650)return [0,0];
  const ys=projected.boundary.map(p=>p[1]),xs=projected.boundary.map(p=>p[0]);
  const panelTop=document.querySelector('.panel').getBoundingClientRect().top;
  const targetY=(140+panelTop)/2;
  return [(Math.min(...xs)+Math.max(...xs))/2,(Math.min(...ys)+Math.max(...ys))/2+(height/2-targetY)/initialZoom];
}
function reset() { selectedPlace = null; animateTo(overviewTarget(), initialZoom); refreshList(); }
canvas.addEventListener('pointerdown', e => {
  canvas.setPointerCapture(e.pointerId); pointers.set(e.pointerId, [e.clientX, e.clientY]);
  gesture = { x: e.clientX, y: e.clientY, moved: false, dist: null };
  if (animation){cancelAnimationFrame(animation);animation=null;}
});
canvas.addEventListener('pointermove', e => {
  if (!pointers.has(e.pointerId)) return;
  const old = pointers.get(e.pointerId); pointers.set(e.pointerId, [e.clientX, e.clientY]);
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()]; const dist = Math.hypot(a[0] - b[0], a[1] - b[1]);
    if (gesture?.dist) zoomBy(dist / gesture.dist);
    gesture = { dist, moved: true }; return;
  }
  const dx = e.clientX - old[0], dy = e.clientY - old[1];
  if (dx || dy) { view.x -= dx / view.zoom; view.y -= dy / view.zoom; gesture.moved = true; requestDraw(); }
});
canvas.addEventListener('pointerup', e => {
  pointers.delete(e.pointerId);
  if(gesture)gesture.dist=null;
  if (pointers.size || gesture?.moved || !projected) return;
  const visible = projected.places.filter(p => selectedCategory === 'Todos' || p.categoria === selectedCategory);
  let hit = null, distance = 22;
  for (const place of visible) { const [x, y] = screen(place.p); const d = Math.hypot(x - e.clientX, y - e.clientY + 9); if (d < distance) { hit = place; distance = d; } }
  if (hit) focusPlace(hit);
});
canvas.addEventListener('pointercancel', e => { pointers.delete(e.pointerId); gesture = pointers.size?{moved:true,dist:null}:null; });
canvas.addEventListener('lostpointercapture',e=>{pointers.delete(e.pointerId);if(!pointers.size)gesture=null;});
canvas.addEventListener('wheel', e => { e.preventDefault(); zoomBy(e.deltaY < 0 ? 1.12 : .89); }, { passive: false });
document.querySelector('#zoom-in').addEventListener('click', () => zoomBy(1.3));
document.querySelector('#zoom-out').addEventListener('click', () => zoomBy(1 / 1.3));
document.querySelector('#reset').addEventListener('click', reset);
document.querySelector('#panel-toggle').addEventListener('click', e => {
  const collapsed = document.querySelector('.panel').classList.toggle('collapsed');
  e.currentTarget.setAttribute('aria-expanded', String(!collapsed));
  e.currentTarget.setAttribute('aria-label', collapsed ? 'Expandir lista' : 'Recolher lista');
  e.currentTarget.textContent = collapsed ? '⌃' : '⌄';
  requestDraw();
});
search.addEventListener('input', refreshList);
document.addEventListener('keydown', e => {
  if (e.target === search || e.target.tagName === 'BUTTON') return;
  if(animation){cancelAnimationFrame(animation);animation=null;}
  const movement = 80 / view.zoom;
  if (e.key === 'ArrowLeft') view.x -= movement;
  else if (e.key === 'ArrowRight') view.x += movement;
  else if (e.key === 'ArrowUp') view.y -= movement;
  else if (e.key === 'ArrowDown') view.y += movement;
  else if (e.key === '+' || e.key === '=') zoomBy(1.3);
  else if (e.key === '-') zoomBy(1 / 1.3);
  else return;
  e.preventDefault(); requestDraw();
});
addEventListener('resize', resize);
document.querySelector('#motion-toggle').addEventListener('click',()=>{
  motionPaused=!motionPaused;
  document.querySelector('#motion-toggle').setAttribute('aria-pressed',String(motionPaused));
  document.querySelector('#motion-toggle').textContent=motionPaused?'▶':'Ⅱ';
  document.querySelector('#motion-toggle').setAttribute('aria-label',motionPaused?'Retomar animação ilustrativa':'Pausar animação ilustrativa');
  lastMotionAt=0;requestDraw();
});
function motionPreference(){
  if(reducedMotion.matches&&animation){cancelAnimationFrame(animation);animation=null;}
  document.querySelector('#motion-toggle').disabled=reducedMotion.matches||motionLoadFailed;
  lastMotionAt=0;requestDraw();
}
reducedMotion.addEventListener('change',motionPreference);
document.addEventListener('visibilitychange',()=>{
  clearTimeout(motionTimer);lastMotionAt=0;lastFrameAt=0;
  if(document.hidden&&animation){cancelAnimationFrame(animation);animation=null;}
  if(document.hidden&&frame){cancelAnimationFrame(frame);frame=0;}
  if(!document.hidden)requestDraw();
});
fetch('dados.json').then(r=>{if(!r.ok)throw new Error(`HTTP ${r.status}`);return r.json();})
 .then(async raw=>{
  data=raw;surface=new RelevoLocal(raw.terrain,raw.origin);projected=projectData(raw);makeCategories();refreshList();resize();motionPreference();
  metrics.firstMapAt=performance.now();status.textContent=`${projected.places.length} pontos carregados`;
  try{
    city=new Cidade(document.querySelector('#city'),message=>{loadStatus.textContent=message;});
    // Secondary illustrative routes never delay search, categories or city loading.
    fetch(raw.walksFile).then(r=>{if(!r.ok)throw new Error('ROUTES_UNAVAILABLE');return r.json();})
      .then(routes=>{movement=new Movimento({...data,...routes},local,elevation);requestDraw();})
      .catch(()=>{motionLoadFailed=true;motionPreference();});
    await city.load(data,()=>{if(!metrics.firstCityAt)metrics.firstCityAt=performance.now();requestDraw();});metrics.readyAt=performance.now();requestDraw();
  }catch(e){loadStatus.textContent=city?'Parte da cidade não carregou. Recarregue para tentar novamente.':'Modo mapa simples · 3D indisponível neste navegador';status.textContent=loadStatus.textContent;requestDraw();}
 })
 .catch(()=>{document.querySelector('#panel-title').textContent='Não foi possível carregar o mapa';loadStatus.textContent='Dados locais indisponíveis. Recarregue a página.';status.textContent=loadStatus.textContent;});
// Read-only diagnostics for repeatable local checks; no telemetry leaves the browser.
window.mapaDiagnostico=()=>({view:{...view},initialZoom,category:selectedCategory,selected:selectedPlace?.id,
 places:projected?.places.length,loaded:city?.stats.loaded,total:city?.stats.total,city:city?{...city.stats}:null,
 metrics:structuredClone(metrics),motion:{running:wantsMovement(),paused:motionPaused,reduced:reducedMotion.matches,time:motionTime,actors:view.zoom>=.5?movement?.visible||0:0,distribution:movement?{...movement.stats}:null,fps},
 selectedScreen:selectedPlace?screen(selectedPlace.p):null});

window.mapaAtores=()=>movement?.rendered?.map(a=>({...a}))||[];
