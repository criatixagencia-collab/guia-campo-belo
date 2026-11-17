import * as THREE from 'three';
import {GLTFLoader} from './vendor/GLTFLoader.js';
import {mergeGeometries} from './vendor/BufferGeometryUtils.js';
import {RGBELoader} from './vendor/RGBELoader.js';

// Display-space colours (the city shader writes values without colour conversion).
const HORIZON='#c2d6e0';const HORIZON_RGB=new THREE.Vector3(194/255,214/255,224/255);
// Manual lookup into the sun's shadow map (RGBA-packed depth in r158) for the unlit city shaders.
const SHADOW_GLSL=`uniform sampler2D sMap;uniform mat4 sMat;uniform float sOn;uniform float sTexel;
      float sTap(vec2 uv,float z){return step(z,dot(texture2D(sMap,uv),vec4(5.9371e-8,1.5199e-5,3.8910e-3,.99609375)));}
      float sunShadow(vec3 wp){if(sOn<.5)return 1.;vec4 sc=sMat*vec4(wp,1.);vec3 s=sc.xyz/sc.w;if(s.x<0.||s.x>1.||s.y<0.||s.y>1.||s.z>1.)return 1.;
        float z=s.z-.0006;vec2 tc=s.xy/sTexel-.5,f=fract(tc),b=(floor(tc)+.5)*sTexel;vec3 wx=vec3(1.-f.x,1.,f.x),wy=vec3(1.-f.y,1.,f.y);float a=0.;
        for(int j=0;j<3;j++)for(int i=0;i<3;i++)a+=wx[i]*wy[j]*sTap(b+vec2(float(i)-1.,float(j)-1.)*sTexel*1.5,z);a*=1.25;
        vec2 e=min(s.xy,1.-s.xy);return mix(1.,a/5.,smoothstep(0.,.08,min(e.x,e.y)));}`;
const rgb=h=>new THREE.Vector3(...[1,3,5].map(i=>parseInt(h.slice(i,i+2),16)/255));

// The existing packet stores east, south, altitude. This renderer converts to
// east, altitude, south and uses a real perspective camera and depth buffer.
export class Cena {
  constructor(canvas,report,terrain){
    this.report=report;this.terrain=terrain;this.meshes=[];this.stats={loaded:0,total:0,draws:0,carLoaded:false};this.prog={car:0,hdr:0,col:0};
    this.mobile=innerWidth<700;this.renderer=new THREE.WebGLRenderer({canvas,antialias:true,powerPreference:'high-performance'});
    this.renderer.setPixelRatio(Math.min(devicePixelRatio,this.mobile?1.25:1.5));
    this.renderer.outputColorSpace=THREE.SRGBColorSpace;this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.15;
    this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=THREE.PCFSoftShadowMap;
    this.scene=new THREE.Scene();this.scene.background=new THREE.Color(HORIZON);this.scene.fog=new THREE.Fog(HORIZON,180,650);
    this.camera=new THREE.PerspectiveCamera(58,1,.15,600);this.mode='near';this.heading=0;this.readyCamera=false;
    this.scene.add(new THREE.HemisphereLight(0xe2f1ff,0x827963,2.1));
    this.sun=new THREE.DirectionalLight(0xffedce,3.0);this.sun.castShadow=true;this.sun.shadow.mapSize.set(this.mobile?1024:2048,this.mobile?1024:2048);
    // One shadow map covers the blocks around the car, so buildings and trees shade the street.
    const reach=this.mobile?55:85;Object.assign(this.sun.shadow.camera,{near:1,far:420,left:-reach,right:reach,top:reach,bottom:-reach});this.sun.shadow.bias=-.0004;this.sun.shadow.normalBias=.08;
    this.scene.add(this.sun,this.sun.target);
    this.car=new THREE.Group();this.scene.add(this.car);this.wheels=[];this.brakeMaterials=[];
    this.shadow=new THREE.Mesh(new THREE.PlaneGeometry(55,55),new THREE.ShadowMaterial({opacity:.26,depthWrite:false}));this.shadow.rotation.x=-Math.PI/2;this.shadow.receiveShadow=true;this.shadow.visible=false;this.scene.add(this.shadow);
    this.markerGroup=new THREE.Group();this.scene.add(this.markerGroup);this.markers=new Map();
    this.v=new THREE.Vector3();this.aim=new THREE.Vector3();this.desired=new THREE.Vector3();this.aimSmooth=new THREE.Vector3();
    this.colliderGrid=new Map();this.polygons=[];this.probe=new THREE.Vector3();
    this.setupEnvironment();this.setupSky();this.setupContactShadow();this.setupTrees();
    // CC0 Poly Haven albedo maps, sampled raw (display space) and normalised by their mean colour so they add
    // real surface detail without replacing the map's own colours.
    const tex=name=>{const t=new THREE.TextureLoader().load('./assets/texturas/'+name+'.jpg');t.wrapS=t.wrapT=THREE.RepeatWrapping;t.anisotropy=Math.min(8,this.renderer.capabilities.getMaxAnisotropy());return t;};
    this.shared={fogColor:{value:HORIZON_RGB},tAsphalt:{value:tex('clean_asphalt')},tPave:{value:tex('concrete_pavement_03')},tWall:{value:tex('plastered_wall')},tRoof:{value:tex('clay_roof_tiles_02')},
      sMap:{value:null},sMat:{value:this.sun.shadow.matrix},sOn:{value:0},sTexel:{value:1/(this.mobile?1024:2048)}};
    this.material=new THREE.ShaderMaterial({side:THREE.DoubleSide,extensions:{derivatives:true},uniforms:this.shared,
      vertexShader:`attribute vec4 tint; attribute float floorHeight; varying vec4 c; varying vec3 world; varying float floorY; varying float depth;
      void main(){world=position;c=tint;floorY=floorHeight;vec4 p=modelViewMatrix*vec4(position,1.);depth=-p.z;
      #ifdef GROUND
      // Green planters overlap the lot/terrain polygons at the same height (z-fighting flicker, worse on phones):
      // lift them slightly, more with distance where depth precision is lower.
      if(tint.r<.7&&tint.g>tint.r+.03){p=modelViewMatrix*vec4(position+vec3(0.,.03+depth*.0012,0.),1.);}
      #endif
      gl_Position=projectionMatrix*p;}`,
      fragmentShader:`precision highp float;varying vec4 c;varying vec3 world;varying float floorY;varying float depth;uniform vec3 fogColor;uniform sampler2D tAsphalt,tPave,tWall,tRoof;${SHADOW_GLSL}
      float h1(float x){return fract(sin(x*12.9898)*43758.5453);}
      float h2(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      float n2(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h2(i),h2(i+vec2(1,0)),f.x),mix(h2(i+vec2(0,1)),h2(i+vec2(1,1)),f.x),f.y);}
      void main(){vec3 col=c.rgb;vec3 n=normalize(cross(dFdx(world),dFdy(world)));n*=sign(dot(n,cameraPosition-world)+1e-6);float ndl=clamp(dot(n,normalize(vec3(-.46,.81,.35))),-1.,1.);
      col*=mix(vec3(.88,.93,1.03),vec3(1.05,1.,.93),ndl*.5+.5)*(.80+.20*abs(ndl));
      if(c.a>.4&&world.y<floorY)col*=.80;
      if(c.a>.4&&world.y>=floorY){
        // Facade: each building gets its own bay width, window style, doors and balconies from a hash of its base.
        vec3 wallCol=col;float v=world.y-floorY,u=abs(n.x)>abs(n.z)?world.z:world.x;bool tall=c.a>.75;
        float id=h1(floor(floorY*10.+.5)*.37+floor(c.g*255.+.5)*1.7),fh=tall?3.:2.85,bay=mix(2.5,3.7,id),fl=floor(v/fh),bx=floor(u/bay);
        vec2 cell=vec2(fract(u/bay),fract(v/fh));float wh=h1(bx*3.1+fl*7.7+id*91.);
        float tp=h1(id*57.3+.31);vec3 tint=tp<.30?vec3(1.07,1.06,1.02):tp<.50?vec3(1.09,1.03,.86):tp<.62?vec3(1.10,.93,.83):tp<.73?vec3(.90,.98,1.07):tp<.82?vec3(.93,1.03,.92):tp<.92?vec3(.90,.90,.91):vec3(1.02,.80,.68);
        if(tall)tint=mix(vec3(1.),tint,.45);col*=tint*texture2D(tWall,vec2(u,v)/3.2).rgb/vec3(.69,.659,.612);wallCol=col;
        col*=mix(.86,1.,smoothstep(0.,2.2,v))*(.97+.06*h1(floor(u*.5)+floor(v*.7)*13.));if(!tall&&v<.7)col*=.80;
        float wx0=tall?.13:.25,wy0=tall?.30:.36,wy1=tall?.84:.80;if(tall&&id>.62)wx0=-.01;
        bool door=false,gate=false;if(fl<.5){if(tall){wx0=.05;wy0=.06;wy1=.88;}else{float dh=h1(bx*5.3+id*31.);gate=dh>.80;door=dh>.52&&!gate;}}
        float wx1=1.-wx0;
        if(gate){if(cell.x>.08&&cell.x<.92&&cell.y<.80){float bar=step(.5,fract(u*7.));col=mix(vec3(.20,.21,.23),vec3(.34,.35,.37),bar)*(cell.y>.74?.7:1.);}}
        else if(door){if(cell.x>.3&&cell.x<.7&&cell.y<.76){float pan=step(.04,abs(cell.x-.5))*step(.08,fract(cell.y*3.));col=mix(vec3(.30,.22,.17),vec3(.27,.30,.33),step(.5,id))*(.78+.22*pan);}}
        else if(cell.x>wx0&&cell.x<wx1&&cell.y>wy0&&cell.y<wy1){
          vec3 glass=mix(vec3(.13,.20,.26),vec3(.46,.60,.68),cell.y*.85+.05*wh);
          glass=mix(glass,vec3(.80,.76,.64),step(.84,wh)*.5);glass*=.82+.3*wh;
          float fx=min(cell.x-wx0,wx1-cell.x)*bay,fy=min(cell.y-wy0,wy1-cell.y)*fh;
          float frame=1.-step(.07,min(fx,fy)),mull=(1.-step(.03,abs(cell.x-.5)*bay))*step(wx0,.2);
          col=mix(glass,wallCol*.55+.42,max(frame,mull));
        }else{
          if(cell.y<=wy0&&cell.y>wy0-.035&&cell.x>wx0-.03&&cell.x<wx1+.03)col*=.74;
          if(tall){if(cell.y>.95)col*=.86;if(fl<.5)col=mix(col,vec3(.36,.36,.38),.7);else if(wx0>0.&&(cell.x<.05||cell.x>.95))col*=1.07;if(id<.34&&fl>.5&&cell.y<.27)col*=cell.y>.24?.62:.84;}
        }
        col=mix(col,wallCol*.9,smoothstep(220.,420.,depth));}
      #ifndef GROUND
      if(c.a<.1&&c.r>c.b+.045){
        // Clay-tile roofs: tiles run down the slope of pitched roofs; the vertical fascia takes the same clay tone.
        if(abs(n.y)>.3){vec2 d=length(n.xz)>.05?normalize(n.xz):vec2(0.,1.);vec2 ruv=vec2(dot(world.xz,vec2(-d.y,d.x)),dot(world.xz,d)/max(abs(n.y),.3));
          col=texture2D(tRoof,ruv/2.6).rgb*col/vec3(.43,.39,.36)*.84;col=mix(vec3(dot(col,vec3(.33))),col,.82);}
        else col=col/vec3(.43,.39,.36)*vec3(.47,.28,.17);
      }
      #endif
      float grain=h2(floor(world.xz*50.));if(c.a<.1)col*=.985+grain*.03;
      #ifdef GROUND
      if(abs(n.y)>.7){vec3 k=c.rgb*255.;float big=n2(world.xz*.35),mid=n2(world.xz*2.3);
        if(distance(k,vec3(180.,187.,184.))<1.5||distance(k,vec3(203.,206.,191.))<1.5){
          // Asphalt: uneven tone, rectangular repair patches and hairline cracks.
          col=texture2D(tAsphalt,world.xz/5.).rgb/vec3(.267,.278,.275)*vec3(.245,.25,.26)*(.84+.26*big)*(.6+.4*texture2D(tAsphalt,world.xz/23.).g/.278);
          float repair=step(.87,h2(floor(world.xz/vec2(5.,3.2))));col*=1.-.15*repair;
          float crack=smoothstep(.03,0.,abs(n2(world.xz*.9)-.5))*step(.55,n2(world.xz*.11+7.));col*=1.-.32*crack;
        }else if(distance(k,vec3(203.,206.,191.))<1.5){col=vec3(.86,.67,.12)*(.74+.26*mid);
        }else if(distance(k,vec3(219.,225.,219.))<1.5){
          // Sidewalk: concrete slabs with joints and per-slab tone.
          vec2 t=fract(world.xz/1.25);float joint=min(1.,step(t.x,.035)+step(t.y,.035)),slab=h2(floor(world.xz/1.25));
          col=texture2D(tPave,world.xz/2.5).rgb/vec3(.294,.251,.208)*vec3(.60,.59,.56)*(.88+.10*slab+.10*big)*(1.-.14*joint);
        }else if(k.g>k.r+7.){col=vec3(.29,.41,.21)*(.78+.32*mid+.16*big)+grain*.03;
        }else{float g=smoothstep(.55,.75,n2(world.xz*.06+3.));
          col=mix(c.rgb*vec3(.84,.82,.78)*(.88+.16*mid),vec3(.33,.43,.25)*(.85+.3*mid),g*.75)*(.97+.05*grain);}
      }
      #endif
      col*=mix(vec3(.71,.76,.86),vec3(1.),min(sunShadow(world+n*.3),smoothstep(-.05,.12,ndl)));
      col=mix(col,fogColor,smoothstep(180.,650.,depth));gl_FragColor=vec4(col,1.);}`});
    this.groundMaterial=this.material.clone();this.groundMaterial.defines={GROUND:1};Object.assign(this.groundMaterial.uniforms,this.shared);
    canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();this.lost=true;report('Gráficos pausados. Recarregue para retomar.');});
  }
  ground(x,z){return this.terrain.elevation([x,z])+.42;}
  buildMarkings(data){
    // Road paint generated from the same street centre lines as the mesh: edge lines and lane dashes on
    // avenues, plus zebra crossings and stop lines on the approaches to each junction.
    const mlon=111320*Math.cos(data.origin.lat*Math.PI/180),half={prim:8,sec:5.5,res:3.75},nodes=new Map(),buckets=new Map(),WHITE=[228,228,222];
    const roads=data.roads.map(r=>({c:r.c,w:half[r.c]||3.75,keys:r.p.map(q=>q[0].toFixed(6)+','+q[1].toFixed(6)),p:r.p.map(q=>[(q[0]-data.origin.lng)*mlon,-(q[1]-data.origin.lat)*111320])}));
    for(const r of roads)r.keys.forEach((k,i)=>{const n=nodes.get(k)||{uses:0,inner:0,w:0};n.uses++;if(i>0&&i<r.keys.length-1)n.inner++;n.w=Math.max(n.w,r.w);nodes.set(k,n);});
    for(const r of roads){
      const cum=[0];for(let i=1;i<r.p.length;i++)cum.push(cum[i-1]+Math.hypot(r.p[i][0]-r.p[i-1][0],r.p[i][1]-r.p[i-1][1]));const L=cum[cum.length-1];if(L<1)continue;
      const at=(s,off)=>{let i=1;while(i<cum.length-1&&cum[i]<s)i++;const a=r.p[i-1],b=r.p[i],len=cum[i]-cum[i-1]||1,t=(s-cum[i-1])/len,dx=(b[0]-a[0])/len,dz=(b[1]-a[1])/len;return [a[0]+(b[0]-a[0])*t-dz*off,a[1]+(b[1]-a[1])*t+dx*off];};
      const strip=(s0,s1,off,width,col)=>{const steps=Math.max(1,Math.ceil((s1-s0)/4));for(let k=0;k<steps;k++){const a=s0+(s1-s0)*k/steps,b=s0+(s1-s0)*(k+1)/steps;
        const q=[at(a,off-width/2),at(a,off+width/2),at(b,off+width/2),at(b,off-width/2)],key=Math.floor(q[0][0]/250)+','+Math.floor(q[0][1]/250);
        if(!buckets.has(key))buckets.set(key,{pos:[],col:[]});const bk=buckets.get(key);
        for(const j of [0,1,2,0,2,3]){bk.pos.push(q[j][0],this.terrain.elevation(q[j])+.43,q[j][1]);bk.col.push(...col);}}};
      const J=[];r.keys.forEach((k,i)=>{const n=nodes.get(k);if(n.uses>=3||(n.uses===2&&n.inner>=1))J.push({s:cum[i],w:n.w});});r.cum=cum;r.J=J;
      const free=(a,b)=>J.every(j=>b<j.s-j.w-7||a>j.s+j.w+7);
      if(r.c!=='res')for(let s=0;s<L;s+=4){const e=Math.min(L,s+4);if(free(s,e)){strip(s,e,r.w-.3,.12,WHITE);strip(s,e,.3-r.w,.12,WHITE);}}
      // The source's wide cream centre band is painted as asphalt; a double yellow line replaces it.
      if(r.c!=='res')for(let s=0;s<L;s+=4){const e=Math.min(L,s+4);if(free(s,e)){strip(s,e,.14,.11,[222,172,30]);strip(s,e,-.14,.11,[222,172,30]);}}
      if(r.c==='prim')for(let s=0;s+3<L;s+=9)if(free(s,s+3)){strip(s,s+3,r.w/2,.12,WHITE);strip(s,s+3,-r.w/2,.12,WHITE);}
      for(const j of J)for(const dir of [1,-1]){const a=j.s+dir*(j.w+1.5),b=a+dir*3,lo=Math.min(a,b),hi=Math.max(a,b);if(lo<.5||hi>L-.5)continue;
        for(let o=.7-r.w;o<=r.w-.7+1e-6;o+=1)strip(lo,hi,o,.45,WHITE);
        const sl=dir>0?hi+1.2:lo-1.6;if(sl>0&&sl+.4<L)strip(sl,sl+.4,0,2*(r.w-.5),WHITE);}
    }
    this.markMaterial=new THREE.ShaderMaterial({side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:-3,polygonOffsetUnits:-3,uniforms:this.shared,
      vertexShader:`attribute vec3 paint;varying vec3 vC;varying vec3 w;varying float depth;void main(){vC=paint;w=position;vec4 mv=modelViewMatrix*vec4(position,1.);depth=-mv.z;gl_Position=projectionMatrix*mv;}`,
      fragmentShader:`precision highp float;uniform vec3 fogColor;varying vec3 vC;varying vec3 w;varying float depth;${SHADOW_GLSL}
      float h2(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      float n2(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h2(i),h2(i+vec2(1,0)),f.x),mix(h2(i+vec2(0,1)),h2(i+vec2(1,1)),f.x),f.y);}
      void main(){if(n2(w.xz*5.)<.10)discard;vec3 col=vC*(.70+.30*n2(w.xz*1.7));col*=mix(vec3(.71,.76,.86),vec3(1.),sunShadow(w+vec3(0.,.3,0.)));col=mix(col,fogColor,smoothstep(180.,650.,depth));gl_FragColor=vec4(col,1.);}`});
    this.roadLines=roads.filter(r=>r.cum);this.markMeshes=[];
    for(const bk of buckets.values()){const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.BufferAttribute(new Float32Array(bk.pos),3));geo.setAttribute('paint',new THREE.BufferAttribute(new Uint8Array(bk.col),3,true));geo.computeBoundingSphere();
      const mesh=new THREE.Mesh(geo,this.markMaterial);this.scene.add(mesh);this.markMeshes.push(mesh);}
  }
  setupTrees(){
    // The source packets describe each tree as a canopy cone hovering at 70% of its height.
    // Those triangles are dropped at load time and replaced by an instanced trunk + rounded crown
    // at the same position, with the same height and colour.
    // Crown = a cluster of lumpy lobes (one large, several smaller) so silhouettes read as foliage, not a ball.
    const m=this.mobile,lobes=m?[[0,.64,0,.9,.30,1],[.40,.76,.16,.56,.22,0],[-.32,.74,-.30,.56,.22,0]]
      :[[0,.64,0,.9,.30,2],[.42,.74,.18,.56,.23,1],[-.30,.72,-.36,.56,.23,1],[-.20,.80,.40,.50,.20,1],[.12,.90,-.06,.46,.17,1]];
    const crown=mergeGeometries(lobes.map(([ox,oy,oz,r,ry,d],li)=>{const g=new THREE.IcosahedronGeometry(1,d),p=g.attributes.position;
      for(let i=0;i<p.count;i++){const x=p.getX(i),y=p.getY(i),z=p.getZ(i),k=1+.18*Math.sin(x*7.1+y*5.3+z*9.7+li*2.3)+.09*Math.sin(x*13+z*11-y*4+li);p.setXYZ(i,ox+x*k*r,oy+y*k*ry,oz+z*k*r);}
      return g;})),pos=crown.attributes.position;
    const trunk=new THREE.CylinderGeometry(.05,.075,.5,6,1,true).toNonIndexed();trunk.translate(0,.25,0);
    crown.setAttribute('part',new THREE.BufferAttribute(new Float32Array(pos.count).fill(1),1));
    trunk.setAttribute('part',new THREE.BufferAttribute(new Float32Array(trunk.attributes.position.count),1));
    this.treeGeometry=mergeGeometries([trunk,crown]);this.treeMeshes=[];
    this.treeMaterial=new THREE.ShaderMaterial({uniforms:{fogColor:{value:HORIZON_RGB}},
      vertexShader:`attribute float part;varying vec3 vCol;varying vec3 vN;varying vec3 vW;varying float vY;varying float depth;
      void main(){vec4 wp=instanceMatrix*vec4(position,1.);vN=normalize(mat3(instanceMatrix)*normal);vY=position.y;vW=wp.xyz;
      float h=fract(sin(dot(instanceMatrix[3].xz,vec2(12.9898,78.233)))*43758.5453);
      vCol=part>.5?instanceColor*mix(vec3(.86,.94,.84),vec3(1.10,1.06,.92),h):vec3(.30,.24,.19);vec4 mv=modelViewMatrix*wp;depth=-mv.z;gl_Position=projectionMatrix*mv;}`,
      fragmentShader:`uniform vec3 fogColor;varying vec3 vCol;varying vec3 vN;varying vec3 vW;varying float vY;varying float depth;
      float hh(vec3 p){return fract(sin(dot(floor(p),vec3(127.1,311.7,74.7)))*43758.5453);}
      void main(){vec3 n=normalize(vN);float l=max(dot(n,normalize(vec3(-.46,.81,.35))),0.);
      float leaf=.5+.25*sin(vW.x*4.1+sin(vW.y*5.3)*2.)*sin(vW.z*3.7+vW.y*2.9)+.25*sin(vW.x*9.3-vW.z*7.1+vW.y*6.)*sin(vW.y*11.+vW.z*5.),fade=smoothstep(60.,160.,depth);
      vec3 col=vCol*(.50+.58*l)*mix(.68,1.10,smoothstep(.3,1.,vY));col*=mix(.80+.36*leaf,1.,fade);
      col+=vCol*vec3(.10,.16,.04)*pow(max(dot(n,normalize(vec3(.46,-.2,-.35))),0.),2.)*(1.-fade);
      col=mix(col,fogColor,smoothstep(180.,650.,depth));gl_FragColor=vec4(col,1.);}`});
  }
  pitchRoofs(positions,colors,count,skip){
    // Houses in the source carry a flat clay-coloured cap. Each cap (a run of level triangles of one colour) is
    // replaced by a hipped roof over the same outline: eaves overhang 35 cm and a ridge runs along the long side.
    const pos=[],col=[],flat=i=>{const y=positions[i*3+1];return colors[i*4+3]===0&&positions[i*3+4]===y&&positions[i*3+7]===y&&colors[i*4]>colors[i*4+2]+11;};
    let i=0;while(i<count){if(!flat(i)){i+=3;continue;}
      const start=i,y=positions[i*3+1],r=colors[i*4],g=colors[i*4+1],b=colors[i*4+2];
      while(i<count&&flat(i)&&positions[i*3+1]===y&&colors[i*4]===r&&colors[i*4+1]===g)i+=3;
      if((i-start)/3>60)continue;const edges=new Map();
      for(let t=start;t<i;t+=3)for(let k=0;k<3;k++){const a=(t+k)*3,c=(t+(k+1)%3)*3,ka=positions[a]+','+positions[a+2],kc=positions[c]+','+positions[c+2],key=ka<kc?ka+'|'+kc:kc+'|'+ka,e=edges.get(key);
        if(e)e.n++;else edges.set(key,{n:1,ax:positions[a],az:positions[a+2],bx:positions[c],bz:positions[c+2]});}
      const ring=[...edges.values()].filter(e=>e.n===1);if(ring.length<3)continue;
      let cx=0,cz=0,L=0,long=0,dx=1,dz=0;for(const e of ring){const l=Math.hypot(e.bx-e.ax,e.bz-e.az);cx+=(e.ax+e.bx)/2*l;cz+=(e.az+e.bz)/2*l;L+=l;if(l>long){long=l;dx=(e.bx-e.ax)/l;dz=(e.bz-e.az)/l;}}cx/=L;cz/=L;
      let inside=false,min=1e9,t0=1e9,t1=-1e9;
      for(const e of ring){if((e.az>cz)!==(e.bz>cz)&&cx<(e.bx-e.ax)*(cz-e.az)/(e.bz-e.az)+e.ax)inside=!inside;
        const vx=e.bx-e.ax,vz=e.bz-e.az,t=Math.max(0,Math.min(1,((cx-e.ax)*vx+(cz-e.az)*vz)/(vx*vx+vz*vz||1)));min=Math.min(min,Math.hypot(cx-e.ax-t*vx,cz-e.az-t*vz));
        const ta=(e.ax-cx)*dx+(e.az-cz)*dz;t0=Math.min(t0,ta);t1=Math.max(t1,ta);}
      if(!inside||min<1.5)continue;
      const rise=Math.min(2.6,Math.max(.8,min*.55)),mid=(t0+t1)/2,half=Math.max(0,(t1-t0)/2-min*1.1);
      const eave=(x,z)=>{const d=Math.hypot(x-cx,z-cz)||1;return [x+(x-cx)/d*.35,y+.03,z+(z-cz)/d*.35];};
      const ridge=(x,z)=>{const t=Math.max(mid-half,Math.min(mid+half,(x-cx)*dx+(z-cz)*dz));return [cx+dx*t,y+rise,cz+dz*t];};
      for(let t=start;t<i;t+=3)skip.add(t);
      for(const e of ring){const a=eave(e.ax,e.az),c=eave(e.bx,e.bz),ra=ridge(e.ax,e.az),rc=ridge(e.bx,e.bz);pos.push(...a,...c,...rc);let n=3;
        if(Math.hypot(ra[0]-rc[0],ra[2]-rc[2])>.05){pos.push(...a,...rc,...ra);n=6;}for(let k=0;k<n;k++)col.push(r,g,b,0);}
      this.stats.pitched=(this.stats.pitched||0)+1;}
    return pos.length?{pos,col}:null;
  }
  buildPoles(){
    // Concrete lamp posts along one sidewalk of every street, outside junctions and clear of buildings.
    const shaft=new THREE.CylinderGeometry(.11,.15,9,6);shaft.translate(0,4.5,0);const arm=new THREE.BoxGeometry(.1,.1,1.9);arm.translate(0,8.4,0);
    const boom=new THREE.BoxGeometry(.1,.1,1.7);boom.translate(0,7.3,.85);const head=new THREE.BoxGeometry(.3,.12,.6);head.translate(0,7.25,1.7);
    const geo=mergeGeometries([shaft,arm,boom,head]);geo.setAttribute('part',new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count).fill(1),1));
    const buckets=new Map(),M=new THREE.Matrix4(),P=new THREE.Vector3(),Q=new THREE.Quaternion(),S=new THREE.Vector3(1,1,1),UP=new THREE.Vector3(0,1,0),C=new THREE.Color();
    for(const r of this.roadLines){const L=r.cum[r.cum.length-1];
      for(let s=14;s<L-6;s+=36){if(!r.J.every(j=>Math.abs(s-j.s)>j.w+5))continue;let i=1;while(i<r.cum.length-1&&r.cum[i]<s)i++;
        const a=r.p[i-1],b=r.p[i],len=r.cum[i]-r.cum[i-1]||1,t=(s-r.cum[i-1])/len,dx=(b[0]-a[0])/len,dz=(b[1]-a[1])/len,off=r.w+1.4,x=a[0]+(b[0]-a[0])*t-dz*off,z=a[1]+(b[1]-a[1])*t+dx*off;
        if(this.blocked(x,z,.7))continue;const k=Math.floor(x/250)+','+Math.floor(z/250);if(!buckets.has(k))buckets.set(k,[]);buckets.get(k).push([x,z,Math.atan2(dz,-dx)]);}}
    for(const list of buckets.values()){const mesh=new THREE.InstancedMesh(geo,this.treeMaterial,list.length);
      list.forEach(([x,z,angle],j)=>{M.compose(P.set(x,this.terrain.elevation([x,z])+.2,z),Q.setFromAxisAngle(UP,angle),S);mesh.setMatrixAt(j,M);mesh.setColorAt(j,C.setRGB(.60,.59,.56));});
      mesh.computeBoundingSphere();mesh.castShadow=!this.mobile;this.scene.add(mesh);this.treeMeshes.push(mesh);this.stats.poles=(this.stats.poles||0)+list.length;}
  }
  treeTriangle(positions,colors,i,trees){
    const r=colors[i*4],g=colors[i*4+1],b=colors[i*4+2];if(colors[i*4+3]!==0||g<r+8||g<b+8)return false;
    const y=[positions[i*3+1],positions[i*3+4],positions[i*3+7]];let ap=-1;
    for(let k=0;k<3;k++){const m=(k+1)%3,n=(k+2)%3;if(Math.abs(y[m]-y[n])<.06&&y[k]>y[m]+.3)ap=k;}
    if(ap<0)return false;const a=(i+ap)*3,ax=positions[a],az=positions[a+2];let radius=1e9;
    for(const k of [(ap+1)%3,(ap+2)%3]){const o=(i+k)*3;radius=Math.min(radius,Math.hypot(positions[o]-ax,positions[o+2]-az));}
    if(radius<.3)return false; // a wall: its top vertex sits directly above a base vertex
    const key=ax+','+az,t=trees.get(key);
    if(t){if(g>t.c[1])t.c=[r,g,b];}else trees.set(key,{x:ax,y:positions[a+1],z:az,base:y[(ap+1)%3],c:[r,g,b]});
    return true;
  }
  addTrees(trees){
    const buckets=new Map(),M=new THREE.Matrix4(),P=new THREE.Vector3(),Q=new THREE.Quaternion(),S=new THREE.Vector3(),UP=new THREE.Vector3(0,1,0),C=new THREE.Color();
    for(const t of trees.values()){t.h=(t.y-t.base)/.3;if(t.h<2||t.h>45)continue;
      // Source trees that fall inside or against a building footprint are dropped; crowns that would
      // poke through a nearby wall are narrowed until they clear it.
      if(this.blocked(t.x,t.z,1.3)){this.stats.treesDropped=(this.stats.treesDropped||0)+1;continue;}
      t.fit=1;while(t.fit>.45&&this.blocked(t.x,t.z,Math.min(4.2,Math.max(1.7,t.h*.3))*t.fit))t.fit-=.15;
      const k=Math.floor(t.x/200)+','+Math.floor(t.z/200);if(!buckets.has(k))buckets.set(k,[]);buckets.get(k).push(t);}
    for(const list of buckets.values()){const mesh=new THREE.InstancedMesh(this.treeGeometry,this.treeMaterial,list.length);
      list.forEach((t,j)=>{const rnd=Math.abs(Math.sin(t.x*12.9898+t.z*78.233)*43758.5453)%1,R=Math.min(4.2,Math.max(1.7,t.h*.3))*(.85+.15*rnd)*t.fit;
        M.compose(P.set(t.x,t.y-t.h-.1,t.z),Q.setFromAxisAngle(UP,rnd*6.283),S.set(R,t.h*(.92+.16*rnd),R));mesh.setMatrixAt(j,M);
        const k=(.80+.3*((rnd*7.3)%1))/255;mesh.setColorAt(j,C.setRGB(t.c[0]*k*.9,t.c[1]*k,t.c[2]*k*.82));});
      mesh.computeBoundingSphere();mesh.castShadow=!this.mobile;this.scene.add(mesh);this.treeMeshes.push(mesh);this.stats.trees=(this.stats.trees||0)+list.length;}
  }
  setupSky(){
    // Gradient dome that follows the camera; its horizon matches the city fog so distant blocks melt into the sky.
    this.skyUniforms={top:{value:rgb('#5f8fbf')},horizon:{value:HORIZON_RGB},ground:{value:rgb('#8f9a9e')},sunDir:{value:new THREE.Vector3(-40,70,30).normalize()},sunColor:{value:rgb('#fff0d4')}};
    this.sky=new THREE.Mesh(new THREE.SphereGeometry(470,32,16),new THREE.ShaderMaterial({side:THREE.BackSide,depthWrite:false,uniforms:this.skyUniforms,
      vertexShader:`varying vec3 vDir;void main(){vDir=normalize(position);vec4 p=projectionMatrix*modelViewMatrix*vec4(position,1.);gl_Position=p.xyww;}`,
      fragmentShader:`uniform vec3 top;uniform vec3 horizon;uniform vec3 ground;uniform vec3 sunDir;uniform vec3 sunColor;varying vec3 vDir;
      float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
        return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
      void main(){vec3 d=normalize(vDir);float h=d.y;vec3 col=mix(horizon,top,smoothstep(.02,.6,h));col=mix(ground,col,smoothstep(-.06,.02,h));
      float s=max(dot(d,normalize(sunDir)),0.);col+=sunColor*(pow(s,700.)*1.6+pow(s,18.)*.22);
      if(h>.015){vec2 uv=d.xz/(h+.12);float n=noise(uv*1.9)*.62+noise(uv*4.1)*.38;
        float cloud=smoothstep(.52,.78,n)*smoothstep(.015,.14,h);col=mix(col,vec3(1.,.99,.97),cloud*.8);}
      gl_FragColor=vec4(col,1.);}`}));
    this.sky.renderOrder=-10;this.sky.frustumCulled=false;this.scene.add(this.sky);
  }
  setupContactShadow(){
    // Soft dark footprint under the tyres; a child of the car so it follows pitch, roll and heading.
    const c=document.createElement('canvas');c.width=128;c.height=256;const g=c.getContext('2d');
    const grad=g.createRadialGradient(64,128,8,64,128,128);grad.addColorStop(0,'rgba(0,0,0,.75)');grad.addColorStop(.55,'rgba(0,0,0,.42)');grad.addColorStop(1,'rgba(0,0,0,0)');
    g.fillStyle=grad;g.fillRect(0,0,128,256);
    const tex=new THREE.CanvasTexture(c);tex.colorSpace=THREE.SRGBColorSpace;
    const blob=new THREE.Mesh(new THREE.PlaneGeometry(2.5,5.2),new THREE.MeshBasicMaterial({map:tex,transparent:true,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2}));
    blob.rotation.x=-Math.PI/2;blob.position.y=.005;blob.renderOrder=1;this.car.add(blob);
  }
  setupEnvironment(){
    // Procedural studio-sky: gradient plus softbox panels, so the glossy paint gets crisp highlights.
    const c=document.createElement('canvas');c.width=1024;c.height=512;const g=c.getContext('2d');const grad=g.createLinearGradient(0,0,0,512);
    grad.addColorStop(0,'#6f96bd');grad.addColorStop(.46,'#e4edf2');grad.addColorStop(.5,'#c9c3b4');grad.addColorStop(.54,'#6e6b62');grad.addColorStop(1,'#2c3132');g.fillStyle=grad;g.fillRect(0,0,1024,512);
    g.fillStyle='rgba(255,255,255,.95)';g.fillRect(140,70,170,46);g.fillRect(640,96,210,34);g.fillRect(420,300,260,22);
    g.fillStyle='rgba(255,236,206,.85)';g.fillRect(860,150,70,120);
    const tex=new THREE.CanvasTexture(c);tex.mapping=THREE.EquirectangularReflectionMapping;tex.colorSpace=THREE.SRGBColorSpace;
    const pmrem=new THREE.PMREMGenerator(this.renderer);this.envTarget=pmrem.fromEquirectangular(tex);this.scene.environment=this.envTarget.texture;tex.dispose();pmrem.dispose();
  }
  async load(data,onchange){
    this.stats.total=data.packets.length;this.collisionsReady=this.loadCollisions();this.buildMarkings(data);this.collisionsReady.then(()=>this.buildPoles());
    const packets=[...data.packets].sort((a,b)=>Math.hypot(a.center[0]+380,a.center[1]+140)-Math.hypot(b.center[0]+380,b.center[1]+140));
    const worker=async()=>{while(packets.length){const p=packets.shift(),compressed=typeof DecompressionStream==='function';
      const response=await fetch(p.file+(compressed?'.gz':''));if(!response.ok)throw new Error(`Malha HTTP ${response.status}`);
      let buf=compressed?await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer():await response.arrayBuffer();
      if(compressed&&data.meshCompression==='delta-byte-columns-gzip'){const bytes=new Uint8Array(buf),decoded=new Uint8Array(buf.byteLength);for(let k=0;k<12;k++){let previous=0;for(let i=0;i<p.vertices;i++){previous=(previous+bytes[k*p.vertices+i])&255;decoded[i*12+k]=previous;}}buf=decoded.buffer;}
      if(buf.byteLength!==p.bytes)throw new Error('Malha incompleta');
      const dv=new DataView(buf),positions=new Float32Array(p.vertices*3),colors=new Uint8Array(p.vertices*4),floors=new Float32Array(p.vertices);
      for(let i=0;i<p.vertices;i++){const o=i*12;positions[i*3]=dv.getInt16(o,true)*.1;positions[i*3+1]=dv.getInt16(o+4,true)*.1;positions[i*3+2]=dv.getInt16(o+2,true)*.1;for(let k=0;k<4;k++)colors[i*4+k]=dv.getUint8(o+6+k);floors[i]=dv.getInt16(o+10,true)*.1;}
      // Re-index the same vertices into smaller tiles, so a street-level camera
      // does not submit whole 400 m blocks hidden behind or far from the car.
      const attributes={position:new THREE.BufferAttribute(positions,3),tint:new THREE.BufferAttribute(colors,4,true),floorHeight:new THREE.BufferAttribute(floors,1)};const tiles=new Map();
      const trees=new Map(),skip=new Set(),roofs=p.file.includes('quadra')?this.pitchRoofs(positions,colors,p.vertices,skip):null;
      for(let i=0;i<p.vertices;i+=3){if(skip.has(i)||this.treeTriangle(positions,colors,i,trees))continue;const tx=Math.floor((positions[i*3]+positions[i*3+3]+positions[i*3+6])/300),tz=Math.floor((positions[i*3+2]+positions[i*3+5]+positions[i*3+8])/300),key=`${tx},${tz}`;if(!tiles.has(key))tiles.set(key,{indices:[],box:new THREE.Box3()});const tile=tiles.get(key);for(let k=0;k<3;k++){tile.indices.push(i+k);this.probe.fromArray(positions,(i+k)*3);tile.box.expandByPoint(this.probe);}}
      for(const tile of tiles.values()){const geo=new THREE.BufferGeometry();for(const [key,attr] of Object.entries(attributes))geo.setAttribute(key,attr);geo.setIndex(tile.indices);geo.boundingBox=tile.box;geo.boundingSphere=tile.box.getBoundingSphere(new THREE.Sphere());const mesh=new THREE.Mesh(geo,p.file.includes('quadra')?this.material:this.groundMaterial);mesh.userData.packet=p;mesh.castShadow=true;this.scene.add(mesh);this.meshes.push(mesh);}
      if(roofs){const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.BufferAttribute(new Float32Array(roofs.pos),3));geo.setAttribute('tint',new THREE.BufferAttribute(new Uint8Array(roofs.col),4,true));
        geo.setAttribute('floorHeight',new THREE.BufferAttribute(new Float32Array(roofs.pos.length/3),1));geo.computeBoundingSphere();const mesh=new THREE.Mesh(geo,this.material);mesh.castShadow=true;this.scene.add(mesh);this.meshes.push(mesh);}
      await this.collisionsReady;this.addTrees(trees);
      this.stats.loaded++;onchange();this.report(`Cidade ${this.stats.loaded}/${this.stats.total}`);await new Promise(r=>setTimeout(r,0));
    }};
    await Promise.all([worker(),worker(),this.loadCar(),this.collisionsReady,this.loadSkyReflections()]);
  }
  // 0..1 share of the download done, weighted by size: car model ~12 MB, city meshes ~7 MB, outlines, sky.
  progress(){const p=this.prog,city=this.stats.total?this.stats.loaded/this.stats.total:0;return Math.min(1,.52*p.car+.34*city+.09*p.col+.05*p.hdr);}
  async loadSkyReflections(){
    // Photographic CC0 sky (Poly Haven) replaces the procedural environment for the car's reflections.
    try{const hdr=await new RGBELoader().loadAsync('./assets/texturas/canary_wharf_1k.hdr',e=>{if(e.total)this.prog.hdr=e.loaded/e.total;});hdr.mapping=THREE.EquirectangularReflectionMapping;
      const pmrem=new THREE.PMREMGenerator(this.renderer),target=pmrem.fromEquirectangular(hdr);this.scene.environment=target.texture;this.envTarget?.dispose();this.envTarget=target;hdr.dispose();pmrem.dispose();
    }catch(e){console.warn('Céu fotográfico indisponível; mantendo o ambiente procedural.',e);}
  }
  async loadCar(){
    const gltf=await new GLTFLoader().loadAsync('./assets/CarConcept.glb',e=>{this.prog.car=e.total?e.loaded/e.total:Math.min(.95,e.loaded/12.4e6);});this.model=gltf.scene;
    const bounds=new THREE.Box3().setFromObject(this.model),size=bounds.getSize(new THREE.Vector3());const scale=4.65/size.z;
    this.model.scale.setScalar(scale);this.model.position.set(-(bounds.min.x+bounds.max.x)*scale/2,-bounds.min.y*scale,-(bounds.min.z+bounds.max.z)*scale/2);
    this.model.traverse(o=>{if(!o.isMesh)return;o.castShadow=true;o.receiveShadow=true;
      for(const m of Array.isArray(o.material)?o.material:[o.material]){
        if(m.name?.startsWith('Paint')){m.color.set('#9e1626');m.metalness=.85;m.roughness=.18;m.clearcoat=1;m.clearcoatRoughness=.05;m.normalMap=null;m.clearcoatNormalMap=null;m.needsUpdate=true;}
        if(m.transmission){m.transmission=0;m.transparent=true;m.opacity=.42;m.depthWrite=false;}
        m.envMapIntensity=m.name?.startsWith('Paint')?1.35:1.15;if(m.name==='Brakelight')this.brakeMaterials.push(m);
      }
    });
    // Front of this credited glTF points along +Z after its authored root transform.
    this.car.add(this.model);this.model.updateMatrixWorld(true);
    for(const name of ['WheelFrontL','WheelFrontR','WheelRearL','WheelRearR']){const wheel=this.model.getObjectByName(name);if(wheel){const hub=new THREE.Group();wheel.parent.add(hub);hub.position.copy(wheel.position);wheel.position.set(0,0,0);hub.add(wheel);const base=wheel.quaternion.clone(),front=name.includes('Front');if(front)base.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),Math.PI/6));this.wheels.push({hub,wheel,base,front});}}
    this.batchCar();
    this.stats.carLoaded=true;this.stats.carDimensions={length:4.65,width:size.x*scale,height:size.y*scale};
  }
  batchCar(){
    // Batch stationary parts by material while leaving the four wheels articulated.
    // Mechanical pieces hidden inside the shell need not consume phone GPU time.
    this.car.updateMatrixWorld(true);const inverse=this.car.matrixWorld.clone().invert(),groups=new Map(),remove=[];
    this.model.traverse(o=>{if(!o.isMesh)return;
      if(/BrakePad|WindshieldWipers|InteriorPedal|BodyHoodInterior|BodyHoodUnder|^Engine$/.test(o.name)){o.visible=false;return;}
      for(let a=o.parent;a&&a!==this.model;a=a.parent)if(this.wheels.some(w=>a===w.hub))return;
      if(Array.isArray(o.material))return;
      const geo=o.geometry.clone();geo.applyMatrix4(inverse.clone().multiply(o.matrixWorld));
      const key=o.material.uuid+':'+Object.keys(geo.attributes).sort().join(',')+':'+Boolean(geo.index);
      if(!groups.has(key))groups.set(key,{material:o.material,geometries:[]});groups.get(key).geometries.push(geo);remove.push(o);
    });
    for(const {material,geometries} of groups.values()){const geometry=mergeGeometries(geometries);if(!geometry)continue;const mesh=new THREE.Mesh(geometry,material);mesh.castShadow=true;mesh.receiveShadow=true;this.car.add(mesh);for(const g of geometries)g.dispose();}
    for(const o of remove)o.removeFromParent();
  }
  async loadCollisions(){const response=await fetch('./assets/colisoes.json');if(!response.ok)throw new Error('Contornos indisponíveis');const d=await response.json();this.prog.col=1;this.polygons=d.polygons;
    this.polygons.forEach((poly,id)=>{const xs=poly.map(p=>p[0]),zs=poly.map(p=>p[1]);for(let x=Math.floor(Math.min(...xs)/40);x<=Math.floor(Math.max(...xs)/40);x++)for(let z=Math.floor(Math.min(...zs)/40);z<=Math.floor(Math.max(...zs)/40);z++){const key=`${x},${z}`;if(!this.colliderGrid.has(key))this.colliderGrid.set(key,[]);this.colliderGrid.get(key).push(id);}});
  }
  blocked(x,z,r=.6){const ids=new Set();for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++)for(const id of this.colliderGrid.get(`${Math.floor(x/40)+dx},${Math.floor(z/40)+dz}`)||[])ids.add(id);
    for(const id of ids){const p=this.polygons[id];let inside=false;for(let i=0,j=p.length-1;i<p.length;j=i++){
      const a=p[i],b=p[j];if((a[1]>z)!==(b[1]>z)&&x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0])inside=!inside;
      const vx=b[0]-a[0],vz=b[1]-a[1],t=Math.max(0,Math.min(1,((x-a[0])*vx+(z-a[1])*vz)/(vx*vx+vz*vz||1)));
      if(Math.hypot(x-a[0]-t*vx,z-a[1]-t*vz)<r)return true;
    }if(inside)return true;}return false;
  }
  vehicleBlocked(x,z,heading){const fx=Math.cos(heading),fz=Math.sin(heading);return this.blocked(x,z,1)||this.blocked(x+fx*1.65,z+fz*1.65,.85)||this.blocked(x-fx*1.65,z-fz*1.65,.85);}
  // Place signs: a small card floating in front of each establishment, with its logo when one is available
  // (logos[id] = image URL) or its name otherwise. Textures are drawn only when the car first gets close.
  setPlaceSigns(places,logos={}){this.signs=[];this.signGroup=new THREE.Group();this.scene.add(this.signGroup);
    for(const p of places){const dx=p.sourceX-p.x,dz=p.sourceZ-p.z,nx=-Math.sin(p.roadAngle||0),nz=Math.cos(p.roadAngle||0),side=Math.sign(dx*nx+dz*nz)||1,off=(p.roadHalf||5)+.5,x=p.x+nx*side*off,z=p.z+nz*side*off;
      this.signs.push({p,x,z,y:this.ground(x,z)+5.2,logo:logos[p.id],sprite:null});}}
  makeSign(s){const W=512,H=176,c=document.createElement('canvas');c.width=W;c.height=H;const g=c.getContext('2d');
    const tex=new THREE.CanvasTexture(c);tex.colorSpace=THREE.SRGBColorSpace;tex.anisotropy=4;
    const card=()=>{g.clearRect(0,0,W,H);g.fillStyle='rgba(8,23,43,.88)';g.strokeStyle='#f5d35e';g.lineWidth=6;g.beginPath();g.roundRect(6,6,W-12,H-40,22);g.fill();g.stroke();
      g.beginPath();g.moveTo(W/2-18,H-35);g.lineTo(W/2,H-6);g.lineTo(W/2+18,H-35);g.closePath();g.fillStyle='#f5d35e';g.fill();};
    const text=()=>{card();g.fillStyle='#fff';g.textAlign='center';g.textBaseline='middle';const words=s.p.nome.split(' ');let lines=[s.p.nome],size=50;
      g.font=`800 ${size}px system-ui,-apple-system,sans-serif`;if(g.measureText(s.p.nome).width>W-60){const mid=Math.ceil(words.length/2);lines=[words.slice(0,mid).join(' '),words.slice(mid).join(' ')];size=40;}
      g.font=`800 ${size}px system-ui,-apple-system,sans-serif`;lines.forEach((l,i)=>{let t=l;while(g.measureText(t).width>W-50&&t.length>4)t=t.slice(0,-2)+'…';g.fillText(t,W/2,(H-34)/2+3+(i-(lines.length-1)/2)*size*1.05);});tex.needsUpdate=true;};
    text();
    if(s.logo){const img=new Image();img.onload=()=>{card();const bw=W-44,bh=H-62,iw=img.naturalWidth||800,ih=img.naturalHeight||500,k=Math.min(bw/iw,bh/ih),w=iw*k,h=ih*k;
      g.save();g.beginPath();g.roundRect(14,14,W-28,H-56,16);g.clip();g.fillStyle='#fff';g.fillRect(14,14,W-28,H-56);g.drawImage(img,(W-w)/2,14+(H-56-h)/2,w,h);g.restore();tex.needsUpdate=true;};img.src=s.logo;}
    const m=new THREE.SpriteMaterial({map:tex,transparent:true,depthWrite:false,fog:false});const sp=new THREE.Sprite(m);sp.scale.set(7.6,2.6,1);sp.position.set(s.x,s.y,s.z);sp.renderOrder=5;this.signGroup.add(sp);return sp;}
  setMarkers(points){this.markerGroup.clear();for(const p of this.markers.values()){for(const mesh of [p.ring,p.beam]){mesh.geometry.dispose();mesh.material.dispose();}}this.markers.clear();
    for(const p of points){const group=new THREE.Group();group.position.set(p.x,this.ground(p.x,p.z)+.1,p.z);
      const ring=new THREE.Mesh(new THREE.TorusGeometry(4.4,.11,6,32),new THREE.MeshBasicMaterial({color:0xffcf52}));ring.rotation.x=-Math.PI/2;group.add(ring);
      const beam=new THREE.Mesh(new THREE.CylinderGeometry(.12,.12,8,6),new THREE.MeshBasicMaterial({color:0xffd65e,transparent:true,opacity:.6,depthWrite:false}));beam.position.y=4;group.add(beam);this.markerGroup.add(group);this.markers.set(p.id,{group,ring,beam});}
  }
  update(car,dt,{mode='near',brake=false,visited=new Set(),reduced=false,snap=false}={}){
    this.mode=mode;const y=this.ground(car.x,car.z),fx=Math.cos(car.heading),fz=Math.sin(car.heading),speed=Math.abs(car.speed);
    this.car.position.set(car.x,y+.04,car.z);this.car.rotation.order='YXZ';this.car.rotation.y=Math.PI/2-car.heading;
    const front=this.ground(car.x+fx*1.4,car.z+fz*1.4),back=this.ground(car.x-fx*1.4,car.z-fz*1.4);
    this.car.rotation.x=-Math.atan2(front-back,2.8);this.car.rotation.z=reduced?0:car.steer*speed*.0008;
    this.spin=(this.spin||0)+car.speed*dt/.34;for(const w of this.wheels){w.wheel.quaternion.copy(w.base);w.wheel.rotateX(-this.spin);if(w.front)w.hub.rotation.z=-car.steer*.35;}
    for(const m of this.brakeMaterials)m.emissiveIntensity=brake?5:1;
    for(const [id,m] of this.markers){const done=visited.has(id);m.ring.material.color.setHex(done?0x57d7ac:0xffcf52);m.beam.visible=!done;}
    if(snap||!this.readyCamera){this.heading=car.heading;this.readyCamera=true;}
    const delta=Math.atan2(Math.sin(car.heading-this.heading),Math.cos(car.heading-this.heading));this.heading+=delta*(1-Math.exp(-dt*(reduced?18:7)));
    const hx=Math.cos(this.heading),hz=Math.sin(this.heading),far=mode==='far',hood=mode==='hood',portrait=this.camera.aspect<1;
    let distance=hood?-.75:far?10:portrait?6.9:4.7;distance+=hood?0:Math.min(.65,speed*.02);const h=hood?1.25:far?3.8:portrait?2.6:1.8;
    let cx=car.x-hx*distance,cz=car.z-hz*distance;
    // Prevent the chase boom from entering a facade when turning in tight streets.
    if(!hood)for(let d=.8;d<distance;d+=.45){const x=car.x-hx*d,z=car.z-hz*d;if(this.blocked(x,z,.3)){distance=Math.max(1,d-.5);cx=car.x-hx*distance;cz=car.z-hz*distance;break;}}
    this.desired.set(cx,Math.max(y+h,this.ground(cx,cz)+.8),cz);this.aim.set(car.x+fx*(hood?18:10),y+(hood?1.15:1),car.z+fz*(hood?18:10));
    const smooth=snap?1:1-Math.exp(-dt*(reduced?25:14));this.camera.position.lerp(this.desired,smooth);this.aimSmooth.lerp(this.aim,smooth);this.camera.lookAt(this.aimSmooth);
    const fov=(this.mobile?66:58)+(reduced?0:Math.min(7,speed*.22));if(reduced?this.camera.fov!==fov:Math.abs(this.camera.fov-fov)>.01){this.camera.fov=fov;this.camera.updateProjectionMatrix();}
    this.car.visible=!hood;this.shadow.position.set(car.x,y+.01,car.z);this.sky.position.copy(this.camera.position);this.sun.position.set(car.x-80,y+140,car.z+60);this.sun.target.position.set(car.x,y,car.z);
    this.camera.updateMatrixWorld();
  }
  project(x,z,y,width,height){this.v.set(x,y,z).project(this.camera);return [width*(.5+.5*this.v.x),height*(.5-.5*this.v.y),this.v.z>=-1&&this.v.z<=1];}
  draw(width,height){if(this.lost)return;if(this.width!==width||this.height!==height){this.width=width;this.height=height;this.renderer.setSize(width,height,false);this.camera.aspect=width/height;this.camera.updateProjectionMatrix();}
    for(const mesh of this.meshes){const s=mesh.geometry.boundingSphere;mesh.visible=this.camera.position.distanceTo(s.center)-s.radius<500;}
    if(this.sun.shadow.map){this.shared.sMap.value=this.sun.shadow.map.texture;this.shared.sOn.value=1;}
    if(this.signs){const near=this.mobile?110:150,cp=this.camera.position;for(const s of this.signs){const d=Math.hypot(cp.x-s.x,cp.z-s.z);
      if(d<near&&!s.sprite)s.sprite=this.makeSign(s);if(s.sprite){s.sprite.visible=d<near;s.sprite.material.opacity=Math.min(1,(near-d)/25);}}this.stats.signs=this.signs.length;this.stats.signsShown=this.signs.filter(s=>s.sprite?.visible).length;this.stats.signNear=Math.round(Math.min(...this.signs.map(s=>Math.hypot(cp.x-s.x,cp.z-s.z))));}
    const treeRange=this.mobile?280:420;for(const mesh of this.treeMeshes){const s=mesh.boundingSphere;mesh.visible=this.camera.position.distanceTo(s.center)-s.radius<treeRange;}
    for(const mesh of this.markMeshes||[]){const s=mesh.geometry.boundingSphere;mesh.visible=this.camera.position.distanceTo(s.center)-s.radius<(this.mobile?200:300);}
    const start=performance.now();this.renderer.render(this.scene,this.camera);this.stats.draws++;this.stats.drawMs=performance.now()-start;this.stats.calls=this.renderer.info.render.calls;this.stats.triangles=this.renderer.info.render.triangles;this.stats.tiles=this.meshes.length;this.stats.camera={x:this.camera.position.x,y:this.camera.position.y,z:this.camera.position.z,fov:this.camera.fov,mode:this.mode};
  }
}
