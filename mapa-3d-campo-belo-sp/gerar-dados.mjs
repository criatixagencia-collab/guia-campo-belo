// Offline: reads only the existing Campo Belo checkout; never fetches source data.
import fs from 'node:fs';
import './relevo.js';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
const here = path.dirname(fileURLToPath(import.meta.url));
const site = path.resolve(here, '../../site');
const { ShapeUtils, Vector2 } = await import(pathToFileURL(path.join(site, 'drone/simulador/three.module.js')));
const source = fs.readFileSync(path.join(site, 'drone/simulador/bairro3d.js'), 'utf8');
const d = vm.runInNewContext(`${source}\n({buildings:BAIRRO_EDIF,roads:BAIRRO_VIAS,lots:BAIRRO_LOTES,sidewalks:BAIRRO_CALCADAS,green:BAIRRO_VERDE,trees:BAIRRO_ARVORES,parked:BAIRRO_CARROS,terrain:BAIRRO_RELEVO,boundary:BAIRRO_LIMITE})`);
const placesSource = fs.readFileSync(path.join(site, 'drone/dados.js'), 'utf8');
const places = vm.runInNewContext(`${placesSource}\ndados`);
const origin = { lat:-23.62008, lng:-46.67225 };
const MLON = 111320 * Math.cos(origin.lat * Math.PI / 180);
const local = ([lng,lat]) => [(lng-origin.lng)*MLON, -(lat-origin.lat)*111320];
const oldTerrain = ([x,z]) => {
  const r=d.terrain, lng=x/MLON+origin.lng,lat=-z/111320+origin.lat;
  const gx=Math.max(0,Math.min(r.n-1.001,(lng-r.lon0)/(r.lon1-r.lon0)*(r.n-1)));
  const gy=Math.max(0,Math.min(r.n-1.001,(lat-r.lat0)/(r.lat1-r.lat0)*(r.n-1)));
  const i=gx|0,j=gy|0,fx=gx-i,fy=gy-j,g=r.g;
  return g[j][i]*(1-fx)*(1-fy)+g[j][i+1]*fx*(1-fy)+g[j+1][i]*(1-fx)*fy+g[j+1][i+1]*fx*fy;
};
const surface=new RelevoLocal(d.terrain,origin);
const terrain=p=>surface.elevation(p);
const triangulate=p=>ShapeUtils.triangulateShape(p.map(q=>new Vector2(...q)),[]);
const alignment=[];
const color=(hex,shade=1) => {
  const v=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)), gray=v[0]*.3+v[1]*.59+v[2]*.11;
  // Retain the approved sage / warm-grey palette with muted source material colors.
  return v.map((n,i)=>Math.round(Math.max(0,Math.min(255,(n*.28+gray*.58+[27,32,29][i])*shade))));
};
const meshes=new Map();
function mesh(key,p=[0,0]) {
  if(!meshes.has(key)) meshes.set(key,{key,bytes:[],bounds:[Infinity,Infinity,-Infinity,-Infinity],count:0,center:p});
  return meshes.get(key);
}
function vertex(m,p,c,kind=0,floor=0) {
  m.bytes.push(...p,...c,kind,floor);
  const sx=p[0]+.23*p[1],sy=.72*p[1]-.1*p[0]-.64*p[2];
  m.bounds[0]=Math.min(m.bounds[0],sx);m.bounds[1]=Math.min(m.bounds[1],sy);
  m.bounds[2]=Math.max(m.bounds[2],sx);m.bounds[3]=Math.max(m.bounds[3],sy);
}
function triangle(m,a,b,c,col,kind=0,floor=0) { for(const p of [a,b,c]) vertex(m,p,col,kind,floor); }
function ring(f) {
  const p=f.geometry.coordinates[0].map(local);
  if(p.length>1&&p[0][0]===p.at(-1)[0]&&p[0][1]===p.at(-1)[1])p.pop();
  return p;
}
function cap(m,p,y,c) {
  if(typeof y==='function') {
    for(const tri of surface.drape(p,triangulate)) {
      const center=tri.reduce((a,q)=>[a[0]+q[0]/3,a[1]+q[1]/3],[0,0]);
      const x=Math.floor(center[0]/400),z=Math.floor(center[1]/400);
      const target=mesh(`chao_${x}_${z}`,[x*400+200,z*400+200]);
      for(const q of tri)vertex(target,[q[0],q[1],y(q)],c);
    }
  } else for(const t of triangulate(p))for(const i of t)vertex(m,[...p[i],y],c);
}
function walls(m,p,lo,hi,c,kind=0,floor=0) {
  for(let i=0;i<p.length;i++) {
    const a=p[i],b=p[(i+1)%p.length],dx=b[0]-a[0],dz=b[1]-a[1],len=Math.hypot(dx,dz)||1;
    const shade=.73+.18*(dx-dz)/len, col=c.map(n=>Math.round(n*shade));
    const a0=[...a,lo],b0=[...b,lo],a1=[...a,hi],b1=[...b,hi];
    triangle(m,a0,b0,b1,col,kind,floor);triangle(m,a0,b1,a1,col,kind,floor);
  }
}
const ground=mesh('base');
// Same sampled relief as the simulator, represented by its original 64x64 grid.
const r=d.terrain;
for(let j=0;j<r.n-1;j++)for(let i=0;i<r.n-1;i++) {
  const at=(x,y)=>[...local([r.lon0+x/(r.n-1)*(r.lon1-r.lon0),r.lat0+y/(r.n-1)*(r.lat1-r.lat0)]),r.g[y][x]-.45];
  const a=at(i,j),b=at(i+1,j),c=at(i+1,j+1),e=at(i,j+1);
  triangle(ground,a,b,c,color('#cbd2c9'));triangle(ground,a,c,e,color('#cbd2c9'));
}
for(const f of d.lots.features)cap(ground,ring(f),p=>terrain(p)+.14,color(['#d8d1c0','#d3ccba','#dcd5c5','#cfc8b6','#d6cfbf','#d0cabb'][(f.properties.t||0)%6]));
for(const f of d.sidewalks.features)cap(ground,ring(f),p=>terrain(p)+.24,color('#e0e1d8'));
for(const f of d.green.features)cap(ground,ring(f),p=>terrain(p)+.30,color(({verde:'#90a68b',quadra:'#92aaa0',agua:'#8faeb9'})[f.properties.kind]||'#b9ad93'));
const half={prim:8,sec:5.5,res:3.75};
function ribbon(m,p,w,lift,col) {
  for(let i=0;i<p.length-1;i++) {
    const a=p[i],b=p[i+1],dx=b[0]-a[0],dz=b[1]-a[1],len=Math.hypot(dx,dz);if(len<.05)continue;
    const nx=-dz/len*w,nz=dx/len*w,steps=Math.max(1,Math.ceil(len/12));
    for(let k=0;k<steps;k++) {
      const q=t=>[a[0]+dx*t,a[1]+dz*t],u=q(k/steps),v=q((k+1)/steps);
      const at=(p,s)=>{const x=[p[0]+nx*s,p[1]+nz*s];return [...x,terrain(x)+lift];};
      cap(m,[at(u,1),at(u,-1),at(v,-1),at(v,1)].map(q=>q.slice(0,2)),q=>terrain(q)+lift,col);
    }
  }
}
for(const f of d.roads.features) {
  const p=f.geometry.coordinates.map(local),w=half[f.properties.cls]||3.75;
  ribbon(ground,p,w,.35,color('#afb6b6'));
  if(f.properties.cls==='prim'||f.properties.cls==='sec')ribbon(ground,p,.18,.40,color('#d4cba2'));
}
const stats={buildings:0,tallBuildings:0,trees:0,parked:0};
function tile(p) {const x=Math.floor(p[0]/400),z=Math.floor(p[1]/400);return mesh(`quadra_${x}_${z}`,[x*400+200,z*400+200]);}
for(const [sourceIndex,f] of d.buildings.features.entries()) {
  const p=ring(f);if(p.length<3||!Number.isFinite(f.properties.h))continue;
  const center=p.reduce((a,q)=>[a[0]+q[0]/p.length,a[1]+q[1]/p.length],[0,0]);
  const m=tile(center),{h,b,col,cw}=f.properties;
  const samples=surface.drape(p,triangulate).flat();
  const heights=samples.length?samples.map(q=>q[2]):p.map(terrain);
  const lowest=Math.min(...heights),highest=Math.max(...heights),tc=highest+.6;
  const oldBase=oldTerrain(center),oldEdgeMax=Math.max(...p.map(oldTerrain));
  alignment.push({sourceIndex,height:h,oldBase,oldEdgeBurial:oldEdgeMax+.24-oldBase,
    lowest,highest,base:tc,roof:tc+h,shift:tc-oldBase,clearance:tc-highest-.4});
  // A neutral plinth closes the slope below the full-height, level facade.
  walls(m,p,lowest-.45,tc+b,color(cw||'#ded7c8'),h>=9?255:128,tc);
  walls(m,p,tc+b,tc+h,color(col||'#a3a099'));
  cap(m,p,tc+h,color(col||'#a3a099',1.06));
  m.count++;stats.buildings++;if(h>=9)stats.tallBuildings++;
}
// Tree footprints, elevations, heights and colors all come from the local geometry.
for(const f of d.trees.features) {
  const p=ring(f);if(p.length<3)continue;
  const center=p.reduce((a,q)=>[a[0]+q[0]/p.length,a[1]+q[1]/p.length],[0,0]);
  const tc=terrain(center),m=tile(center),h=f.properties.h,c=color(f.properties.col||'#739367');
  const base=p.map(q=>[...q,tc+h*.70]),top=[...center,tc+h];
  for(let i=0;i<p.length;i++)triangle(m,base[i],base[(i+1)%p.length],top,c.map(n=>Math.round(n*(i%2?.92:1))));
  stats.trees++;
}
for(const f of d.parked.features) {
  const p=ring(f),center=p.reduce((a,q)=>[a[0]+q[0]/p.length,a[1]+q[1]/p.length],[0,0]);
  const m=tile(center),tc=terrain(center),c=color(f.properties.col||'#c9c9c9');
  walls(m,p,tc+.1,tc+1,c);cap(m,p,tc+1,c);
  const cab=p.map(q=>[center[0]+(q[0]-center[0])*.55,center[1]+(q[1]-center[1])*.72]);
  walls(m,cab,tc+1,tc+1.5,c.map(n=>Math.round(n*.6)));cap(m,cab,tc+1.5,c);stats.parked++;
}
const dir=path.join(here,'cidade');fs.mkdirSync(dir,{recursive:true});
const packets=[];
for(const m of meshes.values()) {
  // Signed 16-bit positions in decimetres: <= 5 cm error per axis.
  // Geographic source coordinates and establishment coordinates remain unchanged.
  const count=m.bytes.length/8,packed=Buffer.alloc(count*12);
  for(let i=0;i<count;i++) {
    const j=i*8,o=i*12;
    for(let a=0;a<3;a++){
      const q=Math.round(m.bytes[j+a]*10);
      if(q< -32768||q>32767)throw new Error('Geometry exceeds packed coordinate range');
      packed.writeInt16LE(q,o+a*2);
    }
    for(let a=0;a<4;a++)packed[o+6+a]=m.bytes[j+3+a];
    packed.writeInt16LE(Math.round(m.bytes[j+7]*10),o+10);
  }
  // Lossless byte-column delta filter before gzip; repeated walls/roof vertices
  // compress far better without changing even one decoded byte.
  const delta=Buffer.alloc(packed.length);
  for(let k=0;k<12;k++){let previous=0;for(let i=0;i<count;i++){const value=packed[i*12+k];delta[k*count+i]=(value-previous+256)%256;previous=value;}}
  const name=`cidade/${m.key}.bin`,zip=gzipSync(delta,{level:9});
  fs.writeFileSync(path.join(here,name),packed);fs.writeFileSync(path.join(here,name+'.gz'),zip);
  packets.push({file:name,vertices:count,bytes:packed.length,gzip:zip.length,bounds:m.bounds,buildings:m.count,center:m.center});
}
const establishments=places.filter(p=>Number.isFinite(p.lat)&&Number.isFinite(p.lng)&&/\b\d{1,5}\b/.test(p.endereco||''))
 .map(p=>({id:p.id,nome:p.nome,categoria:p.categoriaMacro,endereco:p.endereco,lat:p.lat,lng:p.lng}));
const roads=d.roads.features.filter(f=>f.geometry.type==='LineString').map(f=>({p:f.geometry.coordinates,c:f.properties.cls||'',name:f.properties.nome||''}));
const payload={version:4,meshFormat:'int16-decimetres-rgba-stride12',meshCompression:'delta-byte-columns-gzip',source:'site/drone/simulador/bairro3d.js + site/drone/dados.js',origin,
 sourceHashes:{geometry:createHash('sha256').update(source).digest('hex'),places:createHash('sha256').update(placesSource).digest('hex')},
 stats:{...stats,roads:roads.length,lots:d.lots.features.length,sidewalks:d.sidewalks.features.length,green:d.green.features.length,places:establishments.length,minHeight:Math.min(...d.buildings.features.map(f=>f.properties.h)),maxHeight:Math.max(...d.buildings.features.map(f=>f.properties.h))},
 terrainModel:'grid-triangles-a-c',buildingAnchor:'maximum-footprint-terrain-plus-0.6m',packets,terrain:d.terrain,roads,walksFile:'movimento-rotas.json',walksCount:d.sidewalks.features.filter((f,i)=>i%3===0).length,boundary:d.boundary,places:establishments,
 animationNote:'Carros em movimento e pedestres são ilustrações, interpoladas em vias e calçadas locais; não representam trânsito, pessoas ou posições observadas.'};
fs.writeFileSync(path.join(here,'movimento-rotas.json'),JSON.stringify({walks:d.sidewalks.features.filter((f,i)=>i%3===0).map(f=>f.geometry.coordinates[0])}));
fs.writeFileSync(path.join(here,'dados.json'),JSON.stringify(payload));
console.log(JSON.stringify({...payload.stats,packets:packets.length,vertices:packets.reduce((a,p)=>a+p.vertices,0),bytes:packets.reduce((a,p)=>a+p.bytes,0),gzip:packets.reduce((a,p)=>a+p.gzip,0),manifest:fs.statSync(path.join(here,'dados.json')).size},null,2));

fs.writeFileSync(path.join(here,'verificacao/alinhamento.json'),JSON.stringify({
 date:new Date().toISOString(),buildings:alignment.length,
 oldBuriedOver1m:alignment.filter(a=>a.oldEdgeBurial>1).length,
 oldBuriedOverHalfHeight:alignment.filter(a=>a.oldEdgeBurial>a.height/2).length,
 minClearance:Math.min(...alignment.map(a=>a.clearance)),
 maxVerticalShift:Math.max(...alignment.map(a=>a.shift)),
 rows:alignment},null,2));
