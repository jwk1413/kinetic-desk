export interface PerfSnapshot {
  rafs: number;
  draws: number;
  physicsMs: number;
  drawMs: number;
  shadowMs: number;
  frameMs: number;
}

const empty = (): PerfSnapshot => ({
  rafs: 0,
  draws: 0,
  physicsMs: 0,
  drawMs: 0,
  shadowMs: 0,
  frameMs: 0,
});

let current = empty();
let capturing = false;
let debugging = false;

export const perf = {
  setDebug(enabled: boolean): void { debugging = enabled; },
  now(): number { return capturing || debugging ? performance.now() : 0; },
  start(): void {
    capturing = true;
    current = empty();
  },
  stop(): PerfSnapshot {
    capturing = false;
    return { ...current };
  },
  add(field: "physicsMs" | "drawMs" | "shadowMs" | "frameMs", ms: number): void {
    if (capturing || debugging) current[field] += ms;
  },
  raf(): void {
    if (capturing || debugging) current.rafs += 1;
  },
  draw(): void {
    if (capturing || debugging) current.draws += 1;
  },
  snapshot(): PerfSnapshot {
    return { ...current };
  },
};

export function timeBlock(field: Exclude<keyof PerfSnapshot, "rafs" | "draws">, run: () => void): void {
  if (!capturing && !debugging) {
    run();
    return;
  }
  const start = performance.now();
  run();
  current[field] += performance.now() - start;
}
