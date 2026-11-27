Esta página lista o que cada pacote exporta, conferido com o código em `packages/*/src`. Os comentários TSDoc do código são a referência completa; aqui está o mapa. Os pacotes fazem parte de um protótipo de pesquisa e não estão publicados em um registro, por isso não há comando de instalação.

Duas convenções valem em todo lugar. Os pacotes de biblioteca **não têm default export**. Falhas são um **`IdemError`** tipado, com um `code`: decida pelo código, nunca pela mensagem.

## Um produtor, uma borda e um consumidor {#example}

O caminho mais curto pelos três papéis, com o binding HTTP. Cada handler é um `(Request) => Promise<Response>` no padrão Web, então pode ser montado em qualquer runtime que fale `fetch`.

```ts
import { generateKeyPair, Producer } from "@idem/core";
import { createGateway, createProducerHandler, IdemClient } from "@idem/gateway";

// 1. The producer declares its tools and, per tool, the policy that goes into the signed manifest.
const producer = new Producer({
  producer: "demo.idem.dev",
  key: await generateKeyPair(),
  tools: [
    {
      name: "fetch_page",
      inputSchema: {
        type: "object",
        properties: { url: { type: "string", minLength: 1 } },
        required: ["url"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      policy: {
        cacheable: true,
        ttlMs: 300_000,
        scope: "public",
        normalizers: { "/url": ["url:sortQuery"] },
      },
      handler: async (args) => ({
        content: [{ type: "text", text: `page at ${(args as { url: string }).url}` }],
      }),
    },
  ],
});
const serveProducer = createProducerHandler(producer);

// 2. The edge is an HTTP forwarder whose upstream is the producer.
const edge = createGateway({
  id: "edge",
  upstreams: [{ producer: "demo.idem.dev", url: "https://producer.example", kind: "producer" }],
  authSecret: process.env.IDEM_EDGE_SECRET,
});
const serveEdge = (req: Request) => edge.handle(req);

// 3. The consumer names the call locally, asks its edge, and verifies what comes back.
const client = new IdemClient({ edge: "https://edge.example", producer: "demo.idem.dev" });
const out = await client.call("fetch_page", { url: "https://EXAMPLE.com:443/p?b=2&a=1#x" });

out.via;     // "idem": the call travelled as a named Interest
out.name;    // "/idem/v1/demo.idem.dev/fetch_page/<schema-digest>/<args-digest>"
out.verify;  // { ok: true, producer: "demo.idem.dev", keyId: "…" }
out.trace;   // the events at each hop, from the idem-trace header
out.result;  // the CallToolResult the agent gets
```

Uma ferramenta sem `policy` continua sendo servida pelo produtor; ela só nunca é cacheável e sempre passa direto.

## `@idem/core` {#core}

O protocolo em si. Só Web APIs (WebCrypto, `TextEncoder`, `fetch`, `URL`): o mesmo código roda em um navegador, no Node, em uma Vercel Function e dentro do simulador.

### Nomes e canonicalização {#core-names}

| Export | O que faz |
|---|---|
| `canonicalizeArgs(args, tool, policy)` | Executa o pipeline da [seção 3 do protocolo](/docs/protocol#s3): validar, defaults, normalizadores declarados, JCS. Devolve `CanonicalArgs` (`{ value, jcs }`). Lança `INVALID_ARGS`, `UNSUPPORTED_SCHEMA` ou `BAD_POLICY` |
| `makeName({ producer, tool, args })` | O nome de uma chamada, a partir do produtor, do `ToolIdentity` e dos args canônicos [P-2.1] |
| `parseName(name)` | Divide um nome em `{ producer, tool, schemaDigest, argsDigest }`. Lança `BAD_NAME` para nomes malformados, não canônicos e reservados |
| `formatName(parsed)` | O inverso de `parseName`, validando cada componente |
| `toolSchemaDigest(tool)` | `b64u(SHA-256(JCS(tool-identity)))[0:22]`; a descrição nunca entra no hash [P-2.2] |
| `argsDigestOf(canonicalJcs)` | `b64u(SHA-256(...))` de uma string JCS canônica, 43 caracteres |
| `keyLocator(producer, keyId)`, `parseKeyLocator(locator)` | Montam e leem `/idem/v1/<producer>/_key/<keyId>` |
| `producerPrefix(producer)`, `assertProducer(producer)`, `encodeComponent(s)` | O prefixo roteável de um produtor; a checagem de sintaxe do produtor; o percent-encoding de um nome de ferramenta |
| `jcs(value)`, `toJson(value)` | Serialização RFC 8785; uma cópia profunda como JSON puro. As duas lançam `BAD_JSON` para valores que não são JSON |
| `applyNormalizer`, `applyNormalizers`, `isNormalizer`, `parsePointer`, `NORMALIZERS` | Os normalizadores da seção 3 e o tratamento de JSON Pointer |
| `validate(schema, value)`, `applyDefaults(schema, value)`, `assertSupportedSchema(schema)`, `SUPPORTED_SCHEMA_KEYWORDS` | O subconjunto fixo de JSON Schema do Apêndice A [P-3.6] |
| `NAME_PREFIX`, `SCHEMA_DIGEST_LENGTH`, `ARGS_DIGEST_LENGTH` | `"/idem/v1/"`, 22, 43 |

Tipos: `IdemName`, `ParsedName`, `CanonicalArgs`, `Normalizer`, `JsonSchema`, `JsonValue`, `JsonObject`, `ToolIdentity`, `ToolPolicy`, e os objetos do protocolo `Interest`, `Data`, `DataMeta`, `DataSignature`, `Manifest`, `UnsignedManifest`, `ManifestKey`, `Scope`, `CallToolResult`.

### Assinaturas e manifestos {#core-crypto}

| Export | O que faz |
|---|---|
| `generateKeyPair()` | Um `IdemKeyPair` Ed25519 novo (`keyId`, `privateKey`, `publicKey`, `publicKeyJwk`) |
| `importKeyPair(jwk)`, `exportPrivateKeyJwk(key)`, `importPublicKey(jwk)` | Levam chaves para dentro e para fora como JWK |
| `keyPairFromSeed(seed)` | Um par de chaves determinístico a partir de 32 bytes. Só para testes e para o simulador, nunca para uma chave real |
| `keyIdFromJwk(jwk)` | O key id: um thumbprint RFC 7638 truncado, 16 caracteres |
| `signData(input, key)` | Assina um `UnsignedData` como `Data`. Lança `BAD_POLICY` se um resultado de erro tiver frescor diferente de zero [P-5.3] |
| `verifyData(data, trust, opts?)` | Verificação de ponta a ponta [P-5.5]: o locator e o nome concordam, a chave é confiável e não expirou, o digest do conteúdo bate, a assinatura é válida. Devolve um `VerifyResult`, nunca lança |
| `signManifest(m, key)`, `verifyManifest(m, trust, opts?)`, `verifyManifestSignature(m)` | Assinam um manifesto; conferem-no contra um armazenamento de confiança; conferem só a sua consistência interna |
| `contentDigest(content)`, `dataSignedBytes(name, meta)`, `manifestSignedBytes(m)`, `stripEphemeral(result)` | Os bytes exatos que entram no hash e na assinatura [P-5.2] |
| `deriveAuthContext(edgeSecret, credential)` | `b64u(HMAC-SHA256(secret, credential))[0:22]` [P-8.4]. É a borda que o calcula; um forwarder nunca aceita o `authContext` de um Interest recebido |
| `assertManifestShape(m)` | Lança `BAD_MANIFEST` se `m` não tiver o formato da seção 6 |

`VerifyResult` é `{ ok: true, producer, keyId }` ou `{ ok: false, code, reason }`, com `code` igual a `BAD_SIGNATURE`, `UNTRUSTED_KEY` ou `BAD_MANIFEST`. O `verifyData` não compara o `producedAt` com um relógio: uma assinatura válida e um Data dentro do seu tempo de vida são dois vereditos separados.

### Tempo de vida assinado {#core-lifetime}

O predicado de [P-8.6]. Os forwarders e todos os consumidores usam esta mesma definição. O juiz do experimento de segurança não a usa: ele trabalha com a verdade do seu mundo, para não poder concordar com a defesa que julga.

| Export | O que faz |
|---|---|
| `lifetimeState(meta, ttlMs, now, toleranceMs?)` | Onde um Data está em um nó cujo relógio marca `now`: `"within"`, `"expired"` (a sua idade aparente chegou a `min(freshnessMs, ttlMs)` mais a tolerância) ou `"future"` (datado à frente além da tolerância). Falha fechado: um valor que não é número dá `"expired"`. Passe `ttlMs = Infinity` quando nenhum TTL de manifesto é conhecido |
| `isOutsideLifetime(meta, ttlMs, now, toleranceMs?)` | `true` quando o estado não é `"within"` |
| `apparentAge(meta, now)`, `lifetimeOf(meta, ttlMs, toleranceMs?)` | `now − producedAt`, sem corte em 0; e a idade aparente em que um Data expira |
| `lifetimeReason(meta, ttlMs, now, toleranceMs?)` | A mensagem de uma linha de um erro `EXPIRED` ou `CLOCK_SKEW`: qual lado da janela foi perdido, o `producedAt` e a hora local |
| `clockTolerance(ms)` | Valida a opção `clockToleranceMs` de um nó. Lança `BAD_POLICY` para um valor negativo ou que não é número |
| `DEFAULT_CLOCK_TOLERANCE_MS` | `60_000`, o padrão de toda opção `clockToleranceMs` |
| `staleByAge(data, ttlMs)` | `true` quando um Data traz um `ageMs` de pelo menos `min(freshnessMs, ttlMs)` [P-8.1]. Um Data sem `ageMs` vem do seu produtor e não chega velho |
| `acceptData(data, { trust, now, name?, mustBeFresh, ttlMs?, toleranceMs? })` | A decisão do consumidor, a mesma que todo consumidor distribuído toma (`IdemClient`, `IdemConsumer`, `NdnConsumer`, os agentes do simulador, o experimento de segurança): o Data traz o nome pedido, é verificado [P-5.5] e, quando o pedido era de Data fresco, está dentro do seu tempo de vida assinado e não está velho pela sua idade [P-8.7]. Devolve `{ ok: true, verify }` ou `{ ok: false, code, reason, verify }`, com `code` igual a `BAD_SIGNATURE` (nome errado incluído), `UNTRUSTED_KEY`, `BAD_MANIFEST` ou `EXPIRED`; para `EXPIRED`, `verify.ok` é `true` |

A tolerância é local a cada nó, e cada um a recebe como uma opção chamada `clockToleranceMs`: `Forwarder`, `createGateway`, `IdemClient`, `createMcpEdge`, `IdemConsumer` e `NdnConsumer`.

### `TrustStore` {#core-trust}

O estado de confiança de um nó: os manifestos aceitos e as chaves que eles autorizam. Confiança no primeiro uso com fixação opcional [P-6.2], sem rollback [P-6.3].

| Membro | O que faz |
|---|---|
| `pin(producer, publicKeyJwk)` | Fixa uma chave por configuração; devolve o seu key id |
| `addManifest(m, opts?)` | Verifica um manifesto e, se for confiável, aceita-o no lugar do anterior |
| `check(m, opts?)` | A mesma decisão, sem mudar o estado |
| `manifest(producer)`, `policy(producer, tool)` | O manifesto aceito; a `ToolPolicy` que ele declara para uma ferramenta |
| `key(producer, keyId, now?)` | Uma chave de verificação confiável neste momento, ou `undefined` |
| `producers()` | Os produtores com manifesto aceito |

### O motor do forwarder {#core-engine}

```ts
const forwarder = new Forwarder({
  id: "edge",          // node id used in events
  clock,               // RealClock or VirtualClock
  fib,                 // a Fib
  trust,               // a TrustStore
  cs,                  // optional; default: a 64 MiB LRU MemoryContentStore
  pit,                 // optional; default: { maxEntries: 10_000, maxFacesPerEntry: 256 }
  verifyOnInsert,      // optional; default true. false only in experiments [P-7.1]
  authSecret,          // optional; the edge secret that derives authContext [P-8.4]
  clockToleranceMs,    // optional; signed-lifetime tolerance [P-8.6]. Default DEFAULT_CLOCK_TOLERANCE_MS
  onEvent,             // optional; receives every ForwarderEvent
});
forwarder.addFace(face, { consumer: true });   // a face that leads to consumers: this node is their edge
```

| Export | O que é |
|---|---|
| `Forwarder` | O motor da [seção 7 do protocolo](/docs/protocol#s7). `addFace(face, opts?)`, `removeFace(id)`, `receive(faceId, packet)`, `pit()` (os nomes pendentes e quantos esperam), `cs` |
| `Face` | A abstração de enlace: `id`, `send(packet)`, `onReceive(cb)`, `close()` |
| `Packet` | O que viaja em uma face: `interest`, `data`, `nack`, e `call` / `result` para o passthrough |
| `linkFaces(clock, { a, b, latencyMs? })` | Um par de faces conectadas, com atraso, para testes e simulações simples |
| `Fib` | Roteamento por prefixo mais longo: `add(prefix, nextHop)`, `addProducer(producer, nextHop)`, `remove`, `lookup(name)`, `lookupProducer(producer)`, `entries()` |
| `ContentStore`, `MemoryContentStore` | A interface de armazenamento (`get`, `put`, `delete`, `stats`) e a implementação em memória, com orçamento em bytes e substituição `lru`, `lfu` ou `fifo` [P-7.4] |
| `isFresh(entry, now, ttlCapMs?)`, `entryAge(entry, now)`, `dataBytes(data)` | Frescor [P-8.1, P-8.2], idade e o tamanho contado no orçamento |
| `Clock`, `RealClock`, `VirtualClock` | A fonte de tempo. `VirtualClock` acrescenta `step()`, `runUntil(t)`, `runAll()`, `nextAt()`, `pending` |
| `ForwarderEvent`, `ForwarderEventKind` | O fluxo de eventos tipados descrito em [Arquitetura](/docs/architecture#events) |

Tipos de opções e de registros: `ForwarderOptions`, `FaceOptions`, `PitLimits`, `CsEntry`, `CsStats`, `ReplacementPolicy`.

### `Producer` e os auxiliares do consumidor {#core-producer}

| Export | O que faz |
|---|---|
| `new Producer({ producer, key, tools, clock?, manifestVersion?, extraKeys? })` | Um produtor independente de transporte (ADR-014). Rejeita uma ferramenta cacheável sem `readOnlyHint: true` ou com schema não suportado |
| `producer.manifest()` | O manifesto assinado, calculado uma vez |
| `producer.toolList()` | As ferramentas como o `tools/list` do MCP as informaria (`ToolInfo[]`) |
| `producer.identity(tool)` | A identidade de nomeação de uma ferramenta |
| `producer.handleInterest(interest, ctx?)` | Responde a um Interest com um `Data` assinado. Recalcula o nome por conta própria e lança `DIGEST_MISMATCH` se ele diferir [P-5.1]; lança `NOT_CACHEABLE` para ferramentas fora da política e para resultados de várias idas e voltas [P-5.4] |
| `producer.handleCall(tool, args, ctx?)` | Um `tools/call` comum. Para ferramentas cacheáveis, o resultado também leva a assinatura em `_meta["dev.idem/data"]` |
| `producer.serve(face, opts?)` | Atende Interests e chamadas que chegam por uma face; `serviceTimeMs` modela a latência da ferramenta nas simulações |
| `cacheablePolicy(manifest, tool)` | Decide se uma chamada pode usar IDEM [P-6.1]; devolve `{ policy, identity }` ou `undefined` |
| `buildInterest(input)` | Monta um Interest localmente, a partir da política e dos argumentos [P-4.1]; devolve `{ interest, args }` |
| `attachData(result, data)`, `dataFromToolResult(result)` | Colocam um envelope assinado no `_meta` de um resultado de ferramenta, e reconstroem o `Data` a partir de um |
| `wireCode(error)` | Mapeia qualquer erro para um código que pode atravessar um salto |
| `META_KEYS`, `INTEREST_DEFAULTS` | As chaves `dev.idem/*`; `{ mustBeFresh: true, lifetimeMs: 10_000, hopLimit: 8 }` |

Um `ProducerTool` é `{ name, description?, inputSchema, outputSchema?, annotations?, policyVersion?, policy?, handler(args, ctx) }`, e o `ctx` do handler (`ProducerContext`) é `{ auth?, now }`. Os outros tipos de opções são `ProducerOptions`, `ProducerToolPolicy` e `BuildInterestInput`.

### Erros e codificação {#core-errors}

`IdemError` carrega um `code` do tipo `IdemErrorCode`, a união dos códigos de fio (`IdemWireErrorCode`: `DIGEST_MISMATCH`, `BAD_SIGNATURE`, `EXPIRED`, `UNTRUSTED_KEY`, `NOT_CACHEABLE`, `TIMEOUT`, `HOP_LIMIT`, `LOOP`, `UPSTREAM_ERROR`) com os locais (`IdemLocalErrorCode`: `BAD_NAME`, `BAD_JSON`, `BAD_ENCODING`, `INVALID_ARGS`, `UNSUPPORTED_SCHEMA`, `BAD_POLICY`, `BAD_MANIFEST`, `CRYPTO_UNSUPPORTED`, `CLOCK_SKEW`). `isIdemError(e, code?)` refina um erro desconhecido. Dois dos códigos pertencem ao tempo de vida assinado: um forwarder responde `EXPIRED` para um Data fora do seu tempo de vida quando o Interest pediu Data fresco [P-8.6], e um consumidor levanta `CLOCK_SKEW` quando a sua nova tentativa verificada continua fora dele [P-8.7].

Auxiliares de codificação: `b64uEncode`, `b64uDecode`, `isB64u`, `sha256`, `sha256b64u`, `utf8`, `utf8Length`, `randomNonce`.

## `@idem/gateway` {#gateway}

IDEM sobre HTTP: as rotas da [seção 9.1 do protocolo](/docs/protocol#s9-1).

### `createGateway(options)` {#gateway-create}

Um forwarder HTTP, de borda ou regional, que executa o motor do core no relógio real. Devolve `{ handle(req), forwarder, trust }`.

| Opção | Significado |
|---|---|
| `id` | O id do nó, usado em eventos e traces |
| `upstreams` | `{ producer, url, kind: "producer" \| "forwarder", manifestUrl? }[]`: o próximo salto para cada produtor |
| `cs`, `trust`, `pit` | Um Content Store, um armazenamento de confiança e limites de PIT próprios |
| `authSecret` | O segredo da borda; `authContext` é um HMAC dele com a credencial bearer [P-8.4] |
| `verifyOnInsert` | Só como flag de experimento [P-7.1] |
| `clockToleranceMs` | A tolerância da verificação de tempo de vida assinado deste forwarder [P-8.6] |
| `basePath` | O prefixo de caminho em que o handler está montado, como `/api/edge` |
| `fetch`, `onEvent` | Um `fetch` injetado; um ouvinte para todos os eventos do forwarder |

Uma requisição sem o cabeçalho `idem-forwarder` vem de um consumidor, então este nó age como a borda dele. Toda resposta leva o cabeçalho `idem-trace`.

### `createProducerHandler(producer, options?)` {#gateway-producer}

Serve um `Producer` do core pelo mesmo binding: o manifesto, a lista de ferramentas, `POST /idem/v1/interest` e `POST /idem/v1/call`. Opções: `basePath`, e `id` para os traces.

### `IdemClient` {#gateway-client}

O consumidor que verifica. Roda em qualquer lugar que tenha `fetch` e WebCrypto.

| Membro | O que faz |
|---|---|
| `new IdemClient({ edge, producer, producerUrl?, credential?, trust?, fetch?, clock?, clockToleranceMs?, intercept? })` | `edge` é o primeiro salto. `producerUrl` é para onde vai a nova tentativa sem cache, para um consumidor que alcança o produtor; por padrão, ela é uma chamada passthrough pela borda. `clock` e `clockToleranceMs` definem a fonte de tempo e a tolerância da verificação de tempo de vida [P-8.7]. `intercept` é um gancho de teste que reescreve um Data antes da verificação |
| `init()` | Busca e verifica o manifesto e a lista de ferramentas |
| `prepare(tool, args)` | O Interest que uma chamada enviaria, ou `undefined` se a chamada não for IDEM |
| `call(tool, args)` | Chama uma ferramenta e devolve um `CallOutcome` |
| `sendInterest(interest)` | Envia um Interest já montado e verifica a resposta. Um Data que passa na verificação mas está fora do seu tempo de vida volta com `verify.ok` verdadeiro e `error` `EXPIRED` |

Um `CallOutcome` tem `tool`, `result`, `via` (`"idem"` ou `"call"`), `name`, `data`, `verify`, `retried`, `trace`, `latencyMs` e `error`. `retried` é verdadeiro quando a primeira resposta falhou na verificação (`BAD_SIGNATURE`) ou estava fora do seu tempo de vida assinado (`EXPIRED`, vindo de um forwarder ou pelo relógio do próprio cliente), e a chamada foi repetida como chamada comum, que nenhum cache responde [P-5.5, P-8.7]. A resposta repetida passa pelas mesmas verificações. Se vier sem assinatura, assinada para outro nome ou inválida, `error` é `BAD_SIGNATURE`. Se passar na verificação mas continuar fora do tempo de vida, `error` é `CLOCK_SKEW`, e `verify.ok` continua verdadeiro, porque a assinatura é válida. Nos dois casos `result` é um resultado de erro, nunca o conteúdo sem verificação ou expirado. Leia `error` antes de `verify.ok`. `error` é um `CallError`: um código de fio ou `CLOCK_SKEW`, com uma mensagem.

Também exportados: as faces `HttpUpstreamFace` e `RequestFace`; `credentialOf(req)`; e os auxiliares de fio `PATHS`, `HEADERS`, `statusFor(code)`, `errorResponse`, `json`, `isWireError`, `parseTrace`, `formatTrace`, `routePath`, com os tipos `WireError`, `TraceHop`, `CallError`, `CallOutcome`, `Gateway`, `GatewayOptions`, `Upstream`, `IdemClientOptions`, `ProducerHandlerOptions`.

## `@idem/mcp` {#mcp}

O binding MCP, sobre o SDK TypeScript v2 do MCP.

| Export | O que faz |
|---|---|
| `createMcpProducer(producer, info)` | Serve um `Producer` como servidor MCP sem estado. `tools/call` executa `handleCall`, então os resultados de ferramentas cacheáveis levam `_meta["dev.idem/data"]`. A credencial é `Authorization: Bearer` |
| `createMcpEdge({ gateway, producer, info, maxClients?, clockToleranceMs? })` | Um endpoint MCP comum na frente de uma borda IDEM. Ele termina o MCP: lista as ferramentas do produtor (só as ferramentas), e cada `tools/call` passa pelo motor do forwarder no mesmo processo, com a borda nomeando a chamada e verificando a resposta em nome do cliente [P-5.5]. Uma resposta que falha na verificação ou na checagem do tempo de vida mesmo depois da nova tentativa chega ao cliente MCP como um resultado de erro, nunca como conteúdo [P-8.7]. É assíncrono, porque antes aprende a lista de ferramentas e verifica o manifesto |
| `new IdemConsumer({ trust?, clock?, clockToleranceMs? })` | Verifica resultados recebidos por MCP. `pin(producer, keys)` fixa chaves do produtor; `verifyToolResult(result)` devolve um `VerifyResult`, ou `{ ok: false, code: "UNSIGNED" }` para um resultado sem metadados IDEM, ou `{ ok: false, code: "EXPIRED" }` para um cuja assinatura é válida mas que está fora do seu tempo de vida assinado neste relógio [P-8.7]. Ele não tem um caminho próprio sem cache; então quem chamou repete a chamada |
| `createProxyProducer(options)` | Um produtor IDEM, com nome e chave próprios, na frente de um servidor MCP que não fala IDEM. Veja [abaixo](#mcp-proxy) |

Tipos de opções: `McpServerInfo` (`{ name, version }`) e `McpEdgeOptions`. O pacote reexporta o tipo `JsonSchema` do `@idem/core`.

> [!NOTE]
> Um wrapper `withIdem(server)`, que acrescentaria o IDEM a um `McpServer` existente, com ferramentas registradas em outro lugar, está planejado e não foi implementado. Hoje um produtor declara suas ferramentas pelo `Producer` e é servido por `createMcpProducer`.

### `createProxyProducer(options)` {#mcp-proxy}

O proxy-producer da [seção 9.1 do protocolo](/docs/protocol#s9-1) (ADR-038): um produtor IDEM para um servidor MCP que não sabe nada de IDEM, a origem. O proxy chama a origem por MCP comum, nomeia os resultados e os assina com a sua própria chave. A confiança passa para o proxy; a página de [Segurança](/docs/security#limits) diz o que um consumidor fica e não fica sabendo pela assinatura dele.

```ts
import { importKeyPair } from "@idem/core";
import { createProducerHandler } from "@idem/gateway";
import { createMcpProducer, createProxyProducer } from "@idem/mcp";

const proxy = await createProxyProducer({
  upstream: { url: "https://mcp.example.com/mcp", credential: process.env.ORIGIN_TOKEN },
  name: "proxy.example.com",                        // the proxy's own name, never the origin's
  key: await importKeyPair(JSON.parse(process.env.PROXY_KEY_JWK!)),
  tools: {                                          // any tool not listed is relayed, unsigned, never cached
    search_docs: { cacheable: true, ttlMs: 300_000, scope: "public", normalizers: { "/q": ["trim", "lowercase"] } },
    my_tickets: { cacheable: true, ttlMs: 30_000, scope: "private" },  // forwards the user's Bearer
    get_status: { cacheable: true, ttlMs: 10_000, scope: "public", operatorAssertsReadOnly: true },
  },
  onSchemaChange: () => void proxy.refresh(),       // or refresh from a deploy hook
});
export const idem = createProducerHandler(proxy);   // edges: { producer: "proxy.example.com", kind: "producer" }
export const mcp = createMcpProducer(proxy, { name: "idem-proxy", version: "1.0.0" });
```

O `createProxyProducer` lê o `tools/list` da origem e devolve um `ProxyProducer`, uma subclasse do `Producer` do core; por isso ele é servido por `createProducerHandler` ou `createMcpProducer` como qualquer outro produtor. Ele lança `BAD_POLICY` quando o nome é o host da origem, ou quando uma ferramenta declarada cacheável não pode ser: ausente na origem, marcada com `readOnlyHint: false`, sem `readOnlyHint` e sem `operatorAssertsReadOnly`, ou com um schema fora do subconjunto suportado.

| Opção | Significado |
|---|---|
| `upstream` | Um `ProxyUpstream`, `{ url, fetch?, credential?, info? }`: o endpoint Streamable HTTP da origem. `credential` é o Bearer do próprio proxy na origem, usado para o `tools/list` e para as ferramentas declaradas `public`, que nunca veem a credencial de um usuário final, nem quando retidas ou recusadas [P-9.7] |
| `name`, `key` | O nome de produtor e a chave de assinatura do próprio proxy, nunca os da origem [P-9.5] |
| `tools` | A política do operador por ferramenta da origem, um `ProxyToolPolicy`: um `ProducerToolPolicy` mais `policyVersion?` e `operatorAssertsReadOnly?`. Este último é para uma ferramenta à qual a origem não dá `readOnlyHint`; ele não pode contrariar um `readOnlyHint: false` [P-9.6] |
| `onSchemaChange` | Chamado com um `SchemaChange`, `{ tool, manifestVersion }`, quando o proxy vê mudar a entrada da origem para uma ferramenta. A ferramenta fica não cacheável a partir daí, até o `refresh()` [P-9.8] |
| `clock`, `manifestVersion`, `maxClients` | A fonte de tempo; a primeira versão do manifesto, por padrão o relógio em segundos, para que um reinício nunca volte atrás [P-6.3]; o limite de clientes da origem, um por credencial, com padrão 512 |

Um `ProxyProducer` acrescenta `origin`, `manifestVersion` e `refresh()`, que relê a lista de ferramentas da origem e devolve um `ProxyRefresh`, `{ changed, manifestVersion, refused }`; `ProxyProducer.create(options)` é o mesmo que a função. Cada ferramenta que ele lista leva `_meta["dev.idem/origin"]` (a chave é `ORIGIN_META_KEY`), um `OriginRecord` da forma `{ origin, readOnlyHint: "origin" | "operator" | "absent" }`. Como a lista de ferramentas, o registro não é assinado e é só informativo. O tipo de opções é `ProxyProducerOptions`.

Há uma lacuna conhecida. Os forwarders e o `IdemClient` leem um manifesto uma vez só. Depois que a origem muda uma ferramenta e o proxy faz o refresh, uma borda que não foi reiniciada responde `NOT_CACHEABLE` ou `DIGEST_MISMATCH` para aquela ferramenta.

## `@idem/sim` {#sim}

Um simulador determinístico de eventos discretos. Ele executa o `Forwarder` real sobre enlaces virtuais, com uma carga de trabalho derivada de uma semente.

```ts
import { buildTopology, defaultConfig, runSimulation } from "@idem/sim";

const config = defaultConfig({
  topology: buildTopology({ kind: "star", agents: 8, agentLinkMs: 5, producerLinkMs: 40 }),
  mode: "idem",
});
const { metrics } = await runSimulation(config, { seed: 42 });
```

| Export | O que faz |
|---|---|
| `runSimulation(config, { seed, onEvent?, keepEvents? })` | Executa até o fim e devolve um `SimResult` (`metrics`, `events?`, `config`, `seed`) |
| `Simulation` | Uma execução que pode ser avançada em passos: `Simulation.create(config, { seed, ...hooks })`, `runUntil(t)`, `run()`, `result()`, e os ataques `attackTamper()`, `attackForge()`, `attackPrivateProbe()` |
| `SimConfig` | `topology`, `mode`, `workload`, `producer`, `cs`, e ajustes opcionais como `interestLifetimeMs` |
| `SimMode` | `"mcp-direct"`, `"mcp-local-cache"`, `"mcp-gateway-cache"`, `"idem"`, `"idem-noverify"` |
| `buildTopology(preset)` | `star` (agentes → borda → produtor) ou `tree` (agentes → bordas → regional → produtor) |
| `defaultConfig(overrides?)` | Uma configuração inicial razoável |
| `SyntheticWorkload`, `PerAgentWorkload`, `TraceWorkload`, `TraceRecord` | As cargas de trabalho da [Avaliação](/docs/evaluation#workloads). Uma carga sintética aceita `burst: { size, parallel? }` e `startSpreadMs` para chamadas emitidas por código; sem eles, é uma chamada por passo, como antes. Uma carga por agente dá a cada agente o seu próprio `AgentPlan` |
| `Metrics`, `MetricsCollector` | As métricas de uma execução, calculadas a partir do fluxo de eventos do forwarder. `gatewayCacheHits` e `gatewayInflightDuplicates` são contados no modo de cache de gateway e valem 0 nos outros |
| `GatewayCache`, `GatewayRelay`, `gatewayCacheKey(producer, tool, args)`, `stableJson(value)` | O cache de gateway sem assinatura do modo B5 (ADR-036): o cache, com orçamento em bytes e as políticas de substituição do Content Store; o relay que envolve uma face de cliente de um forwarder que repassa chamadas comuns; e a chave, que é o produtor, a ferramenta e os argumentos como foram enviados, serializados com as chaves ordenadas. É um baseline da avaliação e só existe no simulador. `Simulation.gatewayCaches` guarda o cache de cada borda nesse modo |
| `validateConfig(config)`, `SimConfigError` | Confere uma configuração e devolve os seus produtores com os padrões preenchidos; lança um `SimConfigError` cujo `path` aponta para o campo com problema |
| `routesTo`, `pathToProducer`, `reachableProducers` | Rotas de menor latência até um produtor em qualquer grafo (ADR-027) |
| `TOOL_CATALOG`, `TOOL_IDS`, `toolInfo`, `isToolId`, `simTool` | As ferramentas simuladas, que espelham as do produtor de demonstração, e a definição delas do lado do produtor |
| `Rng`, `Zipf`, `percentile` | O gerador com semente de onde sai toda decisão aleatória |
| `planWorkload`, `SIM_PRODUCER`, `SimHooks`, `CallRecord`, `Transmission`, `AttackRecord` | A expansão da carga, o nome do produtor usado nas simulações e os registros que uma execução relata. Um `CallRecord` pode trazer `error`, um `SimCallError`: `"NO_ROUTE"`, ou `"CLOCK_SKEW"` para uma chamada cuja nova tentativa verificada continuou fora do seu tempo de vida assinado |

Tipos de configuração: `SimNode`, `SimLinkConfig`, `TopologyPreset`, `SimProducerConfig`, `SimToolConfig`, `ToolId`, `ToolMixEntry`, `AgentPlan`, `Dist`. Outros tipos: `PlannedCall`, `ResolvedProducer`, `RouteHop`, `RoutePath`, `GatewayCacheEntry`, `GatewayRelayOptions`, `ToolCatalogEntry`, `SimToolContext`, `SimErrorCode`. Constantes: `AGENT_PLAN_DEFAULTS`, `DEFAULT_MAX_RESULT_BYTES`, `CORPUS_ORIGIN`, `SEARCH_QUERIES`, `CITIES`.

O pacote também exporta o modelo de custo de processamento (`ProcessingCosts`, `ProcessingOp`, `costUs`, `assertProcessingCosts`) e, só como tipos, os formatos que a página de resultados lê: `ResultsData`, `SweepData`, `MicrobenchData`, `MicrobenchCell`, `MissOverhead`, `SafetyData`, `SafetyRowData`, `EmulationData`, `EmulationModeId`, `NfdData`, `NfdRunData`, `NfdScenario`, `RunRef`, `Stat`, `AttackClass`, `Expectation`, `EvalModeId`, `SweepBase`. Eles pertencem à avaliação e mudam com ela; leia-os em `packages/sim/src`.

## `@idem/ndn` {#ndn}

O binding nativo sobre NDN, construído com o NDNts (protocolo §9.2, ADR-026). Ele reusa o `@idem/core` para nomear, assinar e verificar; PIT, CS e agregação são do forwarder NDN (NFD).

```ts
import { Forwarder } from "@ndn/fw";
import { NdnConsumer, serveNdn } from "@idem/ndn";

const fw = Forwarder.create();                       // ou uma face para o NFD
await serveNdn({ producer, key, fw });               // o mesmo Producer de antes
const consumer = new NdnConsumer({ producer: "demo.idem.dev", fw });
const out = await consumer.call("fetch_page", { url: "https://corpus.idem.dev/doc/3" });
```

| Export | O que faz |
|---|---|
| `toNdnName`, `fromNdnName`, `ndnUri`, `hasParamsDigest` | Nome IDEM ⇄ nome NDN (um GenericNameComponent por parte; o digest de parâmetros que o NDN acrescenta no fim é removido na volta), e uma URI legível |
| `encodeInterest`, `decodeInterest` | Interest IDEM ⇄ Interest NDN: ApplicationParameters = JCS dos argumentos canônicos, sem assinatura, sem `authContext`; a decodificação confere os bytes contra o `args-digest` |
| `encodeData`, `decodeData`, `encodeNack` | Data IDEM ⇄ Data NDN (Content = `{ content, meta, signature }` em JCS, FreshnessPeriod = `freshnessMs`); recusa Data `private`; erros viram Nacks de aplicação |
| `toWire`, `interestFromWire`, `dataFromWire`, `MAX_PACKET_SIZE` | Codificação TLV; resultados acima do limite de pacote do NDN não são segmentados |
| `producerSigner`, `ndnSigner`, `ndnVerifier` | Assinadores e verificadores Ed25519 do NDN, do keychain do NDNts, com as mesmas chaves WebCrypto do `@idem/core` |
| `verifyNdnData(data, trust, opts?)` | As duas verificações: a assinatura NDN e a assinatura IDEM com o digest do conteúdo. Nunca lança exceção |
| `serveNdn(options)` | Serve um `Producer` sob `/idem/v1/<producer>`, com `_manifest` e `_tools`; ferramentas privadas recebem um Nack `NOT_CACHEABLE` e nunca rodam |
| `NdnConsumer` | `init()` busca o manifesto e a lista de ferramentas pelo NDN, `prepare()` nomeia uma chamada, `call()` a envia e verifica a resposta. As suas opções incluem `retransmissions`, `clock` e `clockToleranceMs`. Um Data verificado que está fora do seu tempo de vida assinado faz a chamada falhar fechada com `EXPIRED`: um consumidor só nativo não tem chamada comum para tentar de novo [P-8.7] |
| `tlvTree`, `toHex`, `TLV_TYPES` | A árvore TLV decodificada de um pacote, para exibição (a visão nativa do sandbox usa) |

Também exportados: `ndnNonce`, `idemNonce`, `CONTENT_TYPE`, `RESERVED` e os tipos de opções e de resultados `NdnConsumerOptions`, `NdnCallOutcome`, `NdnProducer`, `NdnProducerOptions`, `NdnSigner`, `NdnVerifyOptions`, `NdnVerifyResult`, `OuterVerifyResult`, `DecodedData`, `NativeEnvelope` e `TlvNode`.
