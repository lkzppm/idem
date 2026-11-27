O projeto inteiro se apoia em uma decisão: a lógica do forwarder existe **exatamente uma vez**, em `@idem/core`, e todo o resto dá a ela algo sobre o que rodar. O gateway de produção, o simulador e o sandbox no navegador não implementam o protocolo cada um por si. Eles executam a mesma classe com enlaces diferentes e um relógio diferente (ADR-001).

## Topologia {#topology}

A menor implantação útil é uma estrela: agentes, um forwarder de borda, o produtor. Os experimentos sobre vários saltos usam uma árvore, com um forwarder regional entre as bordas e o produtor.

::figure[topology] A topologia em árvore. Um Interest sobe em direção ao produtor e o Data desce pelo mesmo caminho; qualquer forwarder no trajeto que tenha uma cópia fresca responde no lugar dele.

- Os **agentes** são consumidores. Eles falam MCP comum com a borda, ou IDEM sobre HTTP se usarem o cliente que verifica.
- A **borda** é o primeiro salto de cada consumidor. É o único nó que vê de quem é o pedido, e por isso o único que guarda Data `private`, particionado por contexto de autorização.
- Um forwarder **regional** agrega e guarda em cache entre bordas. Ele só armazena Data `public`.
- O **produtor** executa as ferramentas, nomeia ele mesmo os resultados e os assina.

Um servidor não precisa ser reescrito para ser um produtor. Um operador pode colocar um **proxy-producer** na frente de um servidor MCP que não fala IDEM. O proxy ocupa o lugar do produtor nesta figura, com o seu próprio nome e a sua própria chave, e chama aquele servidor por MCP comum. A [referência da API](/docs/api#mcp-proxy) mostra como, e a página de [Segurança](/docs/security#limits) diz o que isso muda na confiança.

Uma chamada a uma ferramenta não cacheável não pega outra estrada. Ela percorre os mesmos enlaces como uma chamada comum, sem entrada no PIT e sem entrada no cache, e cada forwarder que ela atravessa emite `bypass`.

## Pacotes {#packages}

::figure[packages] O que depende de quê. Uma seta vai de um pacote para aquele que ele usa.

| Pacote | Responsabilidade | Roda em |
|---|---|---|
| `@idem/core` | nomes, canonicalização, JCS, digests, Data e manifestos assinados, o armazenamento de confiança, o **motor do forwarder** (PIT, CS, FIB) e seus eventos, os relógios, um `Producer` independente de transporte e os auxiliares do consumidor | navegador, Node, Vercel, simulador |
| `@idem/gateway` | IDEM sobre HTTP: um handler de produtor, um forwarder HTTP (borda ou regional) e um cliente que verifica. Tudo é um `(Request) => Promise<Response>` no padrão Web | navegador (cliente), Node, Vercel |
| `@idem/mcp` | o binding MCP: um produtor e uma borda como endpoints MCP, a verificação de resultados recebidos por MCP, e um proxy-producer para servidores MCP que não falam IDEM | Node, Vercel |
| `@idem/sim` | um simulador determinístico de eventos discretos: topologias, enlaces com atraso, perda e banda, cargas de trabalho com semente, métricas, e o cache de gateway sem assinatura que a avaliação usa como baseline | Node (experimentos), navegador (sandbox) |
| `@idem/ndn` | o binding nativo sobre NDN (NDNts): mapeamento de nomes, o codec de Interest/Data, assinaturas Ed25519 do NDN, um produtor que embrulha o `Producer` e um consumidor que verifica. PIT e CS são os do forwarder NDN | Node, navegador |
| `apps/web` | este site: página inicial, sandbox, documentação, resultados, e o produtor e a borda de demonstração como rotas | Vercel |

A regra de dependência é estrita. O `core` não depende de nada além de Web APIs (WebCrypto, `TextEncoder`, `fetch`, `URL`) e não importa nenhum módulo `node:*`; é isso que o deixa rodar sem mudanças em uma aba do navegador. `sim`, `gateway` e `ndn` dependem só do `core` (o `ndn` também do NDNts); `mcp` depende de `core` e `gateway`. Nada depende de `apps/web`.

## Um único motor {#engine}

As regras da [seção 7 do protocolo](/docs/protocol#s7) vivem em uma classe, `Forwarder`. Ela é parametrizada por tudo o que muda de um ambiente para outro:

| Parâmetro | Gateway de produção | Simulador e sandbox |
|---|---|---|
| **faces** (`Face`: `send`, `onReceive`) | uma requisição HTTP por downstream, um cliente HTTP por upstream | enlaces virtuais com atraso, perda e banda |
| **clock** (`Clock`) | `RealClock`: tempo real e os timers da plataforma | `VirtualClock`: eventos discretos, determinístico para uma semente |
| **cs** (`ContentStore`) | `MemoryContentStore`, um LRU com orçamento em bytes; a interface admite outro armazenamento | a mesma classe |
| **trust** (`TrustStore`) | manifestos buscados no produtor | um manifesto construído na própria execução |
| **onEvent** | traces devolvidos a quem chamou, no cabeçalho `idem-trace` | o canvas e o log do sandbox; as métricas dos experimentos |

Cada forwarder também recebe uma tolerância de relógio, `clockToleranceMs`, para o tempo de vida assinado de [P-8.6]; ela é de 60 segundos, a menos que seja configurada.

Como o relógio é injetado, uma simulação não dorme: ela salta de evento em evento. Como o WebCrypto é assíncrono, o `VirtualClock` espera o callback de cada timer terminar antes de executar o próximo; assim, assinar e verificar nunca reordenam eventos, e uma execução com uma dada semente é reproduzível.

### O fluxo de eventos {#events}

Toda ação observável de um forwarder é um evento tipado. Nada mais é medido: o sandbox desenha esses eventos e os experimentos os contam.

| Evento | Emitido quando |
|---|---|
| `interest_in` | um Interest chega por uma face |
| `cs_hit` | um Data fresco no Content Store o responde (leva o `ageMs` do Data) |
| `pit_aggregate` | o nome já está pendente; a face entra na entrada (leva quantos esperam) |
| `upstream_out` | uma nova entrada do PIT é criada e o Interest é enviado ao próximo salto |
| `data_in` | um Data chega do upstream (leva o seu tamanho) |
| `verify_ok`, `verify_fail` | a assinatura e o digest do conteúdo foram conferidos (leva o tempo gasto) |
| `cs_insert`, `cs_evict` | um Data entra no Content Store, ou sai dele para abrir espaço |
| `pit_satisfy` | o Data é entregue a todas as faces em espera (leva quantas) |
| `pit_expire` | o tempo de vida de uma entrada do PIT acabou; quem esperava recebe `TIMEOUT` |
| `drop` | um Interest ou Data é descartado, com um motivo (`digest_mismatch`, `hop_limit`, `loop`, `unsolicited`, `expired`, ...) |
| `bypass` | uma chamada ou um Interest passa sem estado de PIT ou CS, com um motivo |

## Fluxos {#flows}

### Uma falta, com agregação {#flow-miss}

Três agentes pedem a mesma página quase ao mesmo tempo.

1. O agente 1 chama `fetch_page(url)`. A borda canonicaliza os argumentos e calcula o nome **N**. O CS não tem nada para N e o PIT não tem entrada: a borda cria uma, consulta o produtor no FIB e envia o Interest adiante (`upstream_out`).
2. O agente 2 chama `fetch_page` com uma URL equivalente. A canonicalização dá o mesmo nome N. O PIT já tem N: a borda acrescenta o agente 2 à entrada (`pit_aggregate`, 2 em espera). Nada é enviado.
3. O agente 3 faz o mesmo (`pit_aggregate`, 3 em espera).
4. O produtor executa a ferramenta uma vez, calcula N ele mesmo a partir dos argumentos, assina o resultado e devolve o Data.
5. A borda verifica a assinatura (`verify_ok`), guarda o Data (`cs_insert`), entrega-o às três faces em espera (`pit_satisfy`, 3 faces) e remove a entrada do PIT.

### Um acerto {#flow-hit}

Um quarto agente pede a mesma página enquanto o Data ainda está fresco. A borda calcula N, encontra um Data fresco no CS e responde na hora (`cs_hit`), com `ageMs` atualizado. O produtor não é acionado. O agente verifica a assinatura mesmo assim: um acerto de cache não merece mais confiança que uma resposta nova.

### Uma ferramenta com efeito colateral {#flow-bypass}

`send_email` não está marcada como cacheável no manifesto. O consumidor não monta um Interest para ela; a chamada passa pela borda como chamada comum e a borda emite `bypass`. Duas chamadas `send_email` idênticas enviam dois e-mails, como deve ser.

## Bindings {#bindings}

Um **binding** é a forma como nomes, Interests e Data são transportados entre os nós. O protocolo define dois ([seção 9 do protocolo](/docs/protocol#s9)).

### Overlay HTTP {#http}

Implementado em `@idem/gateway` e `@idem/mcp`. Cada salto é uma troca HTTP, e a própria troca associa uma resposta ao seu pedido.

| Quem | Rota | Corpo → resposta |
|---|---|---|
| produtor | `GET /.well-known/idem.json` | o manifesto assinado |
| produtor | `GET /idem/v1/tools` | a lista de ferramentas, no formato de `tools/list` |
| produtor, forwarder | `POST /idem/v1/interest` | um Interest → um Data, ou `{ code, message }` |
| produtor, forwarder | `POST /idem/v1/call` | `{ producer, tool, args }` → um `CallToolResult` (passthrough) |
| forwarder | `GET /idem/v1/manifest/<producer>` | o manifesto em que este nó confia |
| forwarder | `GET /idem/v1/tools/<producer>` | a lista de ferramentas do produtor, repassada |

Três cabeçalhos importam. `Authorization: Bearer` leva a credencial do usuário final, salto a salto, até o produtor. `idem-forwarder` marca uma requisição enviada por um forwarder; sua ausência diz a um nó que o remetente é um consumidor e que este nó é a borda dele. `idem-trace`, nas respostas, lista os eventos que o pedido causou em cada salto: serve só para diagnóstico e nunca é tratado como confiável.

Sobre o próprio MCP, os mesmos objetos viajam em `_meta`. Um produtor servido por `createMcpProducer` devolve o `CallToolResult` normal e anexa a assinatura em `_meta["dev.idem/data"]`. Um cliente que não conhece o IDEM ignora `_meta`, então o binding é retrocompatível. E uma borda servida por `createMcpEdge` é um endpoint MCP comum: qualquer agente pode se conectar a ela, e cada `tools/call` entra no motor do forwarder como um pedido de consumidor.

### NDN nativo {#ndn}

Implementado em `@idem/ndn` (ADR-026). Ele já foi executado contra forwarders NFD reais, em Docker: uma verificação funcional sobre faces TCP, UDP e WebSocket, e o experimento de emulação E4 ([Avaliação](/docs/evaluation#e4)). Um nome IDEM vira um nome NDN, um GenericNameComponent por parte, e o ApplicationParameters do Interest leva os argumentos canônicos como bytes JCS. O NDN acrescenta o seu próprio ParametersSha256DigestComponent depois do `args-digest`, então duas chamadas equivalentes recebem o mesmo nome nativo exatamente quando recebem o mesmo nome IDEM. O Content do Data é o envelope JCS `{ content, meta, signature }`, e o pacote também é assinado com o Ed25519 do NDN pela chave do produtor, então o consumidor confere as duas assinaturas. O PIT e o Content Store do próprio NFD fazem a agregação e o cache; como eles indexam só pelo nome, sem contexto de autorização, ferramentas `private` nunca usam este binding e ficam no overlay.

## Onde cada peça roda {#deploy}

| Componente | Localmente | Em produção |
|---|---|---|
| Produtor de demonstração | uma rota do servidor de desenvolvimento | uma função: `/api/producer/*` (IDEM sobre HTTP e `/api/producer/mcp`) |
| Gateway de borda | uma rota do servidor de desenvolvimento | funções: `/api/edge/*` (IDEM sobre HTTP) e `/api/mcp` (MCP comum) |
| Simulador e motor | o navegador | o navegador: o sandbox não custa nada ao servidor |
| Experimentos | Node local, Docker | não são implantados |

> [!NOTE]
> Em produção, o Content Store da borda fica na memória de uma instância de função. As instâncias são reaproveitadas, então acertos acontecem, mas um pedido que cai em uma instância nova começa com o cache vazio. O modo ao vivo do sandbox diz isso na página. Um armazenamento compartilhado é possível pela interface `ContentStore` e não está no caminho crítico.

A API de cada pacote está na [Referência da API](/docs/api).
