/* Tiny local WebGL renderer. Projection is identical to the approved Canvas view:
   x = east + .23*south; y = .72*south - .1*east - .64*height.
   No runtime libraries, network map service, or geographic synthesis. */
class Cidade {
  constructor(canvas, report) {
    this.canvas=canvas;this.report=report;this.meshes=[];this.raw=[];
    this.stats={loaded:0,total:0,buildings:0,vertices:0,draws:0,lastDrawMs:0,quality:1.5};
    this.gl=canvas.getContext('webgl',{alpha:false,antialias:false,powerPreference:'low-power'});
    if(!this.gl)throw new Error('WEBGL_UNAVAILABLE');
    this.setup();
    canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();this.lost=true;report('A cidade 3D foi pausada. A busca e o mapa simples continuam disponíveis.');this.onchange?.();});
    canvas.addEventListener('webglcontextrestored',()=>{
      this.setup();this.meshes=[];for(const item of this.raw)this.upload(item.packet,item.buffer);
      this.lost=false;report('Cidade 3D recuperada.');this.onchange?.();
    });
  }
  setup() {
    const gl=this.gl;
    const compile=(type,source)=>{const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(s));return s;};
    const vs=compile(gl.VERTEX_SHADER,`
      attribute vec3 a_position; attribute vec4 a_color; attribute float a_floor;
      uniform vec2 u_size; uniform vec3 u_view;
      varying vec4 v_color; varying vec3 v_position; varying float v_floor;
      void main(){
        vec3 world=a_position*.1;
        vec2 p=vec2(world.x+.23*world.y,.72*world.y-.1*world.x-.64*world.z);
        p=(p-u_view.xy)*u_view.z;
        gl_Position=vec4(2.0*p.x/u_size.x,-2.0*p.y/u_size.y,(.1472*world.x-.64*world.y-.743*world.z)/6000.0,1.0);
        v_color=a_color;v_position=world;v_floor=a_floor*.1;
      }`);
    const fs=compile(gl.FRAGMENT_SHADER,`
      precision mediump float;
      varying vec4 v_color; varying vec3 v_position; varying float v_floor; uniform float u_detail;
      void main(){
        vec3 c=v_color.rgb;
        if(v_color.a>.4 && v_position.z<v_floor)c*=.92;
        // Stylized windows only: floor/facade detail, not surveyed architecture.
        if(v_color.a>.9 && u_detail>.5 && v_position.z>=v_floor){
          float row=fract(v_position.z/3.2);
          float col=fract((v_position.x+v_position.y)/3.4);
          if(row>.28 && row<.65 && col>.23 && col<.68)c*=.69;
        }
        gl_FragColor=vec4(c,1.0);
      }`);
    this.program=gl.createProgram();gl.attachShader(this.program,vs);gl.attachShader(this.program,fs);gl.linkProgram(this.program);
    if(!gl.getProgramParameter(this.program,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(this.program));
    this.floor=gl.getAttribLocation(this.program,'a_floor');this.position=gl.getAttribLocation(this.program,'a_position');this.color=gl.getAttribLocation(this.program,'a_color');
    this.size=gl.getUniformLocation(this.program,'u_size');this.view=gl.getUniformLocation(this.program,'u_view');this.detail=gl.getUniformLocation(this.program,'u_detail');
    this.actorBuffer=gl.createBuffer();gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LEQUAL);
    gl.clearColor(196/255,211/255,211/255,1);
  }
  upload(packet,buffer) {
    const gl=this.gl,b=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,buffer,gl.STATIC_DRAW);
    this.meshes.push({...packet,buffer:b});
  }

  async load(data,onchange) {
    this.onchange=onchange;this.stats.total=data.packets.length;
    const packets=[...data.packets].sort((a,b)=>a.file.includes('/base.')?-1:b.file.includes('/base.')?1:Math.hypot(...a.center)-Math.hypot(...b.center));
    const loadOne=async packet=>{
      const compressed=typeof DecompressionStream==='function';
      const r=await fetch(packet.file+(compressed?'.gz':''));if(!r.ok)throw new Error(`HTTP ${r.status}`);
      let buffer=compressed?await new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer():await r.arrayBuffer();
      if(compressed&&data.meshCompression==='delta-byte-columns-gzip'){
        const delta=new Uint8Array(buffer),decoded=new Uint8Array(buffer.byteLength),count=packet.vertices;
        for(let k=0;k<12;k++){let previous=0;for(let i=0;i<count;i++){previous=(previous+delta[k*count+i])&255;decoded[i*12+k]=previous;}}
        buffer=decoded.buffer;
      }
      if(buffer.byteLength!==packet.bytes)throw new Error('INCOMPLETE_GEOMETRY');
      this.raw.push({packet,buffer});if(!this.lost)this.upload(packet,buffer);
      this.stats.loaded++;this.stats.buildings+=packet.buildings;this.stats.vertices+=packet.vertices;
      this.report(this.stats.loaded===this.stats.total?'Cidade completa · 22.010 edificações da base local':`Carregando cidade · ${Math.round(this.stats.loaded/this.stats.total*100)}%`);
      onchange();
      // Yield after each upload so controls stay available during progressive load.
      await new Promise(resolve=>setTimeout(resolve,0));
    };
    const base=packets.shift();
    const failures=[];
    const worker=async()=>{while(packets.length){const p=packets.shift();try{await loadOne(p);}catch(e){failures.push(p.file);}}};
    await Promise.all([loadOne(base).catch(()=>failures.push(base.file)),worker(),worker()]);
    if(failures.length)throw new Error(`${failures.length} partes da cidade indisponíveis`);
  }
  bind(buffer) {
    const gl=this.gl;gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
    gl.enableVertexAttribArray(this.floor);gl.vertexAttribPointer(this.floor,1,gl.SHORT,false,12,10);
    gl.enableVertexAttribArray(this.position);gl.vertexAttribPointer(this.position,3,gl.SHORT,false,12,0);
    gl.enableVertexAttribArray(this.color);gl.vertexAttribPointer(this.color,4,gl.UNSIGNED_BYTE,true,12,6);
  }
  draw(width,height,view,actors=null) {
    if(this.lost)return;
    const start=performance.now(),gl=this.gl;
    const ratio=Math.min(devicePixelRatio||1,this.stats.quality);
    const w=Math.round(width*ratio),h=Math.round(height*ratio);
    if(this.canvas.width!==w||this.canvas.height!==h){this.canvas.width=w;this.canvas.height=h;}
    gl.viewport(0,0,w,h);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);gl.useProgram(this.program);
    gl.uniform2f(this.size,width,height);gl.uniform3f(this.view,view.x,view.y,view.zoom);gl.uniform1f(this.detail,view.zoom>.65?1:0);
    const bounds=[view.x-width/2/view.zoom,view.y-height/2/view.zoom,view.x+width/2/view.zoom,view.y+height/2/view.zoom];
    let visible=0;
    for(const m of this.meshes){const b=m.bounds;if(b[2]<bounds[0]||b[0]>bounds[2]||b[3]<bounds[1]||b[1]>bounds[3])continue;
      this.bind(m.buffer);gl.drawArrays(gl.TRIANGLES,0,m.vertices);visible+=m.vertices;
    }
    if(actors?.byteLength){
      gl.bindBuffer(gl.ARRAY_BUFFER,this.actorBuffer);gl.bufferData(gl.ARRAY_BUFFER,actors,gl.DYNAMIC_DRAW);this.bind(this.actorBuffer);
      // Actors are an explicit illustrative overlay. The terrain/building
      // depth buffer used to hide them whenever a facade crossed their
      // projected screen position, which looked like intermittent removal.
      // Keep their local-road positions, but draw the small markers above the
      // city so their presence remains legible and stable between frames.
      gl.disable(gl.DEPTH_TEST);gl.depthMask(false);
      gl.drawArrays(gl.TRIANGLES,0,actors.byteLength/12);
      gl.depthMask(true);gl.enable(gl.DEPTH_TEST);
      this.stats.actorVertices=actors.byteLength/12;this.stats.actorOverlay=true;
    } else { this.stats.actorVertices=0;this.stats.actorOverlay=true; }
    this.stats.visibleVertices=visible;this.stats.draws++;this.stats.lastDrawMs=performance.now()-start;
  }
}
window.Cidade=Cidade;
