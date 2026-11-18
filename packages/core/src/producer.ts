import { canonicalizeArgs } from "./canonical";
import type { Clock } from "./clock";
import { RealClock } from "./clock";
import { type IdemKeyPair, signData, signManifest, stripEphemeral } from "./crypto";
import { IdemError, type IdemWireErrorCode, isIdemError } from "./errors";
import type { Face, Packet } from "./face";
import { type JsonObject, type JsonValue, toJson } from "./jcs";
import { assertProducer, makeName, parseName, toolSchemaDigest } from "./name";
import type { Normalizer } from "./normalize";
import { assertSupportedSchema, type JsonSchema, validate } from "./schema";
import type {
  CallToolResult,
  Data,
  Interest,
  Manifest,
  ManifestKey,
  Scope,
  ToolIdentity,
  ToolPolicy,
} from "./types";

/** `_meta` keys used by the MCP binding (protocol §9.1, ADR-009). */
export const META_KEYS = {
  interest: "dev.idem/interest",
  data: "dev.idem/data",
  manifest: "dev.idem/manifest",
} as const;

/** Cache policy a producer declares for one tool. */
export interface ProducerToolPolicy {
  cacheable: boolean;
  ttlMs: number;
  scope: Scope;
  normalizers?: Record<string, Normalizer[]>;
}

/** Context passed to tool handlers. */
export interface ProducerContext {
  /** Opaque end-user credential, if the request carried one. */
  auth?: string;
  /** Producer clock time. */
  now: number;
}

/** A tool served by a {@link Producer}. */
export interface ProducerTool {
  name: string;
  description?: string;
  inputSchema: JsonSchema;
  outputSchema?: JsonSchema;
  /** MCP tool annotations. A cacheable tool MUST be `readOnlyHint: true` [P-6.1]. */
  annotations?: { readOnlyHint?: boolean; [k: string]: unknown };
  /** Bump when semantics change without a schema change [P-2.2]. Default `1`. */
  policyVersion?: number;
  /** Absent → not cacheable (always passthrough). */
  policy?: ProducerToolPolicy;
  handler(args: JsonValue, ctx: ProducerContext): CallToolResult | Promise<CallToolResult>;
}

/** What `tools/list` would report for a tool (the consumer-side view). */
export interface ToolInfo {
  name: string;
  description?: string;
  inputSchema: JsonSchema;
  outputSchema?: JsonSchema;
  annotations?: { readOnlyHint?: boolean; [k: string]: unknown };
}

/** Options of a {@link Producer}. */
export interface ProducerOptions {
  /** Producer component of the names, e.g. `demo.idem.dev`. */
  producer: string;
  key: IdemKeyPair;
  tools: ProducerTool[];
  clock?: Clock;
  /** Manifest version. Bump on every change, including key rotation. Default `1`. */
  manifestVersion?: number;
  /** Additional keys to list (e.g. during rotation). The signing key is always listed. */
  extraKeys?: ManifestKey[];
}

function errorResult(message: string): CallToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

/** Map any error to a code that may travel in a Nack. */
export function wireCode(e: unknown): IdemWireErrorCode {
  if (!isIdemError(e)) return "UPSTREAM_ERROR";
  switch (e.code) {
    case "DIGEST_MISMATCH":
    case "BAD_SIGNATURE":
    case "UNTRUSTED_KEY":
    case "NOT_CACHEABLE":
    case "TIMEOUT":
    case "HOP_LIMIT":
    case "LOOP":
    case "UPSTREAM_ERROR":
      return e.code;
    case "INVALID_ARGS":
    case "UNSUPPORTED_SCHEMA":
    case "BAD_NAME":
      return "NOT_CACHEABLE";
    default:
      return "UPSTREAM_ERROR";
  }
}

/**
 * Transport-agnostic IDEM producer: runs tools, names results itself [P-5.1] and signs them
 * (protocol §5). `@idem/mcp` wraps it for MCP servers; the simulator attaches it to a face.
 */
export class Producer {
  readonly producer: string;
  readonly #key: IdemKeyPair;
  readonly #tools: Map<string, ProducerTool>;
  readonly #clock: Clock;
  readonly #version: number;
  readonly #extraKeys: ManifestKey[];
  #manifest?: Promise<Manifest>;
  #policies?: Promise<Map<string, ToolPolicy>>;

  constructor(opts: ProducerOptions) {
    assertProducer(opts.producer);
    this.producer = opts.producer;
    this.#key = opts.key;
    this.#clock = opts.clock ?? new RealClock();
    this.#version = opts.manifestVersion ?? 1;
    this.#extraKeys = opts.extraKeys ?? [];
    this.#tools = new Map();
    for (const t of opts.tools) {
      if (t.name.startsWith("_"))
        throw new IdemError("BAD_POLICY", `tool "${t.name}" uses the reserved "_" prefix`);
      if (t.policy?.cacheable) {
        if (t.annotations?.readOnlyHint !== true) {
          throw new IdemError(
            "BAD_POLICY",
            `cacheable tool "${t.name}" must declare readOnlyHint: true [P-6.1]`,
          );
        }
        assertSupportedSchema(t.inputSchema); // [P-3.6]
      }
      this.#tools.set(t.name, t);
    }
  }

  /** The tool list as MCP `tools/list` would return it. */
  toolList(): ToolInfo[] {
    return [...this.#tools.values()].map((t) => ({
      name: t.name,
      ...(t.description !== undefined && { description: t.description }),
      inputSchema: t.inputSchema,
      ...(t.outputSchema !== undefined && { outputSchema: t.outputSchema }),
      ...(t.annotations !== undefined && { annotations: t.annotations }),
    }));
  }

  /** Naming identity of a tool. */
  identity(tool: string): ToolIdentity {
    const t = this.#tools.get(tool);
    if (!t) throw new IdemError("NOT_CACHEABLE", `unknown tool "${tool}"`);
    return {
      name: t.name,
      inputSchema: t.inputSchema,
      ...(t.outputSchema !== undefined && { outputSchema: t.outputSchema }),
      policyVersion: t.policyVersion ?? 1,
    };
  }

  #buildPolicies(): Promise<Map<string, ToolPolicy>> {
    this.#policies ??= (async () => {
      const out = new Map<string, ToolPolicy>();
      for (const t of this.#tools.values()) {
        const p = t.policy;
        out.set(t.name, {
          tool: t.name,
          schemaDigest: await toolSchemaDigest(this.identity(t.name)),
          cacheable: p?.cacheable ?? false,
          ttlMs: p?.cacheable ? p.ttlMs : 0,
          scope: p?.scope ?? "public",
          normalizers: p?.normalizers ?? {},
          policyVersion: t.policyVersion ?? 1,
        });
      }
      return out;
    })();
    return this.#policies;
  }

  /** The signed manifest (computed once). */
  manifest(): Promise<Manifest> {
    this.#manifest ??= (async () => {
      const policies = await this.#buildPolicies();
      const keys: ManifestKey[] = [
        { keyId: this.#key.keyId, publicKeyJwk: this.#key.publicKeyJwk },
        ...this.#extraKeys.filter((k) => k.keyId !== this.#key.keyId),
      ];
      return signManifest(
        { producer: this.producer, version: this.#version, keys, tools: [...policies.values()] },
        this.#key,
      );
    })();
    return this.#manifest;
  }

  async #run(t: ProducerTool, args: JsonValue, auth: string | undefined): Promise<CallToolResult> {
    try {
      return await t.handler(args, { now: this.#clock.now(), ...(auth !== undefined && { auth }) });
    } catch (e) {
      return errorResult(e instanceof Error ? e.message : "tool failed");
    }
  }

  async #sign(t: ProducerTool, policy: ToolPolicy, name: string, result: CallToolResult): Promise<Data> {
    return signData(
      {
        name,
        content: stripEphemeral(result),
        producedAt: this.#clock.now(),
        freshnessMs: result.isError === true ? 0 : policy.ttlMs, // [P-5.3]
        scope: policy.scope,
        policyVersion: t.policyVersion ?? 1,
      },
      this.#key,
    );
  }

  /**
   * Answer an Interest. Recomputes the name from the arguments and rejects a mismatch
   * (`DIGEST_MISMATCH`) [P-5.1]. Throws `NOT_CACHEABLE` for tools outside the cacheable policy,
   * invalid arguments, or multi-round-trip results [P-5.4].
   */
  async handleInterest(interest: Interest, ctx: { auth?: string } = {}): Promise<Data> {
    const parsed = parseName(interest.name);
    if (parsed.producer !== this.producer)
      throw new IdemError("NOT_CACHEABLE", "name belongs to another producer");
    const t = this.#tools.get(parsed.tool);
    const policy = (await this.#buildPolicies()).get(parsed.tool);
    if (!t || !policy?.cacheable)
      throw new IdemError("NOT_CACHEABLE", `tool "${parsed.tool}" is not cacheable`);
    const canonical = await canonicalizeArgs(interest.args, t, policy);
    const name = await makeName({ producer: this.producer, tool: this.identity(t.name), args: canonical });
    if (name !== interest.name) throw new IdemError("DIGEST_MISMATCH", "name does not match the arguments");
    const result = await this.#run(t, canonical.value, ctx.auth);
    if (result.resultType === "input_required") {
      throw new IdemError("NOT_CACHEABLE", "multi-round-trip results never use IDEM [P-5.4]");
    }
    return this.#sign(t, policy, name, result);
  }

  /**
   * Plain MCP `tools/call`. For cacheable tools the result also carries the signed Data metadata
   * in `_meta["dev.idem/data"]`, so IDEM-aware clients can verify it and IDEM-unaware clients
   * simply ignore it (protocol §9.1).
   */
  async handleCall(tool: string, args: unknown, ctx: { auth?: string } = {}): Promise<CallToolResult> {
    const t = this.#tools.get(tool);
    if (!t) return errorResult(`unknown tool "${tool}"`);
    const policy = (await this.#buildPolicies()).get(tool);
    if (policy?.cacheable) {
      try {
        const canonical = await canonicalizeArgs(args, t, policy);
        const name = await makeName({ producer: this.producer, tool: this.identity(tool), args: canonical });
        const result = await this.#run(t, canonical.value, ctx.auth);
        if (result.resultType === "input_required") return result;
        const data = await this.#sign(t, policy, name, result);
        return attachData(result, data);
      } catch (e) {
        if (!isIdemError(e, "INVALID_ARGS")) throw e;
        // Invalid for IDEM → plain MCP semantics below [P-3.1].
      }
    }
    let value: JsonValue;
    try {
      value = toJson(args ?? {});
    } catch {
      return errorResult("arguments are not JSON");
    }
    const errors = validate(t.inputSchema, value);
    if (errors.length > 0) return errorResult(`invalid arguments: ${errors.join("; ")}`);
    return this.#run(t, value, ctx.auth);
  }

  /**
   * Serve Interests and calls arriving on `face`. `serviceTimeMs` delays each answer on `clock`
   * (the simulator uses it to model tool latency).
   */
  serve(face: Face, opts: { clock?: Clock; serviceTimeMs?: (p: Packet) => number } = {}): void {
    const clock = opts.clock ?? this.#clock;
    const answer = async (p: Packet): Promise<void> => {
      if (p.type === "interest") {
        const I = p.interest;
        try {
          const data = await this.handleInterest(I, p.auth !== undefined ? { auth: p.auth } : {});
          face.send({ type: "data", nonce: I.nonce, data });
        } catch (e) {
          face.send({
            type: "nack",
            nonce: I.nonce,
            name: I.name,
            code: wireCode(e),
            message: e instanceof Error ? e.message : "",
          });
        }
      } else if (p.type === "call") {
        try {
          const result = await this.handleCall(p.tool, p.args, p.auth !== undefined ? { auth: p.auth } : {});
          face.send({ type: "result", id: p.id, result });
        } catch (e) {
          face.send({
            type: "nack",
            nonce: p.id,
            code: wireCode(e),
            message: e instanceof Error ? e.message : "",
          });
        }
      }
    };
    face.onReceive((p) => {
      const delay = opts.serviceTimeMs?.(p) ?? 0;
      if (delay <= 0) return answer(p);
      clock.setTimeout(() => answer(p), delay);
    });
  }
}

/** Attach signed Data metadata to a tool result under `_meta["dev.idem/data"]`. */
export function attachData(result: CallToolResult, data: Data): CallToolResult {
  const meta: JsonObject = { ...(result._meta ?? {}) };
  meta[META_KEYS.data] = { name: data.name, meta: { ...data.meta }, signature: { ...data.signature } };
  return { ...stripEphemeral(result), _meta: meta };
}

/**
 * Rebuild the Data object from a tool result carrying `_meta["dev.idem/data"]`, or `undefined`
 * if the result has no IDEM metadata.
 */
export function dataFromToolResult(result: CallToolResult): Data | undefined {
  const m = result._meta?.[META_KEYS.data] as unknown as
    | Pick<Data, "name" | "meta" | "signature">
    | undefined;
  if (!m || typeof m !== "object" || typeof m.name !== "string") return undefined;
  return { name: m.name, content: stripEphemeral(result), meta: m.meta, signature: m.signature };
}
