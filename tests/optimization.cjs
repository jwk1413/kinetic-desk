const assert = require('node:assert/strict');
const vm = require('node:vm');
const esbuild = require('esbuild');
function bundle(path) { return esbuild.buildSync({entryPoints:[path],bundle:true,platform:'node',format:'cjs',write:false,external:['electron']}).outputFiles[0].text; }
function load(path, extra={}) { const module={exports:{}};vm.runInNewContext(bundle(path),{module,exports:module.exports,require,performance,console,...extra});return module.exports; }
const sticks=load('src/renderer/src/physics/swinging-sticks.ts');
for(const sign of [-1,1]) {
 const omega=.4*sign;
 const q=sticks.stickDriveTorque({theta:[1.2*sign,-.4],omega:[omega,-.2]},.08);
 assert(q[0]*omega>0,'drive must supply energy in both directions');assert.equal(q[1],0);
}
const {DoublePendulumObject}=load('src/renderer/src/objects/double-pendulum.ts',{document:{createElement:()=>({getContext:()=>null})}});
for(const hz of [30,60,120,144,165]) for(const scale of [.2,1,2.5]) {
 const o=new DoublePendulumObject();let elapsed=0;o.integrate=dt=>{elapsed+=dt;};
 for(let i=0;i<hz*2;i++)o.update(scale/hz,{paused:false,motionMode:'natural',trails:false});
 assert(Math.abs(elapsed-2*scale)<sticks.PHYS_DT+1e-9,`lost sim time ${hz}/${scale}: ${elapsed}`);
}
const p=load('src/renderer/src/perf.ts',{performance:{now:()=>10}}).perf;
p.add('drawMs',5);p.draw();assert.equal(p.snapshot().draws,0);assert.equal(p.now(),0);
p.start();p.add('drawMs',5);p.draw();assert.equal(p.stop().draws,1);p.draw();assert.equal(p.snapshot().draws,1);assert.equal(p.now(),0);
const store=load('src/main/store.ts',{require:(id)=>id==='electron'?{app:{}}:require(id)});
for(const [value,expected] of [[0,1],[4,3],[1.6,2],[NaN,2]])assert.equal(store.clampPhysics({bobCount:value}).bobCount,expected);
(async()=>{
 const result=await esbuild.build({entryPoints:['src/renderer/src/main.ts'],bundle:true,platform:'browser',format:'iife',write:false,plugins:[{name:'scene-stubs',setup(build){
 build.onResolve({filter:/objects\/double-pendulum$/},()=>({path:'object',namespace:'stub'}));
 build.onResolve({filter:/render\/shapes$/},()=>({path:'shapes',namespace:'stub'}));
 build.onLoad({filter:/.*/,namespace:'stub'},args=>({contents:args.path==='shapes'?'export const invalidateSizeCaches=()=>{}; export const prepareShadowBuffer=()=>{};':`export class DoublePendulumObject { origin={x:350,y:360}; layout(){} applyPhysics(){} consumeWindowShift(){return {x:0,y:0}} dispose(){} hitTest(){return null} update(dt){globalThis.simTime+=dt} draw(){globalThis.draws++} }`,loader:'js'}));
 }}]});
 function run(hz,fps,paused,bench,mouse,jitter=false) {
  let now=0,nextId=0;const drawTimes=[];const queue=new Map(),listeners={};let stateListener;
  const ctx={setTransform(){},clearRect(){}};
  const canvas={getContext:()=>ctx,style:{},getBoundingClientRect:()=>({left:0,top:0}),addEventListener:(k,fn)=>listeners[k]=fn};
  const state={interactionMode:'passthrough',motionMode:'natural',paused,trails:false,pivotInertia:false,displayFps:fps,physics:{windowSize:700,bobCount:2,timeScale:1,style:'bobs'}};
  const sandbox={draws:0,simTime:0,console:{log(){}},URLSearchParams,performance:{now:()=>now},document:{visibilityState:'visible',getElementById:()=>canvas},location:{search:bench?'?bench=1':''},requestAnimationFrame:fn=>{queue.set(++nextId,fn);return nextId},cancelAnimationFrame:id=>queue.delete(id)};
  sandbox.window={innerWidth:700,innerHeight:720,devicePixelRatio:2,addEventListener:(k,fn)=>listeners[k]=fn,desk:{getState:()=>undefined,onState:fn=>stateListener=fn,ready:()=>stateListener(state),setClickThrough(){},moveWindowBy(){},setPivotOffset(){}}};
  vm.runInNewContext(result.outputFiles[0].text,sandbox);
  for(let i=1;i<=hz*4;i++){now=i*1000/hz+(jitter && i>1 ? Math.sin(i*1.73)*.8 : 0);const before=sandbox.draws;if(mouse)listeners.pointermove({clientX:i%700,clientY:0,screenX:i,screenY:0});const work=[...queue.values()];queue.clear();work.forEach(fn=>fn(now));if(sandbox.draws>before)drawTimes.push(now);}
  if(jitter && hz===60) {
   const gaps=drawTimes.slice(1).map((t,i)=>t-drawTimes[i]);
   assert(Math.max(...gaps)<1000/fps+2,`jitter caused skipped refresh at ${fps}fps: ${Math.max(...gaps)}`);
  }
  return {draws:sandbox.draws,pending:queue.size};
 }
 for(const hz of [60,120,144,165])for(const fps of [30,60]){
  const ordinary=run(hz,fps,false,false,true),bench=run(hz,fps,false,true,true);
  assert(Math.abs(ordinary.draws-fps*4)<=1,`fps cap ${hz}/${fps}: ${ordinary.draws}`);
  assert.deepEqual(ordinary,bench,'benchmark must use same scheduler');
  const idle=run(hz,fps,true,false,true);assert.equal(idle.draws,1);assert.equal(idle.pending,0);
 }
 for(const hz of [60,120,144,165])for(const fps of [30,60]) {
  const result=run(hz,fps,false,false,true,true);
  assert(Math.abs(result.draws-fps*4)<=1,`jitter fps ${hz}/${fps}: ${result.draws}`);
 }
 console.log('Optimization regressions passed: real scheduler, pointer traffic, idle, benchmark parity, 30–165Hz physics/time scales, bidirectional drive, settings and opt-in profiling.');
})().catch(e=>{console.error(e);process.exitCode=1;});
