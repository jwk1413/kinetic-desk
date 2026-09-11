/** Production stub: frame debug HUD is development-only. */
export class FrameDebug {
  configure(_enabled: boolean, _target: number, _paused: boolean, _hidden = false): void {}
  draw(_now: number): void {}
  tick(
    _now: number,
    _arrival: number,
    _drew: boolean,
    _early: number,
    _cost: { physics: number; draw: number; shadow: number; total: number },
  ): void {}
}
