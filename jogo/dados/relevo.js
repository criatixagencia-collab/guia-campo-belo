/* One piecewise-planar height field for offline meshes, pins and moving actors.
   The diagonal is the same a-c diagonal as the original 64x64 terrain mesh.
   All new vertices are intersections/interpolations of existing local geometry. */
(function(root){
  root.RelevoLocal=class {
    constructor(r,origin){
      this.r=r;this.origin=origin;this.mlon=111320*Math.cos(origin.lat*Math.PI/180);
      this.dx=(r.lon1-r.lon0)/(r.n-1)*this.mlon;
      this.dz=-(r.lat1-r.lat0)/(r.n-1)*111320;
      this.x0=(r.lon0-origin.lng)*this.mlon;this.z0=-(r.lat0-origin.lat)*111320;
    }
    grid(p){return [(p[0]-this.x0)/this.dx,(p[1]-this.z0)/this.dz];}
    local(p){return [this.x0+p[0]*this.dx,this.z0+p[1]*this.dz];}
    heightGrid([x,y]){
      const r=this.r,g=r.g;x=Math.max(0,Math.min(r.n-1,x));y=Math.max(0,Math.min(r.n-1,y));
      const i=Math.min(r.n-2,Math.floor(x)),j=Math.min(r.n-2,Math.floor(y)),u=x-i,v=y-j;
      return u>=v?g[j][i]*(1-u)+g[j][i+1]*(u-v)+g[j+1][i+1]*v:
        g[j][i]*(1-v)+g[j+1][i+1]*u+g[j+1][i]*(v-u);
    }
    elevation(p){return this.heightGrid(this.grid(p));}
    // Split polygon triangles at grid edges and diagonals. Every output triangle
    // lies on one terrain plane, so a lot cannot bridge above a valley or a roof.
    drape(points,triangulate){
      const gp=points.map(p=>this.grid(p)),result=[];
      const clip=(p,d)=>{
        const out=[];for(let k=0;k<p.length;k++){
          const a=p[k],b=p[(k+1)%p.length],da=d(a),db=d(b),ina=da>=-1e-10,inb=db>=-1e-10;
          if(ina)out.push(a);
          if(ina!==inb){const t=da/(da-db);out.push([a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t]);}
        }return out;
      };
      for(const ids of triangulate(points)){
        const tri=ids.map(i=>gp[i]),xs=tri.map(p=>p[0]),ys=tri.map(p=>p[1]);
        for(let i=Math.floor(Math.min(...xs));i<=Math.floor(Math.max(...xs));i++)
          for(let j=Math.floor(Math.min(...ys));j<=Math.floor(Math.max(...ys));j++){
            let p=tri;for(const d of [q=>q[0]-i,q=>i+1-q[0],q=>q[1]-j,q=>j+1-q[1]])p=clip(p,d);
            if(p.length<3)continue;
            for(const sign of [1,-1]){
              const half=clip(p,q=>sign*(q[0]-i-q[1]+j));
              for(let k=1;k<half.length-1;k++){
                const q=[half[0],half[k],half[k+1]],a=q[0],b=q[1],c=q[2];
                if(Math.abs((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]))<1e-11)continue;
                result.push(q.map(p=>[...this.local(p),this.heightGrid(p)]));
              }
            }
          }
      }return result;
    }
  };
})(globalThis);
