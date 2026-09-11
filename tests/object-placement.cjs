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
  external: ['electron'], write: false, define: { __KINETIC_DEV_TOOLS__: 'false' },
}).outputFiles[0].text;

const SRC = {
  wm: bundle('src/main/window-manager.ts'),
  object: bundle('src/renderer/src/objects/double-pendulum.ts'),
  store: bundle('src/main/store.ts'),
  types: bundle('src/shared/types.ts'),
};
const quiet = { log() {}, warn() {}, error() {} };

// The object measures drag inertia against the clock, so the rig drives one.
// With a clock that never advances the whole inertia path is skipped and a test
// built on it would prove nothing.
const clock = { now: 0 };
const fakeClock = { now: () => clock.now };

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
      this.webContents = Object.assign(new EventEmitter(), { isDestroyed: () => false, send() {} });
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
    performance: fakeClock, document: { createElement: () => ({ getContext: () => null }) },
  });
  const { clampPhysics } = loadModule(SRC.store, {
    require: (id) => (id === 'electron' ? { app: { getPath: () => '/tmp' } } : require(id)),
  });
  const types = loadModule(SRC.types, { require });

  const overlay = wm.createOverlayWindow(700, 'sticks');
  const win = overlay.browserWindow;
  const dragObjectTo = (x, y) => handlers.get('drag-object-to')(null, x, y);
  const reportAnchor = () => {
    const fn = handlers.get('set-object-anchor');
    if (fn) fn(null, object.anchorInfo());
  };

  const object = new DoublePendulumObject();
  let physics = clampPhysics({ ...types.defaultPhysicsSettings, style: 'sticks' });
  object.layout(win.bounds.width, win.bounds.height);
  object.applyPhysics(physics);

  // Reporting where the object settled is the whole of it: the main process
  // places the window so the object lands where it belongs.
  const flush = () => reportAnchor();
  flush();

  const rig = {
    displays,
    pivot: () => ({ x: Math.round(win.bounds.x + object.origin.x), y: Math.round(win.bounds.y + object.origin.y) }),
    onScreen() {
      const p = rig.pivot();
      return displays.some(({ workArea: w }) => p.x >= w.x && p.x <= w.x + w.width
        && p.y >= w.y && p.y <= w.y + w.height);
    },
    /** Which display the pivot is sitting on, or null when it is nowhere. */
    displayOfPivot() {
      const p = rig.pivot();
      const i = displays.findIndex(({ workArea: w }) => p.x >= w.x && p.x < w.x + w.width
        && p.y >= w.y && p.y < w.y + w.height);
      return i < 0 ? null : i;
    },
    /**
     * The promise we actually make: the pivot and the first arm stay on a
     * display. The clamp works in whole pixels, so allow a pixel of slack.
     */
    graspable() {
      const p = rig.pivot();
      const { reach } = object.anchorInfo();
      const slack = 2;
      const on = (x, y) => displays.some(({ workArea: w }) => x >= w.x - slack && x <= w.x + w.width + slack
        && y >= w.y - slack && y <= w.y + w.height + slack);
      return on(p.x, p.y) && on(p.x, p.y + reach);
    },
    sync() { object.layout(win.bounds.width, win.bounds.height); flush(); },
    /**
     * A pointer drag of the pivot, the way the renderer performs one: the cursor
     * moves in screen coordinates and the canvas position follows the window.
     */
    dragPivot(totalX, totalY, steps, env) {
      let mouseX = win.bounds.x + object.origin.x;
      let mouseY = win.bounds.y + object.origin.y;
      const grabX = mouseX - (win.bounds.x + object.origin.x);
      const grabY = mouseY - (win.bounds.y + object.origin.y);
      const meta = () => ({ screenX: mouseX, screenY: mouseY, windowX: win.bounds.x, windowY: win.bounds.y });
      clock.now += 1000 / 60;
      object.beginDrag({ part: 'pivot' }, object.origin.x, object.origin.y, { pivotInertia: true, ...meta() });
      for (let i = 0; i < steps; i += 1) {
        clock.now += 1000 / 60;
        mouseX += totalX / steps;
        mouseY += totalY / steps;
        reportAnchor();
        dragObjectTo(mouseX - grabX, mouseY - grabY);
        object.dragTo(mouseX - win.bounds.x, mouseY - win.bounds.y, meta());
        rig.sync();
        object.update(1 / 60, env);
      }
      object.endDrag();
    },
    omega: () => object.state.omega.slice(),
    /** Drags the object by asking for an absolute position, as the renderer does. */
    drag(dx, dy) {
      const p = rig.pivot();
      reportAnchor();
      dragObjectTo(p.x + dx, p.y + dy);
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

/** Window bounds are whole pixels, so a step may round by one; it must not add up. */
function assertSteady(samples, anchor, what) {
  for (const axis of ['x', 'y']) {
    const values = samples.map((p) => p[axis]);
    const spread = Math.max(...values) - Math.min(...values);
    const strayed = Math.max(...values.map((v) => Math.abs(v - anchor[axis])));
    assert(spread <= 1, `${what}: ${axis}가 ${spread}px 밀림`);
    assert(strayed <= 1, `${what}: ${axis}가 원래 자리에서 ${strayed}px 벗어남`);
  }
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
  const seen = [];
  for (let i = 0; i < 24; i += 1) { rig.setSize(SIZES[i % SIZES.length]); seen.push(rig.pivot()); }
  assertSteady(seen, before, `${label}: 창 크기를 바꾸면 고정점이 이동함`);
}

// 4. Interleaving both settles instead of ratcheting, and never escapes.
for (const [label, displays] of DISPLAYS) {
  const rig = makeRig(displays);
  let settled = null;
  const tail = [];
  for (let i = 1; i <= 240; i += 1) {
    if (i % 3 === 0) rig.setStyle(i % 2 ? 'bobs' : 'sticks');
    else rig.setSize(SIZES[i % SIZES.length]);
    assert(rig.onScreen(), `${label}: ${i}회째 조작에서 고정점이 화면을 벗어남`);
    if (i === 60) settled = rig.pivot();
    if (i > 60) tail.push(rig.pivot());
  }
  assertSteady(tail, settled, `${label}: 형태·크기를 섞어 바꾸면 위치가 계속 밀림`);
}

// 5. Resizing is not a request to move the object: parked hard against an edge,
// it must stay exactly where the user left it whatever size they pick.
for (const [label, displays] of DISPLAYS) {
  for (const style of ['bobs', 'sticks']) {
    for (const [corner, dx, dy] of CORNERS) {
      const rig = makeRig(displays);
      rig.setStyle(style);
      rig.drag(dx, dy);
      const parked = rig.pivot();
      assert(rig.graspable(), `${label} ${style} ${corner}: 가장자리로 끌면 잡을 수 없는 자리에 놓임`);
      for (const size of [900, 1100, 700, 500, 1100, 700]) {
        rig.setSize(size);
        const now = rig.pivot();
        // Window bounds are whole pixels, so a size step can land a pixel either
        // way; anything more means the object was pushed around.
        assert(Math.abs(now.x - parked.x) <= 1 && Math.abs(now.y - parked.y) <= 1,
          `${label} ${style} ${corner}: ${size}px로 바꾸니 고정점이 ${JSON.stringify(parked)} → ${JSON.stringify(now)} 로 이동함`);
        // Enlarging at the very edge does push part of the object past it — the
        // alternative is moving the object out from under the user, which is
        // worse. The pivot itself must stay on a display so it can be dragged back.
        assert(rig.onScreen(), `${label} ${style} ${corner}: ${size}px에서 고정점이 화면 밖으로 나감`);
      }
    }
  }
}

// 6. On more than one display the object has to be able to cross the seam. An
// earlier clamp kept its whole swing inside a single display, which quietly
// fenced it off from the second monitor entirely.
{
  const twoScreens = DISPLAYS.find(([name]) => name.includes('경계'))[1];
  for (const style of ['bobs', 'sticks']) {
    for (const size of [500, 700, 1100]) {
      const rig = makeRig(twoScreens);
      rig.setStyle(style);
      rig.setSize(size);
      rig.drag(-9000, -9000);
      assert.equal(rig.displayOfPivot(), 0, `${style} ${size}px: 주 모니터로 돌아오지 못함`);
      rig.drag(9000, 0);
      assert.equal(rig.displayOfPivot(), 1,
        `${style} ${size}px: 오른쪽으로 끌어도 두 번째 모니터로 넘어가지 못함 ${JSON.stringify(rig.pivot())}`);
      const onSecond = rig.pivot();
      const second = twoScreens[1].workArea;
      assert(onSecond.x > second.x + second.width - 200,
        `${style} ${size}px: 두 번째 모니터 오른쪽 끝까지 가지 못함 ${JSON.stringify(onSecond)}`);
      rig.drag(-9000, 0);
      assert.equal(rig.displayOfPivot(), 0, `${style} ${size}px: 주 모니터로 되돌아오지 못함`);
      assert(rig.pivot().x < twoScreens[0].workArea.x + 200,
        `${style} ${size}px: 주 모니터 왼쪽 끝까지 가지 못함 ${JSON.stringify(rig.pivot())}`);
    }
  }
}

// 7. Dragging past the edge of a display must not shake the pendulum apart.
// Inertia used to be measured from the cursor, so a clamped object — cursor
// still moving, object standing still — looked like enormous acceleration. It
// pumped the physics until the velocity clamp fired every step, filling the log
// and flinging the pendulum out of sight.
{
  const noisy = [];
  const realLog = console.log;
  console.log = (...args) => { if (String(args[0]).startsWith('[kinetic]')) noisy.push(String(args[0])); };
  try {
    for (const [label, displays] of DISPLAYS) {
      for (const style of ['bobs', 'sticks']) {
        const rig = makeRig(displays);
        rig.setStyle(style);
        const env = { paused: false, motionMode: 'driven', trails: false };
        for (const [dx, dy] of [[6000, 0], [-6000, 0], [0, 4000], [0, -4000], [6000, 4000]]) {
          rig.dragPivot(dx, dy, 300, env);
          assert(rig.onScreen(), `${label} ${style}: 화면 밖으로 끌려나감 ${JSON.stringify(rig.pivot())}`);
          for (const w of rig.omega()) {
            assert(Number.isFinite(w), `${label} ${style}: 드래그 중 물리가 발산함`);
            assert(Math.abs(w) <= 20, `${label} ${style}: 드래그가 진자를 ${w.toFixed(1)} rad/s 로 돌려버림`);
          }
        }
      }
    }
  } finally {
    console.log = realLog;
  }
  assert.equal(noisy.length, 0, `드래그 중 경고가 ${noisy.length}번 찍힘: ${noisy[0]}`);
}

// 8. The overlay window is transparent, and every pixel of it costs GPU memory,
// so it is kept close to what the object needs. It must still be able to hold
// the object at its widest swing, shadow included, or the object gets clipped.
{
  const wm = loadModule(SRC.wm, {
    require: (id) => (id === 'electron' ? { app: { on() {} }, screen: { getAllDisplays: () => [], getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 4000, height: 4000 } }) }, BrowserWindow: class {}, ipcMain: { on() {}, handle() {}, removeAllListeners() {}, removeHandler() {} } } : require(id)),
    process: { platform: 'darwin', env: {} }, __dirname: '/app/out/main',
  });
  const { DoublePendulumObject } = loadModule(SRC.object, {
    performance: fakeClock, document: { createElement: () => ({ getContext: () => null }) },
  });
  const types = loadModule(SRC.types, { require });
  for (const style of ['bobs', 'sticks']) {
    for (const bobCount of [1, 2, 3]) {
      for (const size of [360, 500, 700, 900, 1100, 1200]) {
        const win = wm.overlayWindowSize(size, style);
        const object = new DoublePendulumObject();
        object.layout(4000, 4000);
        object.applyPhysics({ ...types.defaultPhysicsSettings, style, bobCount, windowSize: size });
        const needed = object.requiredCanvas();
        assert(needed.width <= win.width && needed.height <= win.height,
          `${style} ${bobCount}중 ${size}px: 창 ${win.width}x${win.height} 이 오브제에 필요한 ${Math.ceil(needed.width)}x${Math.ceil(needed.height)} 보다 작아 잘림`);
      }
    }
  }
}

console.log('Object placement: the object stays put through resizes, crosses displays, and survives being dragged past the edge.');
