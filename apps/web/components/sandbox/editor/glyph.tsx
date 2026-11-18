import type { NetNodeKind } from "@/lib/sandbox/network";

/** A node's shape as the stage draws it: a dot (agent), a box (forwarder), a box with a core (producer). */
export function NodeGlyph({ kind, size = 14 }: { kind: NetNodeKind | "link"; size?: number }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden="true" className="obs-glyph">
      {kind === "agent" && <circle cx="8" cy="8" r="4.2" className="obs-glyph-agent" />}
      {kind === "forwarder" && (
        <rect x="2.5" y="2.5" width="11" height="11" rx="3" className="obs-glyph-fwd" />
      )}
      {kind === "producer" && (
        <>
          <rect x="1.5" y="1.5" width="13" height="13" rx="3.4" className="obs-glyph-prod" />
          <rect x="5.5" y="5.5" width="5" height="5" rx="1.3" className="obs-glyph-core" />
        </>
      )}
      {kind === "link" && (
        <>
          <path d="M3.5 12.5l9-9" className="obs-glyph-link" />
          <circle cx="3.5" cy="12.5" r="2" className="obs-glyph-agent" />
          <circle cx="12.5" cy="3.5" r="2" className="obs-glyph-agent" />
        </>
      )}
    </svg>
  );
}
