"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/**
 * Renders `children` except on the given routes (a route and everything under it). Lets the root
 * layout drop a piece of chrome on one page (the footer on the full-viewport sandbox) while the
 * piece itself stays a server component.
 */
export function HideOn({ routes, children }: { routes: readonly string[]; children: ReactNode }) {
  const path = usePathname();
  if (routes.some((r) => path === r || path.startsWith(`${r}/`))) return null;
  return children;
}
