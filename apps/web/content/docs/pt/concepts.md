Esta página explica as ideias do IDEM na ordem em que um pedido as encontra. É um guia, não a especificação: onde ela diz que algo *deve* acontecer, a redação que vale é a da regra citada no [protocolo](/docs/protocol).

## Nomes {#names}

Em uma chamada MCP comum, o pedido diz *a quem* perguntar: o endereço de um servidor. No IDEM ele diz *o que* está sendo perguntado. Esse "o quê" é um nome, e dois pedidos que significam a mesma coisa precisam chegar ao mesmo nome em todos os nós, sem conversar entre si.

```
/idem/v1/<producer>/<tool>/<schema-digest>/<args-digest>
```

::figure[name] Os cinco componentes de um nome. Só o último muda de uma chamada para outra.

- **`/idem/v1`** versiona o formato de transmissão. Uma mudança incompatível em nomes, Interests, Data ou no manifesto exige `/idem/v2`.
- **producer** (o produtor) é quem executa a ferramenta e assina a resposta: um nome de host no overlay HTTP.
- **tool** é o nome da ferramenta no MCP, com percent-encoding.
- **schema digest** são os 22 primeiros caracteres de `b64u(SHA-256(JCS(tool-identity)))`, em que a identidade da ferramenta é o seu nome, o schema de entrada, o schema de saída e um `policyVersion`. Se o schema muda, o nome muda, então uma resposta moldada por um schema antigo nunca é servida para um novo. A `description` da ferramenta fica de fora de propósito: o texto pode ser reescrito sem mudar o significado [P-2.2].
- **args digest** é `b64u(SHA-256(JCS(canonical-args)))`, 43 caracteres. Os argumentos nunca aparecem no nome, só o digest (o resumo criptográfico) deles [P-2.3].

O nome é função de exatamente três coisas: o produtor, a identidade da ferramenta e os argumentos canônicos [P-2.1]. Nada sobre quem chama, sobre a hora ou sobre o caminho entra nele. É isso que permite a um cache que nunca viu você responder à sua pergunta.

```ts
import { canonicalizeArgs, makeName } from "@idem/core";

const args = await canonicalizeArgs({ url: "https://EXAMPLE.com:443/p?b=2&a=1#x" }, tool, policy);
const name = await makeName({ producer: "demo.idem.dev", tool, args });
// "/idem/v1/demo.idem.dev/fetch_page/<22 chars>/<43 chars>"
```

### Canonicalização {#canonicalization}

Os argumentos são escritos por um modelo de linguagem, e modelos não são consistentes na grafia. Um agente escreve `https://EXAMPLE.com:443/p?b=2&a=1#x`, outro escreve `https://example.com/p?a=1&b=2`. É a mesma página. Se as duas chamadas tivessem nomes diferentes, nenhum cache acertaria.

Por isso, antes do hash, os argumentos passam por um único pipeline, executado de forma idêntica pelo consumidor, por todos os forwarders e pelo produtor:

1. **Validar** contra o `inputSchema` da ferramenta. Argumentos inválidos não são uma chamada IDEM: o pedido segue como MCP comum [P-3.1].
2. **Aplicar os defaults** do schema, para que "omitido" e "escrito com o valor padrão" sejam a mesma chamada [P-3.2].
3. **Aplicar os normalizadores** que o produtor declarou para cada campo, e nada além deles [P-3.3].
4. **Serializar** com JCS (RFC 8785), que fixa a ordem das chaves, o formato dos números e o escape das strings [P-3.4].

```
{"url":"https://EXAMPLE.com:443/p?b=2&a=1#x"}     agente A
{"url":"https://example.com/p?a=1&b=2"}           agente B
        │  validar → defaults → url:sortQuery → JCS
        ▼
{"url":"https://example.com/p?a=1&b=2"}           args canônicos: os mesmos bytes
```

Os normalizadores que um produtor pode declarar, por campo (um JSON Pointer como `/url`):

| Normalizador | Efeito |
|---|---|
| `trim` | remove os espaços em volta |
| `lowercase` | mapeamento Unicode para minúsculas, independente de locale |
| `nfc` | normalização Unicode NFC |
| `url` | parse WHATWG; esquema e host em minúsculas; remove a porta padrão e o fragmento |
| `url:sortQuery` | `url`, e depois ordena os parâmetros da query pelo nome |
| `set` | trata um array como conjunto: remove duplicatas e ordena os itens |

> [!IMPORTANT]
> Um forwarder nunca adivinha. Ele aplica só os normalizadores do manifesto assinado do produtor [P-3.3]. Tratar uma string como URL porque ela parece uma daria o mesmo nome a dois pedidos diferentes, e um deles receberia a resposta do outro. Uma taxa de acerto menor é o preço de nunca errar (ADR-006).

Todos também precisam concordar sobre o que é "válido", ou discordariam sobre os nomes. O IDEM v1 fixa, por isso, um subconjunto de JSON Schema que toda implementação suporta exatamente; uma ferramenta cujo schema use qualquer outra coisa (`$ref`, `if`/`then`, ...) simplesmente não é cacheável [P-3.6].

## Interest e Data {#interest-and-data}

O IDEM tem dois objetos de protocolo. Um **Interest** pede um nome. Um **Data** o responde. O modelo é *pull*: nada é enviado sem que alguém tenha pedido, um Interest gera no máximo um Data por salto, e o Data volta pelo caminho inverso ao do Interest.

```ts
interface Interest {
  name: string;          // o que está sendo pedido
  args: unknown;         // os argumentos canônicos (o produtor precisa deles para executar)
  mustBeFresh: boolean;  // padrão true
  lifetimeMs: number;    // padrão 10 000: quanto tempo quem pediu espera
  nonce: string;         // 64 bits aleatórios: distingue um laço de um pedido novo
  hopLimit: number;      // padrão 8, decrementado em cada forwarder
  authContext?: string;  // os remetentes não preenchem: a borda deriva o seu, veja Escopo
}
```

O nome carrega só um digest, então o Interest carrega também os argumentos. Todo nó que o recebe recalcula o digest a partir desses argumentos e descarta o Interest se ele não bater com o nome [P-4.3]. Não dá para forjar um nome que aponte para os argumentos de outra pessoa.

```ts
interface Data {
  name: string;
  content: CallToolResult;   // o resultado MCP, sem o _meta efêmero
  meta: {
    contentDigest: string;   // b64u(SHA-256(JCS(content)))
    producedAt: number;      // relógio do produtor, epoch em ms
    freshnessMs: number;
    scope: "public" | "private";
    policyVersion: number;
  };
  signature: { alg: "Ed25519"; keyLocator: string; value: string };
  ageMs?: number;            // não assinado
}
```

::figure[signed] O que a assinatura do produtor cobre. Mude o nome, o conteúdo ou qualquer campo de meta e a verificação falha.

A assinatura liga o *nome* ao *conteúdo*. Essa é a diferença para uma resposta HTTP assinada ou para o TLS: o TLS prova que você falou com um servidor; um Data assinado prova que este produtor deu esta resposta a esta pergunta, não importa qual nó a entregue, nem quando.

O produtor nunca copia o nome do Interest. Ele o recalcula a partir dos argumentos que recebeu e se recusa a responder se os dois diferirem [P-5.1].

## O forwarder: PIT, CS, FIB {#forwarder}

Um **forwarder** (encaminhador) é um nó intermediário, um gateway. Ele nunca executa ferramentas. Mantém três tabelas, as mesmas três de um roteador NDN.

::figure[tables] Um forwarder entre suas faces downstream (em direção aos consumidores) e sua face upstream (em direção ao produtor).

| Tabela | Mapeia | O que oferece |
|---|---|---|
| **PIT**, Pending Interest Table | um nome → as faces que o aguardam | agregação: um segundo Interest para um nome pendente se junta ao primeiro em vez de seguir adiante |
| **CS**, Content Store | um nome → um Data assinado | cache: um Data fresco responde ao Interest ali mesmo |
| **FIB**, Forwarding Information Base | o prefixo de um produtor → o próximo salto | roteamento: para onde mandar um Interest que ninguém aqui sabe responder |

Uma **face** é o nome que o forwarder dá a um enlace: uma conexão HTTP, um fio simulado, um canal no navegador. O motor só enxerga faces, e é por isso que o mesmo código roda nos três casos.

Para cada Interest, o forwarder faz suas perguntas em uma ordem fixa:

```
on Interest I from face F:
  tool not cacheable (manifest)            → not IDEM; event "bypass"
  digest(I.args) ≠ I.name.argsDigest       → DIGEST_MISMATCH; event "drop"
  hopLimit == 0, or a loop (name, nonce)   → drop
  CS has fresh Data for I.name (scope ok)  → reply from the CS; event "cs_hit"
  PIT has an entry for I.name              → add F to it; event "pit_aggregate"
  otherwise                                → new PIT entry; FIB → next hop; event "upstream_out"
```

E para o Data que volta:

```
on Data D from upstream:
  verify signature and contentDigest       → on failure: drop, error to the waiters
  cacheable and the scope allows it        → store in the CS; event "cs_insert"
  deliver D to every face in the PIT entry → event "pit_satisfy"
  remove the PIT entry
```

::figure[exchange] Uma falta com agregação, depois um acerto. O produtor executa a ferramenta uma vez para quatro pedidos.

Dois detalhes importam nessa sequência. O segundo e o terceiro Interest chegam enquanto o primeiro ainda não foi respondido: quem os atende é o **PIT**, porque ainda não há nada no cache. O quarto chega depois: quem o atende é o **CS**. Um cache comum só oferece o segundo efeito.

Cada linha dessas duas listagens é também um **evento** que o motor emite (`cs_hit`, `pit_aggregate`, `upstream_out`, `verify_ok`, ...). O sandbox desenha esse fluxo de eventos e os experimentos o contam; nenhuma métrica é calculada em outro lugar.

As tabelas têm limite. O PIT limita suas entradas e as faces por entrada, e além do limite um Interest é encaminhado sem estado, sem agregação e sem cache [P-7.3]. O CS tem um orçamento em bytes e uma política de substituição, `lru` por padrão [P-7.4].

## Assinaturas e o manifesto de confiança {#trust}

Um cache só é seguro se uma resposta ruim não consegue entrar. O IDEM confere duas vezes: um forwarder verifica um Data antes de guardá-lo ou entregá-lo [P-7.1], e o consumidor verifica de novo antes de passar o conteúdo ao agente [P-5.5]. Se a verificação do consumidor falha, ele tenta de novo sem nenhum cache.

Para verificar, é preciso saber quais chaves falam por um produtor e o que esse produtor permite guardar em cache. As duas coisas estão no **manifesto**, um documento que o produtor assina e publica em `/.well-known/idem.json`:

```ts
interface Manifest {
  producer: string;
  version: number;      // incrementada a cada mudança, inclusive rotação de chave
  keys: { keyId: string; publicKeyJwk: JsonWebKey; notAfter?: number }[];
  tools: {
    tool: string;
    schemaDigest: string;
    cacheable: boolean;
    ttlMs: number;
    scope: "public" | "private";
    normalizers: Record<string, Normalizer[]>;   // JSON Pointer → normalizadores
    policyVersion: number;
  }[];
  signature: { alg: "Ed25519"; keyId: string; value: string };
}
```

Uma chamada só é cacheável se **tudo** isto valer [P-6.1]:

1. o manifesto marca a ferramenta com `cacheable: true`;
2. a ferramenta declara `readOnlyHint: true` (defesa em profundidade: a dica sozinha nunca basta, porque as anotações do MCP não são confiáveis);
3. o `schemaDigest` do manifesto bate com o calculado a partir da lista de ferramentas que o consumidor realmente vê;
4. o resultado não é um erro nem um resultado intermediário de várias idas e voltas.

A confiança na v1 é **confiança no primeiro uso** (*trust on first use*), com fixação (*pinning*) opcional de chave [P-6.2]. O primeiro manifesto que um nó vê de um produtor é aceito se estiver assinado por uma chave que ele mesmo lista. Depois disso, um manifesto novo só é aceito se estiver assinado por uma chave em que o nó já confia para aquele produtor: uma chave fixada, ou uma que o manifesto aceito no momento lista. Assim, uma rotação é anunciada por uma chave já confiável, e uma chave removida por uma rotação não pode mais assinar manifestos. Um manifesto com `version` menor que a do aceito é rejeitado, o que impede a volta a uma política antiga [P-6.3]. Uma implantação que não pode aceitar confiança no primeiro uso fixa a chave do produtor por configuração.

Um Data indica sua chave com um `keyLocator` no formato `/idem/v1/<producer>/_key/<keyId>`, e o produtor do locator precisa ser o produtor do nome do Data. Uma chave de um produtor não pode assinar por outro [P-5.2].

## Frescor {#freshness}

Uma resposta em cache precisa deixar de ser servida em algum momento. Quem decide quando é o produtor: cada Data carrega um `freshnessMs` (seu período de frescor, *freshness*), limitado pelo `ttlMs` que o manifesto declara para a ferramenta [P-8.2].

::figure[freshness] A idade de um Data se soma em todos os caches por onde ele passou. Ele é fresco enquanto essa idade for menor que o menor valor entre freshnessMs e o ttlMs do manifesto.

Um Data que fica em um cache e depois é servido a outro não começa do zero. Cada nó soma a `ageMs` o tempo que o Data passou no seu armazenamento ao servi-lo, exatamente como o cabeçalho `Age` do HTTP (RFC 9111). No nó N, o Data é fresco enquanto [P-8.1]:

```
ageMs + (now − receivedAt) < min(freshnessMs, ttlMs)
```

`ageMs` é o único campo de um Data que não é assinado, porque cada salto precisa atualizá-lo. Por isso, esta primeira parte do frescor, a idade contada salto a salto, só vale entre nós honestos: ela não pega um nó que declara uma idade menor do que a real.

A segunda parte usa o que é assinado. Todo nó também compara o `producedAt` assinado com o seu próprio relógio. Um Data está fora do seu **tempo de vida assinado** quando qualquer uma das duas linhas vale [P-8.6]:

```
now − producedAt ≥ min(freshnessMs, ttlMs) + clockToleranceMs    (expirado)
producedAt − now > clockToleranceMs                              (datado no futuro)
```

`clockToleranceMs` é uma opção local de cada nó, de 60 segundos por padrão. Ela cobre a diferença entre o relógio do nó e o do produtor, mais o tempo em trânsito. Um forwarder não guarda um Data que está fora do seu tempo de vida assinado, e responde `EXPIRED` a um Interest que pediu Data fresco. Um consumidor também recusa um Data assim, e pergunta de novo uma vez com uma chamada comum [P-8.7].

As duas partes fazem trabalhos diferentes. A idade contada salto a salto não precisa de relógios acertados entre si, e é o que um cache honesto usa para parar de servir na hora. O tempo de vida assinado precisa de relógios que concordem dentro da tolerância, e limita o que um nó desonesto no caminho consegue fazer passar por fresco: nunca mais do que o frescor mais a tolerância. A página de [Segurança](/docs/security#limits) diz o que sobra dentro desse limite e o que um relógio errado causa.

Erros nunca vão para o cache. Um resultado com `isError: true` é assinado com `freshnessMs = 0` [P-5.3], e timeouts e falhas upstream também não são guardados: não existe cache negativo na v1 [P-7.2].

## Escopo {#scope}

Alguns resultados somente leitura são iguais para todo mundo (uma página pública). Outros dependem de quem pergunta (minhas anotações). O nome não diz quem pergunta, então o Data precisa dizer. A política de cada ferramenta declara um **escopo**, e o escopo faz parte do que o produtor assina.

::figure[scope] A borda guarda respostas privadas em uma partição por contexto de autorização. Forwarders além da borda só guardam Data público.

- Data **`public`** pode ser guardado em qualquer Content Store e servido a qualquer um.
- Data **`private`** só pode ser guardado no primeiro forwarder, a borda, e só em uma partição indexada pelo **contexto de autorização** do consumidor [P-8.3].

O `authContext` é derivado na borda, a partir da credencial do consumidor, por uma função de mão única: um HMAC com um segredo que só a borda conhece [P-8.4]. Ele nunca é a própria credencial, nunca faz parte de um nome e não é repassado além do primeiro salto. Um valor que um remetente escreve no campo `authContext` de um Interest é ignorado em todas as faces: a borda sempre deriva o seu. A credencial segue até o produtor salto a salto, como um cabeçalho HTTP `Authorization`.

O PIT segue a mesma partição. Os Interests de dois usuários para o mesmo nome privado compartilham o nome, mas não a entrada do PIT, então a resposta de um nunca é entregue ao outro enquanto os dois esperam. Um Interest privado sem contexto de autorização nunca é agregado e nunca é respondido por um cache.

Uma última verificação fecha uma brecha: se chega um Data assinado como `private` enquanto o manifesto diz que a ferramenta é `public`, o forwarder o trata como inválido em vez de entregá-lo a todos que estavam esperando [P-8.5].

> [!NOTE]
> "`private` nunca vaza" é uma das regras fixas do projeto. Há um teste para isso nas topologias em estrela e em árvore, e o sandbox tem um botão que tenta quebrá-la.

## Quando uma chamada não é IDEM {#passthrough}

O IDEM é opcional por ferramenta e conservador por chamada. Em todos estes casos a chamada segue como um `tools/call` MCP comum, sem nome, sem agregação e sem cache, e o forwarder emite `bypass`:

| Caso | Regra |
|---|---|
| O manifesto não marca a ferramenta como cacheável (por exemplo, `send_email`) | [P-4.2] |
| Os argumentos não validam, ou a normalização os tornou inválidos | [P-3.1] |
| O schema da ferramenta usa uma palavra-chave fora do subconjunto da v1 | [P-3.6] |
| O resultado é um resultado intermediário de várias idas e voltas (`input_required`) | [P-5.4] |
| O PIT está cheio | [P-7.3] |

Nada se perde quando o IDEM sai do caminho: a chamada se comporta exatamente como se não houvesse um forwarder no meio. A seguir: como essas peças são empacotadas, em [Arquitetura](/docs/architecture).
