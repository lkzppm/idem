"use client";

import {
  claimContext,
  currentTexture,
  framesHeld,
  type Gpu,
  getGpu,
  releaseContext,
  validated,
} from "../gpu/device";
import type { Rgba } from "../theme-colors";

/**
 * Instanced signed-distance shapes. Every primitive of the topology view (nodes, links, packets,
 * flashes, trails) is one of four shapes, so one instanced draw call renders a frame on WebGPU,
 * and the same list renders on Canvas2D when WebGPU is missing.
 *
 * Instance layout (12 floats): `x0 y0 x1 y1 | r kind glow stroke | r g b a`
 * - kind 0 `capsule`: segment (x0,y0)–(x1,y1) with radius r; a circle when both ends coincide.
 * - kind 1 `ring`: outline of the capsule, `stroke` wide.
 * - kind 2 `box`: rounded box, center (x0,y0), half extents (x1,y1), corner radius r.
 * - kind 3 `boxOutline`: outline of the box, `stroke` wide.
 * Coordinates are CSS pixels; colors are straight (non-premultiplied) RGBA.
 */
export const FLOATS_PER_INSTANCE = 12;

export class InstanceList {
  data = new Float32Array(FLOATS_PER_INSTANCE * 256);
  count = 0;

  clear(): void {
    this.count = 0;
  }

  #push(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    r: number,
    kind: number,
    glow: number,
    stroke: number,
    c: Rgba,
    alpha: number,
  ): void {
    if ((this.count + 1) * FLOATS_PER_INSTANCE > this.data.length) {
      const next = new Float32Array(this.data.length * 2);
      next.set(this.data);
      this.data = next;
    }
    const o = this.count * FLOATS_PER_INSTANCE;
    const d = this.data;
    d[o] = x0;
    d[o + 1] = y0;
    d[o + 2] = x1;
    d[o + 3] = y1;
    d[o + 4] = r;
    d[o + 5] = kind;
    d[o + 6] = glow;
    d[o + 7] = stroke;
    d[o + 8] = c[0];
    d[o + 9] = c[1];
    d[o + 10] = c[2];
    d[o + 11] = c[3] * alpha;
    this.count++;
  }

  circle(x: number, y: number, r: number, c: Rgba, alpha = 1, glow = 0): void {
    this.#push(x, y, x, y, r, 0, glow, 0, c, alpha);
  }
  ring(x: number, y: number, r: number, stroke: number, c: Rgba, alpha = 1, glow = 0): void {
    this.#push(x, y, x, y, r, 1, glow, stroke, c, alpha);
  }
  capsule(x0: number, y0: number, x1: number, y1: number, r: number, c: Rgba, alpha = 1, glow = 0): void {
    this.#push(x0, y0, x1, y1, r, 0, glow, 0, c, alpha);
  }
  /** Outline of a capsule (a stretched ring), `stroke` wide. */
  capsuleOutline(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    r: number,
    stroke: number,
    c: Rgba,
    alpha = 1,
  ): void {
    this.#push(x0, y0, x1, y1, r, 1, 0, stroke, c, alpha);
  }
  box(cx: number, cy: number, hw: number, hh: number, radius: number, c: Rgba, alpha = 1, glow = 0): void {
    this.#push(cx, cy, hw, hh, radius, 2, glow, 0, c, alpha);
  }
  boxOutline(
    cx: number,
    cy: number,
    hw: number,
    hh: number,
    radius: number,
    stroke: number,
    c: Rgba,
    alpha = 1,
    glow = 0,
  ): void {
    this.#push(cx, cy, hw, hh, radius, 3, glow, stroke, c, alpha);
  }
}

const WGSL = /* wgsl */ `
struct U { res: vec2f, dpr: f32, glowScale: f32, mask: vec4f };
@group(0) @binding(0) var<uniform> u: U;

struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) p: vec2f,
  @location(1) @interpolate(flat) a: vec4f,
  @location(2) @interpolate(flat) b: vec4f,
  @location(3) @interpolate(flat) color: vec4f,
};

@vertex
fn vs(@builtin(vertex_index) vi: u32, @location(0) a: vec4f, @location(1) b: vec4f, @location(2) color: vec4f) -> VOut {
  var corners = array<vec2f, 6>(vec2f(0.0, 0.0), vec2f(1.0, 0.0), vec2f(0.0, 1.0), vec2f(0.0, 1.0), vec2f(1.0, 0.0), vec2f(1.0, 1.0));
  let c = corners[vi];
  let margin = select(2.0, 30.0, b.z > 0.0) + b.w;
  var lo: vec2f;
  var hi: vec2f;
  if (b.y < 1.5) {
    lo = min(a.xy, a.zw) - vec2f(b.x + margin);
    hi = max(a.xy, a.zw) + vec2f(b.x + margin);
  } else {
    lo = a.xy - a.zw - vec2f(margin);
    hi = a.xy + a.zw + vec2f(margin);
  }
  let p = mix(lo, hi, c);
  let ndc = p / u.res * 2.0 - 1.0;
  var o: VOut;
  o.pos = vec4f(ndc.x, -ndc.y, 0.0, 1.0);
  o.p = p;
  o.a = a;
  o.b = b;
  o.color = color;
  return o;
}

fn sdSeg(p: vec2f, a: vec2f, b: vec2f) -> f32 {
  let pa = p - a;
  let ba = b - a;
  let h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
  return length(pa - ba * h);
}

fn sdBox(p: vec2f, c: vec2f, half: vec2f, r: f32) -> f32 {
  let q = abs(p - c) - half + vec2f(r);
  return length(max(q, vec2f(0.0))) + min(max(q.x, q.y), 0.0) - r;
}

@fragment
fn fs(i: VOut) -> @location(0) vec4f {
  let kind = i.b.y;
  var d: f32;
  if (kind < 1.5) {
    d = sdSeg(i.p, i.a.xy, i.a.zw) - i.b.x;
  } else {
    d = sdBox(i.p, i.a.xy, i.a.zw, i.b.x);
  }
  if ((kind > 0.5 && kind < 1.5) || kind > 2.5) {
    d = abs(d) - i.b.w * 0.5;
  }
  let coverage = clamp(0.5 - d * u.dpr, 0.0, 1.0);
  // Faded out before the edge of the instance's quad, so no glow shows a square edge.
  let glow = i.b.z * u.glowScale * exp(-max(d, 0.0) / 9.0) * 0.55 * smoothstep(27.0, 12.0, d);
  var alpha = i.color.a * max(coverage, glow);
  // Optional circle mask: x, y, radius, and +1 keeps the inside, -1 the outside.
  if (u.mask.w != 0.0) {
    let m = clamp(0.5 - (length(i.p - u.mask.xy) - u.mask.z) * u.dpr, 0.0, 1.0);
    alpha *= select(1.0 - m, m, u.mask.w > 0.0);
  }
  return vec4f(i.color.rgb * alpha, alpha);
}
`;

/** A circle that limits a layer to its inside, or to its outside. CSS pixels. */
export interface CircleMask {
  x: number;
  y: number;
  r: number;
  keep: "inside" | "outside";
}

/** One list of shapes, optionally masked; layers draw in order into the same frame. */
export interface Layer {
  list: InstanceList;
  mask?: CircleMask;
}

interface Backend {
  readonly kind: "webgpu" | "canvas2d";
  resize(w: number, h: number, dpr: number): void;
  draw(layers: readonly Layer[], glowScale: number): void;
  destroy(): void;
}

/** Compile the shape pipeline. Needs no canvas, so it can be validated first. */
function shapesPipeline(device: GPUDevice, format: GPUTextureFormat): GPURenderPipeline {
  const module = device.createShaderModule({ label: "shapes", code: WGSL });
  return device.createRenderPipeline({
    layout: "auto",
    vertex: {
      module,
      entryPoint: "vs",
      buffers: [
        {
          arrayStride: FLOATS_PER_INSTANCE * 4,
          stepMode: "instance",
          attributes: [
            { shaderLocation: 0, offset: 0, format: "float32x4" },
            { shaderLocation: 1, offset: 16, format: "float32x4" },
            { shaderLocation: 2, offset: 32, format: "float32x4" },
          ],
        },
      ],
    },
    fragment: {
      module,
      entryPoint: "fs",
      targets: [
        {
          format,
          blend: {
            color: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
            alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
          },
        },
      ],
    },
    primitive: { topology: "triangle-list" },
  });
}

class GpuBackend implements Backend {
  readonly kind = "webgpu" as const;
  readonly #gpu: Gpu;
  readonly #ctx: GPUCanvasContext;
  readonly #pipeline: GPURenderPipeline;
  /** One uniform buffer and bind group per layer, made as layers are first used. */
  readonly #uniforms: { buffer: GPUBuffer; bind: GPUBindGroup }[] = [];
  #instances: GPUBuffer;
  #capacity = 1024;
  #w = 1;
  #h = 1;
  #dpr = 1;

  constructor(gpu: Gpu, canvas: HTMLCanvasElement, pipeline: GPURenderPipeline) {
    this.#gpu = gpu;
    const ctx = canvas.getContext("webgpu");
    if (!ctx) throw new Error("no webgpu context");
    this.#ctx = ctx;
    claimContext(ctx, gpu, this);
    this.#pipeline = pipeline;
    this.#instances = this.#makeInstances(this.#capacity);
  }

  #makeInstances(n: number): GPUBuffer {
    return this.#gpu.device.createBuffer({
      size: n * FLOATS_PER_INSTANCE * 4,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
  }

  #uniform(i: number): { buffer: GPUBuffer; bind: GPUBindGroup } {
    let u = this.#uniforms[i];
    if (!u) {
      const buffer = this.#gpu.device.createBuffer({
        size: 32,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      const bind = this.#gpu.device.createBindGroup({
        layout: this.#pipeline.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer } }],
      });
      u = { buffer, bind };
      this.#uniforms[i] = u;
    }
    return u;
  }

  resize(w: number, h: number, dpr: number): void {
    this.#w = w;
    this.#h = h;
    this.#dpr = dpr;
  }

  draw(layers: readonly Layer[], glowScale: number): void {
    const target = currentTexture(this.#ctx, this.#gpu, this);
    if (!target) return; // canvas owned by a newer renderer, or device lost: skip this frame
    const { device } = this.#gpu;
    const total = layers.reduce((n, l) => n + l.list.count, 0);
    if (total > this.#capacity) {
      this.#instances.destroy();
      while (this.#capacity < total) this.#capacity *= 2;
      this.#instances = this.#makeInstances(this.#capacity);
    }
    // Every layer's instances go into one buffer, back to back; each layer has its own uniforms.
    let first = 0;
    const spans = layers.map((l, i) => {
      const m = l.mask;
      device.queue.writeBuffer(
        this.#uniform(i).buffer,
        0,
        new Float32Array([
          this.#w,
          this.#h,
          this.#dpr,
          glowScale,
          m?.x ?? 0,
          m?.y ?? 0,
          m?.r ?? 0,
          m ? (m.keep === "inside" ? 1 : -1) : 0,
        ]),
      );
      if (l.list.count > 0) {
        device.queue.writeBuffer(
          this.#instances,
          first * FLOATS_PER_INSTANCE * 4,
          l.list.data.buffer,
          0,
          l.list.count * FLOATS_PER_INSTANCE * 4,
        );
      }
      const span = { first, count: l.list.count };
      first += l.list.count;
      return span;
    });
    const enc = device.createCommandEncoder();
    const pass = enc.beginRenderPass({
      colorAttachments: [
        {
          view: target.createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    });
    if (total > 0) {
      pass.setPipeline(this.#pipeline);
      pass.setVertexBuffer(0, this.#instances);
      spans.forEach((sp, i) => {
        if (sp.count === 0) return;
        pass.setBindGroup(0, this.#uniform(i).bind);
        pass.draw(6, sp.count, 0, sp.first);
      });
    }
    pass.end();
    device.queue.submit([enc.finish()]);
  }

  destroy(): void {
    this.#instances.destroy();
    for (const u of this.#uniforms) u.buffer.destroy();
    releaseContext(this.#ctx, this);
  }
}

class Canvas2DBackend implements Backend {
  readonly kind = "canvas2d" as const;
  readonly #canvas: HTMLCanvasElement;
  readonly #ctx: CanvasRenderingContext2D;
  #w = 1;
  #h = 1;
  #dpr = 1;

  constructor(canvas: HTMLCanvasElement) {
    this.#canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d context");
    this.#ctx = ctx;
  }

  resize(w: number, h: number, dpr: number): void {
    this.#w = w;
    this.#h = h;
    this.#dpr = dpr;
  }

  draw(layers: readonly Layer[], glowScale: number): void {
    if (framesHeld()) return;
    const c = this.#ctx;
    c.setTransform(this.#dpr, 0, 0, this.#dpr, 0, 0);
    c.clearRect(0, 0, this.#w, this.#h);
    for (const { list, mask } of layers) {
      c.save();
      if (mask) {
        c.beginPath();
        if (mask.keep === "outside") c.rect(0, 0, this.#w, this.#h);
        c.arc(mask.x, mask.y, Math.max(0, mask.r), 0, Math.PI * 2);
        c.clip("evenodd");
      }
      this.#paint(list, glowScale);
      c.restore();
    }
    void this.#canvas;
  }

  #paint(list: InstanceList, glowScale: number): void {
    const c = this.#ctx;
    const d = list.data;
    for (let i = 0; i < list.count; i++) {
      const o = i * FLOATS_PER_INSTANCE;
      const f = (k: number) => d[o + k] ?? 0;
      const x0 = f(0);
      const y0 = f(1);
      const x1 = f(2);
      const y1 = f(3);
      const r = f(4);
      const kind = f(5);
      const glow = f(6);
      const stroke = f(7);
      const color = `rgba(${Math.round(f(8) * 255)}, ${Math.round(f(9) * 255)}, ${Math.round(f(10) * 255)}, ${f(11)})`;
      c.shadowBlur = glow > 0 ? 12 * glow * glowScale : 0;
      c.shadowColor = color;
      c.fillStyle = color;
      c.strokeStyle = color;
      if (kind === 0) {
        if (x0 === x1 && y0 === y1) {
          c.beginPath();
          c.arc(x0, y0, r, 0, Math.PI * 2);
          c.fill();
        } else {
          c.lineCap = "round";
          c.lineWidth = r * 2;
          c.beginPath();
          c.moveTo(x0, y0);
          c.lineTo(x1, y1);
          c.stroke();
        }
      } else if (kind === 1) {
        c.lineWidth = stroke;
        c.beginPath();
        if (x0 === x1 && y0 === y1) c.arc(x0, y0, Math.max(0, r), 0, Math.PI * 2);
        else {
          // A stretched ring: two half circles joined by the segment's sides.
          const a = Math.atan2(y1 - y0, x1 - x0);
          c.arc(x1, y1, Math.max(0, r), a - Math.PI / 2, a + Math.PI / 2);
          c.arc(x0, y0, Math.max(0, r), a + Math.PI / 2, a + (3 * Math.PI) / 2);
          c.closePath();
        }
        c.stroke();
      } else {
        c.beginPath();
        c.roundRect(x0 - x1, y0 - y1, x1 * 2, y1 * 2, r);
        if (kind === 2) c.fill();
        else {
          c.lineWidth = stroke;
          c.stroke();
        }
      }
    }
    c.shadowBlur = 0;
  }

  destroy(): void {}
}

/** Renders an {@link InstanceList} on a canvas: WebGPU when available, Canvas2D otherwise. */
export class ShapeRenderer {
  readonly #backend: Backend;

  private constructor(backend: Backend) {
    this.#backend = backend;
  }

  /** Create a renderer. `preferGpu: false` forces the Canvas2D path. */
  static async create(canvas: HTMLCanvasElement, preferGpu = true): Promise<ShapeRenderer> {
    if (preferGpu) {
      const gpu = await getGpu();
      if (gpu) {
        // Validate before touching the canvas: a canvas with a "webgpu" context can never get a "2d" one.
        const pipeline = await validated(gpu, "shapes", (device) => shapesPipeline(device, gpu.format));
        if (pipeline) {
          try {
            return new ShapeRenderer(new GpuBackend(gpu, canvas, pipeline));
          } catch (e) {
            console.warn("[idem] WebGPU renderer failed, using Canvas2D:", e);
          }
        }
      }
    }
    return new ShapeRenderer(new Canvas2DBackend(canvas));
  }

  get backend(): "webgpu" | "canvas2d" {
    return this.#backend.kind;
  }

  resize(w: number, h: number, dpr: number): void {
    this.#backend.resize(w, h, dpr);
  }

  draw(list: InstanceList, glowScale = 1): void {
    this.#backend.draw([{ list }], glowScale);
  }

  /** Draw several lists into one frame, in order, each optionally limited by a circle. */
  drawLayers(layers: readonly Layer[], glowScale = 1): void {
    this.#backend.draw(layers, glowScale);
  }

  destroy(): void {
    this.#backend.destroy();
  }
}
