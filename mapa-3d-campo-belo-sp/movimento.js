// Decorative actors interpolate existing road/sidewalk paths in local metres.
// These positions never enter the establishments dataset or claim live traffic.
class Movimento {
  constructor(data,local,elevation) {
    this.elevation=elevation;this.routes=[];this.cacheKey='';this.candidates=[];
    const add=(points,person,id,offset)=>{
      const p=points.map(local),lengths=[0];
      for(let i=1;i<p.length;i++)lengths.push(lengths.at(-1)+Math.hypot(p[i][0]-p[i-1][0],p[i][1]-p[i-1][1]));
      const length=lengths.at(-1);if(length<12)return;
      const projected=p.map(q=>[q[0]+.23*q[1],.72*q[1]-.1*q[0]-.64*elevation(q)]);
      const bounds=[Math.min(...projected.map(q=>q[0])),Math.min(...projected.map(q=>q[1])),Math.max(...projected.map(q=>q[0])),Math.max(...projected.map(q=>q[1]))];
      this.routes.push({p,lengths,length,person,id,offset,bounds,population:Math.max(1,Math.floor(length/(person?12:24)))});
    };
    data.roads.forEach((r,i)=>add(r.p,false,i,1.4));
    data.walks.forEach((p,i)=>add(p,true,i+10000,0));
    this.vertices=new ArrayBuffer(192*2*30*12);
    this.stats={routes:this.routes.length,roadRoutes:this.routes.filter(r=>!r.person).length,walkRoutes:this.routes.filter(r=>r.person).length};
  }
  geometry(time,view,width,height,compact,quality=1.5) {
    const limit=Math.round((compact?96:192)*(quality<1.5?.65:1));
    // Cache intersecting paths, not their centres: long roads remain populated.
    const key=[view.x,view.y,view.zoom,width,height].join(',');
    if(key!==this.cacheKey){
      const x0=view.x-width/2/view.zoom-15,x1=view.x+width/2/view.zoom+15;
      const y0=view.y-height/2/view.zoom-15,y1=view.y+height/2/view.zoom+15;
      this.candidates=this.routes.filter(r=>r.bounds[2]>=x0&&r.bounds[0]<=x1&&r.bounds[3]>=y0&&r.bounds[1]<=y1);
      this.cacheKey=key;
    }
    const bins=Array.from({length:24},()=>[[],[]]);
    for(const r of this.candidates)for(let n=0;n<r.population;n++){
      // Ping-pong on each local segment. The actor slows to a stop at the
      // endpoint and returns, so it never fades out or teleports at a route
      // boundary. This keeps the visible population stable between frames.
      const baseDirection=r.person||n%2===0?1:-1;
      const phase=(time*(r.person?1.05:5.2)+r.id*43.71+n*r.length/r.population)%(r.length*2);
      const returning=phase>r.length;
      const distance=returning?2*r.length-phase:phase;
      const direction=baseDirection*(returning?-1:1);
      let i=1;while(i<r.lengths.length-1&&r.lengths[i]<distance)i++;
      const a=r.p[i-1],b=r.p[i],seg=r.lengths[i]-r.lengths[i-1];if(seg<.01)continue;
      const t=(distance-r.lengths[i-1])/seg,heading=Math.atan2(b[1]-a[1],b[0]-a[0]);
      const x=a[0]+(b[0]-a[0])*t-Math.sin(heading)*r.offset*direction;
      const z=a[1]+(b[1]-a[1])*t+Math.cos(heading)*r.offset*direction;
      const ground=this.elevation([x,z])+(r.person?.34:.45);
      // Keep the full actor visible at the turn-around point. Earlier code
      // dropped actors inside this 5 m fade band, which looked like flicker.
      const fade=1;
      const id=r.id*1000+n;
      // Selection cell is tied to the actor identity, never to its current
      // screen position. Crossing a visual grid boundary therefore cannot
      // replace this actor with another one on the next frame.
      const cell=(id*17+Math.floor(id/24)*13)%24;
      bins[cell][r.person?1:0].push({r,id,x,z,ground,fade,angle:heading+(direction<0?Math.PI:0),cell,segment:i,t,direction});
    }
    // Round-robin spatial cells prevents clustering around the camera centre.
    // Stable hash avoids choosing the same end of every street on every frame.
    for(const bin of bins)for(const group of bin)group.sort((a,b)=>((a.id*2654435761)>>>0)-((b.id*2654435761)>>>0));
    const actors=[];
    for(const type of [0,1]){
      const budget=type?Math.floor(limit*.45):Math.ceil(limit*.55);let emitted=0;
      for(let round=0;emitted<budget;round++){
        let found=false;
        for(const bin of bins){const a=bin[type][round];if(a&&emitted<budget){actors.push(a);emitted++;found=true;}}
        if(!found)break;
      }
    }
    const buffer=new DataView(this.vertices);let count=0;
    const emit=(p,c)=>{const o=count++*12;for(let j=0;j<3;j++)buffer.setInt16(o+j*2,Math.round(p[j]*10),true);for(let j=0;j<4;j++)buffer.setUint8(o+6+j,j<3?c[j]:255);};
    const box=(x,z,lo,hi,len,w,angle,color)=>{
      const co=Math.cos(angle),si=Math.sin(angle),p=[];
      for(const y of [lo,hi])for(const [u,v] of [[-len,-w],[len,-w],[len,w],[-len,w]])p.push([x+u*co-v*si,z+u*si+v*co,y]);
      const faces=[[0,1,5,4],[1,2,6,5],[2,3,7,6],[3,0,4,7],[4,5,6,7]];
      for(let j=0;j<faces.length;j++){const f=faces[j],c=color.map(n=>Math.round(n*(j===4?1:.72+j*.04)));for(const i of [f[0],f[1],f[2],f[0],f[2],f[3]])emit(p[i],c);}
    };
    for(const actor of actors) {
      const {r,id,x,z,ground,fade,angle}=actor;
      if(r.person) {
        const bob=Math.sin(time*6+id)*.05,bodyWidth=Math.max(.24,.6/view.zoom),headWidth=Math.max(.20,.45/view.zoom);
        box(x,z,ground,ground+1.3+bob,bodyWidth*fade,bodyWidth*.92*fade,angle,[66,85,101]);
        box(x,z,ground+1.3+bob,ground+1.75+bob,headWidth*fade,headWidth*fade,angle,[194,166,140]);
      } else {
        const palette=[[206,194,164],[116,138,147],[225,226,218],[153,139,131]];
        box(x,z,ground,ground+.85,2.15*fade,.9*fade,angle,palette[id%4]);
        box(x,z,ground+.85,ground+1.45,1.05*fade,.74*fade,angle,[79,100,112]);
      }
    }
    this.visible=actors.length;
    this.rendered=actors.map(a=>({id:a.id,route:a.r.id,person:a.r.person,x:a.x,z:a.z,ground:a.ground,cell:a.cell,segment:a.segment,t:a.t,direction:a.direction}));
    Object.assign(this.stats,{budget:limit,cars:actors.filter(a=>!a.r.person).length,people:actors.filter(a=>a.r.person).length,occupiedCells:new Set(actors.map(a=>a.cell)).size,candidateRoutes:this.candidates.length});
    return new Uint8Array(this.vertices,0,count*12);
  }
}
window.Movimento=Movimento;
