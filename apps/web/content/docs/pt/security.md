Um cache que qualquer um no caminho pode preencher é um risco, a menos que toda resposta possa ser conferida. A segurança do IDEM se apoia em um movimento: **a confiança está no dado, não no caminho**. Esta página lista o que pode ser tentado contra ele, a regra que barra cada tentativa e o que a versão 1 deixa em aberto de forma consciente. O texto que vale é a [seção 11 do protocolo](/docs/protocol#s11) e as regras que ela cita.

## Em quem se confia, e para quê {#model}

| Parte | Confia-se para | Não se confia para |
|---|---|---|
| **Produtor** | executar a ferramenta, dizer o que é cacheável, assinar suas respostas | falar por outro produtor |
| **Forwarder** | encaminhar, agregar e guardar em cache | alterar uma resposta, decidir o que é cacheável, ver o resultado privado de outro usuário |
| **Consumidor** | perguntar, e verificar o que recebe | ser outra pessoa: seu contexto de autorização é derivado na borda, não declarado por ele |
| **O caminho** (enlaces, outros inquilinos) | nada | qualquer coisa |

Um forwarder é um ajudante não confiável. Se ele se comportar mal, o pior que pode fazer a um consumidor que verifica é deixar de responder.

## Ataques e a regra por trás de cada defesa {#attacks}

### Envenenar um cache {#poisoning}

*A tentativa:* fazer uma resposta errada ser guardada em um Content Store, para que consumidores posteriores a recebam.

*A defesa:* um Data é assinado sobre o seu nome e sobre um digest do seu conteúdo. Um forwarder verifica a assinatura e o digest do conteúdo **antes** de inserir no CS [P-7.1], então um Data forjado ou alterado nunca vira uma entrada de cache. A verificação só pode ser desligada por uma flag de experimento, que existe para medir o seu custo. Um Data que ninguém pediu nem chega a ser considerado: ele só é aceito vindo da face para a qual o Interest foi enviado, e para o mesmo nome ([seção 4.1 do protocolo](/docs/protocol#s4-1)).

### Adulterar uma resposta em trânsito {#tampering}

*A tentativa:* mudar o conteúdo de um Data entre o produtor e o consumidor, ou entre dois forwarders.

*A defesa:* o consumidor verifica a assinatura e o digest do conteúdo antes que o agente veja o resultado [P-5.5]. Uma divergência é `BAD_SIGNATURE`, e o consumidor pergunta de novo com uma chamada comum, que nenhum cache responde. Essa segunda resposta precisa trazer uma assinatura para o mesmo nome e passar pela mesma verificação; se não, a chamada falha e o agente recebe um erro, nunca o conteúdo sem verificação. A mesma verificação em cada forwarder faz um Data adulterado parar no primeiro salto honesto, e todos os que esperavam naquela entrada do PIT recebem um erro e tentam de novo.

### Repetir uma resposta antiga {#replay}

*A tentativa:* quem está no caminho de um Interest, um forwarder ou um atacante em um enlace sem TLS, responde com um Data genuíno que já passou do seu frescor: um que gravou antes, ou um cuja idade declara menor do que é. A assinatura é válida, porque o Data é do próprio produtor.

*A defesa:* duas regras, porque a idade que um Data carrega não pode ser assinada. Salto a salto, cada nó conta a idade a partir do momento em que recebeu o Data e a soma ao `ageMs`, que muda a cada salto e por isso fica fora da assinatura. Um cache honesto nunca serve uma cópia que passou do seu frescor [P-8.1], mas essa regra só obriga os nós honestos. A segunda regra usa o que é assinado: todo nó compara o `producedAt` com o seu próprio relógio. Um Data está fora do seu **tempo de vida assinado** quando é mais velho que o seu frescor mais uma tolerância de relógio, ou quando está datado no futuro além da tolerância. A tolerância é uma opção local de cada nó, `clockToleranceMs`, de 60 segundos por padrão [P-8.6]. Um forwarder não guarda um Data assim em cache e responde `EXPIRED` a todos os que esperavam e pediram Data fresco. Um consumidor também o recusa, julgando pelo seu próprio relógio, e pergunta de novo uma vez com uma chamada comum, que nenhum cache responde [P-8.7]. Isso limita o replay e não o elimina: veja [abaixo](#limits).

### Forjar um nome {#forgery}

*A tentativa:* enviar um Interest cujo nome diz uma coisa e cujos argumentos dizem outra, esperando que a resposta aos argumentos seja guardada sob o nome.

*A defesa:* todo forwarder recalcula o args digest a partir dos argumentos e descarta o Interest se ele não bater com o nome, com `DIGEST_MISMATCH` [P-4.3]. O produtor vai além: nunca copia o nome do Interest, calcula o nome ele mesmo a partir dos argumentos que recebeu [P-5.1].

### Assinar com a chave de outro {#keys}

*A tentativa:* assinar um Data do produtor A com uma chave que pertence ao produtor B, ou com uma chave que ninguém endossou.

*A defesa:* o `keyLocator` do Data precisa indicar o mesmo produtor do nome do Data, e a chave precisa ser uma que o manifesto confiável daquele produtor lista e que não expirou. Caso contrário, o resultado é `UNTRUSTED_KEY` [P-5.2].

### Substituir o manifesto {#manifest}

*A tentativa:* apresentar um manifesto que marca como cacheável uma ferramenta perigosa, lista a chave do atacante ou ressuscita uma política antiga.

*A defesa:* um manifesto só é aceito se estiver assinado por uma chave que ele lista **e** se essa chave já for confiável para o produtor, por estar fixada ou listada no manifesto aceito no momento [P-6.2]. Todo key id listado precisa ser o thumbprint da sua chave. Um manifesto com versão menor que a do aceito é rejeitado [P-6.3]. A exceção é o primeiro contato, discutido [abaixo](#limits).

### Ler o resultado de outro usuário {#leakage}

*A tentativa:* o usuário B pede um nome cuja resposta foi guardada para o usuário A e recebe os dados de A. Ou o Interest de B chega enquanto o de A está pendente, e B é acrescentado à entrada de A no PIT.

*A defesa:* o escopo é declarado no manifesto e assinado dentro de cada Data. Data `private` só é guardado na borda, em uma partição do Content Store indexada pelo contexto de autorização, e o PIT é particionado do mesmo jeito [P-8.3]. A borda deriva ela mesma o contexto de autorização, com uma função de mão única com chave sobre a credencial que chegou com o pedido e um segredo seu. Ela ignora qualquer `authContext` escrito em um Interest que recebe, em todas as faces; assim, um consumidor que conhece o valor de outro usuário não consegue usá-lo para ler a partição dele. O valor nunca passa do primeiro salto [P-8.4]. Um Data assinado como `private` para uma ferramenta que o manifesto chama de `public` é rejeitado em vez de ser entregue a uma entrada compartilhada [P-8.5]. No MCP, em contraste, `cacheScope` é um rótulo do qual os servidores são orientados a não depender para controle de acesso [MCP-CACHE].

### Guardar em cache o que não devia {#hints}

*A tentativa:* um servidor, ou algo que se passa pela sua lista de ferramentas, marca uma ferramenta com `readOnlyHint: true` para que uma chamada que altera estado seja respondida por um cache.

*A defesa:* as anotações do MCP não são confiáveis e nunca bastam. Uma chamada só é cacheável se o manifesto **assinado** do produtor disser que é, se a anotação concordar e se o schema digest do manifesto bater com a lista de ferramentas que o consumidor vê [P-6.1].

### Fundir duas perguntas diferentes {#merging}

*A tentativa:* montar argumentos que uma normalização "prestativa" faria cair no nome de outro pedido.

*A defesa:* ninguém normaliza por conta própria. Só são aplicados os normalizadores que o produtor declarou no seu manifesto assinado [P-3.3], e toda implementação valida contra o mesmo subconjunto fixo de JSON Schema, de modo que todos os nós concordam sobre quais argumentos são válidos e, portanto, sobre os nomes [P-3.6].

### Esgotar um forwarder {#dos}

*A tentativa:* inundar um forwarder com Interests para nomes distintos, para que suas tabelas cresçam sem limite, ou fazer um Interest circular para sempre.

*A defesa:* o PIT limita suas entradas e as faces por entrada; além disso, um Interest é encaminhado sem estado [P-7.3]. O Content Store tem um orçamento em bytes [P-7.4]. Todo Interest carrega um limite de saltos, que cada forwarder decrementa, e um nonce que revela laços [P-4.4]. Erros nunca são guardados em cache, então uma falha não pode ser amplificada em uma falha em cache [P-7.2].

## Como as defesas são conferidas {#checked}

- **Testes.** As regras MUST do protocolo têm testes que citam o id da regra no nome. O teste de isolamento de `private` roda nas topologias em estrela e em árvore e não pode ser removido nem pulado.
- **O sandbox.** Seus controles de ataque adulteram um Data em trânsito, enviam um Interest com args digest forjado e pedem o resultado privado de outro usuário. Cada tentativa precisa ser rejeitada de forma visível. Veja [Como usar o sandbox](/docs/sandbox#attacks).
- **Experimento E5.** Uma bateria adversarial repete essas tentativas, acrescenta outras e relata quantas foram rejeitadas. Cada variante é rotulada de antemão com o que o protocolo diz dela: uma afirmação que precisa valer, um limite documentado ou um vazamento conhecido. Veja [Avaliação](/docs/evaluation#e5).
- **Os mesmos ataques contra um cache em que se confia.** O E5 também roda três dos ataques contra o baseline B5 da avaliação, um cache de respostas compartilhado no gateway, sem assinaturas, do jeito que os produtos que guardam resultados de ferramenta em cache o entregam hoje: um resultado guardado que é reescrito dentro do cache, um resultado reescrito entre o produtor e o gateway, e uma ferramenta por usuário listada como cacheável em um cache indexado por ferramenta e argumentos. O mesmo juiz decide cada tentativa pela verdade de referência. Essas linhas não são afirmações sobre o IDEM. Cada uma aparece ao lado da variante do IDEM que enfrenta o mesmo ataque, e o resultado está na página de [benchmarks](/benchmarks).

## O que a versão 1 deixa em aberto {#limits}

Estes pontos são conhecidos e declarados, não esquecidos.

- **Tempo de resposta.** Uma resposta rápida revela que alguém já pediu aquele nome. Está registrado como risco (questão Q3 nas [decisões](/docs/decisions)); uma mitigação, como um atraso aleatório para nomes `private`, fica fora da v1.
- **Os argumentos são visíveis para o caminho.** O Interest carrega os argumentos, porque o produtor precisa deles. No overlay HTTP cada salto é protegido por TLS, mas todo forwarder do caminho os lê. O nome expõe só um digest.
- **Conteúdo privado não é cifrado.** A borda que guarda um Data `private` consegue lê-lo. Cifrar conteúdo privado para que caches compartilhados possam guardá-lo é trabalho futuro (Q2).
- **Primeiro contato.** Confiança no primeiro uso quer dizer que o primeiro manifesto visto de um produtor é aceito. Uma implantação que não pode aceitar isso fixa a chave do produtor por configuração.
- **Defasagem limitada.** O tempo de vida assinado limita um replay; não o elimina. Um Data genuíno mais novo que o seu frescor mais a tolerância de relógio é aceito, e um forwarder pode guardá-lo e servi-lo até esse limite, nunca depois [P-8.6]. A tolerância é, portanto, o máximo que alguém no caminho consegue esticar a vida de um Data. Perto de um TTL curto, o padrão de 60 segundos é grande, e quem implanta escolhe o valor levando isso em conta. Essa parte continua sem conseguir mudar o conteúdo, responder sob outro nome ou injetar algo de fora do caminho. O experimento de segurança mede os dois lados: um replay fora do tempo de vida, que precisa ser recusado, e um replay dentro da tolerância, que ele relata como aceito por projeto (ADR-034 nas [decisões](/docs/decisions)).
- **Os relógios precisam concordar.** O tempo de vida assinado exige que o relógio do produtor e o de cada verificador concordem dentro da tolerância. Um nó cujo relógio está adiantado em mais do que o frescor mais a tolerância vê como expirada até uma resposta recém-assinada. Um nó cujo relógio está atrasado em mais do que a tolerância a vê como datada no futuro. Os dois falham fechados: um forwarder responde `EXPIRED`, e um consumidor cuja nova tentativa por chamada comum passa na verificação mas continua fora do tempo de vida faz a chamada falhar com o erro local `CLOCK_SKEW`. A mensagem desse erro traz o `producedAt`, a hora local e qual lado da janela foi perdido. Não há como distinguir um relógio errado de um replay no caminho da nova tentativa; por isso, nos dois casos nenhum conteúdo chega ao agente [P-8.7]. Um relógio atrasado em menos do que a tolerância aceita um Data por esse tanto a mais.
- **Um proxy que assina por um servidor legado.** Um operador pode colocar um proxy-producer na frente de um servidor MCP que não fala IDEM, a origem. Ele está implementado em `@idem/mcp` como `createProxyProducer` (ADR-038). O proxy é um produtor com o seu próprio nome e a sua própria chave, e nunca assina sob o nome da origem [P-9.5]. A confiança passa para o proxy, e todo Data diz isso no seu nome e no seu key locator. Um consumidor que verifica um Data assinado pelo proxy fica sabendo que quem tem a chave do proxy garante que aquele conteúdo respondeu àquela chamada, com aquele frescor e aquele escopo, e que nenhum nó entre o proxy e o consumidor o alterou. Ele não fica sabendo que a origem produziu o conteúdo, nem que a ferramenta da origem é mesmo somente leitura: o proxy poderia ter inventado qualquer uma das duas coisas. A política de cache é do operador, por ferramenta. Uma ferramenta que a origem marca com `readOnlyHint: false` não pode ser oferecida como cacheável, e uma ferramenta sem a anotação só pode quando o operador afirma isso de forma explícita [P-9.6]. Uma ferramenta `public` nunca é chamada com a credencial do usuário final [P-9.7]. Quando a origem muda uma ferramenta, o proxy para de assinar essa ferramenta até reler a lista de ferramentas da origem [P-9.8]. Há uma lacuna conhecida: forwarders e consumidores leem um manifesto uma vez só; então, depois de uma mudança dessas, uma borda que não foi reiniciada responde `NOT_CACHEABLE` ou `DIGEST_MISMATCH` para aquela ferramenta.
- **A chave de demonstração.** Quando a implantação de demonstração não tem chave configurada, o produtor assina com uma chave derivada de uma semente pública, para que todas as instâncias assinem igual. Qualquer um pode forjar Data para essa chave. Ela demonstra o mecanismo e não protege nada.
