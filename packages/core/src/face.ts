import type { Clock } from "./clock";
import type { IdemWireErrorCode } from "./errors";
import type { JsonValue } from "./jcs";
import type { CallToolResult, Data, Interest } from "./types";

/**
 * Packets exchanged between IDEM nodes. Only `interest` and `data` are protocol objects; the
 * other fields (`nonce` on Data and Nack, `auth`) are hop-by-hop and unsigned (protocol §7.1).
 *
 * - `interest`: request for a name. `auth` is the end user's opaque credential, carried to the
 *   producer like an HTTP `Authorization` header; it is never a cache key.
 * - `data`: answer to the Interest with `nonce` on this hop.
 * - `nack`: negative answer to the Interest (or call) whose nonce (or id) is `nonce`.
 * - `call` / `result`: plain MCP `tools/call` passthrough for non-cacheable tools (bypass).
 *
 * Packets are immutable once sent: nodes copy, never mutate.
 */
export type Packet =
  | { type: "interest"; interest: Interest; auth?: string }
  | { type: "data"; nonce: string; data: Data }
  | { type: "nack"; nonce: string; name?: string; code: IdemWireErrorCode; message?: string }
  | {
      type: "call";
      id: string;
      producer: string;
      tool: string;
      args: JsonValue;
      auth?: string;
      lifetimeMs?: number;
    }
  | { type: "result"; id: string; result: CallToolResult };

/** Link abstraction. The HTTP gateway, the simulator and the sandbox each implement their own. */
export interface Face {
  readonly id: string;
  send(p: Packet): void;
  /** Register the receive callback. If it returns a promise, transports may await it. */
  onReceive(cb: (p: Packet) => void | Promise<void>): void;
  close(): void;
}

/**
 * A pair of connected faces whose deliveries are scheduled on `clock` after `latencyMs`.
 * With a {@link VirtualClock} the receiver's handler is awaited before the next event runs.
 * Intended for tests and simple simulations (`@idem/sim` adds loss and bandwidth).
 */
export function linkFaces(clock: Clock, opts: { a: string; b: string; latencyMs?: number }): [Face, Face] {
  const latency = opts.latencyMs ?? 0;
  const make = (
    id: string,
  ): Face & { deliver?: (p: Packet) => void | Promise<void>; closed: boolean; peer?: Face } => {
    const face = {
      id,
      closed: false,
      deliver: undefined as ((p: Packet) => void | Promise<void>) | undefined,
      peer: undefined as
        | (Face & { deliver?: (p: Packet) => void | Promise<void>; closed: boolean })
        | undefined,
      send(p: Packet) {
        const peer = face.peer;
        if (face.closed || !peer) return;
        clock.setTimeout(() => (peer.closed ? undefined : peer.deliver?.(p)), latency);
      },
      onReceive(cb: (p: Packet) => void | Promise<void>) {
        face.deliver = cb;
      },
      close() {
        face.closed = true;
      },
    };
    return face;
  };
  const a = make(opts.a);
  const b = make(opts.b);
  a.peer = b;
  b.peer = a;
  return [a, b];
}
