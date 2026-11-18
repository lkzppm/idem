"use client";

import { useSyncExternalStore } from "react";
import { gpuGeneration, onGpuLost } from "../gpu/device";

/**
 * The page's WebGPU device generation: it goes up each time the shared device is lost. Put it in the
 * dependencies of the effect that creates a renderer, so the stale renderer is destroyed and a new
 * one is created on the next device. Always 0 on the server.
 */
export function useGpuGeneration(): number {
  return useSyncExternalStore(onGpuLost, gpuGeneration, () => 0);
}
