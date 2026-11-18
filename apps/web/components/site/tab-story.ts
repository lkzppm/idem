import { MARK_PORTS } from "@/components/brand/mark";

/**
 * The header's tab story: every change of the active tab is told as one exchange of the protocol,
 * with the mark as the consumer.
 *
 * 1. An **Interest** (a blue ball) leaves the tip of the mark's upper harpoon, which recoils, and
 *    hops to the new tab. It stretches with its speed and trails two puffs, like the globe's packets.
 * 2. It lands on the tab and splats into the active underline: the blob spreads with a damped
 *    wobble (squash and stretch), a ring ripples out and the label dips under the impact.
 * 3. When the new page has actually arrived (the pathname changed), a **Data** (a yellow ball)
 *    pops out of the underline and hops home into the lower harpoon, which pops.
 *
 * Going home (the logo) sends the Interest round the mark itself: it leaves the upper harpoon,
 * turns, and comes back into the lower one as Data, the ⇌ drawn as motion.
 *
 * Every moving piece is a WAAPI animation of `transform` and `opacity` only, so it runs on the
 * compositor while the main thread renders the new page. A flight is a cubic Bézier sampled into
 * keyframes (position, stretch along the velocity); the landing pieces are scheduled on the same
 * timeline with delays, so nothing waits on a timer. Interruptible: a new navigation while a ball
 * is in the air re-aims that ball from where it is, with its current velocity, so fast repeated
 * clicks never queue and never jump. With reduced motion the underline just cross-fades.
 */

interface Pt {
  x: number;
  y: number;
}
type Curve = readonly [Pt, Pt, Pt, Pt];

/** One tab as the story sees it: the link (for its box) and the label (it dips on landing). */
export interface StoryTab {
  link: HTMLElement;
  label: HTMLElement;
}

/** The elements the story plays on, owned by `NavLinks` (`nav-links.tsx`). */
export interface StoryParts {
  /** Coordinate space for everything below (positioned). */
  stage: HTMLElement;
  /** Where packets and ripples are added (absolutely positioned over the stage). */
  layer: HTMLElement;
  /** The split mark (`IdemMarkSplit`): its box and its two harpoons. */
  mark: HTMLElement;
  /** The active-tab underline. */
  underline: HTMLElement;
  /** The tabs, in order; read on every use so it follows re-renders. */
  tabs: () => StoryTab[];
}

/** How far inside the link's padding the underline stops (px), so it is a little wider than the label. */
const OUTSET = 2;
/** Height of the underline (px); matches `.tab-underline`. */
const LINE = 3;
/** The impact squash after an Interest lands (ms). */
const IMPACT_MS = 90;
/** Pause between the Interest landing and the Data leaving (ms). */
const DATA_GAP = 50;
const SAMPLES = 28;

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const r2 = (v: number) => Math.round(v * 100) / 100;
const r4 = (v: number) => Math.round(v * 10000) / 10000;

/** Back-out: arrives with a small overshoot (a cartoon pop). */
function backOut(t: number): number {
  const u = t - 1;
  return 1 + 2.70158 * u * u * u + 1.70158 * u * u;
}

/** A CSS-style `cubic-bezier()` timing function. */
function cubicBezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sx = (s: number) => ((ax * s + bx) * s + cx) * s;
  const sy = (s: number) => ((ay * s + by) * s + cy) * s;
  const dx = (s: number) => (3 * ax * s + 2 * bx) * s + cx;
  return (t) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    let s = t;
    for (let i = 0; i < 8; i++) {
      const e = sx(s) - t;
      if (Math.abs(e) < 1e-6) break;
      const d = dx(s);
      if (Math.abs(d) < 1e-6) break;
      s -= e / d;
    }
    if (!(s >= 0 && s <= 1) || Math.abs(sx(s) - t) > 1e-4) {
      let lo = 0;
      let hi = 1;
      s = t;
      for (let i = 0; i < 30; i++) {
        const v = sx(s);
        if (Math.abs(v - t) < 1e-6) break;
        if (v < t) lo = s;
        else hi = s;
        s = (lo + hi) / 2;
      }
    }
    return sy(s);
  };
}

/** Launch: a little wind-up, then it falls onto the tab still moving (an impact, not a stop). */
const EASE_LAUNCH = cubicBezier(0.35, 0.1, 0.75, 0.7);
/** Re-aimed mid-air: keeps its speed from the first frame. */
const EASE_REAIM = cubicBezier(0.25, 0.25, 0.75, 0.7);
/** The Data: ejected fast by the landing, eased into the harpoon. */
const EASE_DATA = cubicBezier(0.2, 0.6, 0.45, 1);
/** Round the mark and back. */
const EASE_LOOP = cubicBezier(0.4, 0, 0.55, 1);

function bezier(c: Curve, t: number): Pt {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const d = 3 * u * t * t;
  const e = t * t * t;
  return {
    x: a * c[0].x + b * c[1].x + d * c[2].x + e * c[3].x,
    y: a * c[0].y + b * c[1].y + d * c[2].y + e * c[3].y,
  };
}

/** A stretch by `k` along the unit direction (dx, dy), thinned across it, times a uniform `s`. */
function stretch(dx: number, dy: number, k: number, s: number): string {
  const q = 1 / Math.sqrt(k);
  const a = (k * dx * dx + q * dy * dy) * s;
  const b = (k - q) * dx * dy * s;
  const d = (k * dy * dy + q * dx * dx) * s;
  return `matrix(${r4(a)}, ${r4(b)}, ${r4(b)}, ${r4(d)}, 0, 0)`;
}

const at = (p: Pt) => `translate(${r2(p.x)}px, ${r2(p.y)}px)`;

interface Path {
  curve: Curve;
  ease: (t: number) => number;
  /** Flight time (ms). */
  dur: number;
  /** A fresh packet pops out of the mark; a re-aimed one is already full size. */
  pop: boolean;
  /** `impact`: hits the underline and splats. `absorb`: shrinks into the lower harpoon. */
  end: "impact" | "absorb";
  /** Turns from Interest blue to Data yellow at this fraction of the flight (home loops). */
  flipAt?: number;
}

/** Keyframes for the ball: position, stretch along the velocity, pop-in, and the ending. */
function ballFrames(p: Path): { frames: Keyframe[]; total: number } {
  const tail = p.end === "impact" ? IMPACT_MS : 0;
  const total = p.dur + tail;
  const pts: Pt[] = [];
  for (let i = 0; i <= SAMPLES; i++) pts.push(bezier(p.curve, p.ease(i / SAMPLES)));
  const vel = pts.map((_, i) => {
    const a = pts[Math.max(0, i - 1)] as Pt;
    const b = pts[Math.min(SAMPLES, i + 1)] as Pt;
    return { x: b.x - a.x, y: b.y - a.y };
  });
  const speeds = vel.map((v) => Math.hypot(v.x, v.y));
  const vmax = Math.max(...speeds, 0.001);
  const frames: Keyframe[] = [];
  let dir = { x: 1, y: 0 };
  for (let i = 0; i <= SAMPLES; i++) {
    const u = i / SAMPLES;
    const v = vel[i] as Pt;
    const len = speeds[i] as number;
    if (len > 0.05) dir = { x: v.x / len, y: v.y / len };
    const sp = len / vmax;
    let k = 1 + 0.9 * sp * sp;
    let s = 1;
    if (p.pop) s *= 0.35 + 0.65 * backOut(clamp(u / 0.22, 0, 1));
    if (p.end === "absorb") {
      const g = clamp((u - 0.8) / 0.2, 0, 1);
      s *= 1 - 0.7 * g;
      k = lerp(k, 1, g);
    }
    frames.push({
      offset: r4((u * p.dur) / total),
      transform: `${at(pts[i] as Pt)} ${stretch(dir.x, dir.y, k, s)}`,
      opacity: p.end === "absorb" && i === SAMPLES ? 0 : 1,
    });
  }
  if (p.end === "impact") {
    const e = pts[SAMPLES] as Pt;
    const hit = at({ x: e.x, y: e.y + 0.5 });
    frames.push({
      offset: r4((p.dur + tail * 0.45) / total),
      transform: `${hit} matrix(1.8, 0, 0, 0.42, 0, 0)`,
      opacity: 1,
    });
    frames.push({ offset: 1, transform: `${hit} matrix(2.2, 0, 0, 0.22, 0, 0)`, opacity: 0 });
  }
  return { frames, total };
}

/** A puff trailing the ball by `lag` of the flight: it fades in behind it and out before the end. */
function puffFrames(p: Path, lag: number): Keyframe[] {
  const n = 18;
  const frames: Keyframe[] = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    const q = bezier(p.curve, p.ease(Math.max(0, u - lag)));
    const fadeIn = clamp((u - lag) / 0.12, 0, 1);
    const fadeOut = 1 - clamp((u - 0.62) / 0.3, 0, 1);
    frames.push({ offset: r4(u), transform: at(q), opacity: r2(0.85 * fadeIn * fadeOut) });
  }
  return frames;
}

/** The underline's landing: a blob the size of the ball spreads to the tab's width and wobbles. */
function splatFrames(x: number, w: number): Keyframe[] {
  const sx0 = Math.min(1, 9 / Math.max(w, 1));
  const sy0 = 2.2;
  const frames: Keyframe[] = [];
  const n = 16;
  const secs = 0.5;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * secs;
    const env = Math.exp(-12.5 * a) * Math.cos(21 * a);
    const sx = 1 - (1 - sx0) * env;
    const sy = 1 + (sy0 - 1) * env;
    frames.push({
      offset: r4(i / n),
      transform: `translateX(${r2(x)}px) scale(${r4(sx)}, ${r4(sy)})`,
      opacity: 1,
    });
  }
  return frames;
}

interface Flight {
  path: Path;
  ball: HTMLElement;
  /** The ball's own animation: its `currentTime` says where the ball is. */
  head: Animation;
  /** Everything that belongs to this flight and dies with it if it is re-aimed. */
  anims: Animation[];
  /** Elements added for this flight (removed when their animation ends or is cancelled). */
  extras: HTMLElement[];
  /** The tab it lands on; `null` for a flight home into the lower harpoon. */
  to: number | null;
}

/** Drives the header's tab story. One instance per mounted header nav. */
export class TabStory {
  #p: StoryParts;
  #reduced: boolean;
  /** The tab the story is heading to or sits on (`null`: home, no tab). */
  #requested: number | null = null;
  /** The tab whose page is on screen (from the pathname). */
  #arrived: number | null = null;
  #flight: Flight | null = null;
  /** Where the underline is shown or about to splat. */
  #lineAt: number | null = null;
  #lineAnim: Animation | null = null;
  /** The last landing, so a late page can still send its Data home. */
  #landing: { tab: number; at: number; dataSent: boolean } | null = null;
  #dead = false;

  constructor(parts: StoryParts, reduced: boolean) {
    this.#p = parts;
    this.#reduced = reduced;
  }

  setReduced(reduced: boolean): void {
    this.#reduced = reduced;
  }

  /** Put the story at `tab` with no motion (first paint). */
  place(tab: number | null): void {
    this.#requested = tab;
    this.#arrived = tab;
    this.#markTabs(tab, 0);
    this.#placeLine(tab);
  }

  /**
   * Begin the exchange toward `to` (a tab index, or `null` for home). Called on a nav click, before
   * the new page arrives, and from `arrive` for any other navigation.
   */
  go(to: number | null): void {
    if (this.#dead) return;
    if (to === this.#requested) {
      // The logo on the home page still answers: a loop round the mark.
      if (to === null && !this.#reduced && !this.#inAir()) this.#loopHome(null);
      return;
    }
    this.#requested = to;
    if (this.#reduced) {
      this.#cancelFlight();
      this.#fadeLine(to);
      this.#markTabs(to, 0);
      return;
    }

    // A ball still in the air is re-aimed from where it is; otherwise a new one leaves the mark.
    const air = this.#inAir();
    this.#retractLine();
    if (to === null) {
      this.#markTabs(null, 0);
      this.#loopHome(air);
      return;
    }
    const tab = this.#tabs()[to];
    if (!tab) return;
    const target = this.#lineCentre(tab);
    const flight = air
      ? this.#reaim(air, target, "impact", EASE_REAIM)
      : this.#launch(this.#port("interest"), target);
    flight.to = to;
    this.#flight = flight;
    this.#markTabs(to, flight.path.dur);
    this.#scheduleLanding(flight, to, tab);
  }

  /** The page for `tab` is on screen now (the pathname changed). */
  arrive(tab: number | null): void {
    if (this.#dead) return;
    this.#arrived = tab;
    if (tab !== this.#requested) {
      this.go(tab);
      return;
    }
    const l = this.#landing;
    if (tab !== null && l && l.tab === tab && !l.dataSent && !this.#reduced) {
      l.dataSent = true;
      this.#sendData(tab, Math.max(0, l.at - now()) + DATA_GAP);
    }
  }

  /** The layout changed (resize, fonts, language): re-place a settled underline. */
  relayout(): void {
    if (this.#dead || this.#lineAnim || this.#inAir()) return;
    this.#placeLine(this.#lineAt);
  }

  destroy(): void {
    this.#dead = true;
    this.#cancelFlight();
    this.#lineAnim?.cancel();
    for (const el of Array.from(this.#p.layer.children)) {
      if (el !== this.#p.underline) el.remove();
    }
  }

  // ---------------------------------------------------------------- geometry

  #tabs(): StoryTab[] {
    return this.#p.tabs();
  }

  #origin(): DOMRect {
    return this.#p.stage.getBoundingClientRect();
  }

  /** A port of the mark (where an Interest leaves, where a Data enters), in stage coordinates. */
  #port(kind: "interest" | "data"): Pt {
    const o = this.#origin();
    const m = this.#p.mark.getBoundingClientRect();
    const f = MARK_PORTS[kind];
    return { x: m.left - o.left + f.x * m.width, y: m.top - o.top + f.y * m.height };
  }

  /** Left edge and width of the underline under `tab`, in stage coordinates. */
  #lineBox(tab: StoryTab): { x: number; w: number; y: number } {
    const o = this.#origin();
    const r = tab.link.getBoundingClientRect();
    const inset = Math.max(0, (Number.parseFloat(getComputedStyle(tab.link).paddingLeft) || 12) - OUTSET);
    return { x: r.left - o.left + inset, w: Math.max(4, r.width - 2 * inset), y: o.height - LINE / 2 };
  }

  /** The lane under the labels where a Data travels home. */
  #lowLane(): number {
    return this.#origin().height * 0.8;
  }

  /** Right edge of the logo link (mark and wordmark), in stage coordinates. */
  #logoRight(): number {
    const link = this.#p.mark.closest("a") ?? this.#p.mark;
    return link.getBoundingClientRect().right - this.#origin().left;
  }

  #lineCentre(tab: StoryTab): Pt {
    const b = this.#lineBox(tab);
    return { x: b.x + b.w / 2, y: b.y };
  }

  // ---------------------------------------------------------------- flights

  /** The flight still in the air, with where its ball is and how fast it moves (px/ms). */
  #inAir(): { flight: Flight; pos: Pt; vel: Pt } | null {
    const f = this.#flight;
    if (!f) return null;
    const t = Number(f.head.currentTime ?? 0);
    if (f.head.playState === "finished" || t >= f.path.dur) return null;
    const u = clamp(t / f.path.dur, 0, 1);
    const du = 0.03;
    const a = bezier(f.path.curve, f.path.ease(u));
    const b = bezier(f.path.curve, f.path.ease(Math.min(1, u + du)));
    const dt = du * f.path.dur;
    return { flight: f, pos: a, vel: { x: (b.x - a.x) / dt, y: (b.y - a.y) / dt } };
  }

  /** Stop the current flight and everything scheduled with it. */
  #cancelFlight(): void {
    const f = this.#flight;
    if (!f) return;
    for (const a of f.anims) a.cancel();
    f.ball.remove();
    for (const el of f.extras) el.remove();
    this.#flight = null;
  }

  #el(cls: string, kind: "interest" | "data"): HTMLElement {
    const el = document.createElement("span");
    el.className = cls;
    el.dataset.kind = kind;
    this.#p.layer.append(el);
    return el;
  }

  /** The animation that owns each transient element: it is removed when that one ends. */
  #owner = new WeakMap<Element, Animation>();

  /** Remove `el` once `anim` ends either way, unless a newer animation has taken it over. */
  #reap(anim: Animation, el: HTMLElement): void {
    this.#owner.set(el, anim);
    const done = () => {
      if (this.#owner.get(el) === anim) el.remove();
    };
    anim.finished.then(done, done);
  }

  /** Fly a ball along `path`; returns the flight (not yet registered as current). */
  #fly(path: Path, kind: "interest" | "data", ball?: HTMLElement, delay = 0): Flight {
    const el = ball ?? this.#el("tab-packet", kind);
    if (path.flipAt !== undefined && !el.firstChild) el.append(document.createElement("i"));
    const { frames, total } = ballFrames(path);
    const head = el.animate(frames, { duration: total, delay, easing: "linear" });
    this.#reap(head, el);
    const flight: Flight = { path, ball: el, head, anims: [head], extras: [], to: null };
    const flip = el.firstElementChild as HTMLElement | null;
    if (flip) {
      const fa = path.flipAt ?? 2;
      const fr: Keyframe[] =
        fa > 1
          ? [{ opacity: 0 }, { opacity: 0 }]
          : [
              { offset: 0, opacity: 0 },
              { offset: Math.max(0, fa - 0.08), opacity: 0 },
              { offset: Math.min(1, fa + 0.08), opacity: 1 },
              { offset: 1, opacity: 1 },
            ];
      flight.anims.push(flip.animate(fr, { duration: total, delay, fill: "both" }));
    }
    if (path.flipAt === undefined && path.dur > 200) {
      for (const [lag, cls] of [
        [0.1, "tab-puff"],
        [0.19, "tab-puff tab-puff-sm"],
      ] as const) {
        const puff = this.#el(cls, kind);
        const a = puff.animate(puffFrames(path, lag), { duration: path.dur, delay, easing: "linear" });
        this.#reap(a, puff);
        flight.anims.push(a);
        flight.extras.push(puff);
      }
    }
    return flight;
  }

  /** Flight time for a trip of `dist` px. */
  #dur(dist: number): number {
    return clamp(200 + 0.5 * dist, 250, 420);
  }

  /** A fresh Interest out of the upper harpoon, which recoils as it fires. */
  #launch(from: Pt, to: Pt): Flight {
    const dir = Math.sign(to.x - from.x) || 1;
    // Up and over the labels (the upper lane, like the upper harpoon), then down onto the tab.
    const curve: Curve = [from, { x: from.x + 20 * dir, y: -2 }, { x: to.x - 20 * dir, y: -2 }, to];
    const path: Path = {
      curve,
      ease: EASE_LAUNCH,
      dur: this.#dur(Math.hypot(to.x - from.x, to.y - from.y)),
      pop: true,
      end: "impact",
    };
    this.#recoil();
    return this.#fly(path, "interest");
  }

  /** Take over a ball in the air and send it to `to` from where it is, at its current speed. */
  #reaim(
    air: { flight: Flight; pos: Pt; vel: Pt },
    to: Pt,
    end: Path["end"],
    ease: Path["ease"],
    flipAt?: number,
  ): Flight {
    const { flight: old, pos, vel } = air;
    for (const a of old.anims) a.cancel();
    for (const el of old.extras) el.remove();
    // The ball itself flies on: its new animation takes it over before the old one's cleanup runs.
    const ball = old.ball;
    const dist = Math.hypot(to.x - pos.x, to.y - pos.y);
    const dur = this.#dur(dist);
    // Hermite to Bézier: the first control point carries the velocity (scaled by the ease's slope).
    let h = { x: (vel.x * dur) / 3, y: (vel.y * dur) / 3 };
    const hl = Math.hypot(h.x, h.y);
    if (hl > 46) h = { x: (h.x / hl) * 46, y: (h.y / hl) * 46 };
    const dir = Math.sign(to.x - pos.x) || 1;
    const c2 = end === "impact" ? { x: to.x - 20 * dir, y: -2 } : { x: to.x + 20, y: this.#lowLane() + 6 };
    const path: Path = {
      curve: [pos, { x: pos.x + h.x, y: pos.y + h.y }, c2, to],
      ease,
      dur,
      pop: false,
      end,
      flipAt,
    };
    this.#flight = null;
    return this.#fly(path, "interest", ball);
  }

  /** Home: round the mark (or back from where the ball is) and into the lower harpoon as Data. */
  #loopHome(air: { flight: Flight; pos: Pt; vel: Pt } | null): void {
    const home = this.#port("data");
    let flight: Flight;
    if (air) {
      flight = this.#reaim(air, home, "absorb", EASE_REAIM, 0.45);
    } else {
      // Out over the logo, round its right end, and back under it: never through the wordmark.
      const from = this.#port("interest");
      const reach = Math.max(14, this.#logoRight() + 8 - from.x) * 1.33;
      const curve: Curve = [
        from,
        { x: from.x + reach, y: from.y - 40 },
        { x: home.x + reach, y: home.y + 40 },
        home,
      ];
      this.#recoil();
      flight = this.#fly(
        { curve, ease: EASE_LOOP, dur: 420, pop: true, end: "absorb", flipAt: 0.5 },
        "interest",
      );
    }
    flight.to = null;
    this.#flight = flight;
    this.#landing = null;
    this.#popHome(flight, flight.path.dur);
  }

  /** The landing at `tab`: the underline splats, a ring ripples, the label dips; then maybe Data. */
  #scheduleLanding(f: Flight, to: number, tab: StoryTab): void {
    const delay = f.path.dur;
    const box = this.#lineBox(tab);
    this.#splat(to, box, delay);
    const ring = this.#ring(this.#lineCentre(tab), "interest", delay);
    f.anims.push(ring.anim);
    f.extras.push(ring.el);
    f.anims.push(
      tab.label.animate(
        [
          { transform: "translateY(0)" },
          { transform: "translateY(2.5px)", offset: 0.2 },
          { transform: "translateY(-1.5px)", offset: 0.5 },
          { transform: "translateY(0.5px)", offset: 0.75 },
          { transform: "translateY(0)" },
        ],
        { duration: 380, delay, easing: "ease-out" },
      ),
    );
    const dataNow = this.#arrived === to;
    this.#landing = { tab: to, at: now() + delay, dataSent: dataNow };
    if (dataNow) {
      for (const a of this.#sendData(to, delay + DATA_GAP)) f.anims.push(a);
    }
  }

  /** A Data from `tab`'s underline home into the lower harpoon. Fire and forget. */
  #sendData(to: number, delay: number): Animation[] {
    const tab = this.#tabs()[to];
    if (!tab) return [];
    const from = this.#lineCentre(tab);
    const start = { x: from.x, y: from.y - 1 };
    const home = this.#port("data");
    // Home under the labels (the lower lane, like the lower harpoon), rising into its tail.
    const low = this.#lowLane();
    const curve: Curve = [
      start,
      { x: start.x - Math.max(16, 0.35 * (start.x - home.x)), y: low - 4 },
      { x: home.x + 20, y: low + 6 },
      home,
    ];
    const path: Path = {
      curve,
      ease: EASE_DATA,
      dur: this.#dur(Math.hypot(home.x - start.x, home.y - start.y)),
      pop: true,
      end: "absorb",
    };
    const f = this.#fly(path, "data", undefined, delay);
    return [...f.anims, ...this.#popHome(null, delay + path.dur)];
  }

  /** The lower harpoon pops and a yellow ring ripples as a Data comes home. */
  #popHome(f: Flight | null, delay: number): Animation[] {
    const harpoon = this.#p.mark.querySelector<SVGElement>('[data-harpoon="data"]');
    const out: Animation[] = [];
    if (harpoon) {
      out.push(
        harpoon.animate(
          [
            { transform: "scale(1)" },
            { transform: "scale(1.34, 1.2)", offset: 0.22 },
            { transform: "scale(0.9, 0.94)", offset: 0.52 },
            { transform: "scale(1.04, 1.02)", offset: 0.78 },
            { transform: "scale(1)" },
          ],
          { duration: 440, delay, easing: "ease-out" },
        ),
      );
    }
    const ring = this.#ring(this.#port("data"), "data", delay);
    out.push(ring.anim);
    if (f) {
      f.anims.push(...out);
      f.extras.push(ring.el);
    }
    return out;
  }

  /** The upper harpoon kicks back as an Interest leaves it. */
  #recoil(): void {
    const harpoon = this.#p.mark.querySelector<SVGElement>('[data-harpoon="interest"]');
    harpoon?.animate(
      [
        { transform: "translateX(0) scaleX(1)" },
        { transform: "translateX(-2.5px) scaleX(0.9)", offset: 0.2 },
        { transform: "translateX(1.2px) scaleX(1.04)", offset: 0.55 },
        { transform: "translateX(0) scaleX(1)" },
      ],
      { duration: 380, easing: "ease-out" },
    );
  }

  /** An expanding ring at `p`, after `delay`. */
  #ring(p: Pt, kind: "interest" | "data", delay: number): { el: HTMLElement; anim: Animation } {
    const el = this.#el("tab-ring", kind);
    const anim = el.animate(
      [
        { transform: `${at(p)} scale(0.45)`, opacity: 0.95 },
        { transform: `${at(p)} scale(2.5)`, opacity: 0 },
      ],
      { duration: 480, delay, easing: "cubic-bezier(0.16, 1, 0.3, 1)" },
    );
    this.#reap(anim, el);
    return { el, anim };
  }

  // ---------------------------------------------------------------- underline

  /** Show the underline settled at `tab` (or hide it), no motion. */
  #placeLine(tab: number | null): void {
    const u = this.#p.underline;
    this.#lineAnim?.cancel();
    this.#lineAnim = null;
    this.#lineAt = tab;
    const t = tab === null ? undefined : this.#tabs()[tab];
    if (!t) {
      u.style.opacity = "0";
      return;
    }
    const b = this.#lineBox(t);
    u.style.width = `${b.w}px`;
    u.style.transform = `translateX(${r2(b.x)}px)`;
    u.style.opacity = "1";
  }

  /** The underline lands at `to` after `delay`: a blob that spreads and wobbles. */
  #splat(to: number, box: { x: number; w: number }, delay: number): void {
    const u = this.#p.underline;
    this.#lineAnim?.cancel();
    u.style.opacity = "0";
    u.style.width = `${box.w}px`;
    this.#lineAt = to;
    const anim = u.animate(splatFrames(box.x, box.w), {
      duration: 500,
      delay,
      easing: "linear",
      fill: "forwards",
    });
    this.#lineAnim = anim;
    anim.finished.then(
      () => {
        if (this.#lineAnim !== anim) return;
        this.#placeLine(to);
      },
      () => undefined,
    );
  }

  /** The underline leaves the tab it was on: a ghost of it winds up and shrinks away. */
  #retractLine(): void {
    const u = this.#p.underline;
    if (this.#lineAt === null) return;
    const cs = getComputedStyle(u);
    const opacity = Number(cs.opacity);
    const transform = cs.transform;
    this.#lineAnim?.cancel();
    this.#lineAnim = null;
    this.#lineAt = null;
    u.style.opacity = "0";
    if (!(opacity > 0.02) || transform === "none") return;
    const ghost = u.cloneNode() as HTMLElement;
    ghost.style.transform = transform;
    ghost.style.opacity = String(opacity);
    this.#p.layer.append(ghost);
    const anim = ghost.animate(
      [
        { transform, opacity },
        { transform: `${transform} scale(1.08, 1.3)`, opacity, offset: 0.3 },
        { transform: `${transform} scale(0.04, 0.6)`, opacity: 0 },
      ],
      { duration: 220, easing: "cubic-bezier(0.5, 0, 0.75, 0)", fill: "forwards" },
    );
    this.#reap(anim, ghost);
  }

  /** Reduced motion: the old underline fades out and the new one fades in, in place. */
  #fadeLine(to: number | null): void {
    const u = this.#p.underline;
    if (this.#lineAt !== null) {
      const ghost = u.cloneNode() as HTMLElement;
      ghost.style.transform = getComputedStyle(u).transform;
      this.#p.layer.append(ghost);
      const a = ghost.animate([{ opacity: 1 }, { opacity: 0 }], {
        duration: 160,
        easing: "ease-out",
        fill: "forwards",
      });
      this.#reap(a, ghost);
    }
    this.#placeLine(to);
    if (to !== null) u.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: "ease-out" });
  }

  // ---------------------------------------------------------------- labels

  /** Light the label of `to` when the Interest lands (`delay` ms from now); dim the others now. */
  #markTabs(to: number | null, delay: number): void {
    this.#tabs().forEach((t, i) => {
      const on = i === to;
      t.link.style.setProperty("--on-delay", on ? `${Math.round(delay)}ms` : "0ms");
      if (on) t.link.dataset.on = "";
      else delete t.link.dataset.on;
    });
  }
}

/** The document timeline's clock (ms), the one WAAPI delays run on. */
function now(): number {
  const t = document.timeline.currentTime;
  return typeof t === "number" ? t : performance.now();
}
