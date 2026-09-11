export type HitPart = "pivot" | "bob1" | "bob2" | "bob3" | "rod1" | "rod2" | "rod3";

export interface HitResult {
  part: HitPart;
}

export interface DragMeta {
  /** Top-left of the overlay window, so drag inertia can follow the object itself. */
  windowX?: number;
  windowY?: number;
  pivotInertia?: boolean;
  screenX?: number;
  screenY?: number;
}

export interface SimEnv {
  paused: boolean;
  motionMode: "natural" | "driven";
  trails: boolean;
}

export interface DrawEnv {
  interactionMode: "control" | "passthrough";
  hovered: HitPart | null;
  dragging: HitPart | null;
  shadows?: boolean;
}

export interface DeskObject {
  readonly id: string;
  hitTest(x: number, y: number): HitResult | null;
  update(dt: number, env: SimEnv): void;
  draw(ctx: CanvasRenderingContext2D, env: DrawEnv): void;
  reset(): void;
  dispose?(): void;
  beginDrag(hit: HitResult, x: number, y: number, meta?: DragMeta): void;
  dragTo(x: number, y: number, meta?: DragMeta): void;
  endDrag(): void;
  cancelDrag(): void;
  containsPoint(x: number, y: number): boolean;
}
