The [sandbox](/sandbox) is where the protocol can be watched instead of read about. This page does not describe where each panel sits, since the layout can be rearranged. It explains what the sandbox *runs* and how to read the protocol state it shows.

One rule makes it trustworthy: the sandbox runs the **same** `Forwarder` class as the gateway. Only the links and the clock differ. What you watch is the protocol's real behaviour, not a re-enactment.

## What you can run {#modes}

The sandbox opens on a choice: a **blank canvas** (the big plus), an **example** network (a swarm on one edge, two producers, a regional tree), **Live**, or the network you were editing last time. Every network but Live can be edited. To open another one, go back with *Networks* at the top of the sidebar: an edited network is kept, and *Continue where you left off* brings it back.

| | A network in the editor | Live |
|---|---|---|
| What runs | a network you build, in your browser: IDEM on real NDN routers compiled to WebAssembly (the default), or a deterministic simulation | real HTTP requests from your browser to the site's edge gateway, which forwards to the demo producer |
| Engine | IDEM: YaNFD, one router per forwarder, in real time. Simulation: the same `Forwarder`, in the page, on a virtual clock | the edge's `Forwarder`, on the server, on the wall clock, shared by every visitor |
| Agents | as many as you add, each with its own list of tools | as many as you add (up to 16), each an `IdemClient` with its own credential, tool and argument |
| Good for | seeing aggregation and caching on any topology, and comparing protocols on the same workload | seeing that the protocol works over a real network, and verifying signatures yourself |

Nothing here produces a result of the project. The counters describe the run in front of you. Measured numbers, with their seeds and configurations, are on the [benchmarks](/benchmarks) page.

### Live {#live}

In live mode every packet you see crossed a real network. A call to a cacheable tool leaves the page as an Interest (`POST /idem/v1/interest`), the edge answers from its Content Store or forwards it, and the page verifies the producer's signature on what comes back before showing it.

The demo producer serves five tools over a small corpus committed with the site. It never fetches anything from the internet.

| Tool | Policy | What it shows |
|---|---|---|
| `fetch_page(url)` | cacheable, `public`, `url:sortQuery` | two spellings of one URL get one name |
| `search_corpus(query, limit)` | cacheable, `public`, `trim` + `lowercase` | normalizers on text, a default applied |
| `weather(city)` | cacheable, `public`, short TTL | an answer going stale and being asked again |
| `my_notes()` | cacheable, `private` | one name, a different answer per credential, never shared |
| `send_email(to, body)` | not cacheable | a side effect: always passes through (`bypass`) |

The edge and the producer are the deployed ones, so they stay as they are. Add agents in the sidebar and click one to choose the tool it calls and its argument; *Ask now* sends its call alone, and `Space` sends every agent's call at once. A new agent fetches the shared page, spelling its URL its own way, so a burst shows normalization and aggregation together.

The edge is shared by everyone on the site. The **visitors** node stands for the others: their calls arrive from it as they happen, and the edge's card lists what the edge saw, yours marked *you*. When one of your calls is answered from the cache, or joins a pending Interest, the log and the card say whether another visitor's call filled it: that answer crossed the network once, for someone else. Only the tool, the first characters of the args digest and how the edge answered are shown, never arguments; private calls carry no digest.

> [!NOTE]
> In the deployment the edge's Content Store lives in the memory of one function instance. If your request lands on a different instance, a call you expected to hit will miss. That is the deployment, not the protocol. The edge's card names the instance it heard from, and says so when your calls were answered by another one.

## The network editor {#editor}

A network is agents, forwarders and producers joined by links. **Agents** make tool calls: each has a number of calls, a think time between them, and a list of tools from the producers it can reach, each with a weight. **Forwarders** are IDEM gateways (an edge, a regional node): they aggregate identical pending calls in the PIT and keep signed answers in the Content Store, whose size you set. **Producers** are MCP servers that sign their results: each has a name (it goes into every Data name it signs), the tools it serves, and how long each tool's results stay fresh. **Links** have a latency and a loss rate.

Agents connect only to forwarders, never straight to a producer or to each other: the forwarder is where IDEM aggregates and caches, so the editor refuses those links and says why.

| To | Do this |
|---|---|
| add a node | click *Agent*, *Forwarder* or *Producer*: it appears next to the selected node, already linked (or drag the chip onto the network) |
| move a node | drag it. A run never restarts for a move |
| link two nodes | select one, then drag from its blue handle onto the other (or hold `Shift` and drag from a node) |
| change a node or a link | click it: a card named after it opens on the right, with its settings. Every field has an info bubble |
| remove | select, then `Delete` |
| look around | drag empty space to pan; scroll, pinch or use the buttons to zoom; `F` fits the network |
| undo | `⌘Z` (`⇧⌘Z` to redo) |
| share | *Share* copies a link that carries the whole network |

The player bar over the network plays, pauses and restarts the run, and shows how many calls were answered (and, for the simulation, its virtual time and speed). A network you open starts paused: press play. When something stops the network from running (no agent, an agent with no tools, a tool whose producer it cannot reach), the player bar says so; click it for the whole list.

The engine is chosen at the top of the sidebar: **IDEM**, on NDN routers (the default), or **Simulation**.

### IDEM on NDN routers {#ndn-engine}

IDEM runs the network on real NDN routers: each forwarder is an instance of YaNFD (the forwarder of the NDN project's ndnd), compiled to WebAssembly and running in this tab. Producers and agents speak the native binding (`@idem/ndn`): Interests and Data are NDN TLV packets, and agents verify both signatures of every answer. It runs in real time, so freshness periods really pass; pausing holds every agent's next call (the calls in flight still finish). The routers forward and cache but check no signature, and calls to `private` or side-effect tools never travel on NDN. The router is downloaded the first time it runs.

### The simulation {#idem-engine}

The simulation runs the network in `@idem/sim`: the agents' calls, over virtual links, with a virtual clock. Everything is derived from one **seed**, so the same network and seed give the same run, event for event. Any change but moving a node restarts it.

Its most useful view is the **comparison**: the same seeded workload runs once per protocol you tick, side by side. The agents ask for exactly the same things at exactly the same times, so whatever differs between the panes is the protocol.

| Protocol | What happens to a call |
|---|---|
| `mcp-direct` | goes straight to the producer. Nothing is cached |
| `mcp-local-cache` | each agent remembers its own answers. A repeat by the same agent is local; a repeat by another agent goes to the producer |
| `idem` | goes through the forwarders: aggregated in a PIT, answered from a CS, or forwarded |

### What the settings change {#controls}

| Setting | What it sets | What to watch |
|---|---|---|
| Calls (agent) | how long an agent's workload is | a longer run gives the Content Store time to fill and pay off |
| Shared pages (agent) | the share of its `fetch_page` calls drawn from a catalog every agent shares | at zero, agents never ask the same page and a shared cache has nothing to share |
| Popularity skew (agent) | how concentrated that catalog's popularity is (Zipf α) | a higher skew concentrates requests on a few names |
| Tools and weights (agent) | which tools it calls, on which producer, how often | `my_notes` is private, `send_email` has a side effect: neither is ever shared |
| Content Store (forwarder) | the store's byte budget | a small store evicts (`cs_evict`) before entries are reused |
| Fresh for (producer) | the freshness its manifest allows per tool | a short freshness turns later hits back into misses |
| Service time (producer) | how long it takes to run a tool | a slow producer keeps Interests pending longer, so more of them aggregate |
| Latency (link) | the link's one-way delay | it spreads out when identical requests reach a forwarder |
| Loss (link) | the share of packets the link drops | lost packets surface as timeouts and retries |
| Seed | the source of every random choice | the same seed replays the same run |
| Speed | how fast virtual time advances on screen | it changes the animation, never the outcome |

## Reading the state {#reading}

### Packets and colors {#colors}

The two colors mean the same thing everywhere on this site. **Blue is an Interest**: a request travelling toward the producer. **Yellow is Data**: a signed answer travelling back. A link with blue going one way and no yellow coming back yet is a question still open.

### The PIT {#pit}

The Pending Interest Table lists names that were asked for and not yet answered, with the number of faces waiting on each. Read it as "questions in flight".

- An entry appears when a forwarder sends an Interest upstream (`upstream_out`).
- Its count grows when another Interest for the same name arrives before the answer (`pit_aggregate`). Each increment is one request that did not go upstream.
- It disappears when the Data arrives and is delivered to every waiting face (`pit_satisfy`), or when its lifetime runs out (`pit_expire`).

A `private` name can appear more than once in the table, one entry per authorization context. That is the partition at work: the two entries share a name and nothing else.

### The Content Store {#cs}

The Content Store lists signed Data by name, with how much of its freshness is left. Read it as "answers on hand".

- An entry appears after a Data was verified (`verify_ok`, then `cs_insert`).
- A fresh entry answers an Interest on the spot (`cs_hit`). The producer is not asked.
- An entry past its freshness is no longer served. The next Interest for that name goes upstream again.
- When the byte budget is full, the replacement policy removes an entry (`cs_evict`).

### The event log {#log}

The log is the forwarder's event stream, unedited. Every counter on the page is derived from it, and so are the experiments' metrics. A request's story reads top to bottom:

| You see | It means |
|---|---|
| `interest_in` → `upstream_out` | a miss: the question went to the next hop |
| `interest_in` → `pit_aggregate` | the same question was already in flight: this one waits for the same answer |
| `interest_in` → `cs_hit` | answered from the cache |
| `data_in` → `verify_ok` → `cs_insert` → `pit_satisfy` | an answer arrived, was checked, stored and delivered |
| `verify_fail` | a Data did not match its signature or its content digest and was refused |
| `bypass` | a call that is not IDEM (a non-cacheable tool, for example) went through untouched |
| `drop` | something was discarded; the reason is on the event |
| `pit_expire` | nobody answered in time; the waiters got `TIMEOUT` |

### The counters {#counters}

| Counter | Definition |
|---|---|
| Upstream calls | requests that reached the producer |
| CS hit ratio | `cs_hit` over the cacheable Interests that reached the edge |
| PIT aggregations | Interests that joined an entry instead of going upstream |
| Producer link bytes | bytes that crossed the link to the producer |
| Latency p50, p95 | per call, as the consumer saw it |
| Verify failures | Data refused at a forwarder or a consumer. Outside an attack this stays at zero |
| Retries | calls sent again after a timeout or a refused answer |
| Safety violations | attacks that got through: a tampered answer accepted, a private answer served to another agent. This must stay at zero |

### A packet, inspected {#packet}

Opening a packet shows the objects of the protocol as they are. For an Interest: the name, split into its components, and the canonical arguments. For a Data: the content, the signed `meta` (content digest, `producedAt`, `freshnessMs`, scope, policy version), the signature with its key locator, and the unsigned `ageMs`. In live mode the page recomputes the digests and verifies the signature in your browser: the check does not depend on trusting the site.

## The attacks {#attacks}

Three controls try to break the protocol on purpose. Each one must end in a visible rejection.

| Attack | What it does | What must happen |
|---|---|---|
| Tamper with a Data | alters the content of an answer in flight | verification fails (`verify_fail`, `BAD_SIGNATURE`); the altered answer is neither cached nor shown, and the call is retried without caches |
| Forge an args digest | sends an Interest whose arguments do not match its name | the forwarder drops it with `DIGEST_MISMATCH` |
| Ask for another user's private result | one consumer asks for a `private` name right after another | each gets its own answer; the first one's cached entry stays in its partition |

The rule behind each rejection is on the [Security](/docs/security#attacks) page. The same attempts, counted over many runs, are experiment E5 in the [Evaluation](/docs/evaluation#e5).

## Panels {#windows}

The protocol's state lives in six panels, with a tab each along the bottom of the network: **Event log**, **PIT & CS**, **Packet inspector**, **Metrics**, **Compare** and **Safety**. Click a tab (or press its number) to open its panel: the panels rise from the tabs, side by side, and the network moves up to make room. Drag the top edge to make them taller or shorter. Which panels are open and their height are remembered in this browser; the button at the right of the tabs resets them. Clicking a forwarder opens its tables, and clicking a call or a name in the log opens it in the inspector. On a phone the panels become tabs of a sheet under the network.

## Keyboard and motion {#access}

The sandbox can be driven without a pointer:

| Key | What it does |
|---|---|
| `1`–`6` | open or close a panel, in the order above |
| `Space` | a burst (live) · play or pause (editor) |
| `R` | restart the run (editor) |
| `Delete` | remove the selected node or link (editor) |
| `⌘Z`, `⇧⌘Z` | undo, redo (editor) |
| `F` | fit the network (editor) |
| `Esc` | close the shortcut list or a menu, clear the highlight and the selection |
| `↑` `↓` | make the panels taller or shorter, from their top edge (`Shift` for bigger steps) |
| `Tab`, then `←` `→` | reach the agents and forwarders on the stage (one tab stop); `Enter` acts as a click |
| `?` | show the shortcut list |

It also honors the system's reduced-motion setting: packets and panels then change state without travelling or bouncing, and a simulation does not start on its own.
