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
          n2bytes: string;
          b2bytes: string;
        }) =>
          `At ${o.loss}% loss on every link, the native star (N2) answered ${o.n2ok} of its calls and the overlay star (B2) ${o.b2ok}; median latency ${o.n2p50} against ${o.b2p50}; bytes over the producer link ${o.n2bytes} against ${o.b2bytes}.`,
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
      question: "Do the four hypotheses the project stated before running anything hold?",
      verdict: (o: { supported: number; partly: number; refuted: number; pending: number }) =>
        `${o.supported} supported, ${o.partly} partly supported, ${o.refuted} refuted and ${o.pending} not evaluated, by the rules written next to each.`,
      lead: "The project stated four falsifiable hypotheses before any experiment ran. The verdicts are computed from the data, with the rule given next to each.",
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
          `Private results served to another context: ${o.accepted} of ${o.trials} trials (${o.variants} variants), all in ${o.leaking}, where the attacker already knows the victim's authContext.`,
        rule: "Rule: zero accepted in both groups. Replaying expired Data is outside this hypothesis: it is a documented limit of v1 (ADR-025), measured under Safety.",
      },
      h4: {
        claim:
          "Under loss and multi-hop topologies, on-path caching reduces bytes on the producer's link and recovery time, compared with end-to-end TCP/HTTP.",
        ran: "E4 has run and is shown first on this page. This page encodes no rule for H4, so it states no verdict.",
        evidence:
          "Needs the network emulation (E4), which has not run. The E2 sweeps ran without loss, so nothing here speaks to recovery.",
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
      N2: "IDEM on native NDN",
      N3: "IDEM on native NDN, two tiers",
      bound: "perfect shared cache",
      desc: {
        B0: "Every call goes to the producer, a plain MCP server. The edge only relays.",
        B1: "Each agent keeps its own cache of results, keyed by the canonical name (so it gets IDEM's canonicalization for free). The strongest baseline that changes nothing in the network.",
        B2: "Agents → one edge forwarder (PIT and Content Store) → producer. Every hop and every agent verifies.",
        B3: "Agents → two edges → one regional forwarder → producer, with the same end-to-end delay as B2.",
        B4: "B2 with verification before caching switched off at the forwarder, only to isolate what it costs.",
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
      verdict: (o: { agents: string; b2: string; ci: string; b1: string }) =>
        `At ${o.agents} agents and overlap 0.5, IDEM sent ${o.b2} (±${o.ci} points) fewer calls to the producer than direct MCP; per-agent caches, ${o.b1}.`,
      lead: "Upstream reduction is the share of tool calls that did not reach the producer, relative to direct MCP on the same workload and seed. The workload is synthetic (W-syn): every agent makes 20 calls with a think time between them, and a fraction of them, the overlap, is drawn from a catalog the whole swarm shares.",
      agents: {
        title: "Upstream reduction as the swarm grows",
        desc: "Line chart of upstream reduction against direct MCP for 1 to 32 agents. The per-agent cache stays near 9 percent; IDEM grows with the swarm and follows the perfect shared cache.",
        x: "agents",
        y: "upstream reduction",
        caption:
          "W-syn at overlap 0.5. Whiskers: 95% confidence interval. The dotted line is a perfect shared cache, every distinct name fetched once.",
        note: "IDEM follows the bound: with a 60 s TTL and an 8 MiB store, nothing expires or is evicted during a run. B3 and B4 reach the producer exactly as often as B2. The halftone area is what sharing across agents adds over private caches.",
      },
      overlap: {
        title: "Upstream reduction as agents ask for more of the same",
        desc: "Line chart of upstream reduction against direct MCP for overlap from 0 to 1 at 8 agents. With no overlap every mode is at zero; IDEM grows faster than the per-agent cache.",
        x: "cross-agent overlap",
        y: "upstream reduction",
        caption: "W-syn at 8 agents. Whiskers: 95% confidence interval.",
      },
      pit: (o: { base: string; shortest: string; think: string }) =>
        `Nearly all of the reduction is the Content Store. PIT aggregation, two identical requests in flight at once, happened for at most ${o.base} of the Interests in the swarm sweep, and for ${o.shortest} at the shortest think time tested (${o.think}). This workload has no burst in which many agents ask for one new thing at the same instant, which is where aggregation would matter.`,
      bytes: (o: { one: string; b1: string; base: string; calls: string }) =>
        `Bytes on the producer link fall less than calls do, because an Interest and its signed Data are larger than a plain call and its result. With one agent B2 saves ${o.one} of the bytes where B1 saves ${o.b1}; at the base point it saves ${o.base} of the bytes for ${o.calls} of the calls.`,
      columns: {
        vsB0: "vs. B0",
        vsB1: "vs. B1",
        bound: "bound",
        hit: "CS hit ratio",
        pit: "PIT aggregation",
        bytes: "bytes vs. B0",
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
        desc: "Cumulative distribution of per-call latency for direct MCP, per-agent cache and IDEM. IDEM answers a share of the calls in about 10 milliseconds, then follows the same curve as the others.",
        x: "latency per call (ms)",
        y: "share of calls",
        caption: (o: { agents: string; hit: string; local: string }) =>
          `All calls at ${o.agents} agents, pooled over seeds, up to the 99th percentile. The step on the left is the share a cache answered: ${o.hit} at the edge for B2, ${o.local} locally for B1. A miss costs the same in every mode.`,
      },
      delta: {
        title: "Change of the median against direct MCP",
        desc: "Line chart of the change in median latency against direct MCP, paired by seed, for 1 to 32 agents. The per-agent cache stays near minus 9 milliseconds; IDEM falls further as the swarm grows.",
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
        `${o.variants} attack variants, ${o.trials} trials each, against the real forwarder, producer, trust store and verifier of @idem/core on a virtual clock. Each trial builds a fresh world from its seed and is judged on ground truth: a variant counts as rejected only if no victim accepted forged, foreign or expired content and no cache kept any.`,
      findings: {
        title: (n: number) =>
          n === 1
            ? "One variant the engine should stop was accepted"
            : `${n} variants the engine should stop were accepted`,
        lead: "The protocol claims to stop this. The engine did not. It is reported as found; nothing was changed in the engine to hide it.",
        every: (accepted: string, trials: string) => `accepted in ${accepted} of ${trials} trials`,
        none: "Every variant the protocol claims to stop was stopped in every trial.",
        text: {
          "private/authcontext-known":
            "The core forwarder trusts an authContext that already sits in an Interest arriving on a consumer face, so an attacker who knows the victim's value reads the victim's partition. That value is an HMAC the edge derives and never sends to anyone, and the HTTP gateway drops the field from incoming Interests; the engine itself does not. Open: ADR-023, question Q7.",
        } as Record<string, string>,
      },
      limits: {
        title: "Documented limits of v1",
        lead: "The protocol does not claim to stop these in v1. The suite runs them all the same, so that a limit is a number and not a footnote.",
        every: (accepted: string, trials: string) => `accepted in ${accepted} of ${trials} trials`,
        leaked: (accepted: string, trials: string) => `inferred correctly in ${accepted} of ${trials} trials`,
        text: {
          "replay/expired@upstream":
            "Stale replay. A party on the producer link records a genuine Data and, after its freshness has run out, substitutes it for the producer's new answer. The signature is valid and nothing compares the signed producedAt with a clock, so the edge verifies it, caches it as fresh and serves it. An honest cache never serves expired Data (replay/expired-cache below), and a party off the path cannot inject any. ADR-025 states the limit and records the rule that would close it.",
          "replay/expired@last-hop":
            "The same replay on the agent's own link passes the consumer's verification: a signature says who produced the Data, not that it is still current (ADR-025).",
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
        replay: "Replay: a genuine Data shown again after it expired",
        private: "Private: asking across authorization contexts",
        poison: "Poison: Data signed by a key outside the manifest",
        timing: "Timing: the side channel of open question Q3",
      } as Record<string, string>,
      where: {
        "producer link": "producer link",
        "agent link": "agent link",
        consumer: "consumer",
        "forwarder (malicious)": "malicious forwarder",
        "none (honest path)": "nobody (honest path)",
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
        "replay/expired@upstream": "Substitutes a recorded, expired Data for the producer's new answer.",
        "replay/expired@last-hop": "Answers the victim's Interest with an expired Data it once fetched.",
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
      } as Record<string, string>,
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
      notRun: [
        "E3, real-agent traces: needs a budgeted LLM swarm. Until it runs, the workload is synthetic and no trace is replayed.",
        "E4, network emulation: needs Docker and Mini-NDN. Hypothesis H4 waits for it.",
        "E1 in a browser: the Playwright half of the microbenchmarks.",
      ],
      reproduceTitle: "Reproduce",
      reproduce:
        "One command reruns E1, E2 and E5 from a clean checkout and regenerates this page's data. The simulations are deterministic for their seeds; E1 depends on the machine.",
      runsTitle: "Runs behind this page",
      runsLead: (digest: string) =>
        `The checkout is not a git repository yet, so each run records a SHA-256 digest of the package sources (tests excluded) in place of a commit. This page's data was exported at source digest ${digest}.`,
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
          n2bytes: string;
          b2bytes: string;
        }) =>
          `Com ${o.loss}% de perda em cada enlace, a estrela nativa (N2) respondeu ${o.n2ok} das suas chamadas e a estrela do overlay (B2) ${o.b2ok}; latência mediana de ${o.n2p50} contra ${o.b2p50}; bytes no enlace do produtor: ${o.n2bytes} contra ${o.b2bytes}.`,
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
      question: "As quatro hipóteses que o projeto enunciou antes de executar qualquer coisa se sustentam?",
      verdict: (o: { supported: number; partly: number; refuted: number; pending: number }) =>
        `${o.supported} sustentadas, ${o.partly} sustentadas em parte, ${o.refuted} refutadas e ${o.pending} não avaliadas, pelas regras escritas ao lado de cada uma.`,
      lead: "O projeto enunciou quatro hipóteses falseáveis antes de qualquer experimento. Os veredictos são calculados a partir dos dados, com a regra ao lado de cada um.",
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
          `Resultados privados servidos a outro contexto: ${o.accepted} de ${o.trials} tentativas (${o.variants} variantes), todas em ${o.leaking}, em que o atacante já conhece o authContext da vítima.`,
        rule: "Regra: zero aceitos nos dois grupos. Repetir Data expirado está fora desta hipótese: é um limite documentado da v1 (ADR-025), medido em Segurança.",
      },
      h4: {
        claim:
          "Sob perda e em topologias de múltiplos saltos, o cache no caminho reduz os bytes no enlace do produtor e o tempo de recuperação, em comparação com TCP/HTTP fim a fim.",
        ran: "O E4 foi executado e aparece primeiro nesta página. Esta página não codifica regra para a H4, então não afirma veredicto.",
        evidence:
          "Depende da emulação de rede (E4), que não foi executada. As varreduras do E2 rodaram sem perda, então nada aqui fala de recuperação.",
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
      N2: "IDEM em NDN nativo",
      N3: "IDEM em NDN nativo, dois níveis",
      bound: "cache compartilhado perfeito",
      desc: {
        B0: "Toda chamada vai ao produtor, um servidor MCP comum. A borda apenas repassa.",
        B1: "Cada agente mantém o seu cache de resultados, com o nome canônico como chave (ganha de graça a canonicalização do IDEM). A linha de base mais forte que não muda nada na rede.",
        B2: "Agentes → um forwarder de borda (PIT e Content Store) → produtor. Cada salto e cada agente verifica.",
        B3: "Agentes → duas bordas → um forwarder regional → produtor, com o mesmo atraso fim a fim do B2.",
        B4: "B2 com a verificação antes do cache desligada no forwarder, só para isolar o que ela custa.",
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
      verdict: (o: { agents: string; b2: string; ci: string; b1: string }) =>
        `Com ${o.agents} agentes e sobreposição 0,5, o IDEM enviou ${o.b2} (±${o.ci} pontos) menos chamadas ao produtor do que o MCP direto; os caches por agente, ${o.b1}.`,
      lead: "A redução a montante é a parcela das chamadas de ferramenta que não chegou ao produtor, em relação ao MCP direto na mesma carga e semente. A carga é sintética (W-syn): cada agente faz 20 chamadas com um tempo de reflexão entre elas, e uma fração delas, a sobreposição, é sorteada de um catálogo que o enxame inteiro compartilha.",
      agents: {
        title: "Redução a montante conforme o enxame cresce",
        desc: "Gráfico de linhas da redução a montante contra MCP direto para 1 a 32 agentes. O cache por agente fica perto de 9 por cento; o IDEM cresce com o enxame e acompanha o cache compartilhado perfeito.",
        x: "agentes",
        y: "redução a montante",
        caption:
          "W-syn com sobreposição 0,5. Hastes: intervalo de confiança de 95%. A linha pontilhada é um cache compartilhado perfeito, cada nome distinto buscado uma vez.",
        note: "O IDEM acompanha o limite: com TTL de 60 s e um store de 8 MiB, nada expira nem é removido durante uma execução. B3 e B4 chegam ao produtor exatamente tantas vezes quanto o B2. A área em retícula é o que o compartilhamento entre agentes acrescenta sobre os caches privados.",
      },
      overlap: {
        title: "Redução a montante conforme os agentes pedem mais do mesmo",
        desc: "Gráfico de linhas da redução a montante contra MCP direto para sobreposição de 0 a 1 com 8 agentes. Sem sobreposição todos os modos ficam em zero; o IDEM cresce mais rápido que o cache por agente.",
        x: "sobreposição entre agentes",
        y: "redução a montante",
        caption: "W-syn com 8 agentes. Hastes: intervalo de confiança de 95%.",
      },
      pit: (o: { base: string; shortest: string; think: string }) =>
        `Quase toda a redução vem do Content Store. A agregação na PIT, dois pedidos idênticos em trânsito ao mesmo tempo, ocorreu em no máximo ${o.base} dos Interests na varredura do enxame, e em ${o.shortest} no menor tempo de reflexão testado (${o.think}). Esta carga não tem uma rajada em que muitos agentes pedem a mesma coisa nova no mesmo instante, que é onde a agregação pesaria.`,
      bytes: (o: { one: string; b1: string; base: string; calls: string }) =>
        `Os bytes no enlace do produtor caem menos do que as chamadas, porque um Interest e o seu Data assinado são maiores que uma chamada comum e o seu resultado. Com um agente, o B2 economiza ${o.one} dos bytes onde o B1 economiza ${o.b1}; no ponto base, economiza ${o.base} dos bytes para ${o.calls} das chamadas.`,
      columns: {
        vsB0: "vs. B0",
        vsB1: "vs. B1",
        bound: "limite",
        hit: "taxa de acerto no CS",
        pit: "agregação na PIT",
        bytes: "bytes vs. B0",
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
        desc: "Distribuição acumulada da latência por chamada para MCP direto, cache por agente e IDEM. O IDEM responde uma parcela das chamadas em cerca de 10 milissegundos e depois segue a mesma curva dos demais.",
        x: "latência por chamada (ms)",
        y: "parcela das chamadas",
        caption: (o: { agents: string; hit: string; local: string }) =>
          `Todas as chamadas com ${o.agents} agentes, somadas entre sementes, até o percentil 99. O degrau à esquerda é a parcela que um cache respondeu: ${o.hit} na borda para o B2, ${o.local} localmente para o B1. Uma falta custa o mesmo em todos os modos.`,
      },
      delta: {
        title: "Variação da mediana em relação ao MCP direto",
        desc: "Gráfico de linhas da variação da latência mediana contra MCP direto, pareada por semente, para 1 a 32 agentes. O cache por agente fica perto de menos 9 milissegundos; o IDEM cai mais conforme o enxame cresce.",
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
        `${o.variants} variantes de ataque, ${o.trials} tentativas cada, contra o forwarder, o produtor, o trust store e o verificador reais de @idem/core em um relógio virtual. Cada tentativa constrói um mundo novo a partir da sua semente e é julgada pelo que de fato aconteceu: uma variante só conta como rejeitada se nenhuma vítima aceitou conteúdo forjado, alheio ou expirado e nenhum cache guardou algum.`,
      findings: {
        title: (n: number) =>
          n === 1
            ? "Uma variante que o motor deveria barrar foi aceita"
            : `${n} variantes que o motor deveria barrar foram aceitas`,
        lead: "O protocolo afirma barrar isto. O motor não barrou. Está relatado como encontrado; nada foi alterado no motor para escondê-lo.",
        every: (accepted: string, trials: string) => `aceita em ${accepted} de ${trials} tentativas`,
        none: "Toda variante que o protocolo afirma barrar foi barrada em todas as tentativas.",
        text: {
          "private/authcontext-known":
            "O forwarder do núcleo confia em um authContext que já vem dentro de um Interest recebido em uma face de consumidor, então um atacante que conhece o valor da vítima lê a partição dela. Esse valor é um HMAC que a borda deriva e nunca envia a ninguém, e o gateway HTTP descarta o campo dos Interests que recebe; o motor em si não descarta. Em aberto: ADR-023, questão Q7.",
        } as Record<string, string>,
      },
      limits: {
        title: "Limites documentados da v1",
        lead: "O protocolo não afirma barrar estes casos na v1. A suíte os executa mesmo assim, para que um limite seja um número e não uma nota de rodapé.",
        every: (accepted: string, trials: string) => `aceita em ${accepted} de ${trials} tentativas`,
        leaked: (accepted: string, trials: string) =>
          `inferência correta em ${accepted} de ${trials} tentativas`,
        text: {
          "replay/expired@upstream":
            "Repetição de dado vencido. Alguém no enlace do produtor grava um Data genuíno e, depois que o frescor dele acabou, coloca-o no lugar da resposta nova do produtor. A assinatura é válida e nada compara o producedAt assinado com um relógio, então a borda o verifica, guarda como fresco e serve. Um cache honesto nunca serve Data expirado (replay/expired-cache, abaixo), e quem está fora do caminho não consegue injetar nenhum. O ADR-025 declara o limite e registra a regra que o fecharia.",
          "replay/expired@last-hop":
            "A mesma repetição no enlace do próprio agente passa pela verificação do consumidor: a assinatura diz quem produziu o Data, não que ele ainda é atual (ADR-025).",
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
        replay: "Repetição: um Data genuíno reapresentado depois de expirar",
        private: "Privado: pedidos entre contextos de autorização",
        poison: "Envenenamento: Data assinado por chave fora do manifesto",
        timing: "Tempo: o canal lateral da questão em aberto Q3",
      } as Record<string, string>,
      where: {
        "producer link": "enlace do produtor",
        "agent link": "enlace do agente",
        consumer: "consumidor",
        "forwarder (malicious)": "forwarder malicioso",
        "none (honest path)": "ninguém (caminho honesto)",
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
        "replay/expired@upstream": "Coloca um Data gravado e expirado no lugar da resposta nova do produtor.",
        "replay/expired@last-hop": "Responde ao Interest da vítima com um Data expirado que buscou antes.",
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
      } as Record<string, string>,
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
      notRun: [
        "E3, traços de agentes reais: depende de um enxame de LLM com orçamento. Até lá, a carga é sintética e nenhum traço é reproduzido.",
        "E4, emulação de rede: depende de Docker e Mini-NDN. A hipótese H4 espera por ela.",
        "E1 em navegador: a metade Playwright dos microbenchmarks.",
      ],
      reproduceTitle: "Reproduzir",
      reproduce:
        "Um comando refaz E1, E2 e E5 a partir de um checkout limpo e regenera os dados desta página. As simulações são determinísticas para as suas sementes; o E1 depende da máquina.",
      runsTitle: "Execuções por trás desta página",
      runsLead: (digest: string) =>
        `O checkout ainda não é um repositório git, então cada execução registra um digest SHA-256 dos fontes dos pacotes (sem os testes) no lugar de um commit. Os dados desta página foram exportados com o digest de fontes ${digest}.`,
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
