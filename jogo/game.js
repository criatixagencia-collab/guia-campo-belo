/* Volta ao Bairro: local browser game. City, streets and places are reused
   from the existing Campo Belo prototype. Only the racing rules are new. */
import {Cena} from './cena.js';
import {Som} from './som.js';
const som=new Som();
const SOURCE='dados/';
const $=selector=>document.querySelector(selector);
const cityCanvas=$('#city'),overlay=$('#race'),ctx=overlay.getContext('2d');
const mini=$('#mini'),mctx=mini.getContext('2d');
const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)');
let data,terrain,city,roadIndex,allCheckpoints=[],selectedCategory='',checkpoints=[];
let width=0,height=0,dpr=1,cityReady=false,last=0,bannerUntil=0;
let state='menu',elapsed=0,raceClockStarted=false,visited=new Set(),bestKey='',nearRoad=null;
let freeDrive=false,cameraMode='near',ready=false,lastSafe=null;
const car={x:0,z:0,heading:0,speed:0,steer:0};
const held={throttle:false,brake:false,left:false,right:false};
const origin={lat:-23.62008,lng:-46.67225};
const metersLng=111320*Math.cos(origin.lat*Math.PI/180);
const local=([lng,lat])=>[(lng-origin.lng)*metersLng,-(lat-origin.lat)*111320];
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
const formatTime=s=>`${String(Math.floor(s/60)).padStart(2,'0')}:${String(Math.floor(s%60)).padStart(2,'0')}.${Math.floor((s%1)*10)}`;
const worldScreen=(x,z,y=0)=>city?city.project(x,z,y,width,height):[0,0,false];
function inBoundary(x,z,polygon){let inside=false;for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){
  const a=polygon[i],b=polygon[j];if((a[1]>z)!==(b[1]>z)&&x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0])inside=!inside;
}return inside;}
function elevation(x,z){return terrain?.elevation([x,z])||0;}
function resize(){width=innerWidth;height=innerHeight;dpr=Math.min(devicePixelRatio||1,2);overlay.width=Math.round(width*dpr);overlay.height=Math.round(height*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);cityReady=true;draw();}

// Asphalt half-widths, the same used by cena.js for the road markings; the sidewalk starts past them.
const ROAD_HALF={prim:8,sec:5.5,res:3.75},CURB=.75;
class RoadIndex{
  constructor(roads){this.size=85;this.cells=new Map();this.segments=[];
    const add=(ix,iz,segment)=>{const key=`${ix},${iz}`;if(!this.cells.has(key))this.cells.set(key,[]);this.cells.get(key).push(segment);};
    // Junctions (3+ road ends/bends meet): the rounded asphalt corners and corner planters go beyond the straight
    // road edges, so a disc around each junction also counts as road for the curb test.
    const nodes=new Map();for(const road of roads){const w=ROAD_HALF[road.c]||3.75;road.p.forEach((q,i)=>{const k=q[0].toFixed(6)+','+q[1].toFixed(6),n=nodes.get(k)||{q,uses:0,w:0};n.uses+=i>0&&i<road.p.length-1?2:1;n.w=Math.max(n.w,w);nodes.set(k,n);});}
    this.junctions=new Map();for(const n of nodes.values())if(n.uses>=3){const [x,z]=local(n.q),key=`${Math.floor(x/this.size)},${Math.floor(z/this.size)}`;if(!this.junctions.has(key))this.junctions.set(key,[]);this.junctions.get(key).push({x,z,r:n.w*1.42+3.5});}
    for(const road of roads){const points=road.p.map(local);for(let i=1;i<points.length;i++){
      const a=points[i-1],b=points[i];if(distance(a,b)<.5)continue;
      const segment={a,b,name:road.name||'',primary:road.c==='prim',w:ROAD_HALF[road.c]||3.75,angle:Math.atan2(b[1]-a[1],b[0]-a[0])};this.segments.push(segment);
      for(let ix=Math.floor(Math.min(a[0],b[0])/this.size);ix<=Math.floor(Math.max(a[0],b[0])/this.size);ix++)
        for(let iz=Math.floor(Math.min(a[1],b[1])/this.size);iz<=Math.floor(Math.max(a[1],b[1])/this.size);iz++)add(ix,iz,segment);
    }}
  }
  nearest(x,z,full=false){const candidates=[];
    if(full)candidates.push(...this.segments);
    else {const ix=Math.floor(x/this.size),iz=Math.floor(z/this.size);for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++)candidates.push(...(this.cells.get(`${ix+dx},${iz+dz}`)||[]));
      if(!candidates.length)candidates.push(...this.segments);
    }
    let best=null,bestD=Infinity,e=Infinity;
    for(const segment of candidates){const [a,b]=[segment.a,segment.b],vx=b[0]-a[0],vz=b[1]-a[1];const t=clamp(((x-a[0])*vx+(z-a[1])*vz)/(vx*vx+vz*vz),0,1);
      const px=a[0]+vx*t,pz=a[1]+vz*t,d=Math.hypot(x-px,z-pz);e=Math.min(e,d-segment.w);
      if(d<bestD){bestD=d;best={x:px,z:pz,d,segment};}
    }
    if(!full){const ix=Math.floor(x/this.size),iz=Math.floor(z/this.size);for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++)for(const j of this.junctions.get(`${ix+dx},${iz+dz}`)||[])e=Math.min(e,Math.hypot(x-j.x,z-j.z)-j.r);}
    // e: distance past the asphalt edge of the widest covering road (negative = on the road), so junctions count as road.
    if(best)best.e=e;return best;
  }
}

function prepareCheckpoints(){const polygon=data.boundary.map(local);allCheckpoints=data.places.map(place=>{
  const [x,z]=local([place.lng,place.lat]);const nearest=roadIndex.nearest(x,z,true),inside=inBoundary(x,z,polygon);
  return {...place,sourceX:x,sourceZ:z,x:nearest.x,z:nearest.z,offset:nearest.d,inside,eligible:inside&&nearest.d<=50};
});}
function categories(){return [...new Set(data.places.map(p=>p.categoria))];}
function selectCategory(category){selectedCategory=category;checkpoints=allCheckpoints.filter(p=>p.categoria===category&&p.eligible);
  $('#categories').querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.category===category)));
  const excluded=allCheckpoints.filter(p=>p.categoria===category&&!p.eligible).length;
  $('#eligibility').textContent=`${checkpoints.length} passagens nesta prova${excluded?` · ${excluded} ponto${excluded===1?'':'s'} fora da mini cidade 3D, sem criar trajeto fictício`:''}.`;
  $('#start').disabled=!checkpoints.length||!ready;
}
function buildMenu(){const root=$('#categories');root.replaceChildren();for(const category of categories()){
  const eligible=allCheckpoints.filter(p=>p.categoria===category&&p.eligible).length;
  const b=document.createElement('button');b.type='button';b.dataset.category=category;b.setAttribute('aria-pressed','false');
  const name=document.createTextNode(category),count=document.createElement('span');count.textContent=`${eligible} passagem${eligible===1?'':'ens'}`;b.append(name,count);
  b.addEventListener('click',()=>selectCategory(category));root.append(b);
}selectCategory('Mobilidade & Automotivo');}
function resetCar(){const starter=checkpoints.reduce((best,p)=>!best||Math.hypot(p.x,p.z)<Math.hypot(best.x,best.z)?p:best,null);
  const road=roadIndex.nearest(starter?.x||0,starter?.z||0);
  // Begin on the same source street, a short distance before the first marker.
  car.heading=road.segment.angle;car.x=road.x-Math.cos(car.heading)*42;car.z=road.z-Math.sin(car.heading)*42;
  const snapped=roadIndex.nearest(car.x,car.z);car.x=snapped.x;car.z=snapped.z;
  car.speed=0;car.steer=0;nearRoad=snapped;lastSafe={x:car.x,z:car.z,heading:car.heading};
  if(city)city.update(car,.1,{mode:cameraMode,snap:true});}
function startRace(explore=false){if(!checkpoints.length||!ready)return;freeDrive=explore;visited=new Set();elapsed=0;raceClockStarted=false;resetCar();state='race';city.setMarkers(freeDrive?[]:checkpoints);
  bestKey=`campo-belo-immersive:${selectedCategory}`;$('#menu').hidden=true;$('#result').hidden=true;$('#hud').hidden=false;$('#touch-controls').hidden=false;
  $('#pause').disabled=false;$('#pause').textContent='Ⅱ';$('#pause').setAttribute('aria-label','Pausar corrida');$('#load').hidden=true;
  banner(freeDrive?'Explore livremente · C troca a câmera':'Acelere para começar a prova',2100);updateHUD();draw();}
function finish(){state='finished';clearHeld();let old=Infinity;
  try{old=Number(localStorage.getItem(bestKey))||Infinity;if(elapsed<old)localStorage.setItem(bestKey,String(elapsed));}
  catch{old=Infinity;}
  $('#final-time').textContent=formatTime(elapsed);$('#best-time').textContent=elapsed<old?'Novo melhor tempo neste navegador!':`Melhor tempo neste navegador: ${formatTime(old)}`;
  $('#result').hidden=false;$('#touch-controls').hidden=true;$('#pause').disabled=true;updateHUD();}
function banner(text,ms=1500){$('#banner').textContent=text;$('#banner').classList.add('show');bannerUntil=performance.now()+ms;}
function clearHeld(){for(const key of Object.keys(held))held[key]=false;document.querySelectorAll('[data-control]').forEach(b=>b.classList.remove('pressed'));}
function togglePause(){if(state==='race'){state='paused';clearHeld();$('#pause').textContent='▶';$('#pause').setAttribute('aria-label','Retomar corrida');banner('Corrida pausada',3600000);}
  else if(state==='paused'){state='race';$('#pause').textContent='Ⅱ';$('#pause').setAttribute('aria-label','Pausar corrida');$('#banner').classList.remove('show');}}
function nearestTarget(){let target=null,d=Infinity;for(const p of checkpoints){if(visited.has(p.id))continue;const current=Math.hypot(car.x-p.x,car.z-p.z);if(current<d){target=p;d=current;}}return {target,d};}
function updateHUD(){if(state==='menu')return;$('#time').textContent=formatTime(elapsed);$('#speed').textContent=String(Math.round(Math.abs(car.speed)*3.6));$('#progress').textContent=`${visited.size}/${checkpoints.length}`;
  if(freeDrive){$('#time').textContent='LIVRE';$('#progress').textContent='—';$('#next-name').textContent='Explore Campo Belo';$('#next-distance').textContent='Câmera próxima, distante ou capô';return;}
  const {target,d}=nearestTarget();$('#next-name').textContent=target?.nome||'Prova completa';$('#next-distance').textContent=target?`${Math.round(d)} m em linha reta · procure o brilho dourado`:'';}
function step(dt){if(state!=='race')return;
  if(held.throttle||held.brake||Math.abs(car.speed)>.15)raceClockStarted=true;
  nearRoad=roadIndex.nearest(car.x,car.z);const shoulder=nearRoad.segment.primary?10:7.5;
  const offroad=nearRoad.d>shoulder;
  let acceleration=held.throttle?(offroad?3.2:8.2):0;
  if(held.brake)acceleration-=car.speed>1?15:5;
  acceleration-=Math.sign(car.speed)*(.6+.018*car.speed*car.speed);
  car.speed=clamp(car.speed+acceleration*dt,-5,offroad?12:29);
  if(!held.throttle&&!held.brake&&Math.abs(car.speed)<.15)car.speed=0;
  const input=Number(held.right)-Number(held.left);car.steer+=(input-car.steer)*Math.min(1,dt*7);
  const grip=offroad?.68:1;const turn=car.speed/2.7*Math.tan(car.steer*.5/(1+Math.abs(car.speed)*.09))*grip;
  const oldHeading=car.heading;car.heading+=turn*dt;
  const nextX=car.x+Math.cos(car.heading)*car.speed*dt,nextZ=car.z+Math.sin(car.heading)*car.speed*dt;
  let nextRoad=roadIndex.nearest(nextX,nextZ);
  // Curb: the car body may not climb onto the sidewalk. Moves that push it further past the asphalt edge
  // slide along the street instead (or stop), so a car already off the road can still drive back.
  const curbHit=(x,z,r,h)=>{const fx=Math.cos(h)*1.6,fz=Math.sin(h)*1.6;return Math.max(r.e,roadIndex.nearest(x+fx,z+fz).e,roadIndex.nearest(x-fx,z-fz).e)>-CURB;};
  if(curbHit(nextX,nextZ,nextRoad,car.heading)&&nextRoad.e>=nearRoad.e-.02){
    const s=nearRoad.segment,tx=Math.cos(s.angle),tz=Math.sin(s.angle),dir=Math.sign(Math.cos(car.heading)*tx+Math.sin(car.heading)*tz)||1;
    const step=car.speed*dt,px=car.x+tx*dir*step*.85+(nearRoad.x-car.x)*.06,pz=car.z+tz*dir*step*.85+(nearRoad.z-car.z)*.06,pr=roadIndex.nearest(px,pz);
    const target=dir*Math.sign(step)>0?s.angle:s.angle+Math.PI,turnTo=Math.atan2(Math.sin(target-car.heading),Math.cos(target-car.heading));
    if(Math.abs(step)>.001&&pr.e<=nearRoad.e+.01&&!city.vehicleBlocked(px,pz,car.heading)){car.heading=oldHeading+turnTo*Math.min(1,dt*5)*(Math.sign(step)<0?0:1);car.speed*=1-Math.min(.5,dt*1.6);car.x=px;car.z=pz;nearRoad=pr;
      if(Math.abs(car.speed)>6)banner('Meio-fio',500);}
    else{car.heading=oldHeading;som.bump(Math.min(1,Math.abs(car.speed)/4+.3));car.speed*=-.12;banner('Meio-fio · manobre para a rua',700);}
  }else if(nextRoad.d>19||city.vehicleBlocked(nextX,nextZ,car.heading)){car.heading=oldHeading;som.bump(Math.min(1,Math.abs(car.speed)/3+.4));car.speed*=-.12;banner('Obstáculo · freie e manobre',700);}else{car.x=nextX;car.z=nextZ;nearRoad=nextRoad;if(nextRoad.d<3)lastSafe={x:car.x,z:car.z,heading:car.heading};}
  if(!freeDrive&&Math.abs(car.speed)>2.5&&nearRoad.d<12){for(const p of checkpoints){if(visited.has(p.id))continue;
    if(Math.hypot(car.x-p.x,car.z-p.z)<17){visited.add(p.id);banner(`${p.nome} · ${visited.size}/${checkpoints.length}`,1800);updateHUD();if(visited.size===checkpoints.length){finish();break;}}
  }}
  if(Math.round(elapsed*10)%2===0)updateHUD();
}
function updateCamera(dt){if(!data||state!=='race'||!city)return;city.update(car,dt,{mode:cameraMode,brake:held.brake,visited,reduced:reducedMotion.matches});}
function drawGuidance(){if(freeDrive||(state!=='race'&&state!=='paused'))return;const {target,d}=nearestTarget();if(!target)return;
  const [sx,sy,visible]=worldScreen(target.x,target.z,elevation(target.x,target.z)+9);
  if(visible&&sx>40&&sx<width-40&&sy>180&&sy<height-100&&d<140){ctx.fillStyle='#10243be0';ctx.font='700 12px system-ui';ctx.textAlign='center';const label=target.nome.slice(0,28);const w=ctx.measureText(label).width+18;ctx.fillRect(sx-w/2,sy-15,w,24);ctx.fillStyle='#ffdf83';ctx.fillText(label,sx,sy+2);return;}
  const relative=Math.atan2(target.z-car.z,target.x-car.x)-car.heading,angle=relative-Math.PI/2;
  const x=width/2+Math.cos(angle)*60,y=height*.32+Math.sin(angle)*25;
  ctx.save();ctx.translate(x,y);ctx.rotate(angle);ctx.fillStyle='#f6d451';ctx.shadowColor='#0009';ctx.shadowBlur=9;ctx.beginPath();ctx.moveTo(17,0);ctx.lineTo(-8,-10);ctx.lineTo(-8,10);ctx.closePath();ctx.fill();ctx.restore();}
function drawMini(){if(!data)return;const w=150,h=150;mctx.clearRect(0,0,w,h);mctx.fillStyle='#0a223b';mctx.fillRect(0,0,w,h);
  // Heading-up map centred on the car (about 650 m across): the street ahead is always "up"; an N marks north.
  if(!miniRoads)miniRoads=data.roads.map(r=>({c:r.c,p:r.p.map(local)}));
  const s=150/650,rot=-Math.PI/2-car.heading,cs=Math.cos(rot),sn=Math.sin(rot),cx=75,cy=96;
  const at=(x,z)=>{const dx=(x-car.x)*s,dz=(z-car.z)*s;return [cx+dx*cs-dz*sn,cy+dx*sn+dz*cs];};
  const far=(110/s)**2;
  for(const [cls,col,lw] of [['res','#55707b',1.1],['sec','#7f9aa3',1.8],['prim','#a9bcc2',2.6]]){mctx.strokeStyle=col;mctx.lineWidth=lw;mctx.beginPath();
    for(const road of miniRoads){if(cls==='res'?road.c==='sec'||road.c==='prim':road.c!==cls)continue;const q=road.p;
      if(q.every(([x,z])=>(x-car.x)**2+(z-car.z)**2>far))continue;q.forEach(([x,z],i)=>{const [px,pz]=at(x,z);i?mctx.lineTo(px,pz):mctx.moveTo(px,pz);});}
    mctx.stroke();}
  for(const p of freeDrive?[]:checkpoints){let [x,z]=at(p.x,p.z);x=clamp(x,5,w-5);z=clamp(z,5,h-5);mctx.beginPath();mctx.arc(x,z,visited.has(p.id)?2:3.4,0,Math.PI*2);mctx.fillStyle=visited.has(p.id)?'#48a786':'#f7d459';mctx.fill();}
  mctx.beginPath();mctx.moveTo(cx,cy-8);mctx.lineTo(cx+5.5,cy+6);mctx.lineTo(cx,cy+3);mctx.lineTo(cx-5.5,cy+6);mctx.closePath();mctx.fillStyle='#e34a43';mctx.fill();mctx.strokeStyle='#fff';mctx.lineWidth=1.4;mctx.stroke();
  const na=rot-Math.PI/2,nx=cx+Math.cos(na)*60,ny=cy+Math.sin(na)*60,ncx=clamp(nx,10,w-10),ncy=clamp(ny,10,h-10);
  mctx.beginPath();mctx.arc(ncx,ncy,8,0,Math.PI*2);mctx.fillStyle='#081b32e6';mctx.fill();mctx.strokeStyle='#f5d35e';mctx.lineWidth=1;mctx.stroke();
  mctx.fillStyle='#f5d35e';mctx.font='bold 10px system-ui,sans-serif';mctx.textAlign='center';mctx.textBaseline='middle';mctx.fillText('N',ncx,ncy+.5);}
let miniRoads=null;
function draw(now=performance.now()){if(!data||!width)return;ctx.clearRect(0,0,width,height);
  if(state!=='menu'){drawGuidance();drawMini();}
  if(now>bannerUntil)$('#banner').classList.remove('show');}
function loop(now){requestAnimationFrame(loop);if(document.hidden)return;
  // The city meshes are expensive on phones: cap active drawing at 30 fps.
  // A paused/menu scene only needs a sparse refresh for loading and notices.
  if(last&&now-last<(state==='race'?1000/30-1:200))return;
  const wallDt=last?Math.max(0,(now-last)/1000):0,dt=Math.min(wallDt,.25);last=now;
  if(!data)return;
  // The clock follows real elapsed time even if rendering falls below target.
  if(state==='race'&&raceClockStarted&&!freeDrive)elapsed+=wallDt;
  // Substeps keep speed and checkpoint detection consistent if a frame is slow.
  const parts=Math.max(1,Math.ceil(dt/.05));for(let i=0;i<parts;i++)step(dt/parts);
  som.setActive(state==='race');if(state==='race')som.update(dt,{speed:car.speed,throttle:held.throttle,brake:held.brake,steer:car.steer,offroad:!!nearRoad&&nearRoad.e>.3});
  updateStreet(now);updateCamera(dt);
  if(city&&!city.lost&&(state==='race'||cityReady)){city.draw(width,height);cityReady=false;}
  draw(now);}
let toggleSound=()=>{};
function blockZoom(){
  // iOS Safari ignores user-scalable=no: cancel its pinch gestures, multi-finger moves and double-tap zoom.
  for(const ev of ['gesturestart','gesturechange','gestureend'])document.addEventListener(ev,e=>e.preventDefault(),{passive:false});
  document.addEventListener('touchmove',e=>{if(e.touches.length>1)e.preventDefault();},{passive:false});
  document.addEventListener('selectstart',e=>e.preventDefault());document.addEventListener('contextmenu',e=>{if(!e.target.closest('a'))e.preventDefault();});
  document.addEventListener('dblclick',e=>e.preventDefault(),{passive:false});}
function bindControls(){blockZoom();const mapping={ArrowUp:'throttle',KeyW:'throttle',ArrowDown:'brake',KeyS:'brake',ArrowLeft:'left',KeyA:'left',ArrowRight:'right',KeyD:'right'};
  addEventListener('keydown',e=>{if(e.code==='KeyP'&&state!=='menu'&&state!=='finished'){e.preventDefault();togglePause();return;}
    if(e.code==='KeyC'&&!e.repeat){cycleCamera();return;}if(e.code==='KeyM'&&!e.repeat){toggleSound();return;}if(e.code==='KeyR'&&!e.repeat){recoverCar();return;}
    if(mapping[e.code]){e.preventDefault();held[mapping[e.code]]=true;}});
  addEventListener('keyup',e=>{if(mapping[e.code]){e.preventDefault();held[mapping[e.code]]=false;}});
  addEventListener('blur',clearHeld);
  document.addEventListener('visibilitychange',()=>{clearHeld();last=0;if(document.hidden&&state==='race')togglePause();if(document.hidden)som.suspend();else som.resume();});
  for(const ev of ['pointerdown','keydown'])addEventListener(ev,()=>som.start(),{capture:true});
  const soundLabel=()=>{$('#sound').textContent=som.muted?'Som: desligado':'Som: ligado';$('#sound').setAttribute('aria-pressed',String(!som.muted));};
  toggleSound=()=>{som.start();som.setMuted(!som.muted);soundLabel();};$('#sound').addEventListener('click',toggleSound);soundLabel();
  for(const button of document.querySelectorAll('[data-control]')){
    const control=button.dataset.control;
    button.addEventListener('pointerdown',e=>{e.preventDefault();button.setPointerCapture(e.pointerId);held[control]=true;button.classList.add('pressed');});
    for(const event of ['pointerup','pointercancel','lostpointercapture'])button.addEventListener(event,()=>{held[control]=false;button.classList.remove('pressed');});
  }
  $('#start').addEventListener('click',()=>startRace(false));$('#free-drive').addEventListener('click',()=>startRace(true));$('#pause').addEventListener('click',togglePause);
  $('#again').addEventListener('click',()=>startRace(false));$('#change-category').addEventListener('click',backToMenu);$('#menu-back').addEventListener('click',backToMenu);
  $('#camera-mode').addEventListener('click',cycleCamera);$('#reset-car').addEventListener('click',recoverCar);$('#fullscreen').addEventListener('click',()=>{if(document.fullscreenElement)document.exitFullscreen();else document.documentElement.requestFullscreen?.();});
  addEventListener('resize',resize);}
async function init(){bindControls();resize();requestAnimationFrame(loop);
  try{const response=await fetch(SOURCE+'dados.json');if(!response.ok)throw new Error(`Dados locais: HTTP ${response.status}`);
    data=await response.json();terrain=new RelevoLocal(data.terrain,data.origin);roadIndex=new RoadIndex(data.roads);prepareCheckpoints();buildMenu();
    const manifest={...data,packets:data.packets.map(p=>({...p,file:SOURCE+p.file}))};
    // The site ships only the gzip city meshes; browsers without DecompressionStream (Safari < 16.4) cannot read them.
    if(typeof DecompressionStream!=='function'){$('#load').textContent='Atualize o navegador para jogar.';$('#eligibility').textContent='Este navegador é antigo demais para a cidade 3D. Atualize o sistema ou use o Chrome.';return;}
    try{city=new Cena(cityCanvas,message=>{$('#load').textContent=message;},terrain);
      resetCar();const t0=performance.now(),tick=setInterval(()=>showProgress(city.progress(),(performance.now()-t0)/1000),300);
      try{await city.load(manifest,()=>{cityReady=true;});}finally{clearInterval(tick);}showProgress(1,0);ready=true;$('#free-drive').disabled=false;selectCategory(selectedCategory);$('#load').hidden=true;city.update(car,.1,{mode:cameraMode,snap:true});cityReady=true;
    }catch(e){$('#load').textContent='Não foi possível carregar a cena 3D. Recarregue a página.';console.error(e);}
    draw();
  }catch(e){$('#load').textContent='Não foi possível carregar a cidade.';$('#eligibility').textContent='Recarregue a página para tentar de novo.';console.error(e);}}
function backToMenu(){state='menu';clearHeld();$('#result').hidden=true;$('#menu').hidden=false;$('#hud').hidden=true;$('#touch-controls').hidden=true;$('#pause').disabled=true;draw();}
function cycleCamera(){cameraMode=({near:'far',far:'hood',hood:'near'})[cameraMode];$('#camera-mode').textContent='Câmera: '+({near:'próxima',far:'distante',hood:'capô'})[cameraMode];if(city){city.update(car,.1,{mode:cameraMode,snap:true});cityReady=true;}}
// Loading bar on the menu: share downloaded and an estimate of the remaining wait from the rate so far.
function showProgress(p,elapsed){const bar=$('#loadbar');if(!bar)return;bar.querySelector('i').style.width=`${Math.round(p*100)}%`;
  bar.setAttribute('aria-valuenow',String(Math.round(p*100)));
  let text;if(p>=1){text='Pronto para jogar!';bar.classList.add('done');}
  else{const left=p>.06&&elapsed>1.5?elapsed*(1-p)/p:null;text=`Carregando a cidade 3D… ${Math.round(p*100)}%`+(left?` · cerca de ${left<10?Math.ceil(left):Math.ceil(left/5)*5} s`:'');}
  bar.querySelector('span').textContent=text;}
// Street name: shown softly above the controls when the car is on a named road; it changes only after
// the car has stayed on the new street for a moment, so junction crossings do not make it flicker.
let streetShown='',streetCandidate='',streetSince=0;
function updateStreet(now){const el=$('#street');if(!el)return;const r=state==='race'&&nearRoad&&nearRoad.e<1.5?nearRoad.segment.name:'';
  if(r!==streetCandidate){streetCandidate=r;streetSince=now;}
  if(streetCandidate!==streetShown&&now-streetSince>(streetCandidate?450:1500)){streetShown=streetCandidate;el.classList.remove('show');
    if(streetShown)setTimeout(()=>{el.textContent=streetShown;el.classList.add('show');},220);}
  if(state!=='race'&&state!=='paused'){el.classList.remove('show');streetShown='';}}
function recoverCar(){if(!ready||state==='menu')return;if(lastSafe){Object.assign(car,lastSafe);car.speed=0;car.steer=0;city.update(car,.1,{mode:cameraMode,snap:true});cityReady=true;if(!freeDrive)elapsed+=5;banner(freeDrive?'De volta à rua':'De volta à rua · +5 s');updateHUD();}}
init();
window.corridaDiagnostico=()=>({state,ready,freeDrive,cameraMode,category:selectedCategory,checkpoints:checkpoints.length,eligible:allCheckpoints.filter(p=>p.eligible).length,excluded:allCheckpoints.filter(p=>!p.eligible).length,visited:visited.size,time:elapsed,car:{...car},roadDistance:nearRoad?.d,blocked:city?.vehicleBlocked(car.x,car.z,car.heading),cityLoaded:city?.stats.loaded,cityTotal:city?.stats.total,cityDraws:city?.stats.draws,graphics:city?.stats});
