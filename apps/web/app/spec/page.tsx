import { permanentRedirect } from "next/navigation";

/**
 * The spec and the docs are one area: `/spec` is kept as a permanent redirect to the protocol
 * page, which renders `spec/01-protocol.md` (ADR-022).
 */
export default function SpecPage() {
  permanentRedirect("/docs/protocol");
}
