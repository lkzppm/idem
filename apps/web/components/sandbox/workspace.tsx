"use client";

import { createContext, type ReactNode, useContext, useEffect } from "react";
import { createPortal } from "react-dom";
import type { Rect, SandboxMode, WindowId } from "@/lib/sandbox/layout";

/**
 * Places in the shell a mode fills: the sidebar body, the stage, the player bar over it, the card
 * on its right (the selection), and each panel of the dock (its body and its title hint).
 */
export type SlotName = "controls" | "stage" | "player" | "aside" | `win:${WindowId}` | `hint:${WindowId}`;

/** What the observatory shell offers the mode running inside it. */
export interface WorkspaceApi {
  mode: SandboxMode;
  /** Phone layout: the stage on top, the panels as tabs of a sheet below. */
  phone: boolean;
  /** Stage size (CSS px). */
  stage: { w: number; h: number };
  /** The part of the stage the dock leaves to the network (stage px). */
  area: Rect;
  /** Mounted slot elements. */
  slots: Partial<Record<SlotName, HTMLElement>>;
  isOpen(id: WindowId): boolean;
  /** Open a panel (or show its tab on a phone). */
  reveal(id: WindowId): void;
  /** The panels this mode fills; the dock shows a tab for these only. */
  setPanels(ids: readonly WindowId[]): void;
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

/**
 * Declare the panels the running mode has something to show in (by engine, network, attacks…). The
 * dock and the keys follow this list; the others' tabs are not drawn.
 */
export function usePanels(ids: readonly WindowId[]): void {
  const { setPanels } = useWorkspace();
  const key = ids.join();
  // `key` stands for the list, so a new array with the same panels does not set it again.
  useEffect(() => setPanels(ids), [key, setPanels]);
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
 * Render `children` into one of the shell's slots (a portal), once the slot exists. A closed panel
 * has no slot, so its content is not rendered at all.
 */
export function Slot({ name, children }: { name: SlotName; children: ReactNode }) {
  const el = useWorkspace().slots[name];
  return el ? createPortal(children, el) : null;
}
