// Counts canvas submissions, not OS/GPU presentation. HUD refreshes independently
// so enabling it cannot keep the paused animation loop alive.
const WINDOW_MS = 10000;

interface TickSample { t: number; gap: number; arrivalGap: number; drew: boolean; early: number; physics: number; draw: number; shadow: number; total: number }

export class FrameDebug {
  private ticks: TickSample[] = [];
  private lastTick: number | null = null;
  private lastArrival: number | null = null;
  private panel: HTMLPreElement | null = null;
  private summary: HTMLSpanElement | null = null;
  private chart: HTMLCanvasElement | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private samples: Array<{ t: number; gap: number }> = [];
  private lastDraw: number | null = null;
  private since = 0;
  private target = 30;
  private status = "";
  private key = "";

  configure(enabled: boolean, target: number, paused: boolean, hidden = false): void {
    if (!enabled) {
      if (this.timer !== null) clearInterval(this.timer);
      this.timer = null;
      this.panel?.remove();
      this.panel = null;
      this.summary = null;
      this.chart = null;
      this.samples = [];
      this.ticks = [];
      this.lastTick = null;
      this.lastArrival = null;
      this.lastDraw = null;
      this.key = "";
      return;
    }
    this.target = target;
    this.status = hidden ? "숨김" : paused ? "일시정지" : "실행 중";
    const key = `${target}/${paused}/${hidden}`;
    if (key !== this.key) {
      this.key = key;
      this.samples = [];
      this.ticks = [];
      this.lastTick = null;
      this.lastArrival = null;
      this.lastDraw = null;
      this.since = performance.now();
    }
    if (!this.panel) {
      this.panel = document.createElement("pre");
      this.panel.style.cssText = "position:fixed;left:12px;top:12px;margin:0;padding:12px 14px;border-radius:10px;background:rgba(15,20,30,.9);color:#e4edff;font:12px/1.65 ui-monospace,monospace;pointer-events:none;user-select:none;z-index:9999;white-space:pre;";
      this.summary = document.createElement("span");
      this.chart = document.createElement("canvas");
      this.chart.width = 680;
      this.chart.height = 240;
      this.chart.style.cssText = "display:block;width:340px;height:120px;margin-top:8px";
      this.chart.setAttribute("aria-label", "최근 10초 프레임 간격 그래프. 빨간 막대는 지연 프레임입니다.");
      this.panel.append(this.summary, this.chart);
      document.body.appendChild(this.panel);
      this.timer = setInterval(() => this.refresh(), 250);
    }
    this.refresh();
  }

  draw(now: number): void {
    if (!this.panel) return;
    this.samples.push({ t: now, gap: this.lastDraw === null ? 0 : now - this.lastDraw });
    this.lastDraw = now;
    this.prune(now);
  }

  tick(now: number, arrival: number, drew: boolean, early: number, cost: {physics: number; draw: number; shadow: number; total: number}): void {
    if (!this.panel) return;
    this.ticks.push({t: now, gap: this.lastTick === null ? 0 : now - this.lastTick, arrivalGap: this.lastArrival === null ? 0 : arrival - this.lastArrival, drew, early, ...cost});
    this.lastTick = now; this.lastArrival = arrival;
    this.prune(now);
  }

  private prune(now: number): void {
    while (this.ticks.length && this.ticks[0].t <= now - WINDOW_MS) this.ticks.shift();
    while (this.samples.length && this.samples[0].t <= now - WINDOW_MS) this.samples.shift();
  }

  private refresh(): void {
    if (!this.panel) return;
    const now = performance.now();
    this.prune(now);
    const duration = Math.min(WINDOW_MS, now - this.since);
    const fps = duration >= 500 ? (this.samples.length * 1000 / duration).toFixed(1) : "측정 중";
    const gaps = this.samples.map(s => s.gap).filter(g => g > 0).sort((a,b) => a-b);
    const p95 = gaps.length ? gaps[Math.ceil(gaps.length * .95) - 1].toFixed(1) : "—";
    const max = gaps.length ? gaps[gaps.length - 1].toFixed(1) : "—";
    const threshold = 1500 / this.target;
    const late = gaps.filter(g => g > threshold).length;
    const silence = this.lastDraw === null ? "—" : (now - this.lastDraw).toFixed(0);
    this.summary!.textContent = `FRAME DEBUG · ${this.status}\n그리기 ${fps} fps / 목표 ${this.target}\n프레임 간격 P95 ${p95} ms · 최대 ${max} ms\n긴 프레임 (> ${threshold.toFixed(1)} ms): ${late}회 / 최근 10초\n마지막 그리기: ${silence} ms 전\nCanvas 호출 기준 · 실제 화면 표시와 다를 수 있음`;
    const percentile = (values: number[], fraction = .95): string => {
      if (!values.length) return "-";
      values.sort((a,b) => a-b);
      return values[Math.max(0, Math.ceil(values.length * fraction)-1)].toFixed(2);
    };
    const rate = duration >= 500 ? (this.ticks.length * 1000 / duration).toFixed(1) : "-";
    const skipped = this.ticks.filter(t => !t.drew && t.early > 0);
    const near = skipped.filter(t => t.early <= 2);
    const drawn = this.ticks.filter(t => t.drew);
    const recent = this.ticks.filter(t => (!t.drew && t.early > 0 && t.early <= 2) || t.arrivalGap > threshold || t.total > 1000 / this.target).slice(-4);
    this.summary!.textContent += `\n\nDIAGNOSTICS / 10s\nRAF ${rate}/s | gap P95 ${percentile(this.ticks.map(t=>t.gap).filter(x=>x>0))} ms\nCallback arrival P95 ${percentile(this.ticks.map(t=>t.arrivalGap).filter(x=>x>0))} ms\nLimiter skips ${skipped.length} | <=2ms early ${near.length}\nCPU P95: physics ${percentile(this.ticks.map(t=>t.physics))} / draw ${percentile(drawn.map(t=>t.draw))} ms\nShadow ${percentile(drawn.map(t=>t.shadow))} ms (included in draw)\nCallback CPU P95 ${percentile(this.ticks.map(t=>t.total))} / max ${percentile(this.ticks.map(t=>t.total),1)} ms\nRecent suspect events (not proven causes):\n${recent.map(t => `${((now-t.t)/1000).toFixed(1)}s ago | ${!t.drew && t.early>0 ? `limiter early ${t.early.toFixed(2)}ms` : `arrival gap ${t.arrivalGap.toFixed(1)}ms`} | CPU ${t.total.toFixed(2)}ms`).join("\n") || "None"}\nCPU submission timing, not GPU completion.\nDebug display itself adds some overhead.`;
    this.drawChart(now);
  }

  private drawChart(now: number): void {
    const ctx = this.chart?.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(2, 0, 0, 2, 0, 0);
    ctx.clearRect(0, 0, 340, 120);
    const left = 36, top = 15, width = 298, height = 80;
    const targetMs = 1000 / this.target;
    const ceiling = Math.max(50, targetMs * 3, ...this.samples.map(s => s.gap));
    const y = (ms: number) => top + height * (1 - ms / ceiling);
    ctx.font = "10px monospace";
    ctx.fillStyle = "#b5c2d6";
    ctx.fillText("프레임 간격 ms · 빨강 = 목표 간격의 1.5배 초과", 0, 10);
    ctx.fillText(ceiling.toFixed(0), 0, top + 8);
    ctx.fillText("0", 20, top + height);
    ctx.fillText("−10초", left, 114);
    ctx.fillText("현재", left + width - 24, 114);
    ctx.strokeStyle = "#657087";
    ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(left, y(targetMs)); ctx.lineTo(left + width, y(targetMs)); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillText(targetMs.toFixed(1), 0, y(targetMs));
    // Preserve narrow spikes: each time-column keeps its maximum gap.
    const bins = new Float64Array(width + 1);
    for (const sample of this.samples) {
      const x = Math.max(0, Math.min(width, Math.floor((sample.t - (now - WINDOW_MS)) / WINDOW_MS * width)));
      bins[x] = Math.max(bins[x], sample.gap);
    }
    for (let x = 0; x <= width; x++) {
      if (bins[x] <= 0) continue;
      ctx.strokeStyle = bins[x] > targetMs * 1.5 ? "#ff7a85" : "#80b7ff";
      ctx.beginPath(); ctx.moveTo(left + x, top + height); ctx.lineTo(left + x, y(bins[x])); ctx.stroke();
    }
  }
}
