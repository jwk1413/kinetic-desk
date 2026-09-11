const assert=require('node:assert/strict');
const vm=require('node:vm');
const {EventEmitter}=require('node:events');
const esbuild=require('esbuild');
const code=esbuild.buildSync({entryPoints:['src/main/window-manager.ts'],bundle:true,platform:'node',format:'cjs',external:['electron'],write:false,define:{__KINETIC_DEV_TOOLS__:'false'}}).outputFiles[0].text;
for(const platform of ['win32','darwin']) {
 const handlers=new Map();const bounds={x:0,y:0,width:1000,height:800};const workArea={x:0,y:25,width:1000,height:775};let macCalls=0;
 class Window extends EventEmitter {
  constructor(options){super();this.options=options;this.webContents=Object.assign(new EventEmitter(),{isDestroyed:()=>false,send(){}});this.bounds={...options};if(platform==='darwin')this.setWindowButtonVisibility=()=>macCalls++;}
  setAlwaysOnTop(){this.top=true} setVisibleOnAllWorkspaces(){assert.equal(platform,'darwin')}
  setIgnoreMouseEvents(v){this.ignore=v} setFocusable(v=true){this.focusable=v} isFocusable(){return this.focusable!==false} isFocused(){return false} blur(){} isAlwaysOnTop(){return this.top}
  loadFile(path){assert(path.endsWith('renderer/index.html'));return Promise.resolve()}
  isDestroyed(){return false} getBounds(){return this.bounds} setBounds(b){this.bounds=b} showInactive(){}
 }
 const screen=Object.assign(new EventEmitter(),{getAllDisplays:()=>[{bounds,workArea}],getPrimaryDisplay:()=>({bounds,workArea}),getDisplayMatching:()=>({bounds,workArea})});
 const electron={app:new EventEmitter(),screen,BrowserWindow:Window,ipcMain:{removeAllListeners(){},removeHandler(){},on:(k,fn)=>handlers.set(k,fn),handle:(k,fn)=>handlers.set(k,fn)}};
 const module={exports:{}};vm.runInNewContext(code,{module,exports:module.exports,require:id=>id==='electron'?electron:require(id),process:{platform,env:{}},__dirname:'/app/out/main',console});
 const overlay=module.exports.createOverlayWindow(700);const win=overlay.browserWindow;
 win.emit('ready-to-show');assert(win.options.transparent);assert(win.top);assert(win.ignore);
 overlay.setInteractionMode('control');overlay.setClickThrough(false);assert.equal(win.ignore,false);
 overlay.setInteractionMode('passthrough');assert.equal(win.ignore,true);
 const fits=(b,label)=>{assert(b.width<=workArea.width&&b.height<=workArea.height,label+': window larger than the work area');};
 fits(win.options,'initial placement');
 overlay.setSize(900,'bobs');fits(win.bounds,'oversized resize');
 assert(win.bounds.width<1395,'a request too large for the display must shrink');
 const small=win.bounds.width;overlay.setSize(500,'bobs');fits(win.bounds,'small resize');
 assert(win.bounds.width<small,'asking for a smaller size must shrink the window');
 assert.equal(win.bounds.width,module.exports.overlayWindowSize(500,'bobs').width,'window must follow overlayWindowSize');
 assert.equal(macCalls,platform==='darwin'?1:0);
 electron.app.emit('before-quit');console.log(platform+': window startup, transparency, topmost, click-through, display-fitted resize and cleanup passed (API simulation).');
}
