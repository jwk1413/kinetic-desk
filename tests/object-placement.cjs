// The overlay is a large transparent window and the pendulum sits somewhere
// inside it. Clamps that only keep the *window* on screen used to let the object
// be dragged or resized hundreds of pixels off the desktop, where it could never
// be grabbed again; style and size changes also walked it across the screen.
// These checks drive the real window manager against the real object.
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const esbuild = require('esbuild');

const bundle = (entry) => esbuild.buildSync({
  entryPoints: [entry], bundle: true, platform: 'node', format: 'cjs',
  external: ['electron'], write: false,
}).outputFiles[0].text;

const SRC = {
  wm: bundle('src/main/window-manager.ts'),
  object: bundle('src/renderer/src/objects/double-pendulum.ts'),
  store: bundle('src/main/store.ts'),
  types: bundle('src/shared/types.ts'),
};
const quiet = { log() {}, warn() {}, error() {} };

function loadModule(code, sandbox) {
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, require, console: quiet, ...sandbox });
  return module.exports;
}

const overlapArea = (a, b) => Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x))
  * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));

const oneDisplay = (width, height) => [{
  bounds: { x: 0, y: 0, width, height },
  workArea: { x: 0, y: 25, width, height: height - 25 },
  primary: true,
}];

/** A fake desktop plus the wiring the renderer normally performs. */
function makeRig(displays) {
  const handlers = new Map();

  class FakeWindow extends EventEmitter {
    constructor(options) {
      super();
      this.options = options;
      this.webContents = new EventEmitter();
      this.bounds = { x: options.x, y: options.y, width: options.width, height: options.height };
    }
    setAlwaysOnTop() {} setVisibleOnAllWorkspaces() {} setWindowButtonVisibility() {}
    setIgnoreMouseEvents() {} setFocusable() {} isFocusable() { return true; }
    isFocused() { return false; } blur() {} isAlwaysOnTop() { return true; }
    loadFile() { return Promise.resolve(); } isDestroyed() { return false; }
    getBounds() { return { ...this.bounds }; }
    setBounds(next) { this.bounds = { ...next }; }
    showInactive() {}
  }

  const screen = Object.assign(new EventEmitter(), {
    getAllDisplays: () => displays,
    getPrimaryDisplay: () => displays.find((d) => d.primary) ?? displays[0],
    getDisplayMatching: (rect) => displays.reduce(
      (best, d) => (overlapArea(rect, d.bounds) > overlapArea(rect, best.bounds) ? d : best),
      displays[0],
    ),
  });
  const electron = {
    app: new EventEmitter(), screen, BrowserWindow: FakeWindow,
    ipcMain: {
      removeAllListeners() {}, removeHandler() {},
      on: (key, fn) => handlers.set(key, fn),
      handle: (key, fn) => handlers.set(key, fn),
    },
  };

  const wm = loadModule(SRC.wm, {
    require: (id) => (id === 'electron' ? electron : require(id)),
    process: { platform: 'darwin', env: {} }, __dirname: '/app/out/main',
  });
  const { DoublePendulumObject } = loadModule(SRC.object, {
    performance, document: { createElement: () => ({ getContext: () => null }) },
  });
  const { clampPhysics } = loadModule(SRC.store, {
    require: (id) => (id === 'electron' ? { app: { getPath: () => '/tmp' } } : require(id)),
  });
  const types = loadModule(SRC.types, { require });

  const overlay = wm.createOverlayWindow(700);
  const win = overlay.browserWindow;
  const moveWindowBy = (dx, dy) => handlers.get('move-window-by')(null, dx, dy);
  const reportPivot = () => {
    const fn = handlers.get('set-pivot-offset');
    if (fn) fn(null, Math.round(object.origin.x), Math.round(object.origin.y));
  };

  const object = new DoublePendulumObject();
  let physics = clampPhysics({ ...types.defaultPhysicsSettings, style: 'sticks' });
  object.layout(win.bounds.width, win.bounds.height);
  object.applyPhysics(physics);

  // The renderer reports the settled pivot before asking for the window move,
  // because the main process clamps that move against the pivot.
  const flush = () => {
    const shift = object.consumeWindowShift();
    reportPivot();
    if (shift.x !== 0 || shift.y !== 0) moveWindowBy(shift.x, shift.y);
  };
  flush();

  const rig = {
    displays,
    pivot: () => ({ x: Math.round(win.bounds.x + object.origin.x), y: Math.round(win.bounds.y + object.origin.y) }),
    onScreen() {
      const p = rig.pivot();
      return displays.some(({ workArea: w }) => p.x >= w.x && p.x <= w.x + w.width
        && p.y >= w.y && p.y <= w.y + w.height);
    },
    sync() { object.layout(win.bounds.width, win.bounds.height); flush(); },
    drag(dx, dy) {
      const overflow = object.shiftBy(dx, dy);
      reportPivot();
      if (overflow.x !== 0 || overflow.y !== 0) moveWindowBy(overflow.x, overflow.y);
    },
    setStyle(style) { physics = clampPhysics({ ...physics, style }); object.applyPhysics(physics); flush(); },
    setSize(size) {
      physics = clampPhysics({ ...physics, windowSize: size });
      const fitted = overlay.fitSize(physics.windowSize);
      overlay.setSize(fitted);
      object.applyPhysics({ ...physics, windowSize: fitted });
      flush();
      rig.sync();
    },
  };
  return rig;
}

const DISPLAYS = [
  ['13" 노트북', oneDisplay(1470, 956)],
  ['16" 노트북', oneDisplay(1728, 1117)],
  ['외장 모니터', oneDisplay(2560, 1440)],
  // A big primary with a smaller laptop beside it at a vertical offset: the
  // window can be sized for one display while the object sits on the other.
  ['외장+노트북 (경계 있음)', [
    { bounds: { x: 0, y: 0, width: 3008, height: 1692 }, workArea: { x: 0, y: 30, width: 3008, height: 1662 }, primary: true },
    { bounds: { x: 3008, y: 101, width: 1728, height: 1117 }, workArea: { x: 3008, y: 134, width: 1728, height: 1084 } },
  ]],
];
const SIZES = [500, 700, 900, 1100];
const CORNERS = [['좌상', -3000, -3000], ['우상', 3000, -3000], ['좌하', -3000, 3000], ['우하', 3000, 3000]];

// 1. The pivot must stay grabbable no matter where it is dragged.
for (const [label, displays] of DISPLAYS) {
  for (const [corner, dx, dy] of CORNERS) {
    const rig = makeRig(displays);
    rig.drag(dx, dy);
    rig.sync();
    assert(rig.onScreen(), `${label} ${corner} 모서리로 드래그하면 고정점이 화면을 벗어남: ${JSON.stringify(rig.pivot())}`);
  }
}

// 2. Changing style must not move the object.
for (const [label, displays] of DISPLAYS) {
  const rig = makeRig(displays);
  rig.drag(-200, 120);
  rig.sync();
  const before = rig.pivot();
  for (let i = 0; i < 8; i += 1) rig.setStyle(i % 2 ? 'bobs' : 'sticks');
  assert.deepEqual(rig.pivot(), before, `${label}: 형태를 바꾸면 고정점이 이동함`);
}

// 3. Changing size must not move the object, and must not accumulate.
for (const [label, displays] of DISPLAYS) {
  const rig = makeRig(displays);
  const before = rig.pivot();
  for (let i = 0; i < 16; i += 1) rig.setSize(SIZES[i % SIZES.length]);
  assert.deepEqual(rig.pivot(), before, `${label}: 창 크기를 바꾸면 고정점이 이동함`);
}

// 4. Interleaving both settles instead of ratcheting, and never escapes.
for (const [label, displays] of DISPLAYS) {
  const rig = makeRig(displays);
  let settled = null;
  for (let i = 1; i <= 240; i += 1) {
    if (i % 3 === 0) rig.setStyle(i % 2 ? 'bobs' : 'sticks');
    else rig.setSize(SIZES[i % SIZES.length]);
    assert(rig.onScreen(), `${label}: ${i}회째 조작에서 고정점이 화면을 벗어남`);
    if (i === 60) settled = rig.pivot();
  }
  assert.deepEqual(rig.pivot(), settled, `${label}: 형태·크기를 섞어 바꾸면 위치가 계속 밀림`);
}

// 5. Pushing the object hard against an edge and then enlarging must not strand it.
for (const [label, displays] of DISPLAYS) {
  for (const [corner, dx, dy] of CORNERS) {
    const rig = makeRig(displays);
    rig.drag(dx, dy);
    const parked = rig.pivot();
    // Hard against the edge the pivot can sit a pixel either way, because the
    // renderer reports it rounded to whole pixels. That must stay a wobble:
    // bounded, and never trending away from where the object was parked.
    const seen = [];
    for (const size of [900, 1100, 700, 1100, 500, 900, 1100, 500, 700]) {
      rig.setSize(size);
      const now = rig.pivot();
      assert(rig.onScreen(), `${label} ${corner}: 가장자리에서 크기를 ${size}px로 바꾸니 고정점이 화면을 벗어남 ${JSON.stringify(now)}`);
      seen.push(now);
    }
    const spread = (axis) => Math.max(...seen.map((p) => p[axis])) - Math.min(...seen.map((p) => p[axis]));
    const strayed = (axis) => Math.max(...seen.map((p) => Math.abs(p[axis] - parked[axis])));
    for (const axis of ['x', 'y']) {
      assert(spread(axis) <= 2,
        `${label} ${corner}: 가장자리에서 크기를 반복해 바꾸면 고정점 ${axis}가 ${spread(axis)}px 밀림`);
      assert(strayed(axis) <= 2,
        `${label} ${corner}: 가장자리에서 크기를 바꾸니 고정점 ${axis}가 놓아둔 자리에서 ${strayed(axis)}px 벗어남`);
    }
  }
}

console.log('Object placement: pivot stays grabbable from every corner, and style/size changes neither move nor ratchet it.');
