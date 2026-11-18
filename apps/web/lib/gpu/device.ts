"use client";

/** A WebGPU device shared by every canvas on the page (hero, sandbox panes). */
export interface Gpu {
  device: GPUDevice;
  format: GPUTextureFormat;
}

let pending: Promise<Gpu | null> | undefined;

/** How many devices were lost so far; renderers made before a loss are stale. */
let generation = 0;
const lostListeners = new Set<() => void>();
/**
 * After this many losses the page stops recreating renderers: a GPU that keeps dropping its device
 * would otherwise rebuild them in a loop. The stale renderers then just skip their frames.
 */
const MAX_RECOVERIES = 3;

/**
 * Number of device losses seen on this page. A renderer created at generation `g` is stale once
 * this is greater than `g` and should be destroyed and created again (`useGpuGeneration`).
 */
export function gpuGeneration(): number {
  return generation;
}

/**
 * Call `cb` after the shared device is lost (not on a deliberate `destroy()`), once the singleton
 * has been reset so that the next {@link getGpu} asks for a new device. Returns the unsubscribe.
 */
export function onGpuLost(cb: () => void): () => void {
  lostListeners.add(cb);
  return () => {
    lostListeners.delete(cb);
  };
}

/**
 * Acquire the shared device, or `null` when WebGPU is unavailable (no `navigator.gpu`, no adapter,
 * or a blocklisted GPU). Callers fall back to Canvas2D. A lost device resets the singleton so the
 * next caller tries again, and tells the {@link onGpuLost} listeners so live renderers recreate
 * themselves on the new device.
 */
export function getGpu(): Promise<Gpu | null> {
  if (pending) return pending;
  pending = (async () => {
    if (typeof navigator === "undefined" || !("gpu" in navigator) || !navigator.gpu) return null;
    try {
      const adapter = await navigator.gpu.requestAdapter({ powerPreference: "low-power" });
      if (!adapter) return null;
      const device = await adapter.requestDevice();
      void device.lost.then((info) => {
        pending = undefined;
        if (info.reason === "destroyed" || generation >= MAX_RECOVERIES) return;
        console.warn(
          `[idem] WebGPU device lost (${info.message || "no reason given"}), recreating renderers`,
        );
        generation++;
        for (const cb of lostListeners) cb();
      });
      return { device, format: navigator.gpu.getPreferredCanvasFormat() };
    } catch {
      return null;
    }
  })();
  return pending;
}

/** Device-pixel ratio, capped: beyond 2x the extra pixels cost more than they show. */
export function cappedDpr(cap = 2): number {
  return Math.min(cap, Math.max(1, typeof window === "undefined" ? 1 : window.devicePixelRatio || 1));
}

/*
 * Canvas context ownership.
 *
 * `canvas.getContext("webgpu")` returns the SAME context object every time for a given canvas, so two
 * engines created on one canvas (React Strict Mode mounts effects twice in dev; fast remounts in prod)
 * share it. Without ownership, the discarded engine's `unconfigure()` pulls the context out from under
 * the live one and its next `getCurrentTexture()` throws `InvalidStateError` (seen in Safari).
 */
const owners = new WeakMap<GPUCanvasContext, object>();

function configure(ctx: GPUCanvasContext, gpu: Gpu): void {
  ctx.configure({ device: gpu.device, format: gpu.format, alphaMode: "premultiplied" });
}

/** Configure `ctx` for `gpu` and make `owner` its owner. */
export function claimContext(ctx: GPUCanvasContext, gpu: Gpu, owner: object): void {
  configure(ctx, gpu);
  owners.set(ctx, owner);
}

/** Unconfigure `ctx` only if `owner` still owns it. A newer engine's configuration is left alone. */
export function releaseContext(ctx: GPUCanvasContext, owner: object): void {
  if (owners.get(ctx) !== owner) return;
  owners.delete(ctx);
  try {
    ctx.unconfigure();
  } catch {
    // already gone with its device
  }
}

let held = false;
const onRelease = new Set<() => void>();

/**
 * Hold every canvas's frames (`true`) or let them go again (`false`). The theme switch holds them
 * while its View Transition starts: in Safari a canvas presenting a frame between the old snapshot
 * and the new one put the half-switched page on screen for a frame (the "flash"). On release, each
 * subscriber draws once, so a canvas that is not animating still shows the new theme.
 */
export function holdFrames(on: boolean): void {
  if (held === on) return;
  held = on;
  if (!on) for (const cb of onRelease) cb();
}

/** Whether canvas frames are held right now (see `holdFrames`). */
export function framesHeld(): boolean {
  return held;
}

/** Call `cb` whenever held frames are released; returns the unsubscribe. */
export function onFramesReleased(cb: () => void): () => void {
  onRelease.add(cb);
  return () => onRelease.delete(cb);
}

/**
 * The texture to draw into this frame, or `null` to skip the frame: frames are held (`holdFrames`),
 * another engine owns the canvas,
 * or the context cannot be (re)configured (e.g. the device was lost). An orphaned context is
 * reclaimed and reconfigured instead of throwing.
 */
export function currentTexture(ctx: GPUCanvasContext, gpu: Gpu, owner: object): GPUTexture | null {
  if (held) return null;
  const current = owners.get(ctx);
  if (current !== undefined && current !== owner) return null;
  try {
    if (current === undefined) claimContext(ctx, gpu, owner);
    return ctx.getCurrentTexture();
  } catch {
    try {
      claimContext(ctx, gpu, owner);
      return ctx.getCurrentTexture();
    } catch {
      return null;
    }
  }
}

const validations = new Map<string, Promise<unknown>>();
const gpuOf = new WeakMap<Promise<unknown>, GPUDevice>();

/**
 * Run `build` (shader modules + pipelines) inside a WebGPU validation error scope and resolve with
 * its result, or `null` if WebGPU reported any error. WebGPU never throws on invalid WGSL: it hands
 * back invalid objects that silently draw nothing, so this is what lets callers fall back to
 * Canvas2D. Compiler messages are logged. Memoized per key and device.
 */
export function validated<T>(gpu: Gpu, key: string, build: (device: GPUDevice) => T): Promise<T | null> {
  const cached = validations.get(key) as Promise<T | null> | undefined;
  if (cached && gpuOf.get(cached) === gpu.device) return cached;
  const run = (async (): Promise<T | null> => {
    const { device } = gpu;
    device.pushErrorScope("validation");
    let result: T | undefined;
    try {
      result = build(device);
    } catch (e) {
      await device.popErrorScope();
      console.warn(`[idem] WebGPU ${key} failed, using Canvas2D:`, e);
      return null;
    }
    const error = await device.popErrorScope();
    if (error) {
      console.warn(`[idem] WebGPU ${key} is invalid, using Canvas2D:\n${error.message}`);
      return null;
    }
    return result;
  })();
  gpuOf.set(run, gpu.device);
  validations.set(key, run);
  return run;
}
