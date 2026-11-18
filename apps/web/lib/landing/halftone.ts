"use client";

import { claimContext, currentTexture, type Gpu, getGpu, releaseContext, validated } from "../gpu/device";
import type { Palette } from "../theme-colors";

/**
 * The hero's backdrop, in the site's cartoon style: a halftone of flat ink dots on a staggered
 * grid, the same dots the globe's territories are printed with. Their sizes follow slow waves,
 * posterized into a few steps like a print, and the dots under the pointer swell in a darker gray (the caller eases
 * the pointer with a springy follow). No gradients, no glow: every pixel is either the page or ink.
 * Quiet behind the words on the left, gone at the bottom so the hero has no edge. Only the dots are
 * painted; between them the canvas is clear.
 *
 * WebGPU only; without it the caller keeps the plain page background.
 */
const WGSL = /* wgsl */ `
struct U {
  res: vec2f,
  time: f32,
  dark: f32,
  pointer: vec2f,
  press: f32,
  spacing: f32,
  bg: vec4f,
  ink: vec4f,
  accent: vec4f,
  // The theme switch's circle (lib/theme-reveal.ts): the second palette inside it.
  bg2: vec4f,
  ink2: vec4f,
  mask: vec4f, // x, y, radius (device pixels), 1 when on
  extra: vec4f, // x: the second palette is dark
};
@group(0) @binding(0) var<uniform> u: U;

@vertex
fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  var p = array<vec2f, 3>(vec2f(-1.0, -3.0), vec2f(-1.0, 1.0), vec2f(3.0, 1.0));
  return vec4f(p[i], 0.0, 1.0);
}

fn hash21(p: vec2f) -> f32 {
  var q = fract(p * vec2f(123.34, 456.21));
  q += dot(q, q + 45.32);
  return fract(q.x * q.y);
}

fn vnoise(p: vec2f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let w = f * f * (3.0 - 2.0 * f);
  let a = hash21(i);
  let b = hash21(i + vec2f(1.0, 0.0));
  let c = hash21(i + vec2f(0.0, 1.0));
  let d = hash21(i + vec2f(1.0, 1.0));
  return mix(mix(a, b, w.x), mix(c, d, w.x), w.y);
}

// Slow waves: two crossing swells bent by a little noise, 0..1.
fn wave(q: vec2f, t: f32) -> f32 {
  let n = vnoise(q * 1.4 + vec2f(t * 0.05, -t * 0.03));
  let a = sin(dot(q, vec2f(2.3, 1.1)) - t * 0.35 + n * 2.6);
  let b = sin(dot(q, vec2f(-1.2, 2.0)) + t * 0.22 + n * 1.8);
  return clamp(0.5 + 0.28 * a + 0.22 * b, 0.0, 1.0);
}

// One dot in a palette, premultiplied: its ink where the dot covers the pixel, clear elsewhere
// (the page's own background shows through, so the canvas can sit above the page while the theme
// switches without hiding it).
fn paint(bg: vec3f, inkc: vec3f, dark: f32, level: f32, swell: f32, edge: f32) -> vec4f {
  let amount = select(0.16, 0.13, dark < 0.5);
  var ink = mix(bg, inkc, amount + 0.1 * level);
  // Under the pointer the dots swell in a darker gray ink, no color.
  ink = mix(ink, mix(bg, inkc, 0.42), smoothstep(0.35, 0.8, swell));
  return vec4f(ink * edge, edge);
}

@fragment
fn fs(@builtin(position) frag: vec4f) -> @location(0) vec4f {
  let s = u.spacing;
  // Staggered grid: every other row shifts half a cell, as in a print halftone.
  let row = floor(frag.y / s);
  let shift = select(0.0, 0.5 * s, (i32(row) & 1) == 1);
  let col = floor((frag.x - shift) / s);
  let c = vec2f((col + 0.5) * s + shift, (row + 0.5) * s);
  let uv = c / u.res;
  let q = vec2f(uv.x * u.res.x / u.res.y, uv.y) * 2.0;

  // Posterized: four flat steps, never a smooth ramp.
  let level = floor(wave(q, u.time) * 4.0) / 3.0;
  var radius = s * (0.06 + 0.17 * level);

  // The pointer swells the dots around it.
  let d = distance(c, u.pointer) / (s * 7.0);
  let swell = u.press * exp(-d * d);
  radius += s * 0.2 * swell;

  // Quiet behind the words, gone at the bottom.
  radius *= mix(0.2, 1.0, smoothstep(0.3, 0.64, uv.x));
  radius *= 1.0 - smoothstep(0.7, 0.98, uv.y);

  let edge = clamp(radius - distance(frag.xy, c) + 0.5, 0.0, 1.0);
  var shade = paint(u.bg.rgb, u.ink.rgb, u.dark, level, swell, edge);
  if (u.mask.w > 0.5) {
    let inside = clamp(0.5 - (distance(frag.xy, u.mask.xy) - u.mask.z), 0.0, 1.0);
    shade = mix(shade, paint(u.bg2.rgb, u.ink2.rgb, u.extra.x, level, swell, edge), inside);
  }
  return shade;
}
`;

/** Floats in the uniform block (`U` above), padded to 16-byte rows. */
const UNIFORM_FLOATS = 36;

export interface HalftoneFrame {
  time: number;
  /** Pointer in canvas pixels. */
  pointer: [number, number];
  /** 0..1 (may overshoot a little): how much the dots under the pointer swell. */
  press: number;
}

/** The theme switch's circle over the canvas: `to` inside it, the frame's palette outside. */
export interface HalftoneReveal {
  /** Centre and radius in CSS pixels, relative to the canvas. */
  x: number;
  y: number;
  r: number;
  to: Palette;
}

export class Halftone {
  readonly #gpu: Gpu;
  readonly #ctx: GPUCanvasContext;
  readonly #pipeline: GPURenderPipeline;
  readonly #buffer: GPUBuffer;
  readonly #bind: GPUBindGroup;
  readonly #u = new Float32Array(UNIFORM_FLOATS);
  #w = 1;
  #h = 1;
  #dpr = 1;

  private constructor(gpu: Gpu, ctx: GPUCanvasContext, pipeline: GPURenderPipeline) {
    this.#gpu = gpu;
    this.#ctx = ctx;
    this.#pipeline = pipeline;
    this.#buffer = gpu.device.createBuffer({
      size: UNIFORM_FLOATS * 4,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.#bind = gpu.device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.#buffer } }],
    });
    claimContext(ctx, gpu, this);
  }

  /** A halftone on `canvas`, or `null` without WebGPU (the page background shows instead). */
  static async create(canvas: HTMLCanvasElement): Promise<Halftone | null> {
    const gpu = await getGpu();
    if (!gpu) return null;
    const pipeline = await validated(gpu, "halftone", (device) => {
      const module = device.createShaderModule({ code: WGSL, label: "halftone" });
      return device.createRenderPipeline({
        label: "halftone",
        layout: "auto",
        vertex: { module, entryPoint: "vs" },
        fragment: { module, entryPoint: "fs", targets: [{ format: gpu.format }] },
        primitive: { topology: "triangle-list" },
      });
    });
    const ctx = canvas.getContext("webgpu");
    if (!pipeline || !ctx) return null;
    return new Halftone(gpu, ctx, pipeline);
  }

  /** Canvas size in device pixels, and the device-pixel ratio (the grid is set in CSS pixels). */
  resize(w: number, h: number, dpr: number): void {
    this.#w = Math.max(1, w);
    this.#h = Math.max(1, h);
    this.#dpr = dpr;
  }

  draw(f: HalftoneFrame, pal: Palette, reveal?: HalftoneReveal): void {
    const tex = currentTexture(this.#ctx, this.#gpu, this);
    if (!tex) return;
    const u = this.#u;
    const k = this.#dpr;
    u.set([this.#w, this.#h, f.time, pal.dark ? 1 : 0, f.pointer[0] * k, f.pointer[1] * k, f.press, 16 * k]);
    u.set(pal.bg, 8);
    u.set(pal.fg, 12);
    u.set(pal.interest, 16);
    const to = reveal?.to ?? pal;
    u.set(to.bg, 20);
    u.set(to.fg, 24);
    u.set(reveal ? [reveal.x * k, reveal.y * k, Math.max(0, reveal.r) * k, 1] : [0, 0, 0, 0], 28);
    u.set([to.dark ? 1 : 0, 0, 0, 0], 32);
    const { device } = this.#gpu;
    device.queue.writeBuffer(this.#buffer, 0, u);
    const enc = device.createCommandEncoder({ label: "halftone" });
    const pass = enc.beginRenderPass({
      colorAttachments: [
        { view: tex.createView(), loadOp: "clear", storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: 0 } },
      ],
    });
    pass.setPipeline(this.#pipeline);
    pass.setBindGroup(0, this.#bind);
    pass.draw(3);
    pass.end();
    device.queue.submit([enc.finish()]);
  }

  destroy(): void {
    this.#buffer.destroy();
    releaseContext(this.#ctx, this);
  }
}
