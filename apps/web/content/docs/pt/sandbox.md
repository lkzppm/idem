O [sandbox](/sandbox) é onde o protocolo pode ser observado em vez de lido. Esta página não descreve onde fica cada painel, porque o layout pode ser rearranjado. Ela explica o que o sandbox *executa* e como ler o estado do protocolo que ele mostra.

Uma regra o torna confiável: o sandbox executa a **mesma** classe `Forwarder` do gateway. Só mudam os enlaces e o relógio. O que você observa é o comportamento real do protocolo, não uma encenação.

## Dois modos {#modes}

| | Ao vivo (Live) | Enxame (Swarm) |
|---|---|---|
| O que roda | requisições HTTP reais do seu navegador ao gateway de borda do site, que encaminha ao produtor de demonstração | uma simulação determinística, inteira no seu navegador |
| Motor | o `Forwarder` da borda, no servidor, no relógio real | o mesmo `Forwarder`, na página, em um relógio virtual |
| Agentes | alguns consumidores na página, cada um um `IdemClient` com a sua credencial | quantos agentes simulados você definir |
| Tempo | real: um período de frescor precisa passar de verdade | virtual: a execução salta de evento em evento, na velocidade que você escolher |
| Serve para | ver que o protocolo funciona sobre uma rede real, e verificar as assinaturas você mesmo | ver agregação e cache em escala, e comparar modos na mesma carga |

Nenhum dos dois modos produz um resultado do projeto. Os contadores descrevem a execução que está na sua frente. Os números medidos, com suas sementes e configurações, estão na página de [resultados](/results).

### Ao vivo {#live}

No modo ao vivo, todo pacote que você vê atravessou uma rede real. Uma chamada a uma ferramenta cacheável sai da página como um Interest (`POST /idem/v1/interest`), a borda responde pelo seu Content Store ou encaminha, e a página verifica a assinatura do produtor no que volta antes de mostrar.

O produtor de demonstração serve cinco ferramentas sobre um pequeno corpus versionado junto com o site. Ele nunca busca nada na internet.

| Ferramenta | Política | O que mostra |
|---|---|---|
| `fetch_page(url)` | cacheável, `public`, `url:sortQuery` | duas grafias de uma URL recebem um só nome |
| `search_corpus(query, limit)` | cacheável, `public`, `trim` + `lowercase` | normalizadores em texto, um default aplicado |
| `weather(city)` | cacheável, `public`, TTL curto | uma resposta que vence e é pedida de novo |
| `my_notes()` | cacheável, `private` | um nome, uma resposta diferente por credencial, nunca compartilhada |
| `send_email(to, body)` | não cacheável | um efeito colateral: sempre passa direto (`bypass`) |

> [!NOTE]
> Em produção, o Content Store da borda fica na memória de uma instância de função. Se o seu pedido cair em outra instância, uma chamada que você esperava acertar vai faltar. Isso é a implantação, não o protocolo.

### Enxame {#swarm}

O modo enxame executa o `@idem/sim`: agentes simulados fazem chamadas de ferramenta sobre enlaces virtuais, com um relógio virtual. Tudo é derivado de uma **semente**, então a mesma semente com os mesmos ajustes dá a mesma execução, evento por evento, e uma execução pode ser compartilhada pelo seu endereço.

Sua visão mais útil é a **comparação**: a mesma carga, com a mesma semente, roda em mais de um modo, sempre `mcp-direct` e `idem`, e também `mcp-local-cache` quando a opção de rodar o MCP com um cache local por agente está marcada. Os agentes pedem exatamente as mesmas coisas, exatamente nos mesmos instantes, então o que diferir entre as execuções é o protocolo.

| Modo | O que acontece com uma chamada |
|---|---|
| `mcp-direct` | vai direto ao produtor. Nada é guardado em cache |
| `mcp-local-cache` | cada agente lembra as próprias respostas. A repetição do mesmo agente é local; a repetição de outro agente vai ao produtor |
| `idem` | vai ao forwarder de borda compartilhado: é agregada no PIT, respondida pelo CS ou encaminhada |

## O que os controles mudam {#controls}

Cada controle é um parâmetro da carga, da rede ou do cache. Mudar um deles e observar o que se move é o caminho mais rápido para criar intuição.

| Controle | O que define | O que observar |
|---|---|---|
| Agentes | quantos consumidores fazem chamadas | mais agentes, mais pedidos idênticos em trânsito ao mesmo tempo |
| Chamadas por agente | o tamanho da carga de cada agente | uma execução mais longa dá tempo ao Content Store de encher e compensar |
| Sobreposição entre agentes | a parte dos pedidos de cada agente tirada de um conjunto comum a todos | em zero, os agentes nunca pedem a mesma coisa e um cache compartilhado não tem o que compartilhar |
| Zipf α | o quanto a popularidade é concentrada dentro do catálogo | um α maior concentra os pedidos em poucos nomes |
| Tamanho do catálogo | quantas páginas distintas existem | um catálogo pequeno se repete mais cedo |
| TTL | o frescor que o manifesto do produtor permite | um TTL curto transforma acertos posteriores de volta em faltas |
| Tamanho do CS | o orçamento em bytes do Content Store | um armazenamento pequeno remove entradas (`cs_evict`) antes de elas serem reutilizadas |
| Latência agente ↔ borda | o atraso dos enlaces dos agentes | espalha no tempo a chegada de pedidos idênticos à borda |
| Latência borda ↔ produtor | o atraso do enlace até o produtor | um enlace lento até o produtor deixa os Interests pendentes por mais tempo, e mais deles se agregam |
| Perda no enlace | a parte dos pacotes que um enlace descarta | pacotes perdidos aparecem como timeouts e novas tentativas |
| Chamadas privadas | a parte das chamadas a `my_notes` | são particionadas por agente e nunca compartilhadas |
| Chamadas com efeito colateral | a parte das chamadas a `send_email` | sempre passam direto |
| Topologia | estrela (uma borda) ou árvore (bordas e um forwarder regional) | em uma árvore, acertos também podem acontecer além da borda |
| Semente | a origem de toda escolha aleatória | a mesma semente repete a mesma execução |
| Velocidade | o quão rápido o tempo virtual avança na tela | muda a animação, nunca o resultado |

## Como ler o estado {#reading}

### Pacotes e cores {#colors}

As duas cores significam a mesma coisa em todo o site. **Azul é um Interest**: um pedido indo em direção ao produtor. **Amarelo é Data**: uma resposta assinada voltando. Um enlace com azul indo e ainda nenhum amarelo voltando é uma pergunta em aberto.

### O PIT {#pit}

A Pending Interest Table lista os nomes que foram pedidos e ainda não respondidos, com o número de faces que esperam por cada um. Leia como "perguntas em trânsito".

- Uma entrada aparece quando um forwarder envia um Interest adiante (`upstream_out`).
- Sua contagem cresce quando outro Interest para o mesmo nome chega antes da resposta (`pit_aggregate`). Cada incremento é um pedido que não seguiu adiante.
- Ela some quando o Data chega e é entregue a todas as faces em espera (`pit_satisfy`), ou quando seu tempo de vida acaba (`pit_expire`).

Um nome `private` pode aparecer mais de uma vez na tabela, uma entrada por contexto de autorização. É a partição funcionando: as duas entradas compartilham o nome e nada mais.

### O Content Store {#cs}

O Content Store lista Data assinado por nome, com quanto resta do seu frescor. Leia como "respostas à mão".

- Uma entrada aparece depois que um Data foi verificado (`verify_ok`, depois `cs_insert`).
- Uma entrada fresca responde a um Interest na hora (`cs_hit`). O produtor não é consultado.
- Uma entrada que passou do seu frescor deixa de ser servida. O próximo Interest para aquele nome segue adiante de novo.
- Quando o orçamento em bytes enche, a política de substituição remove uma entrada (`cs_evict`).

### O log de eventos {#log}

O log é o fluxo de eventos do forwarder, sem edição. Todo contador da página é derivado dele, e as métricas dos experimentos também. A história de um pedido se lê de cima para baixo:

| Você vê | Significa |
|---|---|
| `interest_in` → `upstream_out` | uma falta: a pergunta foi para o próximo salto |
| `interest_in` → `pit_aggregate` | a mesma pergunta já estava em trânsito: esta espera a mesma resposta |
| `interest_in` → `cs_hit` | respondida pelo cache |
| `data_in` → `verify_ok` → `cs_insert` → `pit_satisfy` | uma resposta chegou, foi conferida, guardada e entregue |
| `verify_fail` | um Data não bateu com a sua assinatura ou com o digest do seu conteúdo e foi recusado |
| `bypass` | uma chamada que não é IDEM (uma ferramenta não cacheável, por exemplo) passou intacta |
| `drop` | algo foi descartado; o motivo está no evento |
| `pit_expire` | ninguém respondeu a tempo; quem esperava recebeu `TIMEOUT` |

### Os contadores {#counters}

| Contador | Definição |
|---|---|
| Chamadas upstream | pedidos que chegaram ao produtor |
| Taxa de acerto do CS | `cs_hit` sobre os Interests cacheáveis que chegaram à borda |
| Agregações no PIT | Interests que entraram em uma entrada em vez de seguir adiante |
| Bytes no enlace do produtor | bytes que atravessaram o enlace até o produtor |
| Latência p50, p95 | por chamada, como o consumidor a viu |
| Falhas de verificação | Data recusado em um forwarder ou em um consumidor. Fora de um ataque, fica em zero |
| Novas tentativas | chamadas enviadas de novo depois de um timeout ou de uma resposta recusada |
| Violações de segurança | ataques que passaram: uma resposta adulterada aceita, uma resposta privada servida a outro agente. Precisa ficar em zero |

### Um pacote, inspecionado {#packet}

Abrir um pacote mostra os objetos do protocolo como eles são. Para um Interest: o nome, dividido em seus componentes, e os argumentos canônicos. Para um Data: o conteúdo, o `meta` assinado (digest do conteúdo, `producedAt`, `freshnessMs`, escopo, versão da política), a assinatura com o seu key locator, e o `ageMs`, não assinado. No modo ao vivo, a página recalcula os digests e verifica a assinatura no seu navegador: a conferência não depende de confiar no site.

## Os ataques {#attacks}

Três controles tentam quebrar o protocolo de propósito. Cada um precisa terminar em uma rejeição visível.

| Ataque | O que faz | O que precisa acontecer |
|---|---|---|
| Adulterar um Data | altera o conteúdo de uma resposta em trânsito | a verificação falha (`verify_fail`, `BAD_SIGNATURE`); a resposta alterada não é guardada nem mostrada, e a chamada é refeita sem caches |
| Forjar um args digest | envia um Interest cujos argumentos não batem com o nome | o forwarder o descarta com `DIGEST_MISMATCH` |
| Pedir o resultado privado de outro usuário | um consumidor pede um nome `private` logo depois de outro | cada um recebe a própria resposta; a entrada em cache do primeiro fica na partição dele |

A regra por trás de cada rejeição está na página de [Segurança](/docs/security#attacks). As mesmas tentativas, contadas ao longo de muitas execuções, são o experimento E5 da [Avaliação](/docs/evaluation#e5).

## Janelas {#windows}

O estado do protocolo fica em seis janelas sobre a rede: **Log de eventos**, **PIT e CS**, **Inspetor de pacotes**, **Métricas**, **Comparar** e **Segurança**. Arraste uma pela barra de título, clique duas vezes na barra para recolhê-la, redimensione pelo canto e feche ou reabra pela barra lateral; o layout fica guardado neste navegador, e *Arrumar* devolve cada janela ao lugar. Clicar em um forwarder abre as suas tabelas, e clicar em uma chamada ou em um nome no log abre o inspetor. No celular, as janelas viram abas de uma folha embaixo da rede.

## Teclado e movimento {#access}

O sandbox pode ser operado sem ponteiro:

| Tecla | O que faz |
|---|---|
| `1`–`6` | abre ou fecha uma janela, na ordem acima |
| `Espaço` | uma rajada (ao vivo) · executar ou pausar (enxame) |
| `R` | reinicia a execução (enxame) |
| `Esc` | fecha a lista de atalhos, limpa o destaque; na alça de uma janela, fecha essa janela |
| `←` `↑` `→` `↓` | move uma janela, pela alça na barra de título (`Shift` para passos maiores) |
| `Alt` + `←` `↑` `→` `↓` | redimensiona uma janela, pela mesma alça |
| `Tab`, depois `←` `→` | alcança os agentes e forwarders do palco (uma parada de Tab); `Enter` age como um clique |
| `?` | mostra a lista de atalhos |

Ele também respeita a preferência do sistema por movimento reduzido: pacotes e painéis então mudam de estado sem viajar nem quicar, e uma simulação não começa sozinha.
