import { defineMessages } from "../locale";

/**
 * The sandbox's network editor (ADR-027): the example picker, the Add palette, the properties of the
 * selected node or link, the run settings and the canvas gestures. Protocol terms (Interest, Data,
 * PIT, CS, forwarder, producer, NDN, YaNFD), node ids, tool names and numbers are never translated.
 */
export const editor = defineMessages(
  {
    network: "Network",
    examples: "Examples",
    examplesTitle: "Load an example or a blank canvas",
    share: "Share",
    shareTitle: "Copy a link to this network",
    copied: "Link copied",
    copyFailed: "Copy failed: the link is in the address bar",
    undo: "Undo",
    redo: "Redo",
    fromExample: (name: string) => `From: ${name}`,
    edited: "edited",
    example: {
      swarm: {
        name: "Swarm",
        blurb: "Eight agents behind one edge forwarder, one producer. Most calls fetch shared pages.",
      },
      "two-producers": {
        name: "Two producers",
        blurb: "A docs producer and a weather producer; each agent has its own tool list.",
      },
      regional: {
        name: "Regional tree",
        blurb: "Three edges under a regional forwarder: its cache answers what another edge fetched.",
      },
      live: {
        name: "Live, real HTTP",
        blurb: "This browser through the deployed edge gateway to the producer. Every answer verified here.",
      },
      blank: { name: "Blank canvas", blurb: "Nothing yet: add agents, forwarders and producers." },
    },
    picker: {
      title: "Start from",
      intro:
        "Every example can be edited: drag nodes, link them, change what each one does. Your network is kept in this browser.",
      close: "Close",
      current: "open now",
      locked: "fixed network",
      startTitle: "What do you want to run?",
      resume: "Continue where you left off",
      resumeBlurb: (from: string, nodes: number) =>
        `Your network from ${from}, ${nodes} ${nodes === 1 ? "node" : "nodes"}, as you left it.`,
    },
    run: {
      title: "Run",
      engine: "Engine",
      engineIdem: "IDEM",
      engineIdemHint: "simulated, seeded",
      engineNdn: "NDN",
      engineNdnHint: "real routers",
      compare: "Compare",
      compareModes: {
        "mcp-direct": "MCP direct",
        "mcp-local-cache": "MCP + local cache",
        idem: "IDEM",
      },
      cannotRun: "Can't run yet",
      tips: {
        engine:
          "IDEM: the real @idem/core forwarders on the simulator's virtual clock, the same run for the same seed. NDN: real NDN routers (YaNFD, ndnd's forwarder, compiled to WebAssembly) running in this tab, in real time, with NDN packets on every link.",
        compare:
          "The same seeded workload runs once per protocol, side by side. MCP direct: every call goes to the producer. MCP + local cache: each agent caches its own results. IDEM: forwarders aggregate and cache signed results for everyone.",
      },
    },
    add: {
      title: "Add",
      agent: "Agent",
      forwarder: "Forwarder",
      producer: "Producer",
      hint: "Click to add next to the selected node (linked to it), or drag onto the network.",
      tips: {
        agent: "An LLM agent making tool calls. It connects to a forwarder.",
        forwarder:
          "An IDEM forwarder (an edge or regional gateway): it aggregates identical pending calls (PIT) and caches signed results (CS).",
        producer: "An MCP server that signs its results. Its name goes into every Data name it signs.",
      },
    },
    props: {
      title: "Selected",
      none: "Select a node or a link on the network to change it. Drag from a selected node's handle to link it.",
      kinds: { agent: "Agent", forwarder: "Forwarder", producer: "Producer", link: "Link" },
      calls: "Calls",
      think: "Think time",
      overlap: "Shared pages",
      zipf: "Popularity skew",
      tools: "Tools",
      noTools: "No tools yet.",
      noReach: "Link this agent to a forwarder that reaches a producer, then pick its tools here.",
      unreachable: (producer: string) => `${producer} is not reachable from here`,
      notServed: (producer: string) => `${producer} does not serve this tool`,
      weight: "Weight",
      removeTool: (tool: string) => `Remove ${tool}`,
      addTool: "Add a tool",
      csSize: "Content Store",
      name: "Name",
      nameInvalid: "A lowercase host name, unique in the network (e.g. docs.idem.dev).",
      serves: "Serves",
      ttl: "Fresh for",
      notCacheable: "never cached",
      private: "private",
      service: "Service time",
      latency: "Latency",
      loss: "Loss",
      ends: (a: string, b: string) => `${a} ↔ ${b}`,
      connect: "Connect to…",
      connectNone: "Nothing it can link to",
      delete: "Delete",
      tips: {
        calls: "How many tool calls this agent makes in a run.",
        think: "Mean pause between two calls of this agent (exponential), in virtual time.",
        overlap:
          "Share of this agent's fetch_page calls that ask for pages from a catalog every agent shares; the rest are pages only it asks for. More sharing, more cache hits.",
        zipf: "How concentrated the shared catalog's popularity is (Zipf exponent). Higher: a few pages get most calls.",
        tools:
          "The tools this agent calls, from the producers it can reach, and how often (relative weights). my_notes is private and send_email has a side effect: neither is ever shared from a cache.",
        csSize: "This forwarder's Content Store budget. When full, the least recently used entry goes.",
        name: "The producer component of the names it signs: /idem/v1/<name>/<tool>/…",
        serves:
          "The tools this producer offers and, per its signed manifest, how long a result stays fresh in caches.",
        service: "Median time the producer takes to run a tool.",
        latency: "One-way delay of this link.",
        loss: "Share of packets this link drops. Lost Interests are retried after a timeout.",
        connect: "Link this node to another one. Agents link to forwarders; forwarders to anything.",
      },
    },
    problems: {
      same: "A node cannot link to itself.",
      exists: "These two are already linked.",
      "agent-agent": "Agents don't link to each other: put a forwarder between them.",
      "agent-producer":
        "Agents reach producers through a forwarder: that is where calls are aggregated and cached.",
      "producer-producer": "Producers don't link to each other.",
      missing: "That node is gone.",
    },
    issues: {
      "no-agents": "Add an agent.",
      "no-producers": "Add a producer.",
      "agent-no-tools": (node: string) => `${node} has no tools: link it toward a producer.`,
      "tool-unreachable": (node: string, producer: string, tool: string) =>
        `${node} calls ${tool} on ${producer}, which it cannot reach.`,
      "tool-not-served": (node: string, producer: string, tool: string) =>
        `${node} calls ${tool}, which ${producer} does not serve.`,
    },
    canvas: {
      zoomIn: "Zoom in",
      zoomOut: "Zoom out",
      fit: "Fit the network",
      connect: (id: string) => `Link ${id} to another node: drag onto it`,
      select: (id: string) => `${id}: select`,
      empty: "An empty canvas. Add a node from the sidebar, or drag one here.",
      dropHere: "Drop to add",
      label: "The network editor: drag nodes to move them, drag empty space to pan, scroll to zoom",
    },
    keys: [
      ["Delete", "remove the selected node or link"],
      ["Esc", "deselect"],
      ["← ↑ → ↓", "move the selected node (Shift: further)"],
      ["⌘Z / ⇧⌘Z", "undo, redo"],
      ["F", "fit the network"],
    ] as [string, string][],
    attacks: {
      target: "Target producer",
      needsIdem: "The attacks run on the IDEM run: tick IDEM in Compare.",
    },
    ndn: {
      title: "NDN routers",
      loading: (mb: string) => `Loading the router (${mb})…`,
      starting: "Starting one router per forwarder…",
      running: (n: number) => `${n} ${n === 1 ? "router" : "routers"} running in this tab`,
      failed: (why: string) => `The routers could not start: ${why}`,
      unsupported: "This browser has no WebAssembly or Web Workers, which the NDN routers need.",
      realTime: "real time",
      limits:
        "NDN routers forward and cache, but do not check signatures (agents do) and never see private or side-effect calls: those go straight to the producer.",
      note: "YaNFD in WebAssembly",
      restart: "Run again",
      logEmpty: "No call has finished yet.",
      notOnNdn: "not on NDN",
      stats: {
        answered: "Calls answered",
        verified: "both signatures verified",
        csHits: "Content Store hits",
        aggregated: "Aggregated in a PIT",
        upstream: "Interests to producers",
        upstreamHint: "manifests and tool lists included",
        bypass: "Kept off NDN",
        failed: "Failed",
        latency: "Mean latency",
        noCompare:
          "The NDN engine runs one network in real time; switch to IDEM to compare protocols side by side.",
      },
    },
  },
  {
    network: "Rede",
    examples: "Exemplos",
    examplesTitle: "Carregar um exemplo ou uma tela em branco",
    share: "Compartilhar",
    shareTitle: "Copiar um link para esta rede",
    copied: "Link copiado",
    copyFailed: "Não deu para copiar: o link está na barra de endereço",
    undo: "Desfazer",
    redo: "Refazer",
    fromExample: (name: string) => `De: ${name}`,
    edited: "editada",
    example: {
      swarm: {
        name: "Enxame",
        blurb:
          "Oito agentes atrás de um forwarder de borda, um produtor. A maioria busca páginas compartilhadas.",
      },
      "two-producers": {
        name: "Dois produtores",
        blurb: "Um produtor de documentos e um de clima; cada agente tem sua própria lista de ferramentas.",
      },
      regional: {
        name: "Árvore regional",
        blurb: "Três bordas sob um forwarder regional: o cache dele responde o que outra borda já buscou.",
      },
      live: {
        name: "Ao vivo, HTTP real",
        blurb:
          "Este navegador pelo gateway de borda implantado até o produtor. Cada resposta verificada aqui.",
      },
      blank: { name: "Tela em branco", blurb: "Nada ainda: adicione agentes, forwarders e produtores." },
    },
    picker: {
      title: "Começar de",
      intro:
        "Todo exemplo pode ser editado: arraste nós, ligue-os, mude o que cada um faz. Sua rede fica guardada neste navegador.",
      close: "Fechar",
      current: "aberto agora",
      locked: "rede fixa",
      startTitle: "O que você quer rodar?",
      resume: "Continuar de onde parou",
      resumeBlurb: (from: string, nodes: number) =>
        `Sua rede a partir de ${from}, ${nodes} ${nodes === 1 ? "nó" : "nós"}, como você deixou.`,
    },
    run: {
      title: "Execução",
      engine: "Motor",
      engineIdem: "IDEM",
      engineIdemHint: "simulado, com semente",
      engineNdn: "NDN",
      engineNdnHint: "roteadores reais",
      compare: "Comparar",
      compareModes: {
        "mcp-direct": "MCP direto",
        "mcp-local-cache": "MCP + cache local",
        idem: "IDEM",
      },
      cannotRun: "Ainda não roda",
      tips: {
        engine:
          "IDEM: os forwarders reais do @idem/core no relógio virtual do simulador, a mesma execução para a mesma semente. NDN: roteadores NDN reais (YaNFD, o forwarder do ndnd, compilado para WebAssembly) rodando nesta aba, em tempo real, com pacotes NDN em cada enlace.",
        compare:
          "A mesma carga, com a mesma semente, roda uma vez por protocolo, lado a lado. MCP direto: toda chamada vai ao produtor. MCP + cache local: cada agente guarda os próprios resultados. IDEM: os forwarders agregam e guardam resultados assinados para todos.",
      },
    },
    add: {
      title: "Adicionar",
      agent: "Agente",
      forwarder: "Forwarder",
      producer: "Produtor",
      hint: "Clique para adicionar ao lado do nó selecionado (já ligado a ele), ou arraste para a rede.",
      tips: {
        agent: "Um agente LLM fazendo chamadas de ferramentas. Ele se liga a um forwarder.",
        forwarder:
          "Um forwarder IDEM (um gateway de borda ou regional): agrega chamadas idênticas pendentes (PIT) e guarda resultados assinados (CS).",
        producer:
          "Um servidor MCP que assina seus resultados. O nome dele entra em todo nome de Data que assina.",
      },
    },
    props: {
      title: "Selecionado",
      none: "Selecione um nó ou um enlace na rede para alterá-lo. Arraste da alça de um nó selecionado para ligá-lo.",
      kinds: { agent: "Agente", forwarder: "Forwarder", producer: "Produtor", link: "Enlace" },
      calls: "Chamadas",
      think: "Tempo de pensar",
      overlap: "Páginas compartilhadas",
      zipf: "Concentração da popularidade",
      tools: "Ferramentas",
      noTools: "Nenhuma ferramenta ainda.",
      noReach: "Ligue este agente a um forwarder que alcance um produtor e escolha as ferramentas aqui.",
      unreachable: (producer: string) => `${producer} não é alcançável daqui`,
      notServed: (producer: string) => `${producer} não oferece esta ferramenta`,
      weight: "Peso",
      removeTool: (tool: string) => `Remover ${tool}`,
      addTool: "Adicionar ferramenta",
      csSize: "Content Store",
      name: "Nome",
      nameInvalid: "Um nome de host em minúsculas, único na rede (ex.: docs.idem.dev).",
      serves: "Oferece",
      ttl: "Fresco por",
      notCacheable: "nunca em cache",
      private: "privado",
      service: "Tempo de serviço",
      latency: "Latência",
      loss: "Perda",
      ends: (a: string, b: string) => `${a} ↔ ${b}`,
      connect: "Ligar a…",
      connectNone: "Nada a que possa se ligar",
      delete: "Apagar",
      tips: {
        calls: "Quantas chamadas de ferramenta este agente faz numa execução.",
        think: "Pausa média entre duas chamadas deste agente (exponencial), em tempo virtual.",
        overlap:
          "Parte das chamadas fetch_page deste agente que pedem páginas de um catálogo que todos os agentes compartilham; o resto são páginas só dele. Mais compartilhamento, mais acertos de cache.",
        zipf: "Quão concentrada é a popularidade do catálogo compartilhado (expoente de Zipf). Maior: poucas páginas recebem a maioria das chamadas.",
        tools:
          "As ferramentas que este agente chama, dos produtores que ele alcança, e com que frequência (pesos relativos). my_notes é privada e send_email tem efeito colateral: nenhuma das duas é servida de um cache.",
        csSize:
          "O orçamento do Content Store deste forwarder. Quando enche, sai a entrada usada há mais tempo.",
        name: "O componente de produtor dos nomes que ele assina: /idem/v1/<nome>/<ferramenta>/…",
        serves:
          "As ferramentas que este produtor oferece e, pelo manifesto assinado, por quanto tempo um resultado fica fresco nos caches.",
        service: "Tempo mediano que o produtor leva para rodar uma ferramenta.",
        latency: "Atraso num sentido deste enlace.",
        loss: "Parte dos pacotes que este enlace descarta. Interests perdidos são repetidos após um timeout.",
        connect: "Ligar este nó a outro. Agentes ligam a forwarders; forwarders a qualquer um.",
      },
    },
    problems: {
      same: "Um nó não se liga a si mesmo.",
      exists: "Esses dois já estão ligados.",
      "agent-agent": "Agentes não se ligam entre si: coloque um forwarder entre eles.",
      "agent-producer":
        "Agentes chegam aos produtores por um forwarder: é lá que as chamadas são agregadas e guardadas.",
      "producer-producer": "Produtores não se ligam entre si.",
      missing: "Esse nó não existe mais.",
    },
    issues: {
      "no-agents": "Adicione um agente.",
      "no-producers": "Adicione um produtor.",
      "agent-no-tools": (node: string) => `${node} não tem ferramentas: ligue-o em direção a um produtor.`,
      "tool-unreachable": (node: string, producer: string, tool: string) =>
        `${node} chama ${tool} em ${producer}, que ele não alcança.`,
      "tool-not-served": (node: string, producer: string, tool: string) =>
        `${node} chama ${tool}, que ${producer} não oferece.`,
    },
    canvas: {
      zoomIn: "Aproximar",
      zoomOut: "Afastar",
      fit: "Enquadrar a rede",
      connect: (id: string) => `Ligar ${id} a outro nó: arraste até ele`,
      select: (id: string) => `${id}: selecionar`,
      empty: "Uma tela vazia. Adicione um nó pela barra lateral, ou arraste um para cá.",
      dropHere: "Solte para adicionar",
      label: "O editor de rede: arraste nós para movê-los, arraste o fundo para deslocar, role para dar zoom",
    },
    keys: [
      ["Delete", "remover o nó ou enlace selecionado"],
      ["Esc", "desmarcar"],
      ["← ↑ → ↓", "mover o nó selecionado (Shift: mais longe)"],
      ["⌘Z / ⇧⌘Z", "desfazer, refazer"],
      ["F", "enquadrar a rede"],
    ] as [string, string][],
    attacks: {
      target: "Produtor alvo",
      needsIdem: "Os ataques rodam na execução IDEM: marque IDEM em Comparar.",
    },
    ndn: {
      title: "Roteadores NDN",
      loading: (mb: string) => `Carregando o roteador (${mb})…`,
      starting: "Iniciando um roteador por forwarder…",
      running: (n: number) => `${n} ${n === 1 ? "roteador rodando" : "roteadores rodando"} nesta aba`,
      failed: (why: string) => `Os roteadores não iniciaram: ${why}`,
      unsupported: "Este navegador não tem WebAssembly ou Web Workers, de que os roteadores NDN precisam.",
      realTime: "tempo real",
      limits:
        "Os roteadores NDN encaminham e guardam em cache, mas não verificam assinaturas (os agentes verificam) e nunca veem chamadas privadas ou com efeito colateral: essas vão direto ao produtor.",
      note: "YaNFD em WebAssembly",
      restart: "Rodar de novo",
      logEmpty: "Nenhuma chamada terminou ainda.",
      notOnNdn: "fora do NDN",
      stats: {
        answered: "Chamadas respondidas",
        verified: "as duas assinaturas verificadas",
        csHits: "Acertos no Content Store",
        aggregated: "Agregadas numa PIT",
        upstream: "Interests aos produtores",
        upstreamHint: "manifestos e listas de ferramentas incluídos",
        bypass: "Mantidas fora do NDN",
        failed: "Falharam",
        latency: "Latência média",
        noCompare:
          "O motor NDN roda uma rede em tempo real; mude para IDEM para comparar protocolos lado a lado.",
      },
    },
  },
);
