import { defineMessages } from "../locale";

/**
 * The results page. Every number is passed in already formatted for the locale; the sentences
 * here only place them. Names of modes (B0–B4), tools, metrics, attack variants and the suite's
 * own output are code and are never translated.
 */
export const results = defineMessages(
  {
    meta: {
      title: "Benchmarks",
      description:
        "IDEM measured: the native NDN binding against real NFD forwarders and the HTTP overlay against native NDN under loss (E4), then the evidence behind it: simulated agent swarms (E2), the cost of naming, signing and verifying (E1) and an adversarial suite (E5).",
    },
    nav: {
      native: "Native NDN",
      verdicts: "Verdicts",
      redundancy: "Redundancy",
      gateway: "Shared cache",
      latency: "Latency",
      sensitivity: "Sensitivity",
      cost: "Cost",
      safety: "Safety",
      method: "Method",
    },
    ask: {
      question: "Question",
      verdict: "What the data says",
      native: {
        e4: (o: {
          loss: string;
          n2ok: string;
          b2ok: string;
          n2p50: string;
          b2p50: string;
          n2p95: string;
          b2p95: string;
          n2bytes: string;
          b2bytes: string;
        }) =>
          `At ${o.loss}% loss on every link, the native star (N2) answered ${o.n2ok} of its calls and the overlay star (B2) ${o.b2ok}; median latency ${o.n2p50} against ${o.b2p50}, 95th percentile ${o.n2p95} against ${o.b2p95}; bytes over the producer link ${o.n2bytes} against ${o.b2bytes}.`,
        e4Partial:
          "E4 has a run, but it does not include both the native and the overlay star at its highest loss, so no comparison is stated.",
        e4Pending: "E4, the overlay against native NDN under loss, has not run: there is no result to state.",
        nfd: (o: { passed: string; total: string; stopped: string; failing: string; previous: string }) =>
          `Against real NFD forwarders the latest conformance run passed ${o.passed} of ${o.total} scenarios${o.stopped ? `; ${o.stopped} stopped on an error before any check ran` : ""}${o.failing ? `; checks failed in ${o.failing}` : ""}.${o.previous ? ` ${o.previous}` : ""}`,
        nfdPrevious: (passed: string, total: string) => `The run before it passed ${passed} of ${total}.`,
      },
    },
    hero: {
      kicker: "Benchmarks",
      title: "IDEM, measured.",
      lead: "IDEM names a tool call, signs the answer and lets any forwarder on the path serve it. This page starts with IDEM on real NDN forwarders: the native binding against NFD, and the HTTP overlay against native NDN under loss (E4). Below come the experiments that back it: what sharing saves (E2), what the crypto costs (E1) and what an attacker can do (E5). Every number is read from a committed run folder, and each figure names its runs.",
      kindsLabel: "What kind of result each experiment is",
      kinds: [
        {
          id: "nfd",
          name: "NFD check",
          text: "The native binding against real NFD forwarders in Docker. Pass or fail, not a measurement.",
        },
        {
          id: "e4",
          name: "E4",
          text: "The HTTP overlay and native NDN on the same emulated links with packet loss (Docker, tc netem). Wall-clock time on one machine.",
        },
        {
          id: "sim",
          name: "E2, E5",
          text: "Simulation on a virtual clock, not a measurement of a deployed network.",
        },
        {
          id: "e1",
          name: "E1",
          text: "Wall-clock time of the naming and crypto operations, on one machine.",
        },
      ],
      notRun: "Has not run yet.",
    },
    tiles: {
      label: "Headline numbers",
      nfd: {
        value: (ok: string, all: string) => `${ok} of ${all}`,
        label: "scenarios pass against real NFD forwarders, latest run",
        sub: (o: { stopped: number; previous: string }) =>
          `${o.stopped > 0 ? `${o.stopped} stopped on an error before any check ran. ` : ""}${o.previous}`.trim() ||
          "A conformance check, not a measurement.",
        earlier: (passed: string, total: string) => `The run before: ${passed} of ${total}.`,
      },
      e4: {
        pending: "Pending",
        pendingLabel: "overlay against native NDN under loss (E4)",
        pendingSub: "E4 has not run yet. No number is shown.",
        label: (loss: string) => `of calls answered over native NDN at ${loss}% loss`,
        sub: (b2: string) => `HTTP overlay, same star topology: ${b2}`,
      },
      upstream: {
        label: "fewer calls reach the producer (simulation)",
        sub: (agents: string, ci: string) =>
          `B2 against direct MCP, ${agents} agents, overlap 0.5 · ±${ci} points`,
      },
      safety: {
        value: (ok: string, all: string) => `${ok} of ${all}`,
        label: "attack variants the protocol must stop, stopped in every trial",
        sub: (accepted: number, limits: number) =>
          `${accepted === 0 ? "none accepted" : `${accepted} accepted`}; ${limits} documented ${limits === 1 ? "limit" : "limits"} measured`,
      },
    },
    status: {
      supported: "Supported",
      partly: "Partly supported",
      refuted: "Refuted",
      "not-evaluated": "Not evaluated",
    },
    hyp: {
      title: "The hypotheses",
      question: "Do the hypotheses the project stated before running the experiments that test them hold?",
      verdict: (o: { supported: number; partly: number; refuted: number; pending: number }) =>
        `${o.supported} supported, ${o.partly} partly supported, ${o.refuted} refuted and ${o.pending} not evaluated, by the rules written next to each.`,
      lead: "The project stated four falsifiable hypotheses before any experiment ran, and two more, H5 and H6, with their rules, before the sweeps and attacks that test them ran. The verdicts are computed from the data, with the rule given next to each.",
      h1: {
        claim:
          "On swarm workloads with cross-agent overlap, IDEM reduces the calls reaching the producer compared with direct MCP and with a per-agent local cache.",
        base: (o: { agents: string; vsB0: string; ciB0: string; vsB1: string; ciB1: string }) =>
          `At ${o.agents} agents and overlap 0.5, B2 sent ${o.vsB0} (±${o.ciB0} points) fewer calls upstream than direct MCP and ${o.vsB1} (±${o.ciB1}) fewer than per-agent caches.`,
        largest: (o: { agents: string; vsB0: string; vsB1: string }) =>
          `At ${o.agents} agents: ${o.vsB0} and ${o.vsB1}.`,
        rule: (o: { aboveB0: number; aboveB1: number; points: number }) =>
          `Rule: the 95% interval of the reduction is above zero wherever agents can share (two or more agents, overlap above zero). Against B0: ${o.aboveB0} of ${o.points} points. Against B1: ${o.aboveB1} of ${o.points}.`,
        alone:
          "With a single agent, or with no overlap, there is nothing to share and B2 does exactly what B1 does.",
      },
      h2: {
        claim:
          "p50 and p95 latency per call drop when there is a CS hit or PIT aggregation, and the extra cost on a miss (canonicalize, sign, verify) is small relative to the round trip to the producer.",
        base: (o: { agents: string; p50: string; ci50: string; p95: string; ci95: string }) =>
          `At ${o.agents} agents the per-run median fell by ${o.p50} (±${o.ci50}) and the 95th percentile by ${o.p95} (±${o.ci95}) against direct MCP, paired by seed.`,
        rule: (o: { p50: number; p95: number; p99: number; points: number }) =>
          `Rule: the 95% interval of the change is below zero at every point with two or more agents. p50: ${o.p50} of ${o.points}. p95: ${o.p95} of ${o.points}. The 99th percentile is not part of the hypothesis and moved less: ${o.p99} of ${o.points}.`,
        overhead: (o: { us: string; share: string }) =>
          `A miss pays ${o.us} of extra CPU, ${o.share} of the round trip.`,
        noOverlap: (delta: string) =>
          `With no overlap that cost is all IDEM adds: the median call is ${delta} slower than direct MCP.`,
      },
      h3: {
        claim: "No tampered response is accepted and no private result is served to another context.",
        integrity: (o: { accepted: string; trials: string; variants: number }) =>
          `Tampered, forged or wrongly signed Data accepted: ${o.accepted} of ${o.trials} trials (${o.variants} variants).`,
        privateClean: (o: { trials: string; variants: number }) =>
          `Private results served to another context: 0 of ${o.trials} trials (${o.variants} variants).`,
        privateLeak: (o: { accepted: string; trials: string; variants: number; leaking: string }) =>
          `Private results served to another context: ${o.accepted} of ${o.trials} trials (${o.variants} variants), in ${o.leaking}.`,
        rule: "Rule: zero accepted in both groups. Replays of genuine Data belong to neither group: a replay outside the signed lifetime is a claim of its own [P-8.6, P-8.7] and a replay inside the clock tolerance a documented limit (ADR-034), both measured under Safety.",
      },
      h4: {
        claim:
          "Under loss and multi-hop topologies, on-path caching reduces bytes on the producer's link and recovery time, compared with end-to-end TCP/HTTP.",
        ran: "E4 has run and is shown first on this page. This page encodes no rule for H4, so it states no verdict.",
        evidence:
          "Needs the network emulation (E4), which has not run. The E2 sweeps ran without loss, so nothing here speaks to recovery.",
      },
      h5: {
        claim:
          "Against a shared exact-match cache at the gateway with no signatures, no producer-declared canonicalization and no in-flight aggregation (B5): (a) IDEM sends fewer calls upstream when arguments vary in surface form or identical calls are in flight at the same time, and the same number when neither happens; (b) a result altered at the cache or on the path to it is accepted by B5's consumers and rejected by IDEM's.",
        surface: (o: { above: number; points: number; top: string; vsB5: string; ci: string }) =>
          `Surface variation: B2's reduction against B5 is above zero at ${o.above} of ${o.points} points; ${o.vsB5} (±${o.ci} points) with ${o.top} of the URLs in an equivalent form.`,
        inflight: (o: { above: number; points: number; neither: number; neitherAgree: number }) =>
          `Identical calls in flight, no surface variation: B5 sent duplicates upstream at ${o.points} points and B2's reduction against it is above zero at ${o.above} of them. ${o.neither === 0 ? "No point was free of duplicates, so the half of the rule about sending the same number was not exercised." : `At the ${o.neither} points with no duplicates, it is neither above nor below zero at ${o.neitherAgree}.`}`,
        unclassified: (n: number) =>
          `${n} ${n === 1 ? "point has" : "points have"} a positive mean of duplicates whose interval reaches zero; the rule names no expectation for ${n === 1 ? "it" : "them"}, so ${n === 1 ? "it is" : "they are"} not evaluated.`,
        attacks: (o: { holding: number; pairs: number }) =>
          `Altered results: in ${o.holding} of ${o.pairs} attack pairs the unsigned cache accepted the attack in at least one trial and IDEM in none (the table under Safety).`,
        rule: "Rule (a): above zero at every surface variation above 0 and at every surface-0 point where B5 had duplicates in flight; neither above nor below zero where it had none. Rule (b): each baseline attack accepted at least once, its IDEM mirror never. H5 needs both.",
      },
      h6: {
        claim:
          "When agents issue their calls from code in bursts instead of one per model turn (W-code), the share of cacheable requests absorbed by PIT aggregation grows with the burst size and with how closely the agents' starts coincide, and IDEM's upstream reduction over B5 grows with it.",
        trend: (o: { what: string; from: string; to: string; grows: boolean }) =>
          `${o.what}: from ${o.from} to ${o.to}${o.grows ? "" : ", which does not meet the rule"}.`,
        what: {
          "e2-code-burst/pit_aggregation_ratio": "PIT aggregation as the burst grows",
          "e2-code-burst/upstream_reduction_vs_b5": "Reduction against B5 as the burst grows",
          "e2-code-sync/pit_aggregation_ratio": "PIT aggregation as the start window shrinks",
          "e2-code-sync/upstream_reduction_vs_b5": "Reduction against B5 as the start window shrinks",
        } as Record<string, string>,
        rule: (o: { grows: number; all: number }) =>
          `Rule: a metric grows when its two ends are apart (95% intervals that do not overlap) in the stated direction and no consecutive pair of points is apart the other way. ${o.grows} of ${o.all} grow; H6 needs all of them.`,
      },
    },
    native: {
      title: "IDEM on real NDN",
      lead: "The question the project stands on: does IDEM work when its names and signed Data cross real NDN forwarders, and what does that change against the HTTP overlay when the network drops packets? Two pieces of evidence, E4 first.",
      question:
        "Does IDEM work on real NDN forwarders, and what does the native binding change compared with the HTTP overlay when the network loses packets?",
      e4: {
        title: "E4: HTTP overlay against native NDN under loss",
        lead: "The same agents, producer and links (Docker, with tc netem delay and loss on every link) carry IDEM two ways: over HTTP forwarders (B2, B3) and as native NDN Interests and Data through NFD (N2, N3). B0 is plain MCP. The loss on every link, in each direction, is the x axis.",
        pending: {
          title: "E4 has not run yet",
          text: "There is no E4 result to show, so this section shows no number. Once its run folder is committed under experiments/results/e4, the figures appear here without any change to the page.",
          will: "When it has run, this section shows, for the five modes above: calls answered, median and 95th-percentile latency and bytes over the producer link against loss; the latency distribution at each loss level; and a table of every value with its confidence interval. To run it:",
        },
        x: "loss on every link",
        tabs: "Metric",
        chartsTitle: "What loss does to each mode",
        chart: {
          completion: {
            tab: "Completion",
            title: "Calls answered as loss grows",
            desc: "Line chart of the share of calls answered against the loss on every link, one line per mode.",
            y: "calls answered",
          },
          p50: {
            tab: "Median latency",
            title: "Median latency as loss grows",
            desc: "Line chart of the median latency of answered calls against the loss on every link, one line per mode.",
            y: "median latency (ms)",
          },
          p95: {
            tab: "95th percentile",
            title: "95th-percentile latency as loss grows",
            desc: "Line chart of the 95th-percentile latency of answered calls against the loss on every link, one line per mode.",
            y: "95th percentile (ms)",
          },
          bytes: {
            tab: "Producer-link bytes",
            title: "Bytes over the producer link as loss grows",
            desc: "Line chart of the bytes that crossed the link to the producer against the loss on every link, one line per mode.",
            y: "bytes over the producer link",
          },
        },
        caption: (o: { agents: string; calls: string; seeds: number }) =>
          `${o.agents} agents × ${o.calls} calls, W-syn at the E2 base point, ${o.seeds} seeds per point. Whiskers: 95% confidence interval. Pages are capped to fit one NDN packet, so every mode serves the same pages.`,
        cdf: {
          title: "Latency of every answered call",
          desc: "Cumulative distribution of the latency of answered calls up to the 99th percentile, one curve per mode, for the chosen loss level.",
          tabs: "Loss level",
          tab: (loss: string) => `${loss} loss`,
          x: "latency (ms)",
          y: "share of calls",
          caption:
            "Answered calls pooled over seeds, up to the 99th percentile. Calls that failed are not in it; the share answered is in the chart above.",
        },
        table: {
          row: "Mode · loss",
          completion: "Answered",
          p50: "p50",
          p95: "p95",
          bytes: "Producer link",
          retrans: "Retransmissions",
        },
        guard: (n: number) =>
          `The validity guard discarded and repeated ${n} ${n === 1 ? "run" : "runs"} in which the host froze.`,
      },
      nfd: {
        title: "The native binding against real NFD",
        lead: "@idem/ndn talks to NFD forwarders in Docker over TCP, UDP and WebSocket faces. Each scenario checks rules of the protocol on the wire. It reports pass or fail, not a measurement.",
        pass: "pass",
        fail: "fail",
        stopped: "stopped before any check:",
        checks: (n: number, failed: number) => (failed > 0 ? `${n} checks, ${failed} failed` : `${n} checks`),
        version: (o: { nfd: string; ndnts: string; image: string }) =>
          `NFD ${o.nfd}, NDNts ${o.ndnts}, image ${o.image}. The latest run is shown.`,
        previous: (o: { id: string; passed: string; total: string }) =>
          `The run before it (${o.id}) passed ${o.passed} of ${o.total}.`,
        scenario: {
          S1: "Round trip and manifest bootstrap",
          S2: "PIT aggregation",
          S3: "Content Store and freshness",
          S4: "Equivalent spellings share one name",
          S5: "private is never sent on NDN",
          S6: "Tampered Data is rejected",
          S7: "The packet size limit",
          S8: "Two-forwarder chain",
          S9: "WebSocket face",
        } as Record<string, string>,
      },
    },
    modes: {
      B0: "direct MCP",
      B1: "per-agent cache",
      B2: "IDEM",
      B3: "IDEM, two tiers",
      B4: "IDEM, no verify at forwarders",
      B5: "shared gateway cache, unsigned",
      N2: "IDEM on native NDN",
      N3: "IDEM on native NDN, two tiers",
      bound: "perfect shared cache",
      desc: {
        B0: "Every call goes to the producer, a plain MCP server. The edge only relays.",
        B1: "Each agent keeps its own cache of results, keyed by the canonical name (so it gets IDEM's canonicalization for free). The strongest baseline that changes nothing in the network.",
        B2: "Agents → one edge forwarder (PIT and Content Store) → producer. Every hop and every agent verifies.",
        B3: "Agents → two edges → one regional forwarder → producer, with the same end-to-end delay as B2.",
        B4: "B2 with verification before caching switched off at the forwarder, only to isolate what it costs.",
        B5: "Plain MCP with one response cache at the edge shared by all agents, as MCP gateways ship it: keyed by tool and the arguments as sent (key order aside), the manifest's TTL and the Content Store's byte budget. No signatures, no producer-declared canonicalization, no aggregation of identical calls in flight (ADR-036).",
        N2: "B2's star on native NDN: agents → one edge NFD → producer, Interests and signed Data over UDP faces, no HTTP.",
        N3: "B3's tree on native NDN: agents → two edge NFDs → one regional NFD → producer.",
      },
    },
    chart: {
      table: "Table of values",
      meanCi: "Mean over seeds ± half-width of the 95% confidence interval.",
      legend: "Series",
      mode: "Mode",
      simulation: "Simulation",
      wallClock: "Wall clock",
      run: "run",
      runs: "runs",
      seeds: (n: number) => `${n} seeds per point`,
      emulation: "Emulation",
      hint: "Hover, touch or use the arrow keys to read exact values. Press a legend entry to hide or show a series.",
      hide: "Hide",
      show: "Show",
      showAll: "Show all series",
      noteCi: (n: number) => `Mean ± 95% CI over ${n} seeds`,
      noteRange: (n: number) => `Median of ${n} runs; the range of the runs in brackets`,
      notePooled: (n: number) => `All answered calls pooled over ${n} seeds`,
    },
    redundancy: {
      title: "Calls that never reach the producer",
      question: "How many tool calls does sharing keep from reaching the producer?",
      verdict: (o: { agents: string; b2: string; ci: string; b1: string; b5: string }) =>
        `At ${o.agents} agents and overlap 0.5, IDEM sent ${o.b2} (±${o.ci} points) fewer calls to the producer than direct MCP; per-agent caches, ${o.b1}; the shared gateway cache, ${o.b5}.`,
      lead: "Upstream reduction is the share of tool calls that did not reach the producer, relative to direct MCP on the same workload and seed. The workload is synthetic (W-syn): every agent makes 20 calls with a think time between them, and a fraction of them, the overlap, is drawn from a catalog the whole swarm shares.",
      agents: {
        title: "Upstream reduction as the swarm grows",
        desc: "Line chart of upstream reduction against direct MCP as the number of agents grows, one line each for the per-agent cache, the shared gateway cache, IDEM and IDEM on two tiers, and the perfect shared cache as a dotted line.",
        x: "agents",
        y: "upstream reduction",
        caption:
          "W-syn at overlap 0.5. Whiskers: 95% confidence interval. The dotted line is a perfect shared cache, every distinct name fetched once.",
        note: "IDEM follows the bound: with a 60 s TTL and an 8 MiB store, nothing expires or is evicted during a run. B3 and B4 reach the producer exactly as often as B2. The halftone area is what sharing across agents adds over private caches.",
      },
      overlap: {
        title: "Upstream reduction as agents ask for more of the same",
        desc: "Line chart of upstream reduction against direct MCP as the cross-agent overlap grows, one line each for the per-agent cache, the shared gateway cache, IDEM and IDEM on two tiers, and the perfect shared cache as a dotted line.",
        x: "cross-agent overlap",
        y: "upstream reduction",
        caption: "W-syn at 8 agents. Whiskers: 95% confidence interval.",
      },
      pit: (o: { base: string; shortest: string; think: string }) =>
        `Nearly all of the reduction is the Content Store. PIT aggregation, two identical requests in flight at once, happened for at most ${o.base} of the Interests in the swarm sweep, and for ${o.shortest} at the shortest think time tested (${o.think}). W-syn has no burst in which many agents ask for one new thing at the same instant, which is where aggregation would matter; the code-driven sweeps under Shared cache add those bursts.`,
      bytes: (o: { one: string; b1: string; base: string; calls: string }) =>
        `Bytes on the producer link fall less than calls do, because an Interest and its signed Data are larger than a plain call and its result. With one agent B2 saves ${o.one} of the bytes where B1 saves ${o.b1}; at the base point it saves ${o.base} of the bytes for ${o.calls} of the calls.`,
      vsB5: (o: { agents: string; surface: string; gap: string }) =>
        `Against the shared gateway cache (B5) at the same point, where ${o.surface} of the URLs are written in an equivalent form, ${o.gap}. What that difference is made of is taken apart under Shared cache.`,
      columns: {
        vsB0: "vs. B0",
        vsB1: "vs. B1",
        vsB5: "vs. B5",
        bound: "bound",
        hit: "CS hit ratio",
        pit: "PIT aggregation",
        bytes: "bytes vs. B0",
      },
    },
    gateway: {
      title: "Against a shared gateway cache",
      question:
        "What does IDEM add over one shared, unsigned cache at the gateway, and where does it add nothing?",
      lead: "B5 is plain MCP with one cache at the edge shared by every agent, keyed by tool and the arguments as sent, the way MCP gateways ship response caching (ADR-036). It has the same TTL and byte budget as IDEM's Content Store. What it lacks is names built from producer-declared canonical arguments, aggregation of identical calls in flight, and signatures. The three sweeps here take the first two apart; the signatures are under Safety.",
      verdict: (o: {
        zeroValue: string;
        b5zero: string;
        b2zero: string;
        zero: string;
        topValue: string;
        top: string;
        burstValue: string;
        burst: string;
      }) =>
        `At surface variation ${o.zeroValue}, where B5 removed ${o.b5zero} of the calls against direct MCP and IDEM ${o.b2zero}, ${o.zero}; at ${o.topValue}, ${o.top}; with bursts of ${o.burstValue} calls sent at once, ${o.burst}.`,
      gap: (o: { side: "above" | "below" | "none"; value: string; ci: string }) =>
        o.side === "above"
          ? `IDEM sent ${o.value} (±${o.ci} points) fewer calls upstream than B5`
          : o.side === "below"
            ? `IDEM sent ${o.value} (±${o.ci} points) more calls upstream than B5`
            : `IDEM sent as many calls upstream as B5 within the 95% interval (${o.value} ± ${o.ci} points)`,
      surface: {
        title: "Upstream reduction as arguments vary in spelling",
        desc: "Line chart of upstream reduction against direct MCP as a growing share of the URLs is written in an equivalent form, one line each for the per-agent cache, the shared gateway cache and IDEM, and the perfect shared cache as a dotted line.",
        x: "URLs written in an equivalent form",
        caption: (o: { agents: string; overlap: string }) =>
          `W-syn at ${o.agents} agents, overlap ${o.overlap}. Whiskers: 95% confidence interval. The halftone area is what IDEM adds over the shared gateway cache.`,
        reading: (o: {
          zero: string;
          b5zero: string;
          b2zero: string;
          bound: string;
          gap: string;
          top: string;
          b5top: string;
          b2top: string;
          gapTop: string;
        }) =>
          `With every repeat spelled the same way (${o.zero}), the shared gateway cache removed ${o.b5zero} of the calls against direct MCP and IDEM ${o.b2zero}, against a bound of ${o.bound}. There the two can differ only by identical calls in flight at the same time: B2's reduction against B5 is ${o.gap}. B5 keys on the arguments as sent, so an equivalent spelling is a miss for it, while IDEM's producer-declared canonicalization gives it the same name. With ${o.top} of the URLs in an equivalent form, B5 removed ${o.b5top} and IDEM ${o.b2top}; against B5, ${o.gapTop}.`,
      },
      burst: {
        title: "Upstream reduction as code sends calls in bursts",
        desc: "Line chart of upstream reduction against direct MCP as the number of calls an agent's code sends at once per step grows, one line each for the per-agent cache, the shared gateway cache and IDEM, and the perfect shared cache as a dotted line.",
        x: "calls sent at once per step",
        caption: (o: { agents: string; calls: string; spread: string }) =>
          `W-code: ${o.agents} agents × ${o.calls} calls, no surface variation, agents start within ${o.spread}. Whiskers: 95% confidence interval. The halftone area is what IDEM adds over the shared gateway cache.`,
        reading: (o: {
          one: string;
          dupOne: string;
          pitOne: string;
          gapOne: string;
          top: string;
          dupTop: string;
          pitTop: string;
          gapTop: string;
        }) =>
          `With ${o.one} call per step, B5 sent ${o.dupOne} calls per run upstream while an identical one was already on its way there, IDEM's PIT absorbed ${o.pitOne} of the cacheable requests, and B2's reduction against B5 was ${o.gapOne}. With ${o.top} calls sent at once, B5 sent ${o.dupTop} such duplicates per run, the PIT absorbed ${o.pitTop}, and the reduction against B5 was ${o.gapTop}. A cache that does not coalesce sends each of these duplicates upstream; a PIT answers them with the call already in flight.`,
      },
      sync: {
        title: "Upstream reduction as the agents start closer together",
        desc: "Line chart of upstream reduction against direct MCP as the window in which the agents start shrinks, one line each for the per-agent cache, the shared gateway cache and IDEM, and the perfect shared cache as a dotted line.",
        x: "window in which the agents start",
        within: (d: string) => `within ${d}`,
        instant: "at the same instant",
        caption: (o: { agents: string; calls: string; burst: string }) =>
          `W-code: ${o.agents} agents × ${o.calls} calls in bursts of ${o.burst} sent at once, no surface variation. Whiskers: 95% confidence interval. The halftone area is what IDEM adds over the shared gateway cache.`,
        reading: (o: {
          wide: string;
          dupWide: string;
          pitWide: string;
          gapWide: string;
          narrow: string;
          dupNarrow: string;
          pitNarrow: string;
          gapNarrow: string;
        }) =>
          `When the agents start within ${o.wide}, B5 sent ${o.dupWide} duplicates per run upstream while an identical call was in flight, IDEM's PIT absorbed ${o.pitWide} of the cacheable requests, and B2's reduction against B5 was ${o.gapWide}. When they start ${o.narrow}, as sub-agents an orchestrator spawns together: ${o.dupNarrow} duplicates, ${o.pitNarrow} absorbed, and ${o.gapNarrow} against B5.`,
      },
      chart: {
        tabs: "Metric",
        reduction: { tab: "Upstream reduction" },
        pit: {
          tab: "Absorbed in flight (B2)",
          title: "Requests the PIT absorbed",
          desc: "Line chart of the share of cacheable requests at the edge that IDEM's PIT aggregated with an identical request already in flight, along the sweep.",
          y: "PIT aggregation ratio",
        },
        dup: {
          tab: "Duplicates upstream (B5)",
          title: "Duplicates the gateway cache sent upstream",
          desc: "Line chart of the calls per run that missed the shared gateway cache while an identical call was already upstream, and so went upstream too, along the sweep.",
          y: "duplicates per run",
        },
        columns: { vsB5: "B2 vs. B5", pit: "PIT aggregation (B2)", dup: "duplicates per run (B5)" },
      },
    },
    latency: {
      title: "Latency",
      question: "Does a call get faster, and what does the extra work on a miss cost?",
      verdict: (o: { agents: string; p50: string; ci: string; cpu: string; share: string }) =>
        `At ${o.agents} agents the per-run median latency changed by ${o.p50} (±${o.ci}) against direct MCP, paired by seed; a miss pays ${o.cpu} of extra CPU, ${o.share} of the round trip.`,
      lead: (o: { agent: string; producer: string; service: string }) =>
        `Latency is what the agent observes per call on the virtual clock: ${o.agent} to the edge, ${o.producer} on to the producer, each way, and a log-normal service time with a median of ${o.service}. In the IDEM modes the clock is also charged for the CPU work measured in E1.`,
      cdf: {
        title: "Latency of every call",
        desc: "Cumulative distribution of per-call latency, one curve each for direct MCP, the per-agent cache, the shared gateway cache, IDEM and IDEM on two tiers. A cached call returns in a few milliseconds, so each caching mode starts with a step on the left.",
        x: "latency per call (ms)",
        y: "share of calls",
        caption: (o: { agents: string; hit: string; local: string; gateway: string }) =>
          `All calls at ${o.agents} agents, pooled over seeds, up to the 99th percentile. The step on the left is the share a cache answered: ${o.hit} at the edge for B2, ${o.gateway} at the gateway for B5, ${o.local} locally for B1. A miss costs the same in every mode, but in the IDEM modes it also pays the CPU charged below.`,
      },
      delta: {
        title: "Change of the median against direct MCP",
        desc: "Line chart of the change in median latency against direct MCP, paired by seed, as the number of agents grows, one line each for the per-agent cache, the shared gateway cache, IDEM and IDEM on two tiers.",
        x: "agents",
        y: "median − B0 (ms)",
        caption: "Per-run median latency minus the same seed's B0. Whiskers: 95% confidence interval.",
      },
      table: {
        title: (agents: string) => `Percentiles at ${agents} agents`,
        p: "per-run percentile, mean ± 95% CI",
        d: "change against B0, same seed",
        mean: "mean",
      },
      tail: "The tail barely moves: the slowest calls are misses, and a miss still pays the full trip and the tool's service time.",
      overhead: {
        title: "What a miss pays for names and signatures",
        lead: (o: { args: string; result: string }) =>
          `On a miss, IDEM does work plain MCP does not. Priced with E1's medians for ${o.args} of arguments and the median ${o.result} result:`,
        who: { consumer: "consumer", edge: "edge", producer: "producer" },
        barTotal: (us: string) => `Hover or focus a part. Total: ${us}.`,
        total: (o: { us: string; share: string; rtt: string; service: string }) =>
          `${o.us} in all: ${o.share} of the ${o.rtt} round trip, before the ${o.service} median service time.`,
        b4: (delta: string) =>
          `Skipping the forwarder's verification (B4) made the mean call ${delta} faster. That is the whole price of [P-7.1], verify before caching.`,
        b3: (delta: string) =>
          `The second tier (B3) made it ${delta} slower: one more hop on each hit that the edge misses.`,
        bar: "CPU added to a miss, by step",
      },
    },
    sensitivity: {
      title: "Where it stops helping",
      question: "When does sharing stop helping?",
      verdict: (o: { losing: string; late: string; max: string }) =>
        `${o.losing ? `A shared store of ${o.losing} or less is clearly beaten by private caches` : "No tested store size is clearly beaten by private caches"}; measured on the producer's clock, up to ${o.late} answers per run arrived past their freshness, by ${o.max} at most.`,
      lead: "Three sweeps move one parameter of the base workload (8 agents, overlap 0.5) at a time.",
      y: "upstream reduction",
      ttl: {
        title: "Freshness (TTL)",
        desc: "Line chart of upstream reduction against the manifest TTL from 250 milliseconds to 5 minutes. Reduction grows with the TTL and levels off at 60 seconds.",
        x: "manifest TTL",
        caption:
          "A run lasts about 45 s of virtual time, so a TTL of a minute or more never expires within it. Short TTLs cost IDEM and private caches alike.",
      },
      cs: {
        title: "Content Store budget",
        desc: "Line chart of upstream reduction against the Content Store byte budget from 0 to 8 mebibytes. Below 64 kibibytes IDEM does worse than the per-agent cache.",
        x: "byte budget per store (LRU)",
        caption: (o: { size: string; b2: string; b1: string }) =>
          `The median result is 6 KiB. With ${o.size} or less, the shared store evicts faster than agents ask again and B2 (${o.b2}) does worse than private caches (${o.b1}), which are not bounded here. Two tiers help a little: the regional store is a second budget.`,
      },
      think: {
        title: "Think time",
        desc: "Line chart of upstream reduction against the mean think time from 100 milliseconds to 10 seconds. Reduction is flat up to 2 seconds and falls beyond, as runs outlast the TTL.",
        x: "mean think time between calls",
        caption:
          "Faster agents do not gain: the store already answers every repeat. Slower agents lose, because a run then outlasts the 60 s TTL.",
      },
      staleLabel: "About answers that arrived late",
      stale: (o: { late: string; max: string }) =>
        `No Data was served stale in any run by the protocol's rule, which counts age from each hop's receipt [P-8.1]. Measured on the producer's clock instead, up to ${o.late} answers per run at the short TTLs arrived past their freshness, by ${o.max} at most: the time a Data spends in transit is not part of its age.`,
      mixed: {
        title: "Calls that must not be cached",
        lead: "W-mixed sends 10% of the calls to a private tool and a growing share to a tool with side effects, which is never cacheable and passes through.",
        fraction: "side-effecting calls",
        bypass: "passthrough at the edge (B2, per run)",
        clean: (o: { runs: string }) =>
          `Across the ${o.runs} runs of this sweep: 0 failed calls, 0 stale serves, 0 private results delivered to the wrong agent.`,
      },
    },
    e1: {
      title: "The cost of the crypto path",
      question: "What does naming, signing and verifying a call cost?",
      verdict: (o: { small: string; verify: string; big: string; canon: string }) =>
        `verifyData takes ${o.verify} at ${o.small} and canonicalizeArgs ${o.canon} at ${o.big} (medians over runs).`,
      lead: "One call of each operation in @idem/core, timed with performance.now() after a warm-up, for payloads from 1 KiB to 1 MiB. The payload is the argument text for canonicalizeArgs and makeName, and the result text for signData and verifyData.",
      chart: {
        title: "Time per call by payload size",
        desc: "Log-log line chart of the median time per call of canonicalizeArgs, makeName, signData and verifyData for payloads from 1 kibibyte to 1 mebibyte. All grow linearly with size at large payloads; canonicalizeArgs is the steepest.",
        x: "payload",
        y: "median time per call",
        caption: (o: { runs: number; node: string; cpu: string }) =>
          `Median over ${o.runs} runs of each run's median, on ${o.cpu}, Node ${o.node}. Whiskers: the fastest and the slowest run. Both axes are logarithmic.`,
      },
      load: (o: { busy: number; runs: number; cores: string; max: string }) =>
        o.busy === 0
          ? `The 1-minute load average stayed under the machine's ${o.cores} cores during all ${o.runs} runs.`
          : `${o.busy} of the ${o.runs} runs were taken while the machine was busy with other work (1-minute load average above its ${o.cores} cores, up to ${o.max}). They are kept, and they are why the whiskers reach so far up.`,
      reading: (o: { small: string; verify: string; canon: string }) =>
        `For a result of a few kibibytes the signature dominates: verifyData takes ${o.verify} at ${o.small}. Past that, hashing and JSON canonicalization take over and every operation grows with the payload; canonicalizeArgs is the steepest (${o.canon} at 1 MiB), because it validates, normalizes and re-serializes its input.`,
      browser: "The browser half of E1 (Playwright, headless Chromium) has not run.",
      columns: {
        size: "Payload",
        p50: "median",
        range: "runs: fastest to slowest median",
        p95: "p95",
        p99: "p99",
        iterations: "iterations per run",
      },
    },
    e5: {
      title: "Safety",
      question: "Does any attack on a claim of the protocol get through?",
      verdict: (o: { stopped: string; expected: string; findings: number; limits: number }) =>
        `${o.stopped} of ${o.expected} attack variants the protocol must stop were stopped in every trial; ${o.findings} open ${o.findings === 1 ? "finding" : "findings"}, ${o.limits} documented ${o.limits === 1 ? "limit" : "limits"} measured.`,
      lead: (o: { trials: string; variants: number }) =>
        `${o.variants} attack variants, ${o.trials} trials each, against the real forwarder, producer, trust store and verifier of @idem/core on a virtual clock. Each trial builds a fresh world from its seed and is judged on ground truth: a variant counts as rejected only if no victim accepted forged, foreign or out-of-lifetime content and no cache kept any.`,
      findings: {
        title: (n: number) =>
          n === 1
            ? "One variant the engine should stop was accepted"
            : `${n} variants the engine should stop were accepted`,
        lead: "The protocol claims to stop this. The engine did not. It is reported as found; nothing was changed in the engine to hide it.",
        every: (accepted: string, trials: string) => `accepted in ${accepted} of ${trials} trials`,
        none: "Every variant the protocol claims to stop was stopped in every trial.",
        text: {} as Record<string, string>,
      },
      limits: {
        title: "Documented limits of v1",
        lead: "The protocol does not claim to stop these in v1. The suite runs them all the same, so that a limit is a number and not a footnote.",
        every: (accepted: string, trials: string) => `accepted in ${accepted} of ${trials} trials`,
        leaked: (accepted: string, trials: string) => `inferred correctly in ${accepted} of ${trials} trials`,
        text: {
          "replay/in-tolerance@upstream":
            "Bounded staleness. A party on the producer link substitutes a genuine Data whose freshness has run out but which is still inside the clock tolerance. The signed lifetime [P-8.6] is freshness plus that tolerance, so the edge accepts it, by design: the tolerance is what lets nodes with clocks a little apart agree. The suite also checks the bound: a consumer asking once the copy is outside its lifetime gets a fresh answer. Older replays are refused (replay/expired@upstream). ADR-034.",
          "replay/in-tolerance@last-hop":
            "The same replay on the agent's own link, inside the tolerance, passes the consumer's check for the same reason; one older than freshness plus the tolerance is refused (replay/expired@last-hop). ADR-034.",
          "timing/cache-probe":
            "Timing. A fast answer reveals that someone asked for that public name before. Open question Q3 lists it as an accepted risk, with no defence in v1.",
        } as Record<string, string>,
      },
      columns: {
        variant: "Variant",
        where: "Attacker at",
        rejected: "Rejected",
        outcome: "How it ended (suite output)",
      },
      accepted: "accepted",
      acceptedLimit: "accepted (documented limit)",
      leaked: "leaked (accepted risk)",
      precondition: "Assumes the attacker",
      attack: {
        tamper: "Tamper: Data changed in flight",
        forge: "Forge: a name that does not match its arguments",
        replay: "Replay: a genuine Data shown again late, or dated ahead of the clock",
        private: "Private: asking across authorization contexts",
        poison: "Poison: Data signed by a key outside the manifest",
        timing: "Timing: the side channel of open question Q3",
      } as Record<string, string>,
      where: {
        "producer link": "producer link",
        "agent link": "agent link",
        consumer: "consumer",
        "forwarder (malicious)": "malicious forwarder",
        "regional forwarder (malicious)": "malicious regional forwarder",
        "none (honest path)": "nobody (honest path)",
        "gateway cache (B5)": "the gateway's cache (B5)",
        "producer link (B5)": "producer link (B5)",
        "consumer (B5)": "consumer (B5)",
      } as Record<string, string>,
      what: {
        "tamper/content@upstream": "Rewrites the result text between the producer and the edge.",
        "tamper/content@last-hop": "Rewrites the result text between the edge and the agent.",
        "tamper/freshness@upstream":
          "Raises the signed freshnessMs a thousandfold so caches keep the Data longer.",
        "tamper/signature@upstream": "Changes one character of the signature.",
        "tamper/swap-name@upstream": "Answers with a genuine, correctly signed Data of a different document.",
        "tamper/swap-name@last-hop":
          "Hands the agent a genuine, correctly signed Data of a different document.",
        "tamper/scope@upstream": "Relabels a private result as public so the edge would share it.",
        "forge/args-swap@edge": "Sends the name of one document with the arguments of another.",
        "forge/random-digest@edge": "Sends real arguments under a name with a random args digest.",
        "forge/args-swap@producer":
          "A forwarder that skips its check passes the mismatched Interest to the producer.",
        "replay/expired-cache": "Asks again after the cached copy expired; the edge must not serve it.",
        "replay/expired@upstream":
          "Substitutes a recorded Data, older than its freshness plus the clock tolerance, for the producer's new answer.",
        "replay/expired@last-hop":
          "Answers the victim's Interest with a Data it once fetched, older than its freshness plus the clock tolerance.",
        "replay/in-tolerance@upstream":
          "Substitutes a recorded Data past its freshness but inside the clock tolerance for the producer's new answer.",
        "replay/in-tolerance@last-hop":
          "Answers the victim's Interest with a Data past its freshness but inside the clock tolerance.",
        "replay/understated-age@core":
          "A malicious regional forwarder hands the edge an old Data with its ageMs set back to look fresh.",
        "replay/future-dated@upstream":
          "Offers a genuine Data whose signed producedAt lies beyond the clock tolerance in the future.",
        "baseline/tamper-cache@edge":
          "Rewrites a stored result in the gateway's cache; every later user of that call is served the altered text.",
        "baseline/tamper@upstream":
          "Rewrites the result between the producer and the gateway, which caches it and serves it to later users.",
        "baseline/private-miskeyed@edge":
          "Asks for the per-user tool right after another user's result was cached at the gateway.",
        "replay/unsolicited@consumer-face": "Pushes an old genuine Data into the edge from a consumer face.",
        "private/sequential": "Asks for the private name right after another user's result was cached.",
        "private/concurrent": "Asks for the private name while another user's Interest is pending.",
        "private/anonymous": "Asks for the private name with no credential at all.",
        "private/tree":
          "Two users behind different edges ask at once; the regional forwarder sees no authContext.",
        "private/authcontext-guess": "Fills the Interest's authContext field itself with a random value.",
        "private/authcontext-known": "Fills the Interest's authContext field itself with the victim's value.",
        "poison/unknown-key@upstream": "Replaces the answer with Data validly signed by its own key.",
        "poison/spoofed-key-id@upstream":
          "Signs with its own key but names the producer's key in the locator.",
        "poison/other-producer@upstream":
          "Signs the victim's name with the key of another, trusted producer.",
        "poison/rogue-manifest@upstream":
          "Offers a newer manifest listing only its own key, then signs with it.",
        "poison/unknown-key@last-hop": "Hands the agent Data validly signed by its own key.",
        "poison/unsolicited@consumer-face": "Pushes its own signed Data into the edge from a consumer face.",
        "timing/cache-probe": "Infers from an answer's latency whether someone asked for the name before.",
      } as Record<string, string>,
      assumes: {
        "private/authcontext-known":
          "knows the victim's authContext, a value the edge derives and never sends to anyone.",
        "poison/other-producer@upstream": "is itself a producer every node trusts, for its own names.",
        "timing/cache-probe": "can time its own requests.",
        "replay/future-dated@upstream":
          "holds a genuine Data the producer signed with a producedAt hours ahead (a producer clock glitch).",
        "baseline/tamper-cache@edge":
          "controls the gateway's cache store: a compromised, buggy or malicious gateway or cache backend.",
        "baseline/tamper@upstream":
          "controls the link between the gateway and the producer: no TLS on that hop, or a compromised hop on it.",
        "baseline/private-miskeyed@edge":
          "is a second user of a gateway whose operator listed the per-user tool as cacheable without a per-credential partition, keyed on tool and arguments (a misconfiguration).",
      } as Record<string, string>,
      baseline: {
        title: "The same attacks on the shared gateway cache (B5)",
        lead: "Three attacks of the suite, run again against B5: plain MCP clients, the same producer answering as a plain MCP server, and the shared cache at the edge. Each row sits beside the IDEM variant it mirrors, with both counts from the same run.",
        columns: { attack: "Attack on B5", b5: "Accepted by B5", idem: "The same attack on IDEM" },
        pair: (o: { holding: number; pairs: number }) =>
          `In ${o.holding} of ${o.pairs} pairs the unsigned cache accepted the attack in at least one trial and IDEM in none.`,
        reading:
          "This is the outcome to expect: a cache that keeps no signature has nothing to check a result against, and a cache keyed on tool and arguments has no notion of whose result it holds. The rows are not a finding about any product. They put a number on what the signature and the authorization partition buy against the same attack; they do not measure how often a gateway is compromised or misconfigured. A gateway that adds the caller's token to its key, as FastMCP does, would not leak the private result, and would share nothing between users either.",
        accepted: (accepted: string, trials: string) => `${accepted} of ${trials} trials`,
        missing: "not in this run",
      },
    },
    method: {
      title: "Method",
      question: "How were these numbers produced, and what has not run?",
      lead: "The plan for all five experiments, the metrics and the reporting rules are in the documentation.",
      docs: "Read the evaluation method",
      modesTitle: "Modes compared",
      baseTitle: "Base configuration of the sweeps",
      baseLead:
        "Each sweep changes one of these and keeps the rest. They are assumptions about a swarm, not measurements of one: real traces (E3) would replace them.",
      base: {
        agents: "agents",
        calls: "calls per agent",
        catalog: "shared catalog",
        catalogValue: (n: string, alpha: string) => `${n} documents, Zipf α = ${alpha}`,
        overlap: "overlap",
        think: "think time",
        thinkValue: (v: string) => `exponential, mean ${v}`,
        surface: "equivalent spellings of a URL",
        surfaceValue: (v: string) => `${v} of the calls`,
        links: "links, one way",
        linksValue: (a: string, p: string) => `agent to edge ${a}, edge to producer ${p}`,
        tree: "two tiers (B3)",
        treeValue: (e: number, c: string, p: string) =>
          `${e} edges, edge to regional ${c}, regional to producer ${p}`,
        service: "service time",
        serviceValue: (m: string, s: string) => `log-normal, median ${m}, σ = ${s}`,
        result: "result size",
        resultValue: (v: string) => `log-normal, median ${v}`,
        ttl: "TTL",
        cs: "Content Store",
        csValue: (v: string, p: string) => `${v} per forwarder, ${p.toUpperCase()}`,
        loss: "loss",
        seeds: "seeds",
        seedsValue: (n: number, first: string) => `${n} per point (${first}), the same at every point`,
        cpu: "CPU cost",
        cpuValue: (n: number) =>
          `charged in the IDEM modes from the medians of ${n} E1 runs; the baselines are charged nothing`,
      },
      notRunTitle: "Not run",
      notRun: {
        e3: "E3, real-agent traces: needs a budgeted LLM swarm. Until it runs, the workload is synthetic and no trace is replayed.",
        e4: "E4, network emulation: needs Docker. Hypothesis H4 waits for it.",
        browser: "E1 in a browser: the Playwright half of the microbenchmarks.",
      },
      reproduceTitle: "Reproduce",
      reproduce:
        "One command reruns E1, E2 and E5 from a clean checkout and regenerates this page's data. The simulations are deterministic for their seeds; E1 depends on the machine.",
      runsTitle: "Runs behind this page",
      runsLead: (digest: string) =>
        `Each run records the commit it ran at (with -dirty for local changes) and a SHA-256 digest of the package sources, tests excluded, so a run names its code even without git. This page's data was exported at source digest ${digest}.`,
      runs: {
        experiment: "Experiment",
        id: "Run id",
        seed: "Seeds",
        digest: "Source digest",
        load: "Load average, start → end",
        duration: "Took",
        env: (node: string, cpu: string, cores: string, platform: string) =>
          `All runs: Node ${node}, ${cpu} (${cores} cores), ${platform}.`,
      },
    },
  },
  {
    meta: {
      title: "Benchmarks",
      description:
        "O IDEM medido: o binding NDN nativo contra forwarders NFD reais e o overlay HTTP contra o NDN nativo sob perda (E4), e depois as evidências que o sustentam: enxames de agentes simulados (E2), o custo de nomear, assinar e verificar (E1) e uma suíte adversarial (E5).",
    },
    nav: {
      native: "NDN nativo",
      verdicts: "Veredictos",
      redundancy: "Redundância",
      gateway: "Cache compartilhado",
      latency: "Latência",
      sensitivity: "Sensibilidade",
      cost: "Custo",
      safety: "Segurança",
      method: "Método",
    },
    ask: {
      question: "Pergunta",
      verdict: "O que os dados dizem",
      native: {
        e4: (o: {
          loss: string;
          n2ok: string;
          b2ok: string;
          n2p50: string;
          b2p50: string;
          n2p95: string;
          b2p95: string;
          n2bytes: string;
          b2bytes: string;
        }) =>
          `Com ${o.loss}% de perda em cada enlace, a estrela nativa (N2) respondeu ${o.n2ok} das suas chamadas e a estrela do overlay (B2) ${o.b2ok}; latência mediana de ${o.n2p50} contra ${o.b2p50}, percentil 95 de ${o.n2p95} contra ${o.b2p95}; bytes no enlace do produtor: ${o.n2bytes} contra ${o.b2bytes}.`,
        e4Partial:
          "O E4 tem uma execução, mas ela não inclui as estrelas nativa e do overlay na maior perda, então nenhuma comparação é afirmada.",
        e4Pending:
          "O E4, overlay contra NDN nativo sob perda, ainda não foi executado: não há resultado a afirmar.",
        nfd: (o: { passed: string; total: string; stopped: string; failing: string; previous: string }) =>
          `Contra forwarders NFD reais, a última execução de conformidade passou em ${o.passed} de ${o.total} cenários${o.stopped ? `; ${o.stopped} parou em um erro antes de qualquer verificação` : ""}${o.failing ? `; verificações falharam em ${o.failing}` : ""}.${o.previous ? ` ${o.previous}` : ""}`,
        nfdPrevious: (passed: string, total: string) =>
          `A execução anterior passou em ${passed} de ${total}.`,
      },
    },
    hero: {
      kicker: "Benchmarks",
      title: "O IDEM, medido.",
      lead: "O IDEM nomeia uma chamada de ferramenta, assina a resposta e deixa qualquer forwarder do caminho servi-la. Esta página começa pelo IDEM em forwarders NDN reais: o binding nativo contra o NFD e o overlay HTTP contra o NDN nativo sob perda (E4). Depois vêm os experimentos que o sustentam: o que o compartilhamento economiza (E2), o que a criptografia custa (E1) e o que um atacante consegue (E5). Todo número é lido de uma pasta de execução versionada, e cada figura cita as suas execuções.",
      kindsLabel: "Que tipo de resultado cada experimento é",
      kinds: [
        {
          id: "nfd",
          name: "Verificação NFD",
          text: "O binding nativo contra forwarders NFD reais em Docker. Passa ou falha, não é uma medição.",
        },
        {
          id: "e4",
          name: "E4",
          text: "O overlay HTTP e o NDN nativo nos mesmos enlaces emulados, com perda de pacotes (Docker, tc netem). Tempo de relógio real em uma máquina.",
        },
        {
          id: "sim",
          name: "E2, E5",
          text: "Simulação em um relógio virtual, não uma medição de uma rede implantada.",
        },
        {
          id: "e1",
          name: "E1",
          text: "Tempo de relógio real das operações de nomeação e criptografia, em uma máquina.",
        },
      ],
      notRun: "Ainda não foi executado.",
    },
    tiles: {
      label: "Números principais",
      nfd: {
        value: (ok: string, all: string) => `${ok} de ${all}`,
        label: "cenários passam contra forwarders NFD reais, última execução",
        sub: (o: { stopped: number; previous: string }) =>
          `${o.stopped > 0 ? `${o.stopped} parou em um erro antes de qualquer verificação. ` : ""}${o.previous}`.trim() ||
          "Uma verificação de conformidade, não uma medição.",
        earlier: (passed: string, total: string) => `A execução anterior: ${passed} de ${total}.`,
      },
      e4: {
        pending: "Pendente",
        pendingLabel: "overlay contra NDN nativo sob perda (E4)",
        pendingSub: "O E4 ainda não foi executado. Nenhum número é mostrado.",
        label: (loss: string) => `das chamadas respondidas sobre NDN nativo com ${loss}% de perda`,
        sub: (b2: string) => `Overlay HTTP, mesma topologia em estrela: ${b2}`,
      },
      upstream: {
        label: "menos chamadas chegam ao produtor (simulação)",
        sub: (agents: string, ci: string) =>
          `B2 contra MCP direto, ${agents} agentes, sobreposição 0,5 · ±${ci} pontos`,
      },
      safety: {
        value: (ok: string, all: string) => `${ok} de ${all}`,
        label: "variantes de ataque que o protocolo deve barrar, barradas em todas as tentativas",
        sub: (accepted: number, limits: number) =>
          `${accepted === 0 ? "nenhuma aceita" : accepted === 1 ? "1 aceita" : `${accepted} aceitas`}; ${limits} ${limits === 1 ? "limite documentado medido" : "limites documentados medidos"}`,
      },
    },
    status: {
      supported: "Sustentada",
      partly: "Sustentada em parte",
      refuted: "Refutada",
      "not-evaluated": "Não avaliada",
    },
    hyp: {
      title: "As hipóteses",
      question:
        "As hipóteses que o projeto enunciou antes de executar os experimentos que as testam se sustentam?",
      verdict: (o: { supported: number; partly: number; refuted: number; pending: number }) =>
        `${o.supported} sustentadas, ${o.partly} sustentadas em parte, ${o.refuted} refutadas e ${o.pending} não avaliadas, pelas regras escritas ao lado de cada uma.`,
      lead: "O projeto enunciou quatro hipóteses falseáveis antes de qualquer experimento, e mais duas, H5 e H6, com as suas regras, antes das varreduras e dos ataques que as testam. Os veredictos são calculados a partir dos dados, com a regra ao lado de cada um.",
      h1: {
        claim:
          "Em cargas de enxame com sobreposição entre agentes, o IDEM reduz as chamadas que chegam ao produtor em comparação com MCP direto e com um cache local por agente.",
        base: (o: { agents: string; vsB0: string; ciB0: string; vsB1: string; ciB1: string }) =>
          `Com ${o.agents} agentes e sobreposição 0,5, o B2 enviou ${o.vsB0} (±${o.ciB0} pontos) menos chamadas ao produtor do que o MCP direto e ${o.vsB1} (±${o.ciB1}) menos do que os caches por agente.`,
        largest: (o: { agents: string; vsB0: string; vsB1: string }) =>
          `Com ${o.agents} agentes: ${o.vsB0} e ${o.vsB1}.`,
        rule: (o: { aboveB0: number; aboveB1: number; points: number }) =>
          `Regra: o intervalo de 95% da redução fica acima de zero onde os agentes podem compartilhar (dois ou mais agentes, sobreposição acima de zero). Contra B0: ${o.aboveB0} de ${o.points} pontos. Contra B1: ${o.aboveB1} de ${o.points}.`,
        alone:
          "Com um único agente, ou sem sobreposição, não há o que compartilhar e o B2 faz exatamente o que o B1 faz.",
      },
      h2: {
        claim:
          "As latências p50 e p95 por chamada caem quando há acerto no CS ou agregação na PIT, e o custo extra em uma falta (canonicalizar, assinar, verificar) é pequeno diante da ida e volta até o produtor.",
        base: (o: { agents: string; p50: string; ci50: string; p95: string; ci95: string }) =>
          `Com ${o.agents} agentes, a mediana por execução caiu ${o.p50} (±${o.ci50}) e o percentil 95 caiu ${o.p95} (±${o.ci95}) em relação ao MCP direto, pareado por semente.`,
        rule: (o: { p50: number; p95: number; p99: number; points: number }) =>
          `Regra: o intervalo de 95% da variação fica abaixo de zero em todo ponto com dois ou mais agentes. p50: ${o.p50} de ${o.points}. p95: ${o.p95} de ${o.points}. O percentil 99 não faz parte da hipótese e se moveu menos: ${o.p99} de ${o.points}.`,
        overhead: (o: { us: string; share: string }) =>
          `Uma falta paga ${o.us} de CPU a mais, ${o.share} da ida e volta.`,
        noOverlap: (delta: string) =>
          `Sem sobreposição, esse custo é tudo o que o IDEM acrescenta: a chamada mediana fica ${delta} mais lenta que no MCP direto.`,
      },
      h3: {
        claim: "Nenhuma resposta adulterada é aceita e nenhum resultado privado é servido a outro contexto.",
        integrity: (o: { accepted: string; trials: string; variants: number }) =>
          `Data adulterado, forjado ou assinado com a chave errada aceito: ${o.accepted} de ${o.trials} tentativas (${o.variants} variantes).`,
        privateClean: (o: { trials: string; variants: number }) =>
          `Resultados privados servidos a outro contexto: 0 de ${o.trials} tentativas (${o.variants} variantes).`,
        privateLeak: (o: { accepted: string; trials: string; variants: number; leaking: string }) =>
          `Resultados privados servidos a outro contexto: ${o.accepted} de ${o.trials} tentativas (${o.variants} variantes), em ${o.leaking}.`,
        rule: "Regra: zero aceitos nos dois grupos. A repetição de Data genuíno não entra em nenhum dos dois: uma repetição fora do tempo de vida assinado é uma afirmação à parte [P-8.6, P-8.7] e uma repetição dentro da tolerância de relógio é um limite documentado (ADR-034), ambas medidas em Segurança.",
      },
      h4: {
        claim:
          "Sob perda e em topologias de múltiplos saltos, o cache no caminho reduz os bytes no enlace do produtor e o tempo de recuperação, em comparação com TCP/HTTP fim a fim.",
        ran: "O E4 foi executado e aparece primeiro nesta página. Esta página não codifica regra para a H4, então não afirma veredicto.",
        evidence:
          "Depende da emulação de rede (E4), que não foi executada. As varreduras do E2 rodaram sem perda, então nada aqui fala de recuperação.",
      },
      h5: {
        claim:
          "Contra um cache compartilhado de correspondência exata no gateway, sem assinaturas, sem canonicalização declarada pelo produtor e sem agregação em trânsito (B5): (a) o IDEM envia menos chamadas ao produtor quando os argumentos variam na forma escrita ou quando chamadas idênticas estão em trânsito ao mesmo tempo, e o mesmo número quando nenhuma das duas coisas acontece; (b) um resultado alterado no cache ou no caminho até ele é aceito pelos consumidores do B5 e rejeitado pelos do IDEM.",
        surface: (o: { above: number; points: number; top: string; vsB5: string; ci: string }) =>
          `Variação de grafia: a redução do B2 contra o B5 fica acima de zero em ${o.above} de ${o.points} pontos; ${o.vsB5} (±${o.ci} pontos) com ${o.top} das URLs escritas em uma forma equivalente.`,
        inflight: (o: { above: number; points: number; neither: number; neitherAgree: number }) =>
          `Chamadas idênticas em trânsito, sem variação de grafia: o B5 enviou duplicatas ao produtor em ${o.points} pontos, e a redução do B2 contra ele fica acima de zero em ${o.above} deles. ${o.neither === 0 ? "Nenhum ponto ficou sem duplicatas, então a metade da regra sobre enviar o mesmo número não foi exercitada." : `Nos ${o.neither} pontos sem duplicatas, ela não fica nem acima nem abaixo de zero em ${o.neitherAgree}.`}`,
        unclassified: (n: number) =>
          `${n} ${n === 1 ? "ponto tem" : "pontos têm"} média positiva de duplicatas com intervalo que chega a zero; a regra não diz o que esperar ${n === 1 ? "dele, então ele não é avaliado" : "deles, então eles não são avaliados"}.`,
        attacks: (o: { holding: number; pairs: number }) =>
          `Resultados alterados: em ${o.holding} de ${o.pairs} pares de ataque o cache sem assinatura aceitou o ataque em pelo menos uma tentativa e o IDEM em nenhuma (a tabela em Segurança).`,
        rule: "Regra (a): acima de zero em toda variação de grafia acima de 0 e em todo ponto sem variação em que o B5 teve duplicatas em trânsito; nem acima nem abaixo de zero onde não teve nenhuma. Regra (b): cada ataque de linha de base aceito pelo menos uma vez, o seu espelho no IDEM nunca. A H5 precisa das duas.",
      },
      h6: {
        claim:
          "Quando os agentes emitem as chamadas a partir de código, em rajadas, em vez de uma por turno do modelo (W-code), a parcela das requisições cacheáveis absorvida pela agregação na PIT cresce com o tamanho da rajada e com o quanto os inícios dos agentes coincidem, e a redução do IDEM sobre o B5 cresce junto.",
        trend: (o: { what: string; from: string; to: string; grows: boolean }) =>
          `${o.what}: de ${o.from} para ${o.to}${o.grows ? "" : ", o que não atende à regra"}.`,
        what: {
          "e2-code-burst/pit_aggregation_ratio": "Agregação na PIT conforme a rajada cresce",
          "e2-code-burst/upstream_reduction_vs_b5": "Redução contra o B5 conforme a rajada cresce",
          "e2-code-sync/pit_aggregation_ratio": "Agregação na PIT conforme a janela de início encolhe",
          "e2-code-sync/upstream_reduction_vs_b5": "Redução contra o B5 conforme a janela de início encolhe",
        } as Record<string, string>,
        rule: (o: { grows: number; all: number }) =>
          `Regra: uma métrica cresce quando os seus dois extremos estão separados (intervalos de 95% que não se sobrepõem) no sentido indicado e nenhum par de pontos consecutivos está separado no sentido oposto. ${o.grows} de ${o.all} crescem; a H6 precisa de todas.`,
      },
    },
    native: {
      title: "O IDEM em NDN real",
      lead: "A pergunta em que o projeto se apoia: o IDEM funciona quando os seus nomes e Data assinados atravessam forwarders NDN reais, e o que isso muda em relação ao overlay HTTP quando a rede perde pacotes? Duas evidências, o E4 primeiro.",
      question:
        "O IDEM funciona em forwarders NDN reais, e o que o binding nativo muda em relação ao overlay HTTP quando a rede perde pacotes?",
      e4: {
        title: "E4: overlay HTTP contra NDN nativo sob perda",
        lead: "Os mesmos agentes, produtor e enlaces (Docker, com atraso e perda do tc netem em cada enlace) carregam o IDEM de dois jeitos: por forwarders HTTP (B2, B3) e como Interests e Data NDN nativos pelo NFD (N2, N3). O B0 é MCP comum. A perda em cada enlace, nos dois sentidos, é o eixo x.",
        pending: {
          title: "O E4 ainda não foi executado",
          text: "Não há resultado do E4 para mostrar, então esta seção não mostra número algum. Quando a sua pasta de execução for versionada em experiments/results/e4, as figuras aparecem aqui sem nenhuma mudança na página.",
          will: "Depois de executado, esta seção mostra, para os cinco modos acima: chamadas respondidas, latência mediana e do percentil 95 e bytes no enlace do produtor contra a perda; a distribuição da latência em cada nível de perda; e uma tabela de cada valor com o seu intervalo de confiança. Para executá-lo:",
        },
        x: "perda em cada enlace",
        tabs: "Métrica",
        chartsTitle: "O que a perda faz com cada modo",
        chart: {
          completion: {
            tab: "Conclusão",
            title: "Chamadas respondidas conforme a perda cresce",
            desc: "Gráfico de linhas da parcela de chamadas respondidas contra a perda em cada enlace, uma linha por modo.",
            y: "chamadas respondidas",
          },
          p50: {
            tab: "Latência mediana",
            title: "Latência mediana conforme a perda cresce",
            desc: "Gráfico de linhas da latência mediana das chamadas respondidas contra a perda em cada enlace, uma linha por modo.",
            y: "latência mediana (ms)",
          },
          p95: {
            tab: "Percentil 95",
            title: "Latência do percentil 95 conforme a perda cresce",
            desc: "Gráfico de linhas da latência do percentil 95 das chamadas respondidas contra a perda em cada enlace, uma linha por modo.",
            y: "percentil 95 (ms)",
          },
          bytes: {
            tab: "Bytes no enlace do produtor",
            title: "Bytes no enlace do produtor conforme a perda cresce",
            desc: "Gráfico de linhas dos bytes que cruzaram o enlace até o produtor contra a perda em cada enlace, uma linha por modo.",
            y: "bytes no enlace do produtor",
          },
        },
        caption: (o: { agents: string; calls: string; seeds: number }) =>
          `${o.agents} agentes × ${o.calls} chamadas, W-syn no ponto base do E2, ${o.seeds} sementes por ponto. Barras: intervalo de confiança de 95%. As páginas são limitadas para caber em um pacote NDN, então todos os modos servem as mesmas páginas.`,
        cdf: {
          title: "Latência de cada chamada respondida",
          desc: "Distribuição acumulada da latência das chamadas respondidas até o percentil 99, uma curva por modo, para o nível de perda escolhido.",
          tabs: "Nível de perda",
          tab: (loss: string) => `${loss} de perda`,
          x: "latência (ms)",
          y: "parcela das chamadas",
          caption:
            "Chamadas respondidas, juntas entre as sementes, até o percentil 99. As que falharam não estão nela; a parcela respondida está no gráfico acima.",
        },
        table: {
          row: "Modo · perda",
          completion: "Respondidas",
          p50: "p50",
          p95: "p95",
          bytes: "Enlace do produtor",
          retrans: "Retransmissões",
        },
        guard: (n: number) =>
          `A guarda de validade descartou e repetiu ${n} ${n === 1 ? "execução" : "execuções"} em que o host congelou.`,
      },
      nfd: {
        title: "O binding nativo contra o NFD real",
        lead: "O @idem/ndn conversa com forwarders NFD em Docker por faces TCP, UDP e WebSocket. Cada cenário verifica regras do protocolo no fio. O resultado é passa ou falha, não uma medição.",
        pass: "passa",
        fail: "falha",
        stopped: "parou antes de qualquer verificação:",
        checks: (n: number, failed: number) =>
          failed > 0 ? `${n} verificações, ${failed} falharam` : `${n} verificações`,
        version: (o: { nfd: string; ndnts: string; image: string }) =>
          `NFD ${o.nfd}, NDNts ${o.ndnts}, imagem ${o.image}. A última execução é a mostrada.`,
        previous: (o: { id: string; passed: string; total: string }) =>
          `A execução anterior (${o.id}) passou em ${o.passed} de ${o.total}.`,
        scenario: {
          S1: "Ida e volta e bootstrap do manifesto",
          S2: "Agregação no PIT",
          S3: "Content Store e frescor",
          S4: "Grafias equivalentes dão um só nome",
          S5: "private nunca é enviado no NDN",
          S6: "Data adulterado é rejeitado",
          S7: "O limite de tamanho do pacote",
          S8: "Cadeia de dois forwarders",
          S9: "Face WebSocket",
        } as Record<string, string>,
      },
    },
    modes: {
      B0: "MCP direto",
      B1: "cache por agente",
      B2: "IDEM",
      B3: "IDEM, dois níveis",
      B4: "IDEM, sem verificar nos forwarders",
      B5: "cache compartilhado no gateway, sem assinatura",
      N2: "IDEM em NDN nativo",
      N3: "IDEM em NDN nativo, dois níveis",
      bound: "cache compartilhado perfeito",
      desc: {
        B0: "Toda chamada vai ao produtor, um servidor MCP comum. A borda apenas repassa.",
        B1: "Cada agente mantém o seu cache de resultados, com o nome canônico como chave (ganha de graça a canonicalização do IDEM). A linha de base mais forte que não muda nada na rede.",
        B2: "Agentes → um forwarder de borda (PIT e Content Store) → produtor. Cada salto e cada agente verifica.",
        B3: "Agentes → duas bordas → um forwarder regional → produtor, com o mesmo atraso fim a fim do B2.",
        B4: "B2 com a verificação antes do cache desligada no forwarder, só para isolar o que ela custa.",
        B5: "MCP comum com um cache de respostas na borda compartilhado por todos os agentes, como os gateways MCP o oferecem: chave pela ferramenta e pelos argumentos como enviados (fora a ordem das chaves), o TTL do manifesto e o orçamento em bytes do Content Store. Sem assinaturas, sem canonicalização declarada pelo produtor, sem agregação de chamadas idênticas em trânsito (ADR-036).",
        N2: "A estrela do B2 em NDN nativo: agentes → um NFD de borda → produtor, Interests e Data assinados sobre faces UDP, sem HTTP.",
        N3: "A árvore do B3 em NDN nativo: agentes → dois NFDs de borda → um NFD regional → produtor.",
      },
    },
    chart: {
      table: "Tabela de valores",
      meanCi: "Média entre sementes ± meia largura do intervalo de confiança de 95%.",
      legend: "Séries",
      mode: "Modo",
      simulation: "Simulação",
      wallClock: "Relógio real",
      run: "execução",
      runs: "execuções",
      seeds: (n: number) => `${n} sementes por ponto`,
      emulation: "Emulação",
      hint: "Passe o mouse, toque ou use as setas para ler os valores exatos. Pressione uma entrada da legenda para ocultar ou mostrar uma série.",
      hide: "Ocultar",
      show: "Mostrar",
      showAll: "Mostrar todas as séries",
      noteCi: (n: number) => `Média ± IC 95% em ${n} sementes`,
      noteRange: (n: number) => `Mediana de ${n} execuções; a faixa das execuções entre parênteses`,
      notePooled: (n: number) => `Todas as chamadas respondidas, juntas, em ${n} sementes`,
    },
    redundancy: {
      title: "Chamadas que nunca chegam ao produtor",
      question: "Quantas chamadas de ferramenta o compartilhamento impede de chegar ao produtor?",
      verdict: (o: { agents: string; b2: string; ci: string; b1: string; b5: string }) =>
        `Com ${o.agents} agentes e sobreposição 0,5, o IDEM enviou ${o.b2} (±${o.ci} pontos) menos chamadas ao produtor do que o MCP direto; os caches por agente, ${o.b1}; o cache compartilhado no gateway, ${o.b5}.`,
      lead: "A redução a montante é a parcela das chamadas de ferramenta que não chegou ao produtor, em relação ao MCP direto na mesma carga e semente. A carga é sintética (W-syn): cada agente faz 20 chamadas com um tempo de reflexão entre elas, e uma fração delas, a sobreposição, é sorteada de um catálogo que o enxame inteiro compartilha.",
      agents: {
        title: "Redução a montante conforme o enxame cresce",
        desc: "Gráfico de linhas da redução a montante contra MCP direto conforme o número de agentes cresce, uma linha para o cache por agente, o cache compartilhado no gateway, o IDEM e o IDEM em dois níveis, e o cache compartilhado perfeito como linha pontilhada.",
        x: "agentes",
        y: "redução a montante",
        caption:
          "W-syn com sobreposição 0,5. Hastes: intervalo de confiança de 95%. A linha pontilhada é um cache compartilhado perfeito, cada nome distinto buscado uma vez.",
        note: "O IDEM acompanha o limite: com TTL de 60 s e um store de 8 MiB, nada expira nem é removido durante uma execução. B3 e B4 chegam ao produtor exatamente tantas vezes quanto o B2. A área em retícula é o que o compartilhamento entre agentes acrescenta sobre os caches privados.",
      },
      overlap: {
        title: "Redução a montante conforme os agentes pedem mais do mesmo",
        desc: "Gráfico de linhas da redução a montante contra MCP direto conforme a sobreposição entre agentes cresce, uma linha para o cache por agente, o cache compartilhado no gateway, o IDEM e o IDEM em dois níveis, e o cache compartilhado perfeito como linha pontilhada.",
        x: "sobreposição entre agentes",
        y: "redução a montante",
        caption: "W-syn com 8 agentes. Hastes: intervalo de confiança de 95%.",
      },
      pit: (o: { base: string; shortest: string; think: string }) =>
        `Quase toda a redução vem do Content Store. A agregação na PIT, dois pedidos idênticos em trânsito ao mesmo tempo, ocorreu em no máximo ${o.base} dos Interests na varredura do enxame, e em ${o.shortest} no menor tempo de reflexão testado (${o.think}). A W-syn não tem uma rajada em que muitos agentes pedem a mesma coisa nova no mesmo instante, que é onde a agregação pesaria; as varreduras de chamadas feitas por código, em Cache compartilhado, acrescentam essas rajadas.`,
      bytes: (o: { one: string; b1: string; base: string; calls: string }) =>
        `Os bytes no enlace do produtor caem menos do que as chamadas, porque um Interest e o seu Data assinado são maiores que uma chamada comum e o seu resultado. Com um agente, o B2 economiza ${o.one} dos bytes onde o B1 economiza ${o.b1}; no ponto base, economiza ${o.base} dos bytes para ${o.calls} das chamadas.`,
      vsB5: (o: { agents: string; surface: string; gap: string }) =>
        `Contra o cache compartilhado no gateway (B5) no mesmo ponto, em que ${o.surface} das URLs estão escritas em uma forma equivalente, ${o.gap}. Do que essa diferença é feita é separado em Cache compartilhado.`,
      columns: {
        vsB0: "vs. B0",
        vsB1: "vs. B1",
        vsB5: "vs. B5",
        bound: "limite",
        hit: "taxa de acerto no CS",
        pit: "agregação na PIT",
        bytes: "bytes vs. B0",
      },
    },
    gateway: {
      title: "Contra um cache compartilhado no gateway",
      question:
        "O que o IDEM acrescenta a um cache compartilhado e sem assinatura no gateway, e onde não acrescenta nada?",
      lead: "O B5 é MCP comum com um cache na borda compartilhado por todos os agentes, com a ferramenta e os argumentos como enviados por chave, do jeito que os gateways MCP oferecem cache de respostas (ADR-036). Ele tem o mesmo TTL e o mesmo orçamento em bytes do Content Store do IDEM. O que lhe falta são nomes feitos de argumentos canônicos declarados pelo produtor, a agregação de chamadas idênticas em trânsito e as assinaturas. As três varreduras daqui separam as duas primeiras coisas; as assinaturas estão em Segurança.",
      verdict: (o: {
        zeroValue: string;
        b5zero: string;
        b2zero: string;
        zero: string;
        topValue: string;
        top: string;
        burstValue: string;
        burst: string;
      }) =>
        `Com variação de grafia de ${o.zeroValue}, em que o B5 eliminou ${o.b5zero} das chamadas em relação ao MCP direto e o IDEM ${o.b2zero}, ${o.zero}; com ${o.topValue}, ${o.top}; com rajadas de ${o.burstValue} chamadas enviadas de uma vez, ${o.burst}.`,
      gap: (o: { side: "above" | "below" | "none"; value: string; ci: string }) =>
        o.side === "above"
          ? `o IDEM enviou ${o.value} (±${o.ci} pontos) menos chamadas ao produtor do que o B5`
          : o.side === "below"
            ? `o IDEM enviou ${o.value} (±${o.ci} pontos) mais chamadas ao produtor do que o B5`
            : `o IDEM enviou tantas chamadas ao produtor quanto o B5, dentro do intervalo de 95% (${o.value} ± ${o.ci} pontos)`,
      surface: {
        title: "Redução a montante conforme os argumentos variam na grafia",
        desc: "Gráfico de linhas da redução a montante contra MCP direto conforme cresce a parcela das URLs escritas em uma forma equivalente, uma linha para o cache por agente, o cache compartilhado no gateway e o IDEM, e o cache compartilhado perfeito como linha pontilhada.",
        x: "URLs escritas em uma forma equivalente",
        caption: (o: { agents: string; overlap: string }) =>
          `W-syn com ${o.agents} agentes, sobreposição ${o.overlap}. Hastes: intervalo de confiança de 95%. A área em retícula é o que o IDEM acrescenta ao cache compartilhado no gateway.`,
        reading: (o: {
          zero: string;
          b5zero: string;
          b2zero: string;
          bound: string;
          gap: string;
          top: string;
          b5top: string;
          b2top: string;
          gapTop: string;
        }) =>
          `Com toda repetição escrita do mesmo jeito (${o.zero}), o cache compartilhado no gateway eliminou ${o.b5zero} das chamadas em relação ao MCP direto e o IDEM ${o.b2zero}, diante de um limite de ${o.bound}. Ali os dois só podem diferir por chamadas idênticas em trânsito ao mesmo tempo: a redução do B2 contra o B5 é ${o.gap}. O B5 usa os argumentos como enviados por chave, então uma grafia equivalente é uma falta para ele, enquanto a canonicalização declarada pelo produtor dá a ela o mesmo nome no IDEM. Com ${o.top} das URLs em uma forma equivalente, o B5 eliminou ${o.b5top} e o IDEM ${o.b2top}; contra o B5, ${o.gapTop}.`,
      },
      burst: {
        title: "Redução a montante conforme o código envia chamadas em rajadas",
        desc: "Gráfico de linhas da redução a montante contra MCP direto conforme cresce o número de chamadas que o código de um agente envia de uma vez por passo, uma linha para o cache por agente, o cache compartilhado no gateway e o IDEM, e o cache compartilhado perfeito como linha pontilhada.",
        x: "chamadas enviadas de uma vez por passo",
        caption: (o: { agents: string; calls: string; spread: string }) =>
          `W-code: ${o.agents} agentes × ${o.calls} chamadas, sem variação de grafia, agentes começam dentro de ${o.spread}. Hastes: intervalo de confiança de 95%. A área em retícula é o que o IDEM acrescenta ao cache compartilhado no gateway.`,
        reading: (o: {
          one: string;
          dupOne: string;
          pitOne: string;
          gapOne: string;
          top: string;
          dupTop: string;
          pitTop: string;
          gapTop: string;
        }) =>
          `Com ${o.one} chamada por passo, o B5 enviou ao produtor ${o.dupOne} chamadas por execução enquanto uma idêntica já estava a caminho de lá, a PIT do IDEM absorveu ${o.pitOne} das requisições cacheáveis e a redução do B2 contra o B5 foi de ${o.gapOne}. Com ${o.top} chamadas enviadas de uma vez, o B5 enviou ${o.dupTop} duplicatas dessas por execução, a PIT absorveu ${o.pitTop} e a redução contra o B5 foi de ${o.gapTop}. Um cache que não agrega envia cada uma dessas duplicatas ao produtor; uma PIT as responde com a chamada que já está em trânsito.`,
      },
      sync: {
        title: "Redução a montante conforme os agentes começam mais juntos",
        desc: "Gráfico de linhas da redução a montante contra MCP direto conforme encolhe a janela em que os agentes começam, uma linha para o cache por agente, o cache compartilhado no gateway e o IDEM, e o cache compartilhado perfeito como linha pontilhada.",
        x: "janela em que os agentes começam",
        within: (d: string) => `dentro de ${d}`,
        instant: "no mesmo instante",
        caption: (o: { agents: string; calls: string; burst: string }) =>
          `W-code: ${o.agents} agentes × ${o.calls} chamadas em rajadas de ${o.burst} enviadas de uma vez, sem variação de grafia. Hastes: intervalo de confiança de 95%. A área em retícula é o que o IDEM acrescenta ao cache compartilhado no gateway.`,
        reading: (o: {
          wide: string;
          dupWide: string;
          pitWide: string;
          gapWide: string;
          narrow: string;
          dupNarrow: string;
          pitNarrow: string;
          gapNarrow: string;
        }) =>
          `Quando os agentes começam dentro de ${o.wide}, o B5 enviou ao produtor ${o.dupWide} duplicatas por execução enquanto uma chamada idêntica estava em trânsito, a PIT do IDEM absorveu ${o.pitWide} das requisições cacheáveis e a redução do B2 contra o B5 foi de ${o.gapWide}. Quando começam ${o.narrow}, como subagentes que um orquestrador cria juntos: ${o.dupNarrow} duplicatas, ${o.pitNarrow} absorvidas e ${o.gapNarrow} contra o B5.`,
      },
      chart: {
        tabs: "Métrica",
        reduction: { tab: "Redução a montante" },
        pit: {
          tab: "Absorvidas em trânsito (B2)",
          title: "Requisições que a PIT absorveu",
          desc: "Gráfico de linhas da parcela das requisições cacheáveis na borda que a PIT do IDEM agregou a uma requisição idêntica já em trânsito, ao longo da varredura.",
          y: "taxa de agregação na PIT",
        },
        dup: {
          tab: "Duplicatas ao produtor (B5)",
          title: "Duplicatas que o cache do gateway enviou ao produtor",
          desc: "Gráfico de linhas das chamadas por execução que faltaram no cache compartilhado do gateway enquanto uma chamada idêntica já estava a caminho do produtor, e por isso foram também, ao longo da varredura.",
          y: "duplicatas por execução",
        },
        columns: { vsB5: "B2 vs. B5", pit: "agregação na PIT (B2)", dup: "duplicatas por execução (B5)" },
      },
    },
    latency: {
      title: "Latência",
      question: "Uma chamada fica mais rápida, e quanto custa o trabalho extra em uma falta?",
      verdict: (o: { agents: string; p50: string; ci: string; cpu: string; share: string }) =>
        `Com ${o.agents} agentes, a latência mediana por execução mudou ${o.p50} (±${o.ci}) em relação ao MCP direto, pareada por semente; uma falta paga ${o.cpu} de CPU a mais, ${o.share} da ida e volta.`,
      lead: (o: { agent: string; producer: string; service: string }) =>
        `Latência é o que o agente observa por chamada no relógio virtual: ${o.agent} até a borda, mais ${o.producer} até o produtor, em cada sentido, e um tempo de serviço log-normal com mediana de ${o.service}. Nos modos IDEM o relógio também é cobrado pelo trabalho de CPU medido no E1.`,
      cdf: {
        title: "Latência de cada chamada",
        desc: "Distribuição acumulada da latência por chamada, uma curva para MCP direto, o cache por agente, o cache compartilhado no gateway, o IDEM e o IDEM em dois níveis. Uma chamada em cache volta em poucos milissegundos, então cada modo com cache começa com um degrau à esquerda.",
        x: "latência por chamada (ms)",
        y: "parcela das chamadas",
        caption: (o: { agents: string; hit: string; local: string; gateway: string }) =>
          `Todas as chamadas com ${o.agents} agentes, somadas entre sementes, até o percentil 99. O degrau à esquerda é a parcela que um cache respondeu: ${o.hit} na borda para o B2, ${o.gateway} no gateway para o B5, ${o.local} localmente para o B1. Uma falta custa o mesmo em todos os modos, mas nos modos IDEM paga também a CPU cobrada abaixo.`,
      },
      delta: {
        title: "Variação da mediana em relação ao MCP direto",
        desc: "Gráfico de linhas da variação da latência mediana contra MCP direto, pareada por semente, conforme o número de agentes cresce, uma linha para o cache por agente, o cache compartilhado no gateway, o IDEM e o IDEM em dois níveis.",
        x: "agentes",
        y: "mediana − B0 (ms)",
        caption:
          "Latência mediana por execução menos a do B0 na mesma semente. Hastes: intervalo de confiança de 95%.",
      },
      table: {
        title: (agents: string) => `Percentis com ${agents} agentes`,
        p: "percentil por execução, média ± IC 95%",
        d: "variação contra B0, mesma semente",
        mean: "média",
      },
      tail: "A cauda quase não se move: as chamadas mais lentas são faltas, e uma falta ainda paga a viagem inteira e o tempo de serviço da ferramenta.",
      overhead: {
        title: "O que uma falta paga por nomes e assinaturas",
        lead: (o: { args: string; result: string }) =>
          `Em uma falta, o IDEM faz trabalho que o MCP comum não faz. Com as medianas do E1 para ${o.args} de argumentos e o resultado mediano de ${o.result}:`,
        who: { consumer: "consumidor", edge: "borda", producer: "produtor" },
        barTotal: (us: string) => `Passe o mouse ou foque uma parte. Total: ${us}.`,
        total: (o: { us: string; share: string; rtt: string; service: string }) =>
          `${o.us} ao todo: ${o.share} da ida e volta de ${o.rtt}, antes do tempo de serviço mediano de ${o.service}.`,
        b4: (delta: string) =>
          `Pular a verificação do forwarder (B4) deixou a chamada média ${delta} mais rápida. Esse é todo o preço de [P-7.1], verificar antes de guardar.`,
        b3: (delta: string) =>
          `O segundo nível (B3) a deixou ${delta} mais lenta: um salto a mais em cada acerto que a borda não tem.`,
        bar: "CPU acrescentada a uma falta, por etapa",
      },
    },
    sensitivity: {
      title: "Onde deixa de ajudar",
      question: "Quando o compartilhamento deixa de ajudar?",
      verdict: (o: { losing: string; late: string; max: string }) =>
        `${o.losing ? `Um store compartilhado de ${o.losing} ou menos é claramente superado por caches privados` : "Nenhum tamanho de store testado é claramente superado por caches privados"}; medido no relógio do produtor, até ${o.late} respostas por execução chegaram depois do seu frescor, por no máximo ${o.max}.`,
      lead: "Três varreduras mudam um parâmetro da carga base (8 agentes, sobreposição 0,5) de cada vez.",
      y: "redução a montante",
      ttl: {
        title: "Frescor (TTL)",
        desc: "Gráfico de linhas da redução a montante contra o TTL do manifesto, de 250 milissegundos a 5 minutos. A redução cresce com o TTL e se estabiliza em 60 segundos.",
        x: "TTL do manifesto",
        caption:
          "Uma execução dura cerca de 45 s de tempo virtual, então um TTL de um minuto ou mais nunca expira dentro dela. TTLs curtos custam igualmente ao IDEM e aos caches privados.",
      },
      cs: {
        title: "Orçamento do Content Store",
        desc: "Gráfico de linhas da redução a montante contra o orçamento em bytes do Content Store, de 0 a 8 mebibytes. Abaixo de 64 kibibytes o IDEM fica pior que o cache por agente.",
        x: "orçamento em bytes por store (LRU)",
        caption: (o: { size: string; b2: string; b1: string }) =>
          `O resultado mediano tem 6 KiB. Com ${o.size} ou menos, o store compartilhado remove entradas mais rápido do que os agentes voltam a pedir, e o B2 (${o.b2}) fica pior que os caches privados (${o.b1}), que aqui não têm limite. Dois níveis ajudam um pouco: o store regional é um segundo orçamento.`,
      },
      think: {
        title: "Tempo de reflexão",
        desc: "Gráfico de linhas da redução a montante contra o tempo médio de reflexão, de 100 milissegundos a 10 segundos. A redução é constante até 2 segundos e cai além disso, quando as execuções duram mais que o TTL.",
        x: "tempo médio de reflexão entre chamadas",
        caption:
          "Agentes mais rápidos não ganham: o store já responde toda repetição. Agentes mais lentos perdem, porque a execução passa a durar mais que o TTL de 60 s.",
      },
      staleLabel: "Sobre respostas que chegaram atrasadas",
      stale: (o: { late: string; max: string }) =>
        `Nenhum Data foi servido vencido em nenhuma execução pela regra do protocolo, que conta a idade a partir do recebimento em cada salto [P-8.1]. Medido no relógio do produtor, até ${o.late} respostas por execução, nos TTLs curtos, chegaram depois do seu frescor, por no máximo ${o.max}: o tempo que um Data passa em trânsito não entra na sua idade.`,
      mixed: {
        title: "Chamadas que não podem ir para o cache",
        lead: "A W-mixed envia 10% das chamadas a uma ferramenta privada e uma parcela crescente a uma ferramenta com efeito colateral, que nunca é cacheável e passa direto.",
        fraction: "chamadas com efeito colateral",
        bypass: "passagem direta na borda (B2, por execução)",
        clean: (o: { runs: string }) =>
          `Nas ${o.runs} execuções desta varredura: 0 chamadas com falha, 0 respostas vencidas, 0 resultados privados entregues ao agente errado.`,
      },
    },
    e1: {
      title: "O custo do caminho criptográfico",
      question: "Quanto custa nomear, assinar e verificar uma chamada?",
      verdict: (o: { small: string; verify: string; big: string; canon: string }) =>
        `verifyData leva ${o.verify} com ${o.small} e canonicalizeArgs ${o.canon} com ${o.big} (medianas entre execuções).`,
      lead: "Uma chamada de cada operação de @idem/core, cronometrada com performance.now() depois de um aquecimento, para cargas de 1 KiB a 1 MiB. A carga é o texto do argumento para canonicalizeArgs e makeName, e o texto do resultado para signData e verifyData.",
      chart: {
        title: "Tempo por chamada conforme o tamanho da carga",
        desc: "Gráfico de linhas log-log do tempo mediano por chamada de canonicalizeArgs, makeName, signData e verifyData para cargas de 1 kibibyte a 1 mebibyte. Todas crescem linearmente com o tamanho em cargas grandes; canonicalizeArgs é a mais íngreme.",
        x: "carga",
        y: "tempo mediano por chamada",
        caption: (o: { runs: number; node: string; cpu: string }) =>
          `Mediana entre ${o.runs} execuções da mediana de cada execução, em ${o.cpu}, Node ${o.node}. Hastes: a execução mais rápida e a mais lenta. Os dois eixos são logarítmicos.`,
      },
      load: (o: { busy: number; runs: number; cores: string; max: string }) =>
        o.busy === 0
          ? `A carga média de 1 minuto ficou abaixo dos ${o.cores} núcleos da máquina durante as ${o.runs} execuções.`
          : `${o.busy} das ${o.runs} execuções foram feitas com a máquina ocupada com outro trabalho (carga média de 1 minuto acima dos seus ${o.cores} núcleos, chegando a ${o.max}). Elas foram mantidas, e são o motivo de as hastes subirem tanto.`,
      reading: (o: { small: string; verify: string; canon: string }) =>
        `Para um resultado de poucos kibibytes a assinatura domina: verifyData leva ${o.verify} com ${o.small}. Depois disso, o hash e a canonicalização do JSON assumem e toda operação cresce com a carga; canonicalizeArgs é a mais íngreme (${o.canon} com 1 MiB), porque valida, normaliza e serializa de novo a sua entrada.`,
      browser: "A metade do E1 no navegador (Playwright, Chromium headless) não foi executada.",
      columns: {
        size: "Carga",
        p50: "mediana",
        range: "execuções: da mediana mais rápida à mais lenta",
        p95: "p95",
        p99: "p99",
        iterations: "iterações por execução",
      },
    },
    e5: {
      title: "Segurança",
      question: "Algum ataque a uma afirmação do protocolo passa?",
      verdict: (o: { stopped: string; expected: string; findings: number; limits: number }) =>
        `${o.stopped} de ${o.expected} variantes de ataque que o protocolo deve barrar foram barradas em todas as tentativas; ${o.findings} ${o.findings === 1 ? "achado em aberto" : "achados em aberto"}, ${o.limits} ${o.limits === 1 ? "limite documentado medido" : "limites documentados medidos"}.`,
      lead: (o: { trials: string; variants: number }) =>
        `${o.variants} variantes de ataque, ${o.trials} tentativas cada, contra o forwarder, o produtor, o trust store e o verificador reais de @idem/core em um relógio virtual. Cada tentativa constrói um mundo novo a partir da sua semente e é julgada pelo que de fato aconteceu: uma variante só conta como rejeitada se nenhuma vítima aceitou conteúdo forjado, alheio ou fora do tempo de vida e nenhum cache guardou algum.`,
      findings: {
        title: (n: number) =>
          n === 1
            ? "Uma variante que o motor deveria barrar foi aceita"
            : `${n} variantes que o motor deveria barrar foram aceitas`,
        lead: "O protocolo afirma barrar isto. O motor não barrou. Está relatado como encontrado; nada foi alterado no motor para escondê-lo.",
        every: (accepted: string, trials: string) => `aceita em ${accepted} de ${trials} tentativas`,
        none: "Toda variante que o protocolo afirma barrar foi barrada em todas as tentativas.",
        text: {} as Record<string, string>,
      },
      limits: {
        title: "Limites documentados da v1",
        lead: "O protocolo não afirma barrar estes casos na v1. A suíte os executa mesmo assim, para que um limite seja um número e não uma nota de rodapé.",
        every: (accepted: string, trials: string) => `aceita em ${accepted} de ${trials} tentativas`,
        leaked: (accepted: string, trials: string) =>
          `inferência correta em ${accepted} de ${trials} tentativas`,
        text: {
          "replay/in-tolerance@upstream":
            "Desatualização limitada. Alguém no enlace do produtor coloca no lugar da resposta nova um Data genuíno cujo frescor acabou, mas que ainda está dentro da tolerância de relógio. O tempo de vida assinado [P-8.6] é o frescor mais essa tolerância, então a borda o aceita, por projeto: a tolerância é o que permite que nós com relógios um pouco diferentes concordem. A suíte também verifica o limite: um consumidor que pede quando a cópia já está fora do tempo de vida recebe uma resposta nova. Repetições mais antigas são recusadas (replay/expired@upstream). ADR-034.",
          "replay/in-tolerance@last-hop":
            "A mesma repetição no enlace do próprio agente, dentro da tolerância, passa pela checagem do consumidor pelo mesmo motivo; uma mais antiga que o frescor mais a tolerância é recusada (replay/expired@last-hop). ADR-034.",
          "timing/cache-probe":
            "Tempo. Uma resposta rápida revela que alguém já pediu aquele nome público. A questão em aberto Q3 lista isso como risco aceito, sem defesa na v1.",
        } as Record<string, string>,
      },
      columns: {
        variant: "Variante",
        where: "Atacante em",
        rejected: "Rejeitadas",
        outcome: "Como terminou (saída da suíte)",
      },
      accepted: "aceitas",
      acceptedLimit: "aceitas (limite documentado)",
      leaked: "vazaram (risco aceito)",
      precondition: "Supõe que o atacante",
      attack: {
        tamper: "Adulteração: Data alterado em trânsito",
        forge: "Forja: um nome que não corresponde aos argumentos",
        replay: "Repetição: um Data genuíno reapresentado tarde, ou datado à frente do relógio",
        private: "Privado: pedidos entre contextos de autorização",
        poison: "Envenenamento: Data assinado por chave fora do manifesto",
        timing: "Tempo: o canal lateral da questão em aberto Q3",
      } as Record<string, string>,
      where: {
        "producer link": "enlace do produtor",
        "agent link": "enlace do agente",
        consumer: "consumidor",
        "forwarder (malicious)": "forwarder malicioso",
        "regional forwarder (malicious)": "forwarder regional malicioso",
        "none (honest path)": "ninguém (caminho honesto)",
        "gateway cache (B5)": "o cache do gateway (B5)",
        "producer link (B5)": "enlace do produtor (B5)",
        "consumer (B5)": "consumidor (B5)",
      } as Record<string, string>,
      what: {
        "tamper/content@upstream": "Reescreve o texto do resultado entre o produtor e a borda.",
        "tamper/content@last-hop": "Reescreve o texto do resultado entre a borda e o agente.",
        "tamper/freshness@upstream":
          "Multiplica por mil o freshnessMs assinado para os caches guardarem o Data por mais tempo.",
        "tamper/signature@upstream": "Troca um caractere da assinatura.",
        "tamper/swap-name@upstream": "Responde com um Data genuíno e bem assinado de outro documento.",
        "tamper/swap-name@last-hop": "Entrega ao agente um Data genuíno e bem assinado de outro documento.",
        "tamper/scope@upstream": "Remarca um resultado privado como público para a borda compartilhá-lo.",
        "forge/args-swap@edge": "Envia o nome de um documento com os argumentos de outro.",
        "forge/random-digest@edge": "Envia argumentos reais sob um nome com digest de argumentos aleatório.",
        "forge/args-swap@producer":
          "Um forwarder que pula a sua checagem repassa o Interest inconsistente ao produtor.",
        "replay/expired-cache":
          "Pede de novo depois que a cópia em cache expirou; a borda não pode servi-la.",
        "replay/expired@upstream":
          "Coloca no lugar da resposta nova do produtor um Data gravado, mais antigo que o seu frescor mais a tolerância de relógio.",
        "replay/expired@last-hop":
          "Responde ao Interest da vítima com um Data que buscou antes, mais antigo que o seu frescor mais a tolerância de relógio.",
        "replay/in-tolerance@upstream":
          "Coloca no lugar da resposta nova do produtor um Data gravado, com o frescor vencido mas dentro da tolerância de relógio.",
        "replay/in-tolerance@last-hop":
          "Responde ao Interest da vítima com um Data de frescor vencido, mas dentro da tolerância de relógio.",
        "replay/understated-age@core":
          "Um forwarder regional malicioso entrega à borda um Data antigo com o ageMs reduzido para parecer fresco.",
        "replay/future-dated@upstream":
          "Oferece um Data genuíno cujo producedAt assinado está no futuro, além da tolerância de relógio.",
        "baseline/tamper-cache@edge":
          "Reescreve um resultado guardado no cache do gateway; todo usuário seguinte daquela chamada recebe o texto alterado.",
        "baseline/tamper@upstream":
          "Reescreve o resultado entre o produtor e o gateway, que o guarda e o serve aos usuários seguintes.",
        "baseline/private-miskeyed@edge":
          "Pede a ferramenta por usuário logo depois que o resultado de outro usuário foi guardado no gateway.",
        "replay/unsolicited@consumer-face":
          "Empurra um Data genuíno antigo para a borda a partir de uma face de consumidor.",
        "private/sequential":
          "Pede o nome privado logo depois que o resultado de outro usuário foi guardado.",
        "private/concurrent": "Pede o nome privado enquanto o Interest de outro usuário está pendente.",
        "private/anonymous": "Pede o nome privado sem credencial alguma.",
        "private/tree":
          "Dois usuários atrás de bordas diferentes pedem ao mesmo tempo; o forwarder regional não vê authContext.",
        "private/authcontext-guess":
          "Preenche por conta própria o campo authContext do Interest com um valor aleatório.",
        "private/authcontext-known":
          "Preenche por conta própria o campo authContext do Interest com o valor da vítima.",
        "poison/unknown-key@upstream":
          "Troca a resposta por um Data validamente assinado com a sua própria chave.",
        "poison/spoofed-key-id@upstream":
          "Assina com a sua chave, mas cita a chave do produtor no localizador.",
        "poison/other-producer@upstream": "Assina o nome da vítima com a chave de outro produtor, confiável.",
        "poison/rogue-manifest@upstream":
          "Oferece um manifesto mais novo que lista só a sua chave e assina com ela.",
        "poison/unknown-key@last-hop":
          "Entrega ao agente um Data validamente assinado com a sua própria chave.",
        "poison/unsolicited@consumer-face":
          "Empurra o seu próprio Data assinado para a borda a partir de uma face de consumidor.",
        "timing/cache-probe": "Infere pela latência de uma resposta se alguém já pediu aquele nome.",
      } as Record<string, string>,
      assumes: {
        "private/authcontext-known":
          "conhece o authContext da vítima, um valor que a borda deriva e nunca envia a ninguém.",
        "poison/other-producer@upstream":
          "é ele mesmo um produtor em que todo nó confia, para os seus próprios nomes.",
        "timing/cache-probe": "consegue cronometrar os próprios pedidos.",
        "replay/future-dated@upstream":
          "tem um Data genuíno que o produtor assinou com um producedAt horas à frente (uma falha no relógio do produtor).",
        "baseline/tamper-cache@edge":
          "controla o armazenamento do cache do gateway: um gateway ou backend de cache comprometido, com defeito ou malicioso.",
        "baseline/tamper@upstream":
          "controla o enlace entre o gateway e o produtor: sem TLS nesse trecho, ou com um salto comprometido nele.",
        "baseline/private-miskeyed@edge":
          "é um segundo usuário de um gateway cujo operador listou a ferramenta por usuário como cacheável sem partição por credencial, com ferramenta e argumentos por chave (uma configuração errada).",
      } as Record<string, string>,
      baseline: {
        title: "Os mesmos ataques contra o cache compartilhado no gateway (B5)",
        lead: "Três ataques da suíte, executados de novo contra o B5: clientes MCP comuns, o mesmo produtor respondendo como um servidor MCP comum e o cache compartilhado na borda. Cada linha fica ao lado da variante do IDEM que ela espelha, com as duas contagens da mesma execução.",
        columns: { attack: "Ataque ao B5", b5: "Aceito pelo B5", idem: "O mesmo ataque ao IDEM" },
        pair: (o: { holding: number; pairs: number }) =>
          `Em ${o.holding} de ${o.pairs} pares o cache sem assinatura aceitou o ataque em pelo menos uma tentativa e o IDEM em nenhuma.`,
        reading:
          "Este é o resultado esperado: um cache que não guarda assinatura não tem contra o que conferir um resultado, e um cache com ferramenta e argumentos por chave não sabe de quem é o resultado que guarda. As linhas não são um achado sobre nenhum produto. Elas dão um número ao que a assinatura e a partição por autorização compram contra o mesmo ataque; não medem com que frequência um gateway é comprometido ou mal configurado. Um gateway que acrescenta o token de quem chama à chave, como o FastMCP faz, não vazaria o resultado privado, e também não compartilharia nada entre usuários.",
        accepted: (accepted: string, trials: string) => `${accepted} de ${trials} tentativas`,
        missing: "não está nesta execução",
      },
    },
    method: {
      title: "Método",
      question: "Como estes números foram produzidos, e o que não foi executado?",
      lead: "O plano dos cinco experimentos, as métricas e as regras de relato estão na documentação.",
      docs: "Ler o método de avaliação",
      modesTitle: "Modos comparados",
      baseTitle: "Configuração base das varreduras",
      baseLead:
        "Cada varredura muda um destes itens e mantém os demais. São suposições sobre um enxame, não medições de um: traços reais (E3) os substituiriam.",
      base: {
        agents: "agentes",
        calls: "chamadas por agente",
        catalog: "catálogo compartilhado",
        catalogValue: (n: string, alpha: string) => `${n} documentos, Zipf α = ${alpha}`,
        overlap: "sobreposição",
        think: "tempo de reflexão",
        thinkValue: (v: string) => `exponencial, média ${v}`,
        surface: "grafias equivalentes de uma URL",
        surfaceValue: (v: string) => `${v} das chamadas`,
        links: "enlaces, em cada sentido",
        linksValue: (a: string, p: string) => `agente à borda ${a}, borda ao produtor ${p}`,
        tree: "dois níveis (B3)",
        treeValue: (e: number, c: string, p: string) =>
          `${e} bordas, borda ao regional ${c}, regional ao produtor ${p}`,
        service: "tempo de serviço",
        serviceValue: (m: string, s: string) => `log-normal, mediana ${m}, σ = ${s}`,
        result: "tamanho do resultado",
        resultValue: (v: string) => `log-normal, mediana ${v}`,
        ttl: "TTL",
        cs: "Content Store",
        csValue: (v: string, p: string) => `${v} por forwarder, ${p.toUpperCase()}`,
        loss: "perda",
        seeds: "sementes",
        seedsValue: (n: number, first: string) => `${n} por ponto (${first}), as mesmas em todos os pontos`,
        cpu: "custo de CPU",
        cpuValue: (n: number) =>
          `cobrado nos modos IDEM a partir das medianas de ${n} execuções do E1; as linhas de base não são cobradas`,
      },
      notRunTitle: "Não executado",
      notRun: {
        e3: "E3, traços de agentes reais: depende de um enxame de LLM com orçamento. Até lá, a carga é sintética e nenhum traço é reproduzido.",
        e4: "E4, emulação de rede: depende de Docker. A hipótese H4 espera por ela.",
        browser: "E1 em navegador: a metade Playwright dos microbenchmarks.",
      },
      reproduceTitle: "Reproduzir",
      reproduce:
        "Um comando refaz E1, E2 e E5 a partir de um checkout limpo e regenera os dados desta página. As simulações são determinísticas para as suas sementes; o E1 depende da máquina.",
      runsTitle: "Execuções por trás desta página",
      runsLead: (digest: string) =>
        `Cada execução registra o commit em que rodou (com -dirty quando há mudanças locais) e um digest SHA-256 dos fontes dos pacotes, sem os testes, para que uma execução nomeie o seu código mesmo sem git. Os dados desta página foram exportados com o digest de fontes ${digest}.`,
      runs: {
        experiment: "Experimento",
        id: "Id da execução",
        seed: "Sementes",
        digest: "Digest dos fontes",
        load: "Carga média, início → fim",
        duration: "Duração",
        env: (node: string, cpu: string, cores: string, platform: string) =>
          `Todas as execuções: Node ${node}, ${cpu} (${cores} núcleos), ${platform}.`,
      },
    },
  },
);

/** The dictionary of one locale. */
export type ResultsMessages = (typeof results)["en"];
