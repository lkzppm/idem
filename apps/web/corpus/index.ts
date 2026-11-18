// Static corpus served by the demo producer. The demo tools never fetch the internet
// (CLAUDE.md, "Don't"): every page lives here, committed.

/** A page of the demo corpus, served at `https://corpus.idem.dev/doc/<id>`. */
export interface CorpusPage {
  id: number;
  title: string;
  body: string;
}

export const CORPUS_ORIGIN = "https://corpus.idem.dev";

export const CORPUS: CorpusPage[] = [
  {
    id: 0,
    title: "Named data in one paragraph",
    body:
      "In a named-data network the consumer asks for content by name instead of asking a host for it. " +
      "Any node holding a copy may answer, because the answer carries a signature that binds the name " +
      "to the content. Location stops mattering; integrity travels with the data.",
  },
  {
    id: 1,
    title: "Interest and Data",
    body:
      "An Interest packet names what the consumer wants. A Data packet carries the content, the same " +
      "name and a signature. One Interest is answered by at most one Data on each hop, and the Data " +
      "follows the Interest's path in reverse.",
  },
  {
    id: 2,
    title: "The Pending Interest Table",
    body:
      "When several Interests for the same name arrive before the answer, a forwarder records them " +
      "in its Pending Interest Table and sends only one upstream. When the Data returns, it is copied " +
      "to every waiting face. Duplicate requests collapse into one.",
  },
  {
    id: 3,
    title: "The Content Store",
    body:
      "A forwarder may keep Data it has forwarded in its Content Store. A later Interest for the same " +
      "name is answered locally while the Data is fresh. Freshness is declared by the producer and " +
      "tracked with an age, like the HTTP Age header.",
  },
  {
    id: 4,
    title: "Web caching, revisited",
    body:
      "HTTP caches and CDNs already serve repeated requests close to the client. They rely on the " +
      "origin's cache headers and on trusting the cache operator. Signing each object lets any cache " +
      "serve it without being trusted.",
  },
  {
    id: 5,
    title: "Why tool calls repeat",
    body:
      "Agents that split a task across subagents often fetch the same page or document more than " +
      "once, and usually from different subagents. A per-agent cache cannot see those repeats; a " +
      "shared, verifiable cache on the path can.",
  },
  {
    id: 6,
    title: "Canonical arguments",
    body:
      "Two calls are the same only if their arguments mean the same thing. Key order, default values, " +
      "URL fragments and host case can differ without changing meaning. The producer declares which " +
      "normalizations are safe; nobody else may guess.",
  },
  {
    id: 7,
    title: "Signatures and trust",
    body:
      "Each producer publishes a signed manifest listing its keys and which tools may be cached. " +
      "Consumers trust the first manifest they see or a pinned key, and every later manifest must be " +
      "signed by a key that is already trusted.",
  },
  {
    id: 8,
    title: "Private results",
    body:
      "Some results belong to one user. They may only be cached at the edge, in a partition keyed by " +
      "a one-way hash of the user's credential, and they are never aggregated with another user's " +
      "request.",
  },
  {
    id: 9,
    title: "Side effects pass through",
    body:
      "Sending an email or writing a file must happen every time it is asked for. Tools with side " +
      "effects are never named, never cached and never aggregated: forwarders pass them through.",
  },
  {
    id: 10,
    title: "Flow balance",
    body:
      "Because every Data answers exactly one pending Interest per hop, a consumer controls how much " +
      "data flows toward it by how many Interests it sends. The receiver drives the exchange.",
  },
  {
    id: 11,
    title: "Layers",
    body:
      "Over HTTP, this exchange is an application-layer overlay, like a CDN with signed objects. Over " +
      "Named Data Networking it moves down to the network layer, where routers keep the tables " +
      "themselves.",
  },
];

/** Find a page by its corpus URL path (`/doc/<id>`). */
export function pageAt(url: URL): CorpusPage | undefined {
  if (url.origin !== CORPUS_ORIGIN) return undefined;
  const m = /^\/doc\/(\d+)$/.exec(url.pathname);
  return m ? CORPUS.find((p) => p.id === Number(m[1])) : undefined;
}
