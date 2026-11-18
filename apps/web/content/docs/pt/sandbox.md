O [sandbox](/sandbox) é onde o protocolo pode ser observado em vez de lido. Esta página não descreve onde fica cada painel, porque o layout pode ser rearranjado. Ela explica o que o sandbox *executa* e como ler o estado do protocolo que ele mostra.

Uma regra o torna confiável: o sandbox executa a **mesma** classe `Forwarder` do gateway. Só mudam os enlaces e o relógio. O que você observa é o comportamento real do protocolo, não uma encenação.

## O que dá para rodar {#modes}

O sandbox abre numa escolha: uma rede de **exemplo** (um enxame numa borda, dois produtores, uma árvore regional), uma **tela em branco**, o modo **Ao vivo**, ou a rede que você editava da última vez. Toda rede, exceto a Ao vivo, pode ser editada.

| | Uma rede no editor | Ao vivo |
|---|---|---|
| O que roda | uma rede que você monta, no seu navegador: o motor IDEM (uma simulação determinística) ou o motor NDN (roteadores NDN reais compilados para WebAssembly) | pedidos HTTP reais do seu navegador ao gateway de borda do site, que encaminha ao produtor de demonstração |
| Motor | IDEM: o mesmo `Forwarder`, na página, num relógio virtual. NDN: YaNFD, um roteador por forwarder, em tempo real | o `Forwarder` da borda, no servidor, no relógio de parede |
| Agentes | quantos você adicionar, cada um com sua lista de ferramentas | alguns consumidores na página, cada um um `IdemClient` com sua própria credencial |
| Bom para | ver agregação e cache em qualquer topologia, e comparar protocolos na mesma carga | ver que o protocolo funciona numa rede real, e verificar as assinaturas você mesmo |

Nada aqui produz um resultado do projeto. Os contadores descrevem a execução à sua frente. Os números medidos, com sementes e configurações, estão na página de [benchmarks](/benchmarks).

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

## O editor de rede {#editor}

Uma rede é feita de agentes, forwarders e produtores ligados por enlaces. **Agentes** fazem chamadas de ferramenta: cada um tem um número de chamadas, um tempo de pensar entre elas e uma lista de ferramentas dos produtores que alcança, cada uma com um peso. **Forwarders** são gateways IDEM (uma borda, um nó regional): agregam chamadas idênticas pendentes na PIT e guardam respostas assinadas no Content Store, cujo tamanho você define. **Produtores** são servidores MCP que assinam seus resultados: cada um tem um nome (que entra em todo nome de Data que assina), as ferramentas que oferece e por quanto tempo o resultado de cada uma fica fresco. **Enlaces** têm latência e taxa de perda.

Agentes se ligam só a forwarders, nunca direto a um produtor nem entre si: o forwarder é onde o IDEM agrega e guarda, então o editor recusa essas ligações e diz por quê.

| Para | Faça isto |
|---|---|
| adicionar um nó | clique em *Agente*, *Forwarder* ou *Produtor*: ele aparece ao lado do nó selecionado, já ligado (ou arraste o botão até a rede) |
| mover um nó | arraste-o. Uma execução nunca reinicia por um movimento |
| ligar dois nós | selecione um e arraste da alça azul até o outro (ou segure `Shift` e arraste a partir de um nó) |
| mudar um nó ou enlace | selecione-o e use a seção *Selecionado*. Todo campo tem um balão de informação |
| remover | selecione e aperte `Delete` |
| olhar em volta | arraste o fundo para deslocar; role, faça pinça ou use os botões para zoom; `F` enquadra a rede |
| desfazer | `⌘Z` (`⇧⌘Z` para refazer) |
| compartilhar | *Compartilhar* copia um link que carrega a rede inteira |

Quando algo impede a rede de rodar (nenhum agente, um agente sem ferramentas, uma ferramenta cujo produtor ele não alcança), a seção *Execução* lista.

### O motor IDEM {#idem-engine}

O motor IDEM roda a rede no `@idem/sim`: as chamadas dos agentes, sobre enlaces virtuais, com um relógio virtual. Tudo deriva de uma **semente**, então a mesma rede e a mesma semente dão a mesma execução, evento por evento. Qualquer mudança, exceto mover um nó, reinicia a execução.

Sua visão mais útil é a **comparação**: a mesma carga, com a mesma semente, roda uma vez por protocolo marcado, lado a lado. Os agentes pedem exatamente as mesmas coisas nos mesmos instantes, então o que difere entre os painéis é o protocolo.

| Protocolo | O que acontece com uma chamada |
|---|---|
| `mcp-direct` | vai direto ao produtor. Nada é guardado |
| `mcp-local-cache` | cada agente lembra as próprias respostas. Uma repetição do mesmo agente é local; a de outro agente vai ao produtor |
| `idem` | passa pelos forwarders: agregada numa PIT, respondida por um CS, ou encaminhada |

### O motor NDN {#ndn-engine}

O motor NDN roda a mesma rede em roteadores NDN reais: cada forwarder é uma instância do YaNFD (o forwarder do ndnd, do projeto NDN), compilado para WebAssembly e rodando nesta aba. Produtores e agentes falam o binding nativo (`@idem/ndn`): Interests e Data são pacotes NDN TLV, e os agentes verificam as duas assinaturas de cada resposta. Roda em tempo real, então os períodos de frescor passam de verdade. Os roteadores encaminham e guardam, mas não verificam assinaturas, e chamadas a ferramentas `private` ou com efeito colateral nunca viajam no NDN. O roteador é baixado na primeira vez que você escolhe este motor.

### O que as configurações mudam {#controls}

| Configuração | O que define | O que observar |
|---|---|---|
| Chamadas (agente) | o tamanho da carga de um agente | uma execução mais longa dá tempo ao Content Store de encher e compensar |
| Páginas compartilhadas (agente) | a parte das chamadas `fetch_page` tirada de um catálogo que todos os agentes compartilham | em zero, os agentes nunca pedem a mesma página e um cache compartilhado não tem o que compartilhar |
| Concentração da popularidade (agente) | quão concentrada é a popularidade desse catálogo (α de Zipf) | mais concentração põe os pedidos em poucos nomes |
| Ferramentas e pesos (agente) | quais ferramentas chama, em qual produtor, com que frequência | `my_notes` é privada, `send_email` tem efeito colateral: nenhuma é compartilhada |
| Content Store (forwarder) | o orçamento em bytes do store | um store pequeno despeja (`cs_evict`) antes de as entradas serem reusadas |
| Fresco por (produtor) | o frescor que o manifesto permite por ferramenta | um frescor curto transforma acertos posteriores em faltas |
| Tempo de serviço (produtor) | quanto ele leva para rodar uma ferramenta | um produtor lento deixa Interests pendentes por mais tempo, e mais deles agregam |
| Latência (enlace) | o atraso num sentido do enlace | espalha a chegada de pedidos idênticos a um forwarder |
| Perda (enlace) | a parte dos pacotes que o enlace descarta | pacotes perdidos aparecem como timeouts e novas tentativas |
| Semente | a origem de toda escolha aleatória | a mesma semente repete a mesma execução |
| Velocidade | quão rápido o tempo virtual avança na tela | muda a animação, nunca o resultado |

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
| `Espaço` | uma rajada (ao vivo) · executar ou pausar (editor) |
| `R` | reinicia a execução (editor) |
| `Delete` | remove o nó ou enlace selecionado (editor) |
| `⌘Z`, `⇧⌘Z` | desfazer, refazer (editor) |
| `F` | enquadra a rede (editor) |
| `Esc` | fecha a lista de atalhos, limpa o destaque e a seleção; na alça de uma janela, fecha essa janela |
| `←` `↑` `→` `↓` | move uma janela, pela alça na barra de título (`Shift` para passos maiores) |
| `Alt` + `←` `↑` `→` `↓` | redimensiona uma janela, pela mesma alça |
| `Tab`, depois `←` `→` | alcança os agentes e forwarders do palco (uma parada de Tab); `Enter` age como um clique |
| `?` | mostra a lista de atalhos |

Ele também respeita a preferência do sistema por movimento reduzido: pacotes e painéis então mudam de estado sem viajar nem quicar, e uma simulação não começa sozinha.
