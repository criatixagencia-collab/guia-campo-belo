// Procedural car audio (Web Audio API, no sound files): engine with gear changes, intake roar,
// road/wind noise, tyre squeal and impact thumps. Starts on the first user gesture (browser rule).
const GEARS=[0,6.5,12,17.5,23,99];
export class Som{
  constructor(){this.ctx=null;this.muted=false;try{this.muted=localStorage.getItem('corrida-som')==='0';}catch{}this.gear=1;this.shift=0;this.rpm=900;}
  start(){if(this.ctx){if(this.ctx.state==='suspended')this.ctx.resume();return;}
    const AC=window.AudioContext||window.webkitAudioContext;if(!AC)return;const c=this.ctx=new AC(),t=c.currentTime;
    const comp=c.createDynamicsCompressor();comp.threshold.value=-14;comp.ratio.value=4;comp.connect(c.destination);
    this.master=c.createGain();this.master.gain.value=0;this.master.connect(comp);
    // Engine: two detuned saws at firing frequency + square sub-harmonic, saturated, then a throttle-driven low-pass.
    this.engF=c.createBiquadFilter();this.engF.type='lowpass';this.engF.Q.value=.7;
    const shaper=c.createWaveShaper(),curve=new Float32Array(1024);for(let i=0;i<1024;i++){const x=i/511.5-1;curve[i]=Math.tanh(x*1.3);}shaper.curve=curve;
    this.engG=c.createGain();this.engG.gain.value=.0;shaper.connect(this.engF);this.engF.connect(this.engG);this.engG.connect(this.master);
    const pre=c.createGain();pre.gain.value=.55;pre.connect(shaper);
    this.osc=[['triangle',1,.55],['sine',1.004,.35],['sine',.5,.45],['sine',2,.10]].map(([type,mul,g])=>{const o=c.createOscillator(),gn=c.createGain();o.type=type;gn.gain.value=g;o.connect(gn);gn.connect(pre);o.start(t);return {o,mul};});
    // Combustion roughness: amplitude modulated by a slow random LFO.
    const lfo=c.createOscillator(),lfoG=c.createGain();lfo.frequency.value=13;lfoG.gain.value=.04;lfo.connect(lfoG);lfoG.connect(pre.gain);lfo.start(t);this.lfo=lfo;
    const noise=c.createBuffer(1,c.sampleRate*2,c.sampleRate),d=noise.getChannelData(0);let b=0;for(let i=0;i<d.length;i++){const w=Math.random()*2-1;b=(b+.02*w)/1.02;d[i]=w*.6+b*3;}
    const src=()=>{const s=c.createBufferSource();s.buffer=noise;s.loop=true;s.start(t,Math.random()*2);return s;};
    const band=(type,f,q,g)=>{const s=src(),fl=c.createBiquadFilter(),gn=c.createGain();fl.type=type;fl.frequency.value=f;fl.Q.value=q;gn.gain.value=g;s.connect(fl);fl.connect(gn);gn.connect(this.master);return {fl,gn};};
    this.intake=band('lowpass',400,.5,0);this.road=band('lowpass',220,.5,0);this.wind=band('lowpass',700,.3,0);this.squeal=band('bandpass',1800,4,0);
    this.noise=noise;this.apply();
  }
  apply(){if(this.master)this.master.gain.setTargetAtTime(this.muted||!this.active?0:.55,this.ctx.currentTime,.08);}
  setMuted(m){this.muted=m;try{localStorage.setItem('corrida-som',m?'0':'1');}catch{}this.apply();}
  setActive(a){if(a!==this.active){this.active=a;this.apply();}}
  // speed in m/s (max ~29), throttle/brake booleans, steer -1..1, offroad boolean.
  update(dt,{speed,throttle,brake,steer,offroad}){if(!this.ctx||!this.active)return;const c=this.ctx,t=c.currentTime,v=Math.abs(speed);
    let g=this.gear;while(g<5&&v>GEARS[g])g++;while(g>1&&v<GEARS[g-1]-1.5)g--;
    if(g!==this.gear){if(g>this.gear)this.shift=.16;this.gear=g;}
    this.shift=Math.max(0,this.shift-dt);
    const lo=GEARS[g-1],hi=Math.min(GEARS[g],30),f=Math.min(1,(v-lo)/(hi-lo)),target=(g===1?900:1700)+f*(g===1?4700:4300)+(throttle&&v<1?1400:0);
    this.rpm+=(target-this.rpm)*Math.min(1,dt*(this.shift>0?3:9));
    const load=throttle?1:brake?.25:.4,hz=this.rpm/60*2;
    for(const {o,mul} of this.osc)o.frequency.setTargetAtTime(hz*mul,t,.03);
    this.lfo.frequency.setTargetAtTime(hz*.25+3,t,.05);
    this.engF.frequency.setTargetAtTime(160+this.rpm*(throttle?.13:.07),t,.05);
    this.engG.gain.setTargetAtTime((.20+.14*load)*(this.shift>0?.6:1),t,.04);
    this.intake.fl.frequency.setTargetAtTime(250+this.rpm*.08,t,.05);this.intake.gn.gain.setTargetAtTime(throttle?.02+this.rpm/6500*.03:.006,t,.06);
    this.road.gn.gain.setTargetAtTime(Math.min(.18,v/29*.10)*(offroad?1.6:1),t,.1);this.road.fl.frequency.setTargetAtTime(offroad?450:180+v*3,t,.1);
    this.wind.gn.gain.setTargetAtTime(Math.pow(v/29,2)*.07,t,.1);
    const slip=Math.max(Math.abs(steer)*Math.max(0,v-14)/15,brake&&speed>9?(v-9)/20:0);this.squeal.gn.gain.setTargetAtTime(Math.min(.04,slip*.04),t,.05);
  }
  // Impact: short low thump (curb, wall).
  bump(strength=1){if(!this.ctx||this.muted||!this.active)return;const c=this.ctx,t=c.currentTime,s=c.createBufferSource(),fl=c.createBiquadFilter(),g=c.createGain();
    s.buffer=this.noise;fl.type='lowpass';fl.frequency.value=120+80*strength;g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(.5*strength,t+.015);g.gain.exponentialRampToValueAtTime(.0001,t+.28);
    s.connect(fl);fl.connect(g);g.connect(this.master);s.start(t,Math.random());s.stop(t+.3);}
  suspend(){this.ctx?.suspend();}
  resume(){if(this.ctx&&!document.hidden)this.ctx.resume();}
}
