import { IdemError, NAME_PREFIX, utf8 } from "@idem/core";
import { AltUri, Component, ImplicitDigest, Name, ParamsDigest, TT } from "@ndn/packet";

const decoder = new TextDecoder("utf-8", { fatal: true });

/**
 * Map an IDEM name (or a reserved name such as a key locator) to an NDN name: each `/`-separated
 * part becomes one GenericNameComponent holding its UTF-8 bytes (protocol §9.2, ADR-026). The
 * mapping is a bijection on IDEM names, so the IDEM name is always recoverable with
 * {@link fromNdnName}.
 *
 * Throws `BAD_NAME` when `idemName` does not start with `/idem/v1/` or has an empty part.
 */
export function toNdnName(idemName: string): Name {
  if (typeof idemName !== "string" || !idemName.startsWith(NAME_PREFIX)) {
    throw new IdemError("BAD_NAME", `name must start with ${NAME_PREFIX}`);
  }
  const parts = idemName.slice(1).split("/");
  if (parts.some((p) => p.length === 0)) throw new IdemError("BAD_NAME", "empty name component");
  return new Name(parts.map((p) => new Component(TT.GenericNameComponent, utf8(p))));
}

/**
 * Recover the IDEM name of an NDN name: drop a trailing ParametersSha256DigestComponent or
 * ImplicitSha256DigestComponent (both are NDN's own, never part of an IDEM name, ADR-026) and join
 * the GenericNameComponents with `/`.
 *
 * Throws `BAD_NAME` when a component is not a GenericNameComponent with UTF-8 text free of `/`, or
 * the result does not start with `/idem/v1/`.
 */
export function fromNdnName(name: Name): string {
  let n = name;
  const last = n.get(-1);
  if (last && (ParamsDigest.match(last) || ImplicitDigest.match(last))) n = n.getPrefix(-1);
  const parts: string[] = [];
  for (const c of n.comps) {
    if (c.type !== TT.GenericNameComponent) {
      throw new IdemError("BAD_NAME", `unexpected NDN component type ${c.type} in an IDEM name`);
    }
    let s: string;
    try {
      s = decoder.decode(c.value);
    } catch (e) {
      throw new IdemError("BAD_NAME", "NDN name component is not UTF-8", { cause: e });
    }
    if (s.length === 0 || s.includes("/")) throw new IdemError("BAD_NAME", "invalid IDEM name component");
    parts.push(s);
  }
  const out = `/${parts.join("/")}`;
  if (!out.startsWith(NAME_PREFIX)) throw new IdemError("BAD_NAME", `name must start with ${NAME_PREFIX}`);
  return out;
}

/** True when the last component of `name` is a ParametersSha256DigestComponent. */
export function hasParamsDigest(name: Name): boolean {
  const last = name.get(-1);
  return last !== undefined && ParamsDigest.match(last);
}

/**
 * Readable NDN URI of a name (NDN "alternate URI" syntax): GenericNameComponents as plain text and
 * the digest components as `params-sha256=<hex>` / `sha256digest=<hex>`, e.g.
 * `/idem/v1/demo.idem.dev/fetch_page/<schema>/<args>/params-sha256=…`.
 */
export function ndnUri(name: Name): string {
  return AltUri.ofName(name);
}
