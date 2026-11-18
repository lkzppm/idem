The [sandbox](/sandbox) is where the protocol can be watched instead of read about. This page does not describe where each panel sits, since the layout can be rearranged. It explains what the sandbox *runs* and how to read the protocol state it shows.

One rule makes it trustworthy: the sandbox runs the **same** `Forwarder` class as the gateway. Only the links and the clock differ. What you watch is the protocol's real behaviour, not a re-enactment.

## Two modes {#modes}

| | Live | Swarm |
|---|---|---|
| What runs | real HTTP requests from your browser to the site's edge gateway, which forwards to the demo producer | a deterministic simulation, entirely in your browser |
| Engine | the edge's `Forwarder`, on the server, on the wall clock | the same `Forwarder`, in the page, on a virtual clock |
| Agents | a few consumers in the page, each an `IdemClient` with its own credential | as many simulated agents as you set |
| Time | real: a freshness period has to actually pass | virtual: the run jumps from event to event, at the speed you choose |
| Good for | seeing that the protocol works over a real network, and verifying signatures yourself | seeing aggregation and caching at scale, and comparing modes on the same workload |

Neither mode produces a result of the project. The counters describe the run in front of you. Measured numbers, with their seeds and configurations, are on the [results](/results) page.

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

> [!NOTE]
> In the deployment the edge's Content Store lives in the memory of one function instance. If your request lands on a different instance, a call you expected to hit will miss. That is the deployment, not the protocol.

### Swarm {#swarm}

Swarm mode runs `@idem/sim`: simulated agents issue tool calls over virtual links, with a virtual clock. Everything is derived from one **seed**, so the same seed and the same settings give the same run, event for event, and a run can be shared by its address.

Its most useful view is the **comparison**: the same seeded workload runs in more than one mode, always `mcp-direct` and `idem`, plus `mcp-local-cache` when *Also run MCP with a per-agent local cache* is ticked. The agents ask for exactly the same things at exactly the same times, so whatever differs between the runs is the protocol.

| Mode | What happens to a call |
|---|---|
| `mcp-direct` | goes straight to the producer. Nothing is cached |
| `mcp-local-cache` | each agent remembers its own answers. A repeat by the same agent is local; a repeat by another agent goes to the producer |
| `idem` | goes to the shared edge forwarder: aggregated in the PIT, answered from the CS, or forwarded |

## What the controls change {#controls}

Each control is a parameter of the workload, the network or the cache. Changing one and watching what moves is the quickest way to build intuition.

| Control | What it sets | What to watch |
|---|---|---|
| Agents | how many consumers issue calls | more agents mean more identical requests in flight together |
| Calls per agent | how long each agent's workload is | a longer run gives the Content Store time to fill and pay off |
| Cross-agent overlap | the share of each agent's requests drawn from a pool all agents share | at zero, agents never ask the same thing and a shared cache has nothing to share |
| Zipf α | how skewed popularity is within the catalog | a higher α concentrates requests on a few names |
| Catalog size | how many distinct pages exist | a small catalog repeats sooner |
| TTL | the freshness the producer's manifest allows | a short TTL turns later hits back into misses |
| CS size | the Content Store's byte budget | a small store evicts (`cs_evict`) before entries are reused |
| Agent ↔ edge latency | the delay of the agents' links | it spreads out when identical requests reach the edge |
| Edge ↔ producer latency | the delay of the link to the producer | a slow producer link keeps Interests pending longer, so more of them aggregate |
| Link loss | the share of packets a link drops | lost packets surface as timeouts and retries |
| Private calls | the share of calls to `my_notes` | they are partitioned per agent and never shared |
| Side-effect calls | the share of calls to `send_email` | they always pass through |
| Topology | star (one edge) or tree (edges and a regional forwarder) | in a tree, hits can also happen beyond the edge |
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

## Windows {#windows}

The protocol's state lives in six windows over the network: **Event log**, **PIT & CS**, **Packet inspector**, **Metrics**, **Compare** and **Safety**. Drag one by its title bar, double-click the bar to collapse it, resize it from its corner, and close or reopen it from the sidebar; the layout is remembered in this browser, and *Tidy up* puts every window back. Clicking a forwarder opens its tables, and clicking a call or a name in the log opens it in the inspector. On a phone the windows become tabs of a sheet under the network.

## Keyboard and motion {#access}

The sandbox can be driven without a pointer:

| Key | What it does |
|---|---|
| `1`–`6` | open or close a window, in the order above |
| `Space` | a burst (live) · play or pause (swarm) |
| `R` | restart the run (swarm) |
| `Esc` | close the shortcut list, clear the highlight; on a window's grip, close that window |
| `←` `↑` `→` `↓` | move a window, from the grip in its title bar (`Shift` for bigger steps) |
| `Alt` + `←` `↑` `→` `↓` | resize a window, from the same grip |
| `Tab`, then `←` `→` | reach the agents and forwarders on the stage (one tab stop); `Enter` acts as a click |
| `?` | show the shortcut list |

It also honors the system's reduced-motion setting: packets and panels then change state without travelling or bouncing, and a simulation does not start on its own.
