"use client";

import { createContext, type ReactNode, useContext } from "react";
import { createPortal } from "react-dom";
import type { Rect, SandboxMode, WindowId } from "@/lib/sandbox/layout";

/** Places in the shell a mode fills: the sidebar body, the stage, its status cluster, each window. */
export type SlotName = "controls" | "stage" | "status" | `win:${WindowId}` | `hint:${WindowId}`;

/** What the observatory shell offers the mode running inside it. */
export interface WorkspaceApi {
  mode: SandboxMode;
  /** Phone layout: the stage on top, the windows as tabs of a sheet below. */
  phone: boolean;
  /** Stage size (CSS px). */
  stage: { w: number; h: number };
  /** The part of the stage the open windows leave to the network (stage px). */
  area: Rect;
  /** Mounted slot elements. */
  slots: Partial<Record<SlotName, HTMLElement>>;
  isOpen(id: WindowId): boolean;
  /** Open a window (or show its tab on a phone) and bring it to the front. */
  reveal(id: WindowId): void;
}

const Ctx = createContext<WorkspaceApi | null>(null);

/** Provides the shell's API to the mode components. */
export function WorkspaceProvider({ value, children }: { value: WorkspaceApi; children: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** The observatory shell around this mode. */
export function useWorkspace(): WorkspaceApi {
  const ws = useContext(Ctx);
  if (!ws) throw new Error("useWorkspace outside the observatory");
  return ws;
}

/** True when a key event comes from a text field, where shortcut keys must type instead. */
export function isTyping(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null;
  if (!el) return false;
  return (
    el.isContentEditable ||
    el.tagName === "TEXTAREA" ||
    el.tagName === "SELECT" ||
    (el.tagName === "INPUT" &&
      !["checkbox", "radio", "range", "button"].includes((el as HTMLInputElement).type))
  );
}

/**
 * Render `children` into one of the shell's slots (a portal), once the slot exists. A closed window
 * has no slot, so its content is not rendered at all.
 */
export function Slot({ name, children }: { name: SlotName; children: ReactNode }) {
  const el = useWorkspace().slots[name];
  return el ? createPortal(children, el) : null;
}
