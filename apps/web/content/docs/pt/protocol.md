<!-- translated-from: spec/01-protocol.md sha256:226481ec1ac518077ec66c30264d1d7eb9498d06d12b1180710f91f33cc7f121 -->
# 01 — Protocolo IDEM v1 (normativo)

MUST/SHOULD/MAY conforme RFC 2119/8174. Cada regra tem um id `[P-x.y]` que os testes citam.

## 1. Terminologia

| Termo | Definição |
|---|---|
| **Consumer** (consumidor) | Quem pede dados: um agente, ou o cliente MCP que ele usa |
| **Producer** (produtor) | Servidor MCP que conhece o IDEM: executa a ferramenta, nomeia e **assina** o resultado |
| **Forwarder** | Nó intermediário (gateway). Mantém um **PIT**, um **CS** e um **FIB**. Nunca executa ferramentas |
| **Interest** | Pedido por um nome, levando os argumentos canonicalizados |
| **Data** | Resposta nomeada, assinada pelo produtor |
| **Manifest** (manifesto) | Documento assinado do produtor: chaves públicas e política de cache por ferramenta |
| **PIT** | Pending Interest Table: nomes pedidos e ainda não respondidos, com a lista de quem espera |
| **CS** | Content Store: cache de Data indexado pelo nome |
| **FIB** | Forwarding Information Base: prefixo do produtor → próximo salto |
| **authContext** | Identificador opaco do contexto de autorização do consumidor (por exemplo, um hash do seu token) |

Modelo de comunicação: **pull, dirigido pelo receptor**. Um Interest gera no máximo um Data por salto
(*flow balance*), e o Data volta pelo caminho inverso ao do Interest.

## 2. Nomes

### 2.1 Gramática

```
name          = "/idem/v1/" producer "/" tool "/" schema-digest "/" args-digest
producer      = component        ; overlay: producer host (e.g. "demo.idem.dev")
                                  ; native: routable NDN prefix, encoded as components
tool          = component        ; MCP tool name, percent-encoded (RFC 3986, unreserved)
schema-digest = b64u(SHA-256(JCS(tool-identity)))[0:22]
args-digest   = b64u(SHA-256(JCS(canonical-args)))         ; 43 characters
tool-identity = { "name", "inputSchema", "outputSchema"?, "policyVersion" }
b64u          = base64url without padding (RFC 4648 §5)
JCS           = JSON Canonicalization Scheme (RFC 8785)
```

Exemplo: `/idem/v1/demo.idem.dev/fetch_page/3q2-7wEAAQ0abcDEF12xy/Xk9...(43 chars)`

### 2.2 Regras

- **[P-2.1]** O nome MUST ser função **somente** de (producer, tool-identity, canonical-args). Dois
  pedidos com os mesmos três valores MUST produzir o mesmo nome em todos os nós.
- **[P-2.2]** O `schema-digest` muda quando o schema ou o `policyVersion` mudam. A `description` da
  ferramenta MUST NOT fazer parte de `tool-identity` (o texto pode mudar sem mudar a semântica; se a
  semântica mudar, o produtor incrementa `policyVersion`).
- **[P-2.3]** O nome MUST NOT conter argumentos em claro, apenas o digest deles.
- **[P-2.4]** Nomes que começam com `/idem/v1/<producer>/_` são reservados (manifesto, chaves).

## 3. Canonicalização dos argumentos

Pipeline aplicado de forma **idêntica** por consumidor, forwarder e produtor:

1. **Validar** os argumentos contra o `inputSchema`. Em caso de falha, o pedido **não é IDEM**: segue
   como uma chamada MCP comum (passthrough) **[P-3.1]**.
2. **Aplicar os defaults** declarados no schema **[P-3.2]**.
3. **Aplicar os normalizadores** declarados pelo produtor no manifesto, por campo (JSON Pointer):

| Normalizador | Efeito |
|---|---|
| `trim` | remove os espaços em volta |
| `lowercase` | mapeamento Unicode padrão para minúsculas, independente de locale (`toLowerCase` do ECMAScript, `str.lower` do Python); veja ADR-011 |
| `nfc` | normalização Unicode NFC |
| `url` | parse WHATWG; esquema e host em minúsculas; remove a porta padrão e o fragmento |
| `url:sortQuery` | `url` + ordenação estável dos parâmetros da query pelo nome, reserializados como `application/x-www-form-urlencoded` (uma query vazia remove o `?`) |
| `set` | array tratado como conjunto: remove duplicatas e ordena pela serialização JCS de cada item (ordem de unidades de código UTF-16) |

   - **[P-3.3]** Forwarders e consumidores MUST aplicar **somente** os normalizadores do manifesto. Inferir
     uma normalização (por exemplo, tratar uma string como URL sem declaração) é proibido: fundir
     pedidos diferentes sob um mesmo nome entregaria a resposta errada.
   - Os ponteiros são JSON Pointers da RFC 6901, aplicados **do mais profundo para o mais raso** (mais
     tokens de referência primeiro; empates pela ordem de unidades de código do ponteiro), de modo que
     os normalizadores dos elementos rodam antes de um `set` no pai. Ponteiros que não resolvem (campos
     opcionais ausentes) são ignorados. Um normalizador de string em algo que não é string, ou `set` em
     algo que não é array, é um erro de manifesto (`BAD_POLICY`); uma URL que não pode ser interpretada
     torna a chamada não IDEM (`INVALID_ARGS` → passthrough).
   - O resultado é **validado de novo**; se a normalização o tornou inválido, a chamada não é IDEM
     (passthrough). Isso garante que os args canônicos são sempre válidos e, portanto, [P-3.5].
4. **Serializar** com JCS (RFC 8785) **[P-3.4]**. Propriedades de objeto cujo valor é ausente/`undefined`
   são omitidas; NaN, ±Infinity e surrogates isolados não são JSON e tornam a chamada não IDEM.

- **[P-3.5]** A implementação MUST incluir testes de propriedade: para args válidos `a`,
  `canon(canon(a)) == canon(a)` (idempotência), e permutar as chaves de um objeto não muda o nome.
- **[P-3.6]** As implementações MUST suportar exatamente o subconjunto de JSON Schema do Apêndice A. Um
  produtor MUST NOT marcar uma ferramenta como cacheável se o seu `inputSchema` usar qualquer outra
  palavra-chave; um consumidor ou forwarder que encontre um schema assim MUST tratar a ferramenta como
  não cacheável. (Todos concordam sobre a validade, então todos concordam sobre os nomes.)

## 4. Interest

```ts
interface Interest {
  name: string;               // §2
  args: unknown;              // canonical-args (already normalized object)
  mustBeFresh: boolean;       // default true
  lifetimeMs: number;         // default 10_000
  nonce: string;              // 64 random bits, b64u
  hopLimit: number;           // default 8
  authContext?: string;       // never set by a sender; ignored on receipt [P-8.4]
}
```

- **[P-4.1]** O consumidor MUST calcular o nome localmente, a partir do manifesto e dos argumentos.
- **[P-4.2]** Um Interest para uma ferramenta não cacheável MUST NOT ser emitido: a chamada segue como MCP comum.
- **[P-4.3]** Todo forwarder MUST recalcular o `args-digest` a partir de `args` e descartar o Interest se
  ele não bater com o nome (erro `DIGEST_MISMATCH`).
- **[P-4.4]** Um forwarder MUST decrementar `hopLimit` e descartar em 0 (um Interest que chega com
  `hopLimit = 0` é respondido com `HOP_LIMIT`; um que chega com `h > 0` é encaminhado com `h − 1`). Ele MUST
  descartar um Interest cujo `(name, nonce)` já esteja no PIT vindo de outra face (laço); o mesmo
  nonce vindo da mesma face é uma duplicata e é descartado em silêncio.

### 4.1 Campos salto a salto (não fazem parte dos objetos Interest e Data)

Cada salto associa respostas a pedidos. No overlay HTTP, a própria troca HTTP faz isso. No motor
(`@idem/core`), os pacotes levam o `nonce` do Interest de volta no Data ou no Nack daquele salto; um
forwarder encaminha upstream com o nonce do Interest que criou a entrada do PIT e responde a cada
downstream com o nonce daquele downstream. Data e Nacks são aceitos **somente** vindos da face para a
qual o Interest foi encaminhado, e para o mesmo nome; qualquer outra coisa é descartada como não solicitada.

A credencial do usuário final (`Authorization: Bearer` no overlay) viaja salto a salto até o produtor,
como um cabeçalho HTTP. Ela nunca faz parte de um nome nem de uma chave de cache; a borda deriva o
`authContext` a partir dela (§8).

## 5. Data

```ts
interface Data {
  name: string;
  content: CallToolResult;    // MCP result without its top-level _meta (ephemeral: traces, dev.idem/*)
  meta: {
    contentDigest: string;    // b64u(SHA-256(JCS(content)))
    producedAt: number;       // epoch ms, producer clock
    freshnessMs: number;      // >= 0
    scope: "public" | "private";
    policyVersion: number;
  };
  signature: {
    alg: "Ed25519";
    keyLocator: string;       // "/idem/v1/<producer>/_key/<keyId>"
    value: string;            // b64u(Ed25519(JCS({ name, ...meta })))
  };
  ageMs?: number;             // NOT signed; accumulated per hop, like the HTTP Age header
}
```

- **[P-5.1]** O produtor MUST calcular o nome **ele mesmo**, a partir dos argumentos recebidos, e nunca
  copiá-lo do Interest. Se ele diferir do nome do Interest, responde `DIGEST_MISMATCH`.
- **[P-5.2]** Bytes assinados = `JCS({ name, contentDigest, producedAt, freshnessMs, scope, policyVersion })`.
  O `keyLocator` MUST indicar o mesmo produtor do nome do Data; quem verifica MUST rejeitar um Data cuja
  chave pertença a outro produtor (`UNTRUSTED_KEY`). O `keyId` é o thumbprint JWK da RFC 7638 da chave
  pública, em base64url, truncado em 16 caracteres.
- **[P-5.3]** Um resultado com `isError: true` MUST ter `freshnessMs = 0` e MUST NOT ser guardado em cache.
- **[P-5.4]** Resultados intermediários de várias idas e voltas (`resultType: "input_required"`) e pedidos
  que levam `inputResponses`/`requestState` MUST NOT usar IDEM, em linha com a regra de cache do próprio MCP [MCP-CACHE].
- **[P-5.5]** O consumidor MUST verificar a assinatura e o `contentDigest` antes de entregar o conteúdo ao
  agente. Em caso de falha → `BAD_SIGNATURE`, e o consumidor tenta de novo uma vez como **chamada comum**
  (§9.1, `POST /idem/v1/call`), que nenhum PIT agrega e nenhum CS responde: no próprio produtor quando o
  consumidor consegue alcançá-lo, senão pela sua borda. O resultado da nova tentativa MUST trazer um Data
  assinado para o mesmo nome e passar pela mesma verificação; se não, a chamada falha com `BAD_SIGNATURE`
  e nenhum conteúdo é entregue ao agente (ADR-024).

## 6. Manifesto

```ts
interface Manifest {
  producer: string;
  version: number;                       // bumped on every change; key rotation bumps it
  keys: { keyId: string; publicKeyJwk: JsonWebKey; notAfter?: number }[];
  tools: {
    tool: string;
    schemaDigest: string;
    cacheable: boolean;
    ttlMs: number;
    scope: "public" | "private";
    normalizers: Record<string /* JSON Pointer */, Normalizer[]>;
    policyVersion: number;
  }[];
  signature: { alg: "Ed25519"; keyId: string; value: string };  // over JCS(manifest without signature)
}
```

Distribuição: `GET https://<producer>/.well-known/idem.json` (overlay), `_meta["dev.idem/manifest"]` em
`server/discover`, e como Data nomeado `/idem/v1/<producer>/_manifest/<version>` (nativo).

- **[P-6.1]** Uma chamada só é cacheável se **tudo** isto valer: (a) o manifesto marca a ferramenta com
  `cacheable: true`; (b) a ferramenta tem `readOnlyHint: true` (defesa em profundidade); (c) o
  `schemaDigest` do manifesto bate com o derivado de `tools/list`; (d) §5.3 e §5.4 não se aplicam.
- **[P-6.2]** Confiança na v1: *trust on first use* (confiança no primeiro uso), com **pinning** (fixação)
  opcional de chave por configuração. O manifesto MUST ser verificado com uma chave que ele lista **e** que
  seja confiável no momento (fixada, ou listada pelo manifesto aceito no momento), exceto no primeiro
  contato. Uma chave removida por uma rotação não pode mais assinar manifestos. Todo `keyId` listado MUST
  ser igual ao thumbprint do seu JWK.
- **[P-6.3]** Um nó MUST rejeitar um manifesto cuja `version` seja menor que a do aceito (rollback).

## 7. Comportamento do forwarder

```
on Interest I from face F:
  tool not cacheable (manifest), or            → error NOT_CACHEABLE; event "bypass"
    I.name.schemaDigest ≠ the manifest's         (reason "not_cacheable")
  digest(I.args) ≠ I.name.argsDigest           → error DIGEST_MISMATCH; event "drop"
  hopLimit == 0 or loop (name, nonce)          → drop; event "drop"
  CS has D for I.name (scope ok), and D is     → reply D to F; event "cs_hit"
    fresh [P-8.1] and not expired [P-8.6],
    or I.mustBeFresh is false
  PIT has an entry for I.name                  → add F (with I.mustBeFresh) to entry;
                                                 event "pit_aggregate"
  otherwise                                    → create PIT entry; FIB(producer) → next hop;
                                                 send I; event "upstream_out"

on Data D from upstream:
  verify signature and contentDigest           → fail: drop, error to waiters; "verify_fail"
  signed scope private, manifest public        → drop, BAD_SIGNATURE to waiters [P-8.5]
  D expired at this node [P-8.6]               → not stored; EXPIRED to every waiter that
                                                 asked for fresh Data, D to the others;
                                                 event "drop" (reason "expired")
  D stale by its ageMs [P-8.1]                 → EXPIRED to every waiter that asked for fresh
                                                 Data, D to the others; event "drop"
                                                 (reason "stale")
  if cacheable and scope allows                → store in CS; event "cs_insert"
  deliver D to every other face in the entry   → event "pit_satisfy"(n faces)
  remove PIT entry

on Data D for a passthrough Interest [P-7.3]   → the same two checks, then relay D or EXPIRED

on PIT entry lifetime expiry                   → TIMEOUT error to all; event "pit_expire"

on plain call C from face F (not IDEM)         → FIB(producer) → next hop; send C with no PIT or CS
                                                 state; relay the result to F; event "bypass"
```

Um forwarder nunca transforma um Interest em chamada comum. Um consumidor que segue [P-4.2] não envia
Interest para uma ferramenta não cacheável; por isso, o que chega é respondido com `NOT_CACHEABLE` (§10),
o que também cobre o consumidor que guarda um manifesto mais antigo que o do forwarder. Quem enviou MAY
então repetir o pedido como chamada comum. As chamadas comuns (ferramentas não cacheáveis, argumentos
fora do schema [P-3.1], a nova tentativa de [P-5.5]) são o que o forwarder deixa passar (ADR-024).

- **[P-7.1]** Um forwarder MUST verificar a assinatura antes de inserir no CS. A verificação só pode ser
  desligada por uma flag de experimento (para medir o seu custo), nunca em produção.
- **[P-7.2]** Erros (TIMEOUT, 5xx upstream, `isError`) MUST NOT ser guardados em cache (não há cache negativo na v1).
- **[P-7.3]** O PIT MUST limitar suas entradas e as faces por entrada (proteção contra DoS); quando o limite
  é excedido → passthrough (encaminhado sem estado de PIT, sem agregação e sem cache; evento `bypass`, motivo `pit_full`).
  O passthrough guarda o `mustBeFresh` do Interest e o `ttlMs` da ferramenta, e a sua resposta passa
  pelas verificações de [P-8.6] como se tivesse uma entrada de PIT própria.
- **[P-7.4]** O CS MUST respeitar um orçamento em bytes. A política de substituição é configurável (`lru`
  por padrão; `lfu` e `fifo` para experimentos).

## 8. Frescor e escopo

- **[P-8.1]** Um Data é fresco no nó N enquanto `ageMs + (now_N − receivedAt_N) < freshnessMs`. Ao servir
  pelo CS, N atualiza `ageMs` (semântica do cabeçalho HTTP `Age`, RFC 9111). A idade é contada por salto,
  a partir do recebimento, no relógio de cada nó; por isso, esta regra não exige relógios acertados entre
  os nós. O `ageMs` não é assinado: sozinha, a regra só obriga os nós honestos. O que um nó desonesto
  consegue fazer um receptor aceitar é limitado, em vez disso, pelo `producedAt` assinado [P-8.6], até a
  tolerância de relógio (§11, replay de dado vencido). Um Interest com `mustBeFresh: true` só é respondido
  por uma entrada do CS se ela estiver fresca por esta regra e por [P-8.2] e não estiver expirada por
  [P-8.6]; um Interest com `mustBeFresh: false` pode ser respondido por qualquer entrada, fresca ou não.
- **[P-8.2]** O `freshnessMs` de um Data MUST ser ≤ o `ttlMs` do manifesto para aquela ferramenta.
  Forwarders e consumidores MUST usar `min(freshnessMs, ttlMs)` como frescor efetivo.
- **[P-8.3]** `scope: "public"`: pode ir para qualquer CS. `scope: "private"`: só para um CS **particionado
  por `authContext`**, e só no primeiro forwarder (a borda). Forwarders além da borda MUST NOT guardar
  Data `private`.
  O PIT é particionado da mesma forma: Interests `private` são agregados **somente** com Interests do
  mesmo `authContext`. Um Interest `private` sem `authContext` (anônimo, ou além da borda) nunca é
  agregado e nunca é respondido por um CS.
- **[P-8.4]** A borda MUST derivar o `authContext` ela mesma, de forma não reversível, a partir da
  credencial que chegou com o Interest e de um segredo seu (por exemplo, HMAC do token com o segredo da
  borda), e MUST ignorar qualquer `authContext` presente em um Interest recebido, em qualquer face: um
  valor que o remetente pudesse escolher permitiria a ele ler a partição de outro contexto. Sem credencial,
  ou em uma face que não leva a consumidores, não há `authContext`. Ele MUST NOT ser propagado além do
  primeiro salto. O campo continua no Interest (§4) para que o formato de transmissão não mude; os
  remetentes o deixam sem valor.
- **[P-8.5]** Um Data cujo `scope` assinado é `private` enquanto o manifesto diz `public` MUST NOT ser
  entregue a uma entrada agregada do PIT nem guardado em cache: o forwarder o trata como inválido
  (`BAD_SIGNATURE` para quem espera, que tenta de novo como em [P-5.5]).
- **[P-8.6]** *Tempo de vida assinado.* No nó N, a idade aparente de um Data é `now_N − producedAt`. O IDEM
  tira isso do `apparent_age` da RFC 9111 §4.2.3 [RFC9111], com o `producedAt` assinado no lugar do `Date`
  não assinado, e se afasta dela em um ponto: a idade não é limitada a 0 por baixo. A RFC 9111 pode fazer
  esse corte porque os seus caches são confiáveis; com um carimbo de tempo assinado, o corte deixaria um
  Data datado no futuro viver pelo seu frescor mais o deslocamento. O Data está **fora do seu tempo de
  vida assinado** em N quando está *expirado*, `apparentAge ≥ min(freshnessMs, ttlMs) + clockToleranceMs`,
  ou *datado no futuro*, `producedAt − now_N > clockToleranceMs`. `clockToleranceMs` é uma opção local de
  cada nó, com padrão de 60 000 ms; ela cobre a diferença de relógio entre N e o produtor mais o tempo de
  trânsito. Dentro da janela, um Data é aceito qualquer que seja a sua idade aparente. Nesta seção,
  "expirado" quer dizer fora do tempo de vida assinado, de qualquer um dos lados. Um forwarder MUST
  tratar como inválido um Data vindo do upstream que esteja expirado: ele MUST NOT guardá-lo, e MUST
  responder a todo downstream cujo Interest tinha `mustBeFresh: true` com `EXPIRED` no lugar do Data; um
  downstream cujo Interest tinha `mustBeFresh: false` MAY recebê-lo. O PIT guarda a flag por downstream;
  assim, Interests com flags diferentes continuam dividindo uma mesma entrada. Um forwarder MUST NOT
  responder a um Interest com `mustBeFresh: true` por uma entrada do CS que esteja expirada, diga o que
  disser o `ageMs` dela.
  O invariante que essas regras mantêm: um downstream que pediu Data fresco recebe só Data fresco por
  [P-8.1]/[P-8.2] e dentro do seu tempo de vida assinado, quaisquer que sejam as flags dos outros
  Interests da entrada, e também por um passthrough [P-7.3]. Para um Data vindo do upstream, fresco por
  [P-8.1] quer dizer que o seu `ageMs`, se presente, está abaixo de `min(freshnessMs, ttlMs)`; um Data sem
  `ageMs` vem do produtor, não de um cache, e não chega velho. Um forwarder MUST responder a um
  downstream assim com `EXPIRED` no lugar de um Data que está velho pelo seu `ageMs`, como para um
  expirado, e entregar o Data aos outros. Por estar dentro do seu tempo de vida assinado, esse Data MAY
  ser guardado; ele nunca é um acerto fresco, já que a sua idade já alcança o seu frescor.
- **[P-8.7]** *Verificação do tempo de vida no consumidor.* Depois de [P-5.5], um consumidor cujo Interest
  tinha `mustBeFresh: true` MUST NOT entregar ao agente um Data expirado [P-8.6], julgado pelo seu próprio
  relógio, nem um Data velho pelo seu `ageMs` [P-8.1] (a regra de [P-8.6] para Data vindo do upstream).
  Ele tenta de novo uma vez como chamada comum, a nova tentativa de [P-5.5], que ele também faz
  quando um forwarder respondeu `EXPIRED`. O resultado da nova tentativa MUST trazer um Data assinado para
  o mesmo nome, passar pela verificação e não estar expirado. Se ele passa pela verificação mas está
  expirado (de qualquer um dos lados), a chamada falha com o erro local `CLOCK_SKEW` e nenhum conteúdo é
  entregue ao agente; a mensagem do erro traz o `producedAt`, a hora local e qual lado da janela foi
  perdido. Um Data que o produtor acabou de fazer e que já parece expirado, ou datado no futuro além da
  tolerância, quer dizer que o relógio deste nó e o do produtor discordam em mais do que a janela permite,
  ou que alguém no caminho da nova tentativa também faz replay; não há como distinguir os dois casos, e
  por isso a chamada falha fechada. Um consumidor que pediu com `mustBeFresh: false` pula a verificação. Um
  consumidor só nativo (§9.2) não tem chamada comum e falha fechado com `EXPIRED`, como já faz para
  `BAD_SIGNATURE` [P-9.3].

## 9. Bindings de transporte

### 9.1 Overlay HTTP (sobre o MCP 2026-07-28)

- **Consumidor → borda:** há duas entradas, e as duas terminam como um pedido de consumidor ao motor da
  borda (§7). Um consumidor que conhece o IDEM fala IDEM sobre HTTP (os endpoints abaixo): ele mesmo
  nomeia a chamada [P-4.1] e verifica a resposta [P-5.5]. Um cliente MCP sem alterações fala MCP comum
  (Streamable HTTP, sem estado) com o endpoint MCP da borda (abaixo), e a borda faz o papel de consumidor
  em nome dele; assim, os agentes que já existem não precisam mudar o código.
- **Borda → produtor:** `tools/call` do MCP com `_meta["dev.idem/interest"] = { name, nonce, hopLimit }`.
  O produtor devolve o `CallToolResult` normal e anexa
  `_meta["dev.idem/data"] = { name, meta, signature }`. Clientes que não conhecem o IDEM ignoram `_meta`,
  então o binding é retrocompatível.
- **Forwarder ↔ forwarder:** `POST /idem/v1/interest` com um `Interest` no corpo (JSON); a resposta é um
  `Data` (JSON) ou um erro `{ code, message }`. HTTP/2 por padrão.
- **IDEM sobre HTTP, endpoints** (implementados em `@idem/gateway`):

  | Quem | Rota | Corpo → resposta |
  |---|---|---|
  | produtor | `GET /.well-known/idem.json` | manifesto assinado |
  | produtor | `GET /idem/v1/tools` | lista de ferramentas (formato de `tools/list`) |
  | produtor, forwarder | `POST /idem/v1/interest` | Interest → Data, ou `{ code, message }` |
  | produtor, forwarder | `POST /idem/v1/call` | `{ producer, tool, args }` → `CallToolResult` (passthrough) |
  | forwarder | `GET /idem/v1/manifest/<producer>` | o manifesto em que este nó confia |
  | forwarder | `GET /idem/v1/tools/<producer>` | a lista de ferramentas do produtor (repassada) |

  Cabeçalhos: `Authorization: Bearer <credential>` (usuário final, §4.1); `idem-forwarder: <id>` nas
  requisições enviadas por um forwarder (ausente ⇒ o remetente é um consumidor e este nó é a borda
  dele); `idem-trace` nas respostas (lista JSON de `{ node, events }` por salto, só para diagnóstico,
  nunca confiável). Códigos de status: 400 `DIGEST_MISMATCH`, 422 `NOT_CACHEABLE`,
  502 `BAD_SIGNATURE`/`EXPIRED`/`UNTRUSTED_KEY`/`UPSTREAM_ERROR`, 504 `TIMEOUT`, 508 `HOP_LIMIT`/`LOOP`. Um produtor
  MAY expor esse conjunto de endpoints além do MCP; as bordas SHOULD preferi-lo quando disponível (ADR-014).
- **Endpoint MCP da borda:** a borda MAY expor um endpoint MCP comum (Streamable HTTP) que lista as
  ferramentas do produtor; cada `tools/call` entra no motor do forwarder como um pedido de consumidor
  (implementado em `@idem/mcp`, `createMcpEdge`). O endpoint **termina o MCP**: um servidor MCP (o SDK)
  interpreta e roteia cada pedido e expõe de novo as ferramentas do produtor, e só as ferramentas. Em
  nome do cliente, ele nomeia a chamada [P-4.1], verifica o Data [P-5.5] e devolve o conteúdo verificado,
  com `_meta["dev.idem/data"]` anexado para que um cliente que conhece o IDEM possa verificar de novo. Ele
  não roteia pelos cabeçalhos `Mcp-Method` / `Mcp-Name` da 2026-07-28 [MCP-CHANGELOG]; um proxy que repassa
  os bytes do MCP intactos e decide por esses cabeçalhos não faz parte da v1 (ADR-024).
- **Produtor legado (sem IDEM):** um operador MAY rodar um *proxy-producer* na frente de um servidor MCP
  que não fala IDEM (a *origem*), ao lado da borda ou no mesmo processo. O proxy é um produtor IDEM por
  direito próprio (§5, §6): ele chama a origem por MCP comum, nomeia os resultados e os assina com a sua
  própria chave. A confiança então passa para o proxy, e todo Data diz isso no seu nome e no seu
  `keyLocator`. Implementado em `@idem/mcp` (`createProxyProducer`, ADR-038).
  - **[P-9.5]** Um proxy-producer MUST usar o seu próprio nome de produtor e a sua própria chave; assim,
    os seus nomes são `/idem/v1/<proxy>/…` e o seu `keyLocator` é `/idem/v1/<proxy>/_key/<keyId>`. Ele
    MUST NOT assinar sob o nome da origem. Um consumidor que só confia no nome ou na chave da origem,
    portanto, não aceita um Data assinado pelo proxy como se fosse da origem: [P-5.2] o rejeita
    (`UNTRUSTED_KEY`, ou `BAD_SIGNATURE` quando o nome ou o key locator é reescrito). Cada ferramenta na
    lista de ferramentas do proxy leva `_meta["dev.idem/origin"] = { origin, readOnlyHint }`: o endpoint
    da origem, e quem responde pelo `readOnlyHint` listado (`"origin"`, `"operator"` ou `"absent"`). Como
    a própria lista de ferramentas, esse registro não é assinado e é só informativo. Os objetos Manifest
    e Data não mudam.
  - **[P-9.6]** A política de cache é do operador, por ferramenta. Uma ferramenta sem política não é
    cacheável: cada chamada a ela é repassada à origem e devolvida sem assinatura. Para [P-6.1](b), o
    proxy MUST NOT oferecer como cacheável uma ferramenta que o `tools/list` da origem marca com
    `readOnlyHint: false`, e MUST NOT oferecer uma que não tem `readOnlyHint`, a menos que o operador
    afirme isso de forma explícita (`operatorAssertsReadOnly`); a sua própria lista de ferramentas
    mostra então `readOnlyHint: true`, com `"operator"` no registro de origem.
  - **[P-9.7]** A credencial de uma chamada à origem segue a política declarada pelo operador, nunca o
    estado atual da ferramenta. Para uma ferramenta que o operador declarou cacheável com escopo
    `public`, o proxy MUST NOT repassar a credencial do usuário final à origem, esteja a ferramenta
    oferecida como cacheável, retida depois de uma mudança de schema [P-9.8] ou recusada depois de uma
    releitura: ele chama com a sua própria credencial configurada, ou com nenhuma, para que uma
    resposta compartilhada não possa depender de quem perguntou e para que uma origem não consiga obter
    credenciais de usuários mudando a sua lista de ferramentas. Para uma ferramenta declarada `private`,
    ele repassa a credencial do usuário final (`Authorization: Bearer`) e assina o Data como `private`
    (§8). Para uma ferramenta que o operador não declarou, ou declarou como não cacheável, o operador
    não prometeu nada: o proxy repassa a chamada com a credencial do usuário final, como faria um proxy
    transparente, e nunca a assina.
  - **[P-9.8]** Depois de cada chamada à origem cujo resultado ele assinaria, o proxy MUST comparar a
    entrada atual do `tools/list` da origem para aquela ferramenta (schema de entrada, schema de saída,
    `readOnlyHint`) com aquela a partir da qual o seu manifesto foi montado. Havendo diferença, ele MUST
    NOT assinar aquele resultado: o Interest é respondido com `NOT_CACHEABLE`, e uma chamada comum
    recebe o resultado da origem sem assinatura. Toda ferramenta que mudou fica então não cacheável, sob
    uma nova versão do manifesto, até o proxy reler a lista de ferramentas da origem (um refresh), o
    que incrementa a versão de novo; o novo `schema-digest` dá nomes novos [P-2.2], e um Interest para
    um nome antigo nunca é respondido. Um Data assinado antes da mudança continua podendo ser servido
    até o fim do seu frescor, como acontece com qualquer produtor que muda uma ferramenta.
  - Falhas da origem e resultados `isError` viram resultados de erro com `freshnessMs = 0`, nunca
    guardados em cache ([P-5.3], [P-7.2]). Um resultado da origem com `resultType: "input_required"`
    não é nomeado [P-5.4]; a v1 não repassa as rodadas de uma chamada de várias idas e voltas, então
    uma chamada comum recebe um resultado de erro.

### 9.2 NDN nativo (NDNts)

Implementado em `@idem/ndn` (ADR-026). O binding mapeia os objetos da §4 e da §5 no formato de pacote
NDN v0.3; nomear, assinar e verificar continuam sendo do `@idem/core`, sem mudança.

- **Nomes.** Cada parte separada por `/` de um nome IDEM é um GenericNameComponent com seus bytes
  UTF-8; nomes reservados (§2.2, por exemplo key locators) são mapeados do mesmo jeito. O `args-digest`
  continua como componente explícito, e o NDN acrescenta o seu próprio ParametersSha256DigestComponent,
  calculado sobre o ApplicationParameters. O nome IDEM de um pacote nativo é o seu nome NDN sem esse
  último componente.
- **Interest NDN.** Name = nome IDEM + ParametersSha256DigestComponent; ApplicationParameters =
  `JCS(args canônicos)`, exatamente os bytes que o `args-digest` resume; `MustBeFresh`,
  `InterestLifetime` e `HopLimit` mapeados a partir da §4; CanBePrefix desligado. O Nonce de 32 bits
  do NDN substitui o nonce IDEM (seus quatro primeiros bytes, quando houver); a detecção de laços é
  do NFD, então todo Interest enviado, retransmissões incluídas, leva um nonce novo (o NFD descarta
  um par nome e nonce que já viu). O consumidor sempre liga MustBeFresh (padrão da §4): sem ele, o
  NFD responde com uma entrada vencida do CS, e o TTL deixaria de limitar o que o consumidor recebe.
  - **[P-9.1]** Um Interest nativo MUST NOT ser assinado, e seu ApplicationParameters MUST ser
    exatamente `JCS(args canônicos)`. Assim o ParametersSha256DigestComponent é função só dos args
    canônicos, e duas chamadas têm o mesmo nome nativo se e só se têm o mesmo nome IDEM [P-2.1].
  - **[P-9.2]** Um produtor nativo MUST conferir que o ApplicationParameters resume no `args-digest`
    do nome (a verificação de [P-4.3], sobre bytes) antes de [P-5.1]; as falhas são respondidas como
    abaixo. O `authContext` nunca é codificado [P-8.4].
- **Data NDN.** Mesmo Name do Interest; ContentType BLOB; `FreshnessPeriod = freshnessMs`;
  Content = `JCS({ content, meta, signature })` (o Data da §5 sem `name`, que o nome NDN carrega, e
  sem o `ageMs` não assinado); assinatura Ed25519 do NDN pela chave do produtor, com KeyLocator = o
  key locator IDEM `/idem/v1/<producer>/_key/<keyId>` mapeado como acima.
  - **[P-9.3]** Um consumidor nativo MUST verificar as duas assinaturas antes de entregar o conteúdo
    ao agente: a assinatura NDN, por uma chave que o trust store tem para o produtor do nome (a mesma
    chave que o `keyLocator` IDEM nomeia, [P-5.2]), e a assinatura IDEM e o `contentDigest`
    exatamente como em [P-5.5]. Um Data que falha em qualquer uma não é entregue (`BAD_SIGNATURE` /
    `UNTRUSTED_KEY`). A nova tentativa como chamada simples de [P-5.5] precisa do overlay; um
    consumidor só nativo falha fechado.
  - A perda é recuperada pelo consumidor: um Interest que fica sem resposta durante o seu
    InterestLifetime MAY ser emitido de novo para o mesmo nome com um Nonce novo (o NFD descarta um
    par nome + Nonce que já viu). O `NdnConsumer` faz isso `retransmissions` vezes (padrão 0).
  - Um Data maior que 8800 bytes (o limite de pacote do NFD) não é segmentado na v1: o produtor
    responde `UPSTREAM_ERROR`.
- **Erros.** Um Nack de aplicação: um Data com o nome do Interest, ContentType NACK,
  `FreshnessPeriod = 0`, Content = `JCS({ code, message })` (§10), assinado como qualquer Data.
- **Escopo.** O PIT e o CS do NFD são indexados só pelo nome e não têm contexto de autorização.
  - **[P-9.4]** Ferramentas `private` MUST NOT usar o binding nativo: um consumidor MUST NOT emitir
    um Interest nativo para uma delas, um produtor MUST responder a um com um Nack `NOT_CACHEABLE`
    sem executar a ferramenta, e um consumidor MUST rejeitar um Data nativo cujo escopo assinado é
    `private`. Chamadas privadas ficam no overlay (§8, [P-8.3]).
- **Manifesto e ferramentas.** O produtor também responde `/idem/v1/<producer>/_manifest/<version>`
  (o manifesto assinado, §6) e `/idem/v1/<producer>/_tools/<version>` (o formato de `tools/list`) a
  Interests com CanBePrefix, para que um consumidor nativo estabeleça confiança ([P-6.2]) sem overlay.
- PIT, CS e agregação são **os do próprio NFD**; o binding não acrescenta nenhum. Roteamento: rotas
  estáticas (`nfdc route add`) ou NLSR no Mini-NDN. O binding nativo mede o IDEM sobre uma rede ICN
  real (spec 05, E4).

## 10. Erros

| Código | Quando |
|---|---|
| `DIGEST_MISMATCH` | o nome não bate com os argumentos |
| `BAD_SIGNATURE` | assinatura ou contentDigest inválidos |
| `EXPIRED` | Data fora do seu tempo de vida assinado em um forwarder (expirado, ou datado no futuro além da tolerância), ou velho pelo seu `ageMs`, para um Interest que pediu Data fresco; a mensagem diz qual [P-8.6]; o consumidor tenta de novo como em [P-8.7] |
| `UNTRUSTED_KEY` | a chave não está em um manifesto confiável |
| `NOT_CACHEABLE` | Interest para uma ferramenta que o manifesto não marca como cacheável, ou cujo `schema-digest` não é o do manifesto: devia ter sido uma chamada comum [P-4.2] (§7) |
| `TIMEOUT` | a entrada do PIT expirou |
| `HOP_LIMIT` / `LOOP` | descartado pelo limite de saltos ou pela detecção de laço |
| `UPSTREAM_ERROR` | o produtor ou o próximo salto falhou, ou não há rota |

Erros locais (levantados pelas implementações, nunca enviados pela rede): `BAD_NAME`, `BAD_JSON`,
`BAD_ENCODING`, `INVALID_ARGS` (→ passthrough), `UNSUPPORTED_SCHEMA` (→ não cacheável), `BAD_POLICY`,
`BAD_MANIFEST`, `CRYPTO_UNSUPPORTED`, `CLOCK_SKEW` (a nova tentativa verificada de [P-8.7] continua fora
do seu tempo de vida assinado, de qualquer um dos lados).
Quando um erro local precisa atravessar um salto, ele é mapeado para `NOT_CACHEABLE` (problemas de
argumento, schema ou nome) ou `UPSTREAM_ERROR` (qualquer outro).

## 11. Considerações de segurança e privacidade

- **Envenenamento de cache:** mitigado pela verificação de assinatura no forwarder e no consumidor (P-5.5, P-7.1).
  A nova tentativa do consumidor também é verificada; por isso, tirar a assinatura de um resultado repetido
  não rebaixa a chamada a uma chamada sem verificação (P-5.5).
- **Replay de dado vencido:** o frescor relativo, contado por salto (P-8.1), apoia-se no `ageMs` não
  assinado; sozinho, portanto, ele só obriga os nós honestos. Quem está no caminho de um Interest (um
  forwarder, ou um atacante em um enlace sem TLS) pode respondê-lo com um **Data genuíno que já passou do
  seu frescor**: um que gravou antes, ou um cujo `ageMs` ele declara menor do que é. O tempo de vida
  assinado (P-8.6) limita o que isso rende: uma vez expirado o Data, um forwarder que o recebe não o
  guarda em cache e não o entrega a um Interest que pediu Data fresco (`EXPIRED`), nenhum CS o serve como
  fresco, e um consumidor o recusa e tenta de novo (P-8.7). O que sobra é uma **defasagem limitada**: um
  replay mais novo que `min(freshnessMs, ttlMs) + clockToleranceMs` é aceito, e um forwarder pode
  guardá-lo e servi-lo até esse limite, nunca depois. A tolerância é, portanto, o máximo que um caminho
  consegue esticar a vida de um Data; perto de um TTL curto ela é grande, e quem implanta a escolhe
  levando isso em conta. A regra precisa que o relógio do produtor e o de cada verificador concordem
  dentro da tolerância. Um nó cujo relógio está adiantado em mais do que o frescor mais a tolerância
  falha fechado: o seu forwarder responde `EXPIRED`, e o seu consumidor, depois da nova tentativa como
  chamada comum, `CLOCK_SKEW`. Um nó cujo relógio está atrasado aceita um Data por mais tempo, em até a
  tolerância; atrasado em mais do que isso, ele vê um Data fresco como datado no seu futuro e falha
  fechado do mesmo jeito. Um Data que o produtor assinou com um `producedAt` muito no futuro (uma falha
  de relógio) é recusado em toda parte até essa data entrar na tolerância, de modo que quem está no
  caminho não consegue ficar repetindo-o. O que quem está no caminho não consegue fazer de jeito
  nenhum: mudar o conteúdo, responder sob outro nome ou assinar pelo produtor; e um Data só é aceito da
  face para a qual o seu Interest foi enviado (§4.1), de modo que quem está fora do caminho não consegue
  injetar um. TLS por salto no overlay deixa só os próprios forwarders no caminho. O E5 mede tanto a
  afirmação quanto o limite (05-evaluation, ADR-034).
- **Vazamento entre usuários:** o `cacheScope` do MCP não é controle de acesso [MCP-CACHE]; aqui o escopo é
  assinado pelo produtor, o CS `private` é particionado (P-8.3), e a chave da partição é derivada pela
  borda, nunca tirada do Interest (P-8.4).
- **Canal lateral de tempo:** um acerto rápido revela que alguém já pediu aquele nome. Registrado como
  risco (Q3); uma mitigação opcional (atraso aleatório para `private`) fica fora da v1.
- **Argumentos em claro:** o Interest leva os argumentos até o produtor. No overlay, TLS por salto.
  O nome expõe só o digest.
- **DoS no PIT:** limites (P-7.3).
- **Comprometimento de chave:** rotação por uma nova versão do manifesto; `notAfter` por chave.

## 12. Versionamento

O prefixo `/idem/v1` versiona o formato de transmissão. Qualquer mudança incompatível nas seções §2, §4,
§5 ou §6 exige `/idem/v2` e um ADR.

## Apêndice A. Subconjunto de JSON Schema (IDEM v1) [P-3.6]

Anotações (ignoradas na validação): `$schema`, `$id`, `$comment`, `title`, `description`, `default`
(usada pelo passo 2 da §3), `examples`, `deprecated`, `readOnly`, `writeOnly`, `format` (não é verificado).

Palavras-chave de validação: `type` (string ou array; `integer` = número inteiro), `enum`, `const`
(igualdade por JCS), `properties`, `required`, `additionalProperties`, `minProperties`, `maxProperties`,
`items`, `prefixItems`, `minItems`, `maxItems`, `uniqueItems` (por JCS), `minLength`, `maxLength`
(pontos de código), `pattern` (ECMA-262, flag `u`), `minimum`, `maximum`, `exclusiveMinimum`,
`exclusiveMaximum`, `multipleOf`, `anyOf`, `allOf`, `oneOf`, `not`. Schemas booleanos são permitidos.

Os defaults são aplicados somente a partir de `properties`, `items` e `prefixItems`, nunca através de
combinadores. Não suportados na v1 (ferramenta não cacheável): `$ref`, `$defs`, `if`/`then`/`else`,
`dependentSchemas`, `patternProperties`, `unevaluated*`, `contains`, e qualquer outra palavra-chave.
