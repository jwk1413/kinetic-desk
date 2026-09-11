// Release stand-in for the profiling counters. The build swaps perf.ts for this
// so the packaged app carries no measurement code and the frame loop calls
// nothing; every function here folds away to a constant.
export interface PerfSnapshot {
  rafs: number;
  draws: number;
  physicsMs: number;
  drawMs: number;
  shadowMs: number;
  frameMs: number;
}

const EMPTY: PerfSnapshot = { rafs: 0, draws: 0, physicsMs: 0, drawMs: 0, shadowMs: 0, frameMs: 0 };

export const perf = {
  setDebug(_enabled: boolean): void {},
  now(): number { return 0; },
  start(): void {},
  stop(): PerfSnapshot { return EMPTY; },
  add(_field: "physicsMs" | "drawMs" | "shadowMs" | "frameMs", _ms: number): void {},
  raf(): void {},
  draw(): void {},
  snapshot(): PerfSnapshot { return EMPTY; },
};
