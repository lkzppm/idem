import { defineMessages } from "../locale";

/**
 * The home page: the hero's words and every section below it, figures included. Protocol terms
 * (Interest, Data, PIT, CS, FIB, field names, error codes) and code stay as they are in both
 * languages; they are names in the spec, not words to translate (ADR-018). No string states a
 * number: none exists in `experiments/results` yet (CLAUDE.md, spec 04 §1).
 */

type Tone = "i" | "d";
/** A run of words, optionally in an accent (blue: requests; yellow: answers). */
type Seg = { text: string; tone?: Tone; br?: boolean };
type Beat = { term: string; body: string };
type Labelled = { title: string; sub: string };

export const landing = defineMessages(
  {
    nav: {
      idea: "Idea",
      how: "How it works",
      live: "Live",
      forwarder: "Forwarder",
      guarantees: "Guarantees",
    },
    hero: {
      title: [
        { text: "Tool calls", br: true },
        { text: "as " },
        { text: "named", tone: "i" },
        { text: " " },
        { text: "data", tone: "d" },
        { text: "." },
      ] as Seg[],
      body: "IDEM names every read-only MCP tool call and signs its answer, so identical calls travel once and any node on the way can serve the result.",
      sandbox: "Open the sandbox",
      docs: "Read the docs",
      stackLabel: "Built on",
      stack: {
        mcp: "Model Context Protocol: the tool calls IDEM names",
        ndn: "Named Data Networking: the architecture IDEM borrows (Interest, Data, PIT, CS)",
        ndnts: "NDNts: the NDN libraries behind the native binding",
        ed25519: "Ed25519 signatures (RFC 8032), through WebCrypto",
        jcs: "JSON Canonicalization Scheme (RFC 8785): the bytes that get signed",
        ts: "TypeScript: one core for browser, Node and serverless",
      },
    },
    idea: {
      label: "The idea",
      title: "Ask once. Answer everyone.",
      lead: "Agents working on the same task keep asking the same tools the same things. Over plain MCP, every call travels to the server and runs the tool again. IDEM gives each read-only call a name, so a forwarder on the way can fold identical requests into one and answer repeats from its cache, with a signature that proves who made the answer.",
      modeLabel: "Protocol",
      plain: "Plain MCP",
      idem: "With IDEM",
      hint: "Click an agent to make it ask.",
      sameCall: "Every agent asks",
      edge: "edge forwarder",
      proxy: "proxy",
      producer: "producer",
      agentAsks: (l: string) => `Agent ${l}: ask now`,
      figIdem:
        "With IDEM: identical Interests from several agents wait on one PIT entry at the edge, one goes to the producer, the signed Data fans out to all of them and stays in the Content Store, which answers a later agent without asking the producer",
      figPlain:
        "Plain MCP: every agent's call travels through the proxy to the server, which runs the tool once per call",
      legendInterest: "Interest: a request, by name",
      legendData: "Data: the signed answer",
      legendRun: "one run of the tool",
      beatsIdem: [
        {
          term: "Fold.",
          body: "Identical Interests that meet at the edge wait on one PIT entry. Only one goes upstream.",
        },
        {
          term: "Fan out.",
          body: "One signed Data comes back, is checked, stored, and answers every agent that was waiting.",
        },
        {
          term: "Serve.",
          body: "A later ask for the same name is answered from the Content Store. The producer is not asked.",
        },
      ] as Beat[],
      beatsPlain: [
        {
          term: "Travel.",
          body: "Every agent's call crosses the whole path to the server, even the same call.",
        },
        {
          term: "Run again.",
          body: "The server runs the tool once per call: same question, same work, again.",
        },
        { term: "Pay again.", body: "An agent that asks a moment later pays the full trip and another run." },
      ] as Beat[],
    },
    how: {
      label: "How it works",
      title: "A tool call becomes a name. Its result becomes signed data.",
      lead: "The Named Data Networking model, applied to tool calling. Requests carry names, not destinations; answers carry signatures, not trust in the path.",
      facts: [
        { term: "Names", value: "/idem/v1/… · SHA-256" },
        { term: "Canonical form", value: "JCS, RFC 8785" },
        { term: "Signatures", value: "Ed25519" },
        { term: "Forwarder state", value: "PIT · CS · FIB" },
      ],
      tabs: "How an IDEM call works",
      replay: "Play again",
      steps: [
        {
          label: "Canonicalize",
          body: "The consumer validates the arguments against the tool's schema, applies only the normalizers the producer declared, and serializes them with JCS. Two spellings of one request become the same bytes.",
        },
        {
          label: "Name",
          body: "The name is a function of the producer, the tool's identity and the canonical arguments, and nothing else. The arguments appear only as a digest.",
        },
        {
          label: "Sign",
          body: "The producer runs the tool once and signs the name together with the result's metadata. The content is bound by its digest, so the answer can travel through any cache and stay checkable.",
        },
        {
          label: "Serve",
          body: "Any forwarder on the path may answer from its Content Store. The consumer verifies the producer's signature, whoever answered.",
        },
      ],
      canon: {
        title:
          "Two spellings of the same URL: the producer's url:sortQuery normalizer lowercases the host, drops the default port and the fragment, and sorts the query, so both serialize to the same canonical bytes",
        a: "agent A",
        b: "agent B",
        rules: ["host to lowercase", "default port dropped", "fragment dropped", "query sorted"],
        normalizer: "the producer declares",
        canonical: "canonical args, JCS",
        same: "Same bytes, so the same name.",
      },
      name: {
        title:
          "An IDEM name: version, producer, tool, a digest of the tool's identity and a digest of the canonical arguments",
        identity: "tool identity",
        args: "canonical args",
        parts: ["version", "producer", "tool", "schema", "arguments"],
        note: "Only a digest of the arguments is in the name, never the arguments.",
      },
      sign: {
        title:
          "The producer runs the tool once and signs: the signature covers the name and the metadata, and the metadata carries the content's digest",
        producer: "producer",
        runs: "runs the tool once",
        content: "the CallToolResult",
        digest: "SHA-256 of the content",
        meta: "producedAt · freshnessMs · scope",
        signature: "Ed25519 · keyLocator",
        age: "time in caches, not signed",
        signed: "signed",
        key: "producer's key",
      },
      serve: {
        title:
          "An agent's Interest is answered by a regional forwarder's Content Store; the agent verifies the Data with the producer's key before using it",
        agent: "agent",
        edge: "edge",
        regional: "regional",
        producer: "producer",
        miss: "not here",
        hit: "in its CS",
        notAsked: "not asked",
        verify: "verified with the producer's key",
        manifest: "from the signed manifest",
      },
    },
    live: {
      label: "Live, in this page",
      title: "Same question, same name.",
      lead: "Edit either call. Both are canonicalized and named by the real protocol library, running in your browser. Equivalent spellings collapse to one name, so a cache or an aggregating forwarder treats them as one request.",
      try: "Try",
      presets: ["Same page, different spelling", "Different page"],
      field: "args.url",
      canonical: "Canonical args (JCS)",
      name: "Name",
      computing: "computing…",
      same: "Same name: one fetch serves both",
      different: "Different names: two fetches",
      naming: "naming…",
      notIdem: "Not an IDEM call",
      fallback: "A consumer would fall back to a plain MCP call.",
      footnote: [
        "Computed in your browser by ",
        "@idem/core",
        ": validate against the schema, apply the producer's normalizer ",
        "url:sortQuery",
        " (lowercase the host, drop the default port and the fragment, sort the query), serialize with JCS (RFC 8785), then SHA-256.",
      ],
      packetsTitle: "Two packets. One asks, one answers.",
      packetsLead: [
        { text: "An " },
        { text: "Interest", tone: "i" },
        {
          text: " names what it wants and carries the canonical arguments, so the producer can run the tool. A ",
        },
        { text: "Data", tone: "d" },
        {
          text: " object is the producer's signed answer: any cache may keep it and serve it again, because the signature travels with it.",
        },
      ] as Seg[],
      interestNotes: [
        ["name", "What is asked. The arguments appear only as a digest."],
        ["args", "The canonical arguments. Every forwarder recomputes the digest; a mismatch is dropped."],
        ["lifetimeMs", "How long the request may wait in a PIT."],
        ["nonce", "Per-request randomness, for loop detection."],
        ["hopLimit", "Bounds forwarding; every hop decrements it."],
      ] as [string, string][],
      dataNotes: [
        ["content", "The MCP CallToolResult, unchanged."],
        ["meta", "Content digest, production time, freshness and scope: all covered by the signature."],
        ["signature", "Ed25519 over the name and meta. The key is listed in the producer's signed manifest."],
        ["ageMs", "Not signed: time spent in caches, like HTTP Age."],
      ] as [string, string][],
      signed: "signed bytes",
      sameName: "same name",
      signAgain: "Sign again",
      signing: "signing…",
      generated:
        "Signed in your browser with a fresh Ed25519 key. Sign again: the nonce and the signature change, the name does not.",
      cannotSign: "This browser could not sign the packets (its WebCrypto may lack Ed25519).",
      /** The sample Data's content (prose inside the JSON); keys, names and digests stay as they are. */
      sampleText: "Sample page text, signed in your browser.",
    },
    forwarder: {
      label: "Inside a forwarder",
      title: "Pass through, drop, serve, fold or forward.",
      lead: "Every node on the path runs the same pipeline. The Pending Interest Table folds identical requests into one, the Content Store answers from cache, and the FIB picks the next hop. Data coming back is verified before it is stored or delivered.",
      title2:
        "The forwarder pipeline of spec §7: an Interest is passed through, dropped, answered from the Content Store, added to a pending PIT entry, or forwarded; the Data that comes back is verified, stored, delivered to every waiting face, and the entry is cleared",
      pick: "Send an Interest",
      scenarios: [
        { label: "A side effect", call: "send_email(…)" },
        { label: "Tampered args", call: "args ≠ name" },
        { label: "Asked before", call: "fetch_page(…/doc/3)" },
        { label: "Already pending", call: "fetch_page(…/doc/3)" },
        { label: "A new question", call: "fetch_page(…/doc/4)" },
      ],
      yes: "yes",
      no: "no",
      boxes: {
        in: { title: "Interest in", sub: "from a face" },
        cacheable: { title: "cacheable?", sub: "per manifest" },
        valid: { title: "valid?", sub: "digest, loop" },
        cs: { title: "fresh in CS?", sub: "scope allows" },
        pit: { title: "in the PIT?", sub: "name pending" },
        fwd: { title: "forward", sub: "PIT entry, FIB" },
        pass: { title: "pass through", sub: "plain MCP" },
        drop: { title: "drop", sub: "wrong digest" },
        reply: { title: "reply Data", sub: "from the CS" },
        add: { title: "add the face", sub: "waits on entry" },
        dataIn: { title: "Data in", sub: "from upstream" },
        verify: { title: "verify", sub: "the signature" },
        store: { title: "store", sub: "if cacheable" },
        satisfy: { title: "satisfy", sub: "every face" },
        clear: { title: "clear", sub: "entry removed" },
      } as Record<string, Labelled>,
      upstream: "upstream",
      failsHead: "if it fails:",
      failsBody: "drop, error to the waiters",
      failsShort: "if it fails: drop",
      interestRow: "Interest, downstream to upstream",
      dataRow: "Data, upstream to downstream",
      caption:
        "The forwarding rules of spec §7. Pick an Interest, or let them play in turn: blue is the request's path, yellow the answer's.",
    },
    where: {
      label: "Where it sits",
      title: "An application-layer overlay, borrowing a network-layer idea.",
      body: "IDEM runs over HTTP between agent, edge gateway and producer: like a CDN with signed objects, addressed by names instead of URLs. It borrows the network-layer model of Named Data Networking without asking the network to change.",
      today: "Today",
      todayBody: "HTTP overlay between agent, edge gateway and producer, running in the sandbox.",
      planned: "Native NDN",
      plannedBody:
        "The same names and signed Data as NDN packets, via NDNts, measured against NFD forwarders in Docker.",
      note: "In the spec, a binding is an MCP transport, not an OSI layer 4 protocol.",
      figTitle:
        "The protocol stack, exploded: IP, TCP, TLS, HTTP, the IDEM overlay, and the application with MCP on top",
      layers: [
        { name: "IP", what: "host-to-host delivery" },
        { name: "TCP", what: "a reliable byte stream" },
        { name: "TLS", what: "channel security, hop by hop" },
        { name: "HTTP", what: "request and response" },
        { name: "IDEM", what: "names · PIT · CS · signed Data" },
        { name: "Application", what: "agent · MCP client and servers" },
      ],
    },
    guarantees: {
      label: "Guarantees",
      title: "Caching without trusting the cache.",
      lead: "A cache that cannot forge an answer, cannot leak one, and cannot get in the way. These are rules of the protocol, not conventions.",
      items: [
        {
          title: "Signed authorization to cache",
          body: "Only what the producer's signed manifest declares cacheable is cached. MCP annotations are untrusted: readOnlyHint is never enough.",
        },
        {
          title: "Private never leaks",
          body: "Results scoped private are kept per user at the edge, never stored beyond it, and never served to anyone else, even for the same name.",
        },
        {
          title: "End-to-end verification",
          body: "Every consumer checks the producer's signature, whoever answered. A tampered answer is rejected and the call is retried directly.",
        },
        {
          title: "Transparent to MCP",
          body: "Tools with side effects or no cache policy, and arguments outside the schema, pass through as ordinary MCP calls.",
        },
      ],
      v1: {
        title:
          "The forwarder stores a signed Data whose tool the producer's signed manifest marks cacheable; a result from a tool that only claims readOnlyHint passes by and is not stored",
        manifest: "signed manifest",
        cacheable: "cacheable",
        hint: "readOnlyHint only",
        cs: "CS",
      },
      v2: {
        title:
          "Alice's private result is kept in her own partition at the edge; Bob asks for the same name, is not served from Alice's partition, and his request goes to the producer",
        alice: "Alice",
        bob: "Bob",
        edge: "edge",
        upstream: "to the producer",
      },
      v3: {
        title:
          "A signed Data passes the agent's check; a tampered one fails it, is thrown away, and the agent asks the producer directly",
        agent: "agent",
        cache: "a cache",
        producer: "producer",
        tampered: "tampered",
        retry: "retry, direct",
      },
      v4: {
        title:
          "A call with a side effect passes straight through the forwarder as a plain MCP call; its PIT and Content Store are not touched",
        call: "send_email(…)",
        plain: "plain MCP",
        untouched: "untouched",
      },
    },
    cta: {
      title: "One question. One trip.",
      body: "Watch identical calls fold into one request in the sandbox, with real names, real signatures and real verification, or read how the protocol works.",
      sandbox: "Open the sandbox",
      docs: "Read the docs",
      fine: [
        "A research prototype for EEL878 Computer Networks I (UFRJ, 2026/2). The protocol is specified and implemented; the experiments that test it have not run yet, so this site states no results. Measured numbers will appear on ",
        " once they exist.",
      ],
    },
  },
  {
    nav: {
      idea: "Ideia",
      how: "Como funciona",
      live: "Ao vivo",
      forwarder: "Forwarder",
      guarantees: "Garantias",
    },
    hero: {
      title: [
        { text: "Chamadas de ferramenta", br: true },
        { text: "como " },
        { text: "dados", tone: "d" },
        { text: " " },
        { text: "nomeados", tone: "i" },
        { text: "." },
      ],
      body: "O IDEM dá um nome a cada chamada de ferramenta MCP somente leitura e assina a resposta, para que chamadas idênticas viajem uma vez só e qualquer nó do caminho possa entregar o resultado.",
      sandbox: "Abrir o sandbox",
      docs: "Ler a documentação",
      stackLabel: "Feito com",
      stack: {
        mcp: "Model Context Protocol: as chamadas de ferramenta que o IDEM nomeia",
        ndn: "Named Data Networking: a arquitetura que o IDEM toma emprestada (Interest, Data, PIT, CS)",
        ndnts: "NDNts: as bibliotecas NDN por trás da ligação nativa",
        ed25519: "Assinaturas Ed25519 (RFC 8032), via WebCrypto",
        jcs: "JSON Canonicalization Scheme (RFC 8785): os bytes que são assinados",
        ts: "TypeScript: um só núcleo para navegador, Node e serverless",
      },
    },
    idea: {
      label: "A ideia",
      title: "Pergunte uma vez. Responda a todos.",
      lead: "Agentes trabalhando na mesma tarefa vivem fazendo as mesmas perguntas às mesmas ferramentas. Com MCP puro, cada chamada viaja até o servidor e executa a ferramenta de novo. O IDEM dá um nome a cada chamada somente leitura, então um forwarder no caminho pode juntar pedidos idênticos em um só e responder às repetições a partir do seu cache, com uma assinatura que prova quem fez a resposta.",
      modeLabel: "Protocolo",
      plain: "MCP puro",
      idem: "Com IDEM",
      hint: "Clique em um agente para ele perguntar.",
      sameCall: "Todo agente pede",
      edge: "forwarder de borda",
      proxy: "proxy",
      producer: "produtor",
      agentAsks: (l: string) => `Agente ${l}: perguntar agora`,
      figIdem:
        "Com IDEM: Interests idênticos de vários agentes esperam numa mesma entrada da PIT na borda, um só vai ao produtor, o Data assinado volta para todos eles e fica no Content Store, que responde a um agente que pergunta depois sem consultar o produtor",
      figPlain:
        "MCP puro: a chamada de cada agente atravessa o proxy até o servidor, que executa a ferramenta uma vez por chamada",
      legendInterest: "Interest: um pedido, pelo nome",
      legendData: "Data: a resposta assinada",
      legendRun: "uma execução da ferramenta",
      beatsIdem: [
        {
          term: "Agrupar.",
          body: "Interests idênticos que se encontram na borda esperam numa mesma entrada da PIT. Só um segue adiante.",
        },
        {
          term: "Distribuir.",
          body: "Volta um único Data assinado, que é conferido, guardado e responde a todos os agentes que esperavam.",
        },
        {
          term: "Servir.",
          body: "Quem pede o mesmo nome depois é respondido pelo Content Store. O produtor nem é consultado.",
        },
      ],
      beatsPlain: [
        {
          term: "Viajar.",
          body: "A chamada de cada agente atravessa o caminho todo até o servidor, mesmo sendo a mesma chamada.",
        },
        {
          term: "Executar de novo.",
          body: "O servidor executa a ferramenta uma vez por chamada: mesma pergunta, mesmo trabalho, de novo.",
        },
        {
          term: "Pagar de novo.",
          body: "Um agente que pergunta logo depois paga a viagem inteira e mais uma execução.",
        },
      ],
    },
    how: {
      label: "Como funciona",
      title: "Uma chamada de ferramenta vira um nome. O resultado vira um dado assinado.",
      lead: "O modelo de Named Data Networking, aplicado a chamadas de ferramenta. Pedidos carregam nomes, não destinos; respostas carregam assinaturas, não confiança no caminho.",
      facts: [
        { term: "Nomes", value: "/idem/v1/… · SHA-256" },
        { term: "Forma canônica", value: "JCS, RFC 8785" },
        { term: "Assinaturas", value: "Ed25519" },
        { term: "Estado do forwarder", value: "PIT · CS · FIB" },
      ],
      tabs: "Como funciona uma chamada IDEM",
      replay: "Repetir",
      steps: [
        {
          label: "Canonizar",
          body: "O consumidor valida os argumentos contra o schema da ferramenta, aplica só os normalizadores que o produtor declarou e serializa tudo com JCS. Duas grafias do mesmo pedido viram os mesmos bytes.",
        },
        {
          label: "Nomear",
          body: "O nome é função do produtor, da identidade da ferramenta e dos argumentos canônicos, e de nada mais. Os argumentos aparecem só como digest.",
        },
        {
          label: "Assinar",
          body: "O produtor executa a ferramenta uma vez e assina o nome junto com os metadados do resultado. O conteúdo fica preso pelo seu digest, então a resposta pode passar por qualquer cache e continuar verificável.",
        },
        {
          label: "Servir",
          body: "Qualquer forwarder do caminho pode responder do seu Content Store. O consumidor verifica a assinatura do produtor, não importa quem respondeu.",
        },
      ],
      canon: {
        title:
          "Duas grafias da mesma URL: o normalizador url:sortQuery do produtor passa o host para minúsculas, remove a porta padrão e o fragmento e ordena a query, então as duas viram os mesmos bytes canônicos",
        a: "agente A",
        b: "agente B",
        rules: ["host em minúsculas", "porta padrão removida", "fragmento removido", "query ordenada"],
        normalizer: "o produtor declara",
        canonical: "args canônicos, JCS",
        same: "Mesmos bytes, logo o mesmo nome.",
      },
      name: {
        title:
          "Um nome IDEM: versão, produtor, ferramenta, um digest da identidade da ferramenta e um digest dos argumentos canônicos",
        identity: "identidade da ferramenta",
        args: "args canônicos",
        parts: ["versão", "produtor", "ferramenta", "schema", "argumentos"],
        note: "No nome entra só um digest dos argumentos, nunca os argumentos.",
      },
      sign: {
        title:
          "O produtor executa a ferramenta uma vez e assina: a assinatura cobre o nome e os metadados, e os metadados carregam o digest do conteúdo",
        producer: "produtor",
        runs: "executa a ferramenta uma vez",
        content: "o CallToolResult",
        digest: "SHA-256 do conteúdo",
        meta: "producedAt · freshnessMs · scope",
        signature: "Ed25519 · keyLocator",
        age: "tempo em caches, não assinado",
        signed: "assinado",
        key: "chave do produtor",
      },
      serve: {
        title:
          "O Interest de um agente é respondido pelo Content Store de um forwarder regional; o agente verifica o Data com a chave do produtor antes de usá-lo",
        agent: "agente",
        edge: "borda",
        regional: "regional",
        producer: "produtor",
        miss: "não tem",
        hit: "tem no CS",
        notAsked: "nem consultado",
        verify: "verificado com a chave do produtor",
        manifest: "do manifesto assinado",
      },
    },
    live: {
      label: "Ao vivo, nesta página",
      title: "Mesma pergunta, mesmo nome.",
      lead: "Edite qualquer uma das chamadas. As duas são canonizadas e nomeadas pela biblioteca real do protocolo, rodando no seu navegador. Grafias equivalentes viram um nome só, então um cache ou um forwarder que agrupa pedidos as trata como um único pedido.",
      try: "Teste",
      presets: ["Mesma página, outra grafia", "Outra página"],
      field: "args.url",
      canonical: "Args canônicos (JCS)",
      name: "Nome",
      computing: "calculando…",
      same: "Mesmo nome: uma busca serve as duas",
      different: "Nomes diferentes: duas buscas",
      naming: "nomeando…",
      notIdem: "Não é uma chamada IDEM",
      fallback: "Um consumidor voltaria para uma chamada MCP comum.",
      footnote: [
        "Calculado no seu navegador pelo ",
        "@idem/core",
        ": valida contra o schema, aplica o normalizador do produtor ",
        "url:sortQuery",
        " (host em minúsculas, sem porta padrão nem fragmento, query ordenada), serializa com JCS (RFC 8785) e aplica SHA-256.",
      ],
      packetsTitle: "Dois pacotes. Um pergunta, o outro responde.",
      packetsLead: [
        { text: "Um " },
        { text: "Interest", tone: "i" },
        {
          text: " diz o nome do que quer e leva os argumentos canônicos, para que o produtor possa executar a ferramenta. Um ",
        },
        { text: "Data", tone: "d" },
        {
          text: " é a resposta assinada do produtor: qualquer cache pode guardá-lo e entregá-lo de novo, porque a assinatura viaja junto.",
        },
      ],
      interestNotes: [
        ["name", "O que se pede. Os argumentos aparecem só como digest."],
        [
          "args",
          "Os argumentos canônicos. Todo forwarder recalcula o digest; se não bater, o pedido é descartado.",
        ],
        ["lifetimeMs", "Quanto tempo o pedido pode esperar numa PIT."],
        ["nonce", "Aleatoriedade por pedido, para detectar laços."],
        ["hopLimit", "Limita o encaminhamento; cada salto o decrementa."],
      ],
      dataNotes: [
        ["content", "O CallToolResult do MCP, sem alteração."],
        ["meta", "Digest do conteúdo, hora de produção, validade e escopo: tudo coberto pela assinatura."],
        ["signature", "Ed25519 sobre o nome e o meta. A chave está no manifesto assinado do produtor."],
        ["ageMs", "Não assinado: tempo passado em caches, como o Age do HTTP."],
      ],
      signed: "bytes assinados",
      sameName: "mesmo nome",
      signAgain: "Assinar de novo",
      signing: "assinando…",
      generated:
        "Assinado no seu navegador com uma chave Ed25519 nova. Assine de novo: o nonce e a assinatura mudam, o nome não.",
      cannotSign:
        "Este navegador não conseguiu assinar os pacotes (talvez o WebCrypto dele não tenha Ed25519).",
      sampleText: "Texto de exemplo da página, assinado no seu navegador.",
    },
    forwarder: {
      label: "Dentro de um forwarder",
      title: "Deixar passar, descartar, servir, agrupar ou encaminhar.",
      lead: "Todo nó do caminho roda o mesmo pipeline. A Pending Interest Table junta pedidos idênticos em um só, o Content Store responde do cache e a FIB escolhe o próximo salto. O Data que volta é verificado antes de ser guardado ou entregue.",
      title2:
        "O pipeline do forwarder, §7 da spec: um Interest passa direto, é descartado, é respondido pelo Content Store, entra numa entrada pendente da PIT ou é encaminhado; o Data que volta é verificado, guardado, entregue a cada face que esperava, e a entrada é removida",
      pick: "Envie um Interest",
      scenarios: [
        { label: "Efeito colateral", call: "send_email(…)" },
        { label: "Args adulterados", call: "args ≠ name" },
        { label: "Já perguntado", call: "fetch_page(…/doc/3)" },
        { label: "Já pendente", call: "fetch_page(…/doc/3)" },
        { label: "Pergunta nova", call: "fetch_page(…/doc/4)" },
      ],
      yes: "sim",
      no: "não",
      boxes: {
        in: { title: "novo Interest", sub: "por uma face" },
        cacheable: { title: "cacheável?", sub: "pelo manifesto" },
        valid: { title: "válido?", sub: "digest, laço" },
        cs: { title: "fresco no CS?", sub: "escopo permite" },
        pit: { title: "está na PIT?", sub: "nome pendente" },
        fwd: { title: "encaminha", sub: "PIT, FIB" },
        pass: { title: "passa direto", sub: "MCP comum" },
        drop: { title: "descarta", sub: "digest errado" },
        reply: { title: "responde Data", sub: "do CS" },
        add: { title: "anota a face", sub: "espera junto" },
        dataIn: { title: "Data chega", sub: "de cima" },
        verify: { title: "verifica", sub: "a assinatura" },
        store: { title: "guarda", sub: "se cacheável" },
        satisfy: { title: "satisfaz", sub: "toda face" },
        clear: { title: "limpa", sub: "tira a entrada" },
      },
      upstream: "para cima",
      failsHead: "se falhar:",
      failsBody: "descarta e avisa quem espera",
      failsShort: "se falhar: descarta",
      interestRow: "Interest, de baixo para cima",
      dataRow: "Data, de cima para baixo",
      caption:
        "As regras de encaminhamento do §7 da spec. Escolha um Interest ou deixe que eles se revezem: azul é o caminho do pedido, amarelo o da resposta.",
    },
    where: {
      label: "Onde ele fica",
      title: "Uma sobreposição na camada de aplicação, com uma ideia da camada de rede.",
      body: "O IDEM roda sobre HTTP entre o agente, o gateway de borda e o produtor: como uma CDN com objetos assinados, endereçados por nomes em vez de URLs. Ele toma emprestado o modelo de rede do Named Data Networking sem pedir que a rede mude.",
      today: "Hoje",
      todayBody: "Sobreposição HTTP entre agente, gateway de borda e produtor, rodando no sandbox.",
      planned: "NDN nativo",
      plannedBody:
        "Os mesmos nomes e Data assinados como pacotes NDN, via NDNts, medidos com forwarders NFD em Docker.",
      note: "Na spec, um binding é um transporte do MCP, não um protocolo da camada 4 do OSI.",
      figTitle:
        "A pilha de protocolos, explodida: IP, TCP, TLS, HTTP, a sobreposição IDEM e a aplicação com o MCP no topo",
      layers: [
        { name: "IP", what: "entrega de host a host" },
        { name: "TCP", what: "um fluxo de bytes confiável" },
        { name: "TLS", what: "segurança do canal, salto a salto" },
        { name: "HTTP", what: "requisição e resposta" },
        { name: "IDEM", what: "nomes · PIT · CS · Data assinado" },
        { name: "Aplicação", what: "agente · cliente e servidores MCP" },
      ],
    },
    guarantees: {
      label: "Garantias",
      title: "Cache sem confiar no cache.",
      lead: "Um cache que não consegue forjar uma resposta, não consegue vazar uma e não atrapalha. São regras do protocolo, não convenções.",
      items: [
        {
          title: "Autorização assinada para cachear",
          body: "Só entra no cache o que o manifesto assinado do produtor declara cacheável. As anotações do MCP não são confiáveis: readOnlyHint nunca basta.",
        },
        {
          title: "Privado nunca vaza",
          body: "Resultados de escopo privado ficam guardados por usuário na borda, nunca além dela, e nunca são entregues a outra pessoa, nem para o mesmo nome.",
        },
        {
          title: "Verificação de ponta a ponta",
          body: "Todo consumidor confere a assinatura do produtor, não importa quem respondeu. Uma resposta adulterada é rejeitada e a chamada é refeita direto no produtor.",
        },
        {
          title: "Transparente para o MCP",
          body: "Ferramentas com efeito colateral ou sem política de cache, e argumentos fora do schema, passam como chamadas MCP comuns.",
        },
      ],
      v1: {
        title:
          "O forwarder guarda um Data assinado cuja ferramenta o manifesto assinado do produtor marca como cacheável; o resultado de uma ferramenta que só alega readOnlyHint passa direto e não é guardado",
        manifest: "manifesto assinado",
        cacheable: "cacheável",
        hint: "só readOnlyHint",
        cs: "CS",
      },
      v2: {
        title:
          "O resultado privado da Alice fica na partição dela na borda; o Bob pede o mesmo nome, não é servido pela partição da Alice, e o pedido dele vai ao produtor",
        alice: "Alice",
        bob: "Bob",
        edge: "borda",
        upstream: "ao produtor",
      },
      v3: {
        title:
          "Um Data assinado passa na checagem do agente; um adulterado falha, é jogado fora, e o agente pergunta direto ao produtor",
        agent: "agente",
        cache: "um cache",
        producer: "produtor",
        tampered: "adulterado",
        retry: "refaz, direto",
      },
      v4: {
        title:
          "Uma chamada com efeito colateral atravessa o forwarder como uma chamada MCP comum; a PIT e o Content Store dele não são tocados",
        call: "send_email(…)",
        plain: "MCP comum",
        untouched: "intocados",
      },
    },
    cta: {
      title: "Uma pergunta. Uma viagem.",
      body: "Veja chamadas idênticas virarem um único pedido no sandbox, com nomes reais, assinaturas reais e verificação real, ou leia como o protocolo funciona.",
      sandbox: "Abrir o sandbox",
      docs: "Ler a documentação",
      fine: [
        "Um protótipo de pesquisa para a disciplina EEL878 Redes de Computadores I (UFRJ, 2026/2). O protocolo está especificado e implementado; os experimentos que o testam ainda não rodaram, então este site não afirma nenhum resultado. Números medidos vão aparecer em ",
        " quando existirem.",
      ],
    },
  },
);
