import { defineMessages } from "../locale";

/**
 * The documentation: interface strings, the page tree (titles and leads) and the labels inside the
 * figures. The pages' own text lives in `content/docs/<locale>/<slug>.md` (ADR-022). Names, code,
 * digests and protocol terms (Interest, Data, PIT, CS, FIB, MUST, SHOULD) are never translated.
 */
export const docs = defineMessages(
  {
    meta: {
      title: "Docs",
      /** The browser tab of a docs page: `%s` is the page's title. */
      titleTemplate: "%s · IDEM Docs",
      description:
        "IDEM documentation: concepts, the normative v1 protocol, architecture, the API of the @idem packages, the sandbox guide and the evaluation method.",
    },
    nav: {
      label: "Documentation",
      menu: "Menu",
      open: "Open the documentation menu",
      close: "Close the documentation menu",
    },
    groups: {
      learn: "Learn",
      spec: "Specification",
      use: "Use",
      research: "Research",
    },
    pages: {
      introduction: {
        title: "Introduction",
        lead: "IDEM turns a read-only tool call into a name and its result into signed data, so the same question is answered once and any node on the path can serve the answer.",
      },
      concepts: {
        title: "Concepts",
        lead: "Names, Interests and Data, the forwarder's three tables, signatures and the trust manifest, freshness and scope: the ideas everything else in these docs builds on.",
      },
      architecture: {
        title: "Architecture",
        lead: "One protocol engine, used unchanged by the HTTP gateway, the simulator and the browser sandbox, and the packages built around it.",
      },
      protocol: {
        title: "Protocol",
        lead: "IDEM v1: names, canonicalization, Interest, Data, manifest, forwarder behavior, bindings and errors. Every rule has an id that the tests cite.",
      },
      security: {
        title: "Security",
        lead: "What an attacker on the path, a curious neighbour or a careless cache could try, and the rule that stops each attempt.",
      },
      api: {
        title: "API reference",
        lead: "The public surface of the four packages (core, gateway, mcp and sim), as the source exports it.",
      },
      sandbox: {
        title: "Using the sandbox",
        lead: "What the sandbox runs, what each control changes, and how to read the protocol state it shows.",
      },
      evaluation: {
        title: "Evaluation",
        lead: "How the project tests its claims: the modes compared, the workloads, the metrics and the five experiments. The numbers live on the results page.",
      },
      decisions: {
        title: "Decisions",
        lead: "The architecture decision records: context, decision and consequences, in the order they were taken.",
      },
      references: {
        title: "References",
        lead: "The sources the spec cites, by key.",
      },
    },
    toc: { title: "On this page" },
    pager: { label: "Previous and next page", previous: "Previous", next: "Next" },
    code: { copy: "Copy code", copied: "Copied" },
    anchor: (heading: string) => `Link to the section “${heading}”`,
    source: {
      /** Shown before the spec file's path. */
      renderedFrom: "Rendered from",
      /** Shown after it. */
      asIs: "in the repository, as it is written there.",
      normative: "This is the normative text.",
      translation:
        "This page is a translation. The English text is normative: if the two ever differ, the English one is right.",
      stale:
        "The spec changed after this translation was made, so parts of it may be behind. Check the normative text.",
      readOriginal: "Read the normative text",
      readTranslation: "Back to the translation",
      original: "You are reading the normative text, in English.",
      untranslated: {
        decisions:
          "This page is rendered from the spec in English: it is a living record that receives new decisions, so it is not translated.",
        references:
          "This page is rendered from the spec in English: it is a bibliographic list, kept in one place.",
        protocol: "This page is rendered from the spec in English, which is the normative text.",
      },
      fallback: "This page has no translation yet, so it is shown in English.",
      missing: "This page's text is not available in this build. It lives in the repository:",
    },
    fig: {
      swarm: {
        title:
          "Three agents ask the same question. The edge forwarder sends one Interest to the producer and delivers the one signed Data to all three.",
        ask: "3 Interests, one name",
        fanout: "one Data, delivered to all 3",
        one: "1 Interest",
        signed: "1 signed Data",
        agents: "agents",
        edge: "edge forwarder",
        producer: "producer",
        signs: "runs the tool once",
      },
      name: {
        title:
          "The five components of an IDEM name: the version prefix, the producer, the tool, the schema digest and the args digest.",
        version: ["version", "wire format"],
        producer: ["producer", "runs the tool, signs"],
        tool: ["tool", "MCP tool name"],
        schema: ["schema digest", "of the tool identity", "22 characters"],
        args: ["args digest", "of the canonical args", "43 characters"],
      },
      exchange: {
        title:
          "Sequence: three agents send Interests for the same name; the edge forwards one, the producer answers with one signed Data, the edge verifies it, stores it and delivers it to all three. A later Interest is answered from the Content Store.",
        agent: "agent",
        edge: "edge",
        producer: "producer",
        miss: "CS miss → new PIT entry",
        wait2: "PIT: 2 waiting",
        wait3: "PIT: 3 waiting",
        data: "Data N, signed",
        verify: "verify · store · satisfy 3",
        later: "Later, while the Data is still fresh",
        fromCs: "Data N, from the CS",
        hit: "cs_hit: producer not asked",
      },
      tables: {
        title:
          "A forwarder and its three tables: the PIT maps a name to the faces waiting for it, the CS maps a name to signed Data, the FIB maps a producer prefix to the next hop.",
        forwarder: "forwarder",
        pit: "3 faces waiting",
        cs: "signed Data, fresh",
        fib: "→ upstream face",
        down: "downstream faces",
        up: "upstream face",
        interestsIn: "Interests in",
        dataOut: "Data out",
        interestOut: "Interest out",
        dataIn: "Data in",
      },
      signed: {
        title:
          "The fields of a Data object. The signature covers the name and the five meta fields; the content is bound through contentDigest; ageMs is not signed.",
        signed: "signed by the producer",
        key: "Ed25519, key listed in the manifest",
        content: "bound by contentDigest",
        age: "not signed",
        ageWhy: "each cache adds its own time",
      },
      freshness: {
        title:
          "Freshness timeline: Data is fresh from producedAt until the smaller of freshnessMs and the manifest TTL; its age is the time spent in earlier caches plus the time in this Content Store.",
        fresh: "fresh: served from the CS",
        stale: "stale: asked upstream again",
        upstream: "spent in earlier caches",
        here: "spent in this CS",
        now: "now",
      },
      scope: {
        title:
          "The edge's Content Store has one shared partition for public Data and one partition per authorization context for private Data. Forwarders beyond the edge store public Data only.",
        edge: "edge CS",
        context: "context",
        onlyA: "served to context A only",
        shared: "one entry, served to all",
        onlyB: "served to context B only",
        agent: "agent",
        beyond: "next forwarder",
        stored: "stored and served",
        never: "never stored",
        /** Argument of the HMAC in the pseudo-code line; the identifiers around it stay in English. */
        edgeSecret: "edge secret",
      },
      packages: {
        title:
          "Package dependencies: gateway, sim and the planned ndn package depend on core; mcp depends on gateway and core; the web app uses mcp, gateway, sim and core.",
        core: "Web APIs only: browser, Node, Vercel, simulator",
        planned: "planned (M6)",
        mcp: "MCP binding",
        web: "site, sandbox, demo routes",
        sim: "simulator",
      },
      topology: {
        title:
          "Tree topology: four agents, two edge forwarders, one regional forwarder and the producer. Interests travel toward the producer and Data returns on the same path.",
        agents: "agents",
        edges: "edge forwarders",
        regional: "regional forwarder",
        publicOnly: "caches public Data only",
        producer: "producer",
        signs: "runs tools, signs",
      },
      modes: {
        title:
          "The three main modes compared: mcp-direct, where every call reaches the producer; mcp-local-cache, where each agent keeps its own cache; and idem, where agents share an edge forwarder.",
        direct: ["every call reaches", "the producer"],
        local: ["a repeat by the same", "agent stays local"],
        idem: ["identical calls meet", "at the edge"],
      },
    },
  },
  {
    meta: {
      title: "Docs",
      titleTemplate: "%s · Documentação IDEM",
      description:
        "Documentação do IDEM: conceitos, o protocolo v1 normativo, arquitetura, a API dos pacotes @idem, o guia do sandbox e o método de avaliação.",
    },
    nav: {
      label: "Documentação",
      menu: "Menu",
      open: "Abrir o menu da documentação",
      close: "Fechar o menu da documentação",
    },
    groups: {
      learn: "Entender",
      spec: "Especificação",
      use: "Usar",
      research: "Pesquisa",
    },
    pages: {
      introduction: {
        title: "Introdução",
        lead: "O IDEM transforma uma chamada de ferramenta somente leitura em um nome e o resultado em dado assinado: a mesma pergunta é respondida uma vez, e qualquer nó do caminho pode servir a resposta.",
      },
      concepts: {
        title: "Conceitos",
        lead: "Nomes, Interest e Data, as três tabelas do forwarder, assinaturas e o manifesto de confiança, frescor e escopo: as ideias em que o resto da documentação se apoia.",
      },
      architecture: {
        title: "Arquitetura",
        lead: "Um único motor de protocolo, usado sem mudanças pelo gateway HTTP, pelo simulador e pelo sandbox no navegador, e os pacotes construídos em volta dele.",
      },
      protocol: {
        title: "Protocolo",
        lead: "IDEM v1: nomes, canonicalização, Interest, Data, manifesto, comportamento do forwarder, bindings e erros. Cada regra tem um id, citado pelos testes.",
      },
      security: {
        title: "Segurança",
        lead: "O que um atacante no caminho, um vizinho curioso ou um cache descuidado poderia tentar, e a regra que barra cada tentativa.",
      },
      api: {
        title: "Referência da API",
        lead: "A superfície pública dos quatro pacotes (core, gateway, mcp e sim), como o código-fonte a exporta.",
      },
      sandbox: {
        title: "Como usar o sandbox",
        lead: "O que o sandbox executa, o que cada controle muda e como ler o estado do protocolo que ele mostra.",
      },
      evaluation: {
        title: "Avaliação",
        lead: "Como o projeto testa o que afirma: os modos comparados, as cargas de trabalho, as métricas e os cinco experimentos. Os números ficam na página de resultados.",
      },
      decisions: {
        title: "Decisões",
        lead: "Os registros de decisão de arquitetura: contexto, decisão e consequências, na ordem em que foram tomadas.",
      },
      references: {
        title: "Referências",
        lead: "As fontes que a especificação cita, por chave.",
      },
    },
    toc: { title: "Nesta página" },
    pager: { label: "Página anterior e próxima", previous: "Anterior", next: "Próxima" },
    code: { copy: "Copiar código", copied: "Copiado" },
    anchor: (heading: string) => `Link para a seção “${heading}”`,
    source: {
      renderedFrom: "Renderizado de",
      asIs: "no repositório, como está escrito lá.",
      normative: "Este é o texto normativo.",
      translation:
        "Esta página é uma tradução. O texto em inglês é o normativo: se os dois divergirem, vale o inglês.",
      stale:
        "A especificação mudou depois desta tradução, então partes dela podem estar atrasadas. Confira o texto normativo.",
      readOriginal: "Ler o texto normativo",
      readTranslation: "Voltar à tradução",
      original: "Você está lendo o texto normativo, em inglês.",
      untranslated: {
        decisions:
          "Esta página é renderizada da especificação, em inglês: é um registro vivo, que recebe decisões novas, e por isso não é traduzida.",
        references:
          "Esta página é renderizada da especificação, em inglês: é uma lista bibliográfica, mantida em um só lugar.",
        protocol: "Esta página é renderizada da especificação em inglês, que é o texto normativo.",
      },
      fallback: "Esta página ainda não tem tradução, por isso aparece em inglês.",
      missing: "O texto desta página não está disponível nesta build. Ele fica no repositório:",
    },
    fig: {
      swarm: {
        title:
          "Três agentes fazem a mesma pergunta. O forwarder de borda envia um Interest ao produtor e entrega o único Data assinado aos três.",
        ask: "3 Interests, um só nome",
        fanout: "um Data, entregue aos 3",
        one: "1 Interest",
        signed: "1 Data assinado",
        agents: "agentes",
        edge: "forwarder de borda",
        producer: "produtor",
        signs: "executa uma vez",
      },
      name: {
        title:
          "Os cinco componentes de um nome IDEM: o prefixo de versão, o produtor, a ferramenta, o schema digest e o args digest.",
        version: ["versão", "do formato"],
        producer: ["produtor", "executa e assina"],
        tool: ["ferramenta", "nome no MCP"],
        schema: ["schema digest", "da identidade da tool", "22 caracteres"],
        args: ["args digest", "dos args canônicos", "43 caracteres"],
      },
      exchange: {
        title:
          "Sequência: três agentes enviam Interests para o mesmo nome; a borda encaminha um, o produtor responde com um Data assinado, a borda verifica, guarda e entrega aos três. Um Interest posterior é respondido pelo Content Store.",
        agent: "agente",
        edge: "borda",
        producer: "produtor",
        miss: "CS vazio → entrada no PIT",
        wait2: "PIT: 2 em espera",
        wait3: "PIT: 3 em espera",
        data: "Data N, assinado",
        verify: "verifica · guarda · entrega 3",
        later: "Depois, com o Data ainda fresco",
        fromCs: "Data N, vindo do CS",
        hit: "cs_hit: produtor não acionado",
      },
      tables: {
        title:
          "Um forwarder e suas três tabelas: o PIT liga um nome às faces que o aguardam, o CS liga um nome a um Data assinado, o FIB liga o prefixo de um produtor ao próximo salto.",
        forwarder: "forwarder",
        pit: "3 faces em espera",
        cs: "Data assinado, fresco",
        fib: "→ face upstream",
        down: "faces downstream",
        up: "face upstream",
        interestsIn: "Interests entram",
        dataOut: "Data sai",
        interestOut: "Interest sai",
        dataIn: "Data entra",
      },
      signed: {
        title:
          "Os campos de um Data. A assinatura cobre o nome e os cinco campos de meta; o conteúdo fica preso pelo contentDigest; ageMs não é assinado.",
        signed: "assinado pelo produtor",
        key: "Ed25519, chave listada no manifesto",
        content: "preso pelo contentDigest",
        age: "não assinado",
        ageWhy: "cada cache soma o seu tempo",
      },
      freshness: {
        title:
          "Linha do tempo do frescor: o Data é fresco de producedAt até o menor entre freshnessMs e o TTL do manifesto; sua idade é o tempo passado em caches anteriores mais o tempo neste Content Store.",
        fresh: "fresco: servido do CS",
        stale: "vencido: pede de novo",
        upstream: "tempo em caches anteriores",
        here: "tempo neste CS",
        now: "agora",
      },
      scope: {
        title:
          "O Content Store da borda tem uma partição compartilhada para Data público e uma partição por contexto de autorização para Data privado. Forwarders além da borda só guardam Data público.",
        edge: "CS da borda",
        context: "contexto",
        onlyA: "só para o contexto A",
        shared: "uma entrada, para todos",
        onlyB: "só para o contexto B",
        agent: "agente",
        beyond: "forwarder seguinte",
        stored: "guardado e servido",
        never: "nunca guardado",
        edgeSecret: "segredo da borda",
      },
      packages: {
        title:
          "Dependências dos pacotes: gateway, sim e o pacote ndn planejado dependem do core; mcp depende de gateway e core; o site usa mcp, gateway, sim e core.",
        core: "só Web APIs: navegador, Node, Vercel, simulador",
        planned: "planejado (M6)",
        mcp: "binding MCP",
        web: "site, sandbox, rotas de demo",
        sim: "simulador",
      },
      topology: {
        title:
          "Topologia em árvore: quatro agentes, dois forwarders de borda, um forwarder regional e o produtor. Interests seguem em direção ao produtor e o Data volta pelo mesmo caminho.",
        agents: "agentes",
        edges: "forwarders de borda",
        regional: "forwarder regional",
        publicOnly: "só guarda Data público",
        producer: "produtor",
        signs: "executa e assina",
      },
      modes: {
        title:
          "Os três modos principais comparados: mcp-direct, em que toda chamada chega ao produtor; mcp-local-cache, em que cada agente mantém o próprio cache; e idem, em que os agentes compartilham um forwarder de borda.",
        direct: ["toda chamada chega", "ao produtor"],
        local: ["a repetição do mesmo", "agente fica local"],
        idem: ["chamadas idênticas se", "encontram na borda"],
      },
    },
  },
);
