import { NAME_PREFIX } from "./name";

function components(prefix: string): string[] {
  return prefix.split("/").filter((c) => c.length > 0);
}

/**
 * Forwarding Information Base: name prefix → next-hop face id, with longest-prefix match on
 * name components. `"/"` is the default route.
 */
export class Fib {
  readonly #routes = new Map<string, string>();

  /** Add or replace a route. */
  add(prefix: string, nextHop: string): void {
    this.#routes.set(`/${components(prefix).join("/")}`, nextHop);
  }

  /** Route every name of `producer` (`/idem/v1/<producer>`) to `nextHop`. */
  addProducer(producer: string, nextHop: string): void {
    this.add(`${NAME_PREFIX}${producer}`, nextHop);
  }

  remove(prefix: string): boolean {
    return this.#routes.delete(`/${components(prefix).join("/")}`);
  }

  /** Longest-prefix match. */
  lookup(name: string): string | undefined {
    const c = components(name);
    for (let n = c.length; n >= 0; n--) {
      const hop = this.#routes.get(`/${c.slice(0, n).join("/")}`);
      if (hop !== undefined) return hop;
    }
    return undefined;
  }

  /** Next hop for a producer, as used by passthrough calls. */
  lookupProducer(producer: string): string | undefined {
    return this.lookup(`${NAME_PREFIX}${producer}`);
  }

  entries(): [prefix: string, nextHop: string][] {
    return [...this.#routes.entries()];
  }
}
