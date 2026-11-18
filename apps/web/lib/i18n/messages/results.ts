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
        "Measured and simulated results of IDEM: the cost of naming, signing and verifying (E1), a simulated agent swarm against direct MCP and per-agent caches (E2), and an adversarial suite against the core engine (E5).",
    },
    hero: {
      kicker: "Benchmarks",
      title: "What the runs say.",
      lead: "Three of the five planned experiments have run: the cost of naming, signing and verifying a call (E1), a simulated agent swarm compared with direct MCP and with per-agent caches (E2), and an adversarial suite against the core engine (E5). Every number below is read from a committed run folder, and each figure names its runs.",
      simulationLabel: "Simulation",
      simulation:
        "E2 and E5 run on a virtual clock. They are simulation results, not measurements of a deployed network. E1 is wall-clock time on one machine. The real-agent traces (E3) and the network emulation (E4) have not run.",
    },
    tiles: {
      label: "Headline numbers",
      upstream: {
        label: "fewer calls reach the producer",
        sub: (agents: string, ci: string) =>
          `B2 against direct MCP, ${agents} agents, overlap 0.5 · ±${ci} points`,
      },
      latency: {
        label: "median latency per call",
        sub: (ci: string) => `B2 against direct MCP, same seeds · ±${ci}`,
      },
      overhead: {
        label: "of CPU added to a cache miss",
        sub: (share: string, rtt: string) => `${share} of the ${rtt} round trip to the producer`,
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
        evidence:
          "Needs the network emulation (E4), which has not run. The E2 sweeps ran without loss, so nothing here speaks to recovery.",
      },
    },
    modes: {
      B0: "direct MCP",
      B1: "per-agent cache",
      B2: "IDEM",
      B3: "IDEM, two tiers",
      B4: "IDEM, no verify at forwarders",
      bound: "perfect shared cache",
      desc: {
        B0: "Every call goes to the producer, a plain MCP server. The edge only relays.",
        B1: "Each agent keeps its own cache of results, keyed by the canonical name (so it gets IDEM's canonicalization for free). The strongest baseline that changes nothing in the network.",
        B2: "Agents → one edge forwarder (PIT and Content Store) → producer. Every hop and every agent verifies.",
        B3: "Agents → two edges → one regional forwarder → producer, with the same end-to-end delay as B2.",
        B4: "B2 with verification before caching switched off at the forwarder, only to isolate what it costs.",
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
      tipCi: (label: string, x: string, y: string, ci: string) => `${label} at ${x}: ${y} (95% CI ±${ci})`,
      tipRange: (label: string, x: string, y: string, lo: string, hi: string) =>
        `${label} at ${x}: ${y} (runs from ${lo} to ${hi})`,
      tipPlain: (label: string, x: string, y: string) => `${label} at ${x}: ${y}`,
    },
    redundancy: {
      title: "Calls that never reach the producer",
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
        "Resultados medidos e simulados do IDEM: o custo de nomear, assinar e verificar (E1), um enxame de agentes simulado contra MCP direto e caches por agente (E2) e uma suíte adversarial contra o motor do núcleo (E5).",
    },
    hero: {
      kicker: "Benchmarks",
      title: "O que as execuções dizem.",
      lead: "Três dos cinco experimentos planejados foram executados: o custo de nomear, assinar e verificar uma chamada (E1), um enxame de agentes simulado comparado com MCP direto e com caches por agente (E2) e uma suíte adversarial contra o motor do núcleo (E5). Todo número abaixo é lido de uma pasta de execução versionada, e cada figura cita as suas execuções.",
      simulationLabel: "Simulação",
      simulation:
        "E2 e E5 rodam em um relógio virtual. São resultados de simulação, não medições de uma rede implantada. E1 é tempo de relógio real em uma máquina. Os traços de agentes reais (E3) e a emulação de rede (E4) não foram executados.",
    },
    tiles: {
      label: "Números principais",
      upstream: {
        label: "menos chamadas chegam ao produtor",
        sub: (agents: string, ci: string) =>
          `B2 contra MCP direto, ${agents} agentes, sobreposição 0,5 · ±${ci} pontos`,
      },
      latency: {
        label: "latência mediana por chamada",
        sub: (ci: string) => `B2 contra MCP direto, mesmas sementes · ±${ci}`,
      },
      overhead: {
        label: "de CPU a mais em uma falta de cache",
        sub: (share: string, rtt: string) => `${share} da ida e volta de ${rtt} até o produtor`,
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
        evidence:
          "Depende da emulação de rede (E4), que não foi executada. As varreduras do E2 rodaram sem perda, então nada aqui fala de recuperação.",
      },
    },
    modes: {
      B0: "MCP direto",
      B1: "cache por agente",
      B2: "IDEM",
      B3: "IDEM, dois níveis",
      B4: "IDEM, sem verificar nos forwarders",
      bound: "cache compartilhado perfeito",
      desc: {
        B0: "Toda chamada vai ao produtor, um servidor MCP comum. A borda apenas repassa.",
        B1: "Cada agente mantém o seu cache de resultados, com o nome canônico como chave (ganha de graça a canonicalização do IDEM). A linha de base mais forte que não muda nada na rede.",
        B2: "Agentes → um forwarder de borda (PIT e Content Store) → produtor. Cada salto e cada agente verifica.",
        B3: "Agentes → duas bordas → um forwarder regional → produtor, com o mesmo atraso fim a fim do B2.",
        B4: "B2 com a verificação antes do cache desligada no forwarder, só para isolar o que ela custa.",
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
      tipCi: (label: string, x: string, y: string, ci: string) => `${label} em ${x}: ${y} (IC 95% ±${ci})`,
      tipRange: (label: string, x: string, y: string, lo: string, hi: string) =>
        `${label} em ${x}: ${y} (execuções de ${lo} a ${hi})`,
      tipPlain: (label: string, x: string, y: string) => `${label} em ${x}: ${y}`,
    },
    redundancy: {
      title: "Chamadas que nunca chegam ao produtor",
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
