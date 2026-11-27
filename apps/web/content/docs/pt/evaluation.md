Esta página é o método: o que é comparado, com quais cargas de trabalho, com quais métricas, em quais experimentos. Ela **não traz resultados**. Números só são publicados na página de [benchmarks](/benchmarks), e só depois que uma execução versionada os produziu.

## A regra sobre números {#rule}

Todo número que este projeto publica, neste site, no README ou no relatório, vem de um único pipeline. Uma execução é versionada em `experiments/results/<experiment>/<run-id>/` com tudo o que é preciso para repeti-la:

| Arquivo | Conteúdo |
|---|---|
| `config.json` | a configuração completa da execução |
| `metrics.csv` | as métricas medidas |
| `events.jsonl.gz` | o fluxo de eventos do forwarder (opcional) |
| `seed` | a semente de onde saiu toda escolha aleatória |
| `git-sha` | a revisão do código que rodou |
| `env.json` | versões do runtime e CPU |

Nenhuma página mostra uma estimativa, uma meta ou um valor ilustrativo no lugar de uma medição. Onde ainda não existe uma execução, a página diz isso.

## Hipóteses {#hypotheses}

As hipóteses foram escritas antes dos experimentos, de uma forma que pode falhar. Uma hipótese refutada com método correto é um resultado válido e é relatada como refutada, com os dados.

| | Hipótese | Testada por |
|---|---|---|
| **H1**, redundância | Em cargas de enxame com sobreposição entre subagentes, o IDEM reduz as chamadas que chegam ao produtor, em comparação com MCP direto e com um cache dentro de cada agente | E2 |
| **H2**, latência | A latência por chamada cai quando há um acerto no CS ou uma agregação no PIT, e o custo extra em uma falta (canonicalizar, assinar, verificar) é pequeno perto da ida e volta até o produtor | E1, E2 |
| **H3**, segurança | Nenhuma resposta adulterada é aceita e nenhum resultado `private` é servido a outro contexto | E5 |
| **H4**, rede | Sob perda e com vários saltos, o cache no caminho reduz os bytes no enlace do produtor e o tempo de recuperação, em comparação com TCP/HTTP fim a fim | E4 |
| **H5**, o que o protocolo acrescenta a um cache compartilhado | Contra um cache compartilhado de correspondência exata no gateway, sem assinaturas, sem canonicalização declarada pelo produtor e sem agregação de chamadas em andamento (modo B5): (a) o IDEM manda menos chamadas upstream quando os argumentos variam na grafia ou quando chamadas idênticas estão em andamento ao mesmo tempo, e o mesmo número quando nenhuma das duas coisas acontece; (b) um resultado alterado no cache ou no caminho até ele é aceito pelos consumidores do B5 e rejeitado pelos do IDEM | E2, E5 |
| **H6**, rajadas vindas de código | Quando os agentes emitem suas chamadas a partir de código, em rajadas, em vez de uma por turno do modelo, a parcela dos pedidos cacheáveis absorvida pela agregação do PIT cresce com o tamanho da rajada e com o quanto os inícios dos agentes coincidem, e a redução upstream do IDEM sobre o B5 cresce junto | E2 |

## Modos comparados {#modes}

A mesma carga roda em cada modo. Três deles são linhas de base sem IDEM.

::figure[modes] Os três modos principais. O cache local é a linha de base mais forte que não muda nada na rede: ele pega um agente se repetindo, e perde um agente repetindo outro.

| Id | Modo | Descrição |
|---|---|---|
| B0 | `mcp-direct` | cada agente chama o produtor diretamente, como faz o MCP 2026-07-28: `tools/call` não é guardado em cache |
| B1 | `mcp-local-cache` | cada agente mantém o próprio cache de resultados, por correspondência exata |
| B2 | `idem` | agentes → um forwarder de borda com PIT e CS → produtor |
| B3 | `idem-tree` | agentes → borda → forwarder regional → produtor (vários saltos) |
| B4 | `idem-noverify` | B2 com a verificação antes do cache desligada, **só** para isolar quanto a verificação custa |
| B5 | `mcp-gateway-cache` | MCP comum com um cache de respostas compartilhado na borda, sem assinatura e por correspondência exata, do jeito que os produtos que guardam `tools/call` em cache o entregam |

B1 importa. Comparar o IDEM só com "nenhum cache" daria ao protocolo o crédito de ganhos que qualquer cache dá. A diferença que interessa é entre um cache que pertence a cada agente e um que o caminho compartilha. B4 nunca é uma opção de implantação: [P-7.1] só permite desligar a verificação como flag de experimento.

O B5 existe porque a primeira pergunta sobre o IDEM é o que ele dá que um cache no gateway não dá. O B5 modela esse cache como ele é entregue, nem enfraquecido nem melhorado [FASTMCP-CACHE] [MCP-PROXY] [CONTEXTFORGE-CACHE]. É MCP comum de ponta a ponta: sem nomes, sem assinaturas, e nada é verificado. A borda mantém um cache compartilhado por todos os seus agentes, indexado por produtor, ferramenta e pelos argumentos como foram enviados, serializados com as chaves ordenadas. A ordem das chaves, portanto, não importa, e qualquer outra diferença de grafia importa, porque nenhuma normalização declarada pelo produtor é aplicada. Duas chamadas idênticas que não encontram entrada enquanto as duas estão em andamento vão ambas upstream: o cache não as funde. O modelo é generoso onde a comparação, de outro modo, seria sobre configuração. Ele guarda exatamente as ferramentas que o manifesto do produtor marca como cacheáveis, com o TTL do manifesto, e tem o orçamento em bytes e a política de substituição do Content Store. Uma ferramenta `public` tem uma entrada compartilhada por todos os agentes. Uma ferramenta `private` tem uma entrada por credencial de quem chama, a partição por token da chave do FastMCP, e assim o B5 ganha as mesmas repetições por usuário que a borda do IDEM. O que sobra entre o B5 e o B2 é o que o protocolo acrescenta: canonicalização declarada pelo produtor, agregação das chamadas em andamento e assinaturas (ADR-036).

## Cargas de trabalho {#workloads}

- **W-syn, sintética.** Um conjunto de agentes, cada um fazendo um número de chamadas sobre um catálogo de páginas. A popularidade dentro do catálogo segue uma distribuição Zipf com expoente α. Um parâmetro explícito de **sobreposição entre agentes** define a fração dos pedidos de cada agente tirada de um conjunto comum a todos; o resto é próprio do agente. Cada varredura move um parâmetro a partir de um ponto base comum: o número de agentes em 1, 2, 4, 8, 16 e 32, a sobreposição, o TTL, o tamanho do Content Store, o tempo de reflexão, ou a variação de grafia dos argumentos. O ponto base é um conjunto de suposições sobre um enxame, escrito nas configurações em `experiments/configs/`; nenhuma foi ajustada a partir de resultados.
- **W-trace, gravada.** Traces de chamadas de ferramenta gravados de um enxame real de agentes no experimento E3, guardados em JSON Lines com o instante, o agente, a ferramenta, os argumentos e o tamanho do resultado de cada chamada. Os argumentos são mantidos como o modelo os escreveu, então a canonicalização é exercitada com variação de grafia real. Nenhum trace assim foi gravado ainda: veja [E3](#e3).
- **W-mixed.** Uma carga com uma fração de chamadas não cacheáveis (`send_email`) e de chamadas `private` (`my_notes`), para conferir que o bypass e o escopo se mantêm sob carga.
- **W-code, chamadas emitidas por código.** W-syn em que as chamadas de um agente vêm de um programa que o modelo escreveu, como no Code Mode e na chamada programática de ferramentas [CODE-MODE] [PTC], em vez de uma chamada por turno do modelo. Um passo emite uma rajada de chamadas de uma vez, espera por todas e então pensa por um turno do modelo antes do passo seguinte. Os agentes começam dentro de uma janela configurável, e uma janela de zero é um orquestrador criando os seus subagentes no mesmo instante. As chamadas em si são planejadas como em W-syn e o número de chamadas por agente é mantido constante; assim, uma rajada muda quando as chamadas são emitidas, não quais (ADR-037). Ninguém mediu com que frequência chamadas emitidas por código se repetem entre agentes; por isso, todo valor base desta carga é uma suposição, declarada como tal na sua configuração.

A carga sintética faz da sobreposição um botão, porque é dela que o resultado mais depende: sem nenhuma, um cache compartilhado não tem o que compartilhar. Uma carga gravada diria quanta sobreposição um enxame real de fato tem. Até o E3 rodar, o IDEM não tem dados próprios sobre isso.

## Métricas {#metrics}

Todas as métricas do forwarder são calculadas a partir do fluxo de eventos do motor ([Arquitetura](/docs/architecture#events)), o mesmo fluxo que o sandbox desenha.

| Métrica | Definição |
|---|---|
| Chamadas upstream | requisições `tools/call` que chegam ao produtor |
| Redução upstream | `1 − upstream(mode) / upstream(B0)`, pareada por semente; também relatada contra o B1 e contra o B5 |
| Redução do oráculo | o que um cache compartilhado perfeito alcançaria com as mesmas chamadas: o limite para qualquer modo |
| Taxa de acerto do CS | `cs_hit / (Interests cacheáveis na borda)` |
| Taxa de agregação do PIT | `pit_aggregate / (Interests cacheáveis na borda)` |
| Acertos do cache do gateway | só no B5: chamadas respondidas pelo cache do gateway |
| Duplicatas em andamento | só no B5: chamadas cacheáveis que não encontraram entrada no cache do gateway enquanto uma chamada idêntica já estava upstream, e que por isso também foram upstream. É o que um PIT teria absorvido |
| Latência | por chamada, como o consumidor a observa; relatada como p50, p95 e p99 |
| Bytes no enlace do produtor | bytes que atravessam o enlace até o produtor |
| Custo criptográfico | tempo por operação de canonicalizar, assinar e verificar (E1) |
| Respostas vencidas | Data servido além do seu frescor; precisa ser zero |
| Violações de segurança | Data adulterado aceito, mais resultados `private` servidos entre contextos; precisa ser zero |

A taxa de acerto do CS e a taxa de agregação do PIT são relatadas separadamente de propósito. São dois mecanismos diferentes: um precisa de uma resposta já guardada, o outro só precisa que duas perguntas se sobreponham no tempo.

## Experimentos {#experiments}

### E1: microbenchmarks {#e1}

O custo de `canonicalizeArgs`, `makeName`, `signData` e `verifyData`, para cargas de 1 KB a 1 MB. A saída é uma distribuição de tempos por operação. Sustenta H2: é o preço pago em toda falta. Ele foi executado no Node. A metade do experimento que roda no navegador não foi executada.

### E2: simulação guiada por traces {#e2}

O experimento principal. O `@idem/sim` roda as cargas nos modos B0 a B5. Cada ponto é executado com 30 sementes e relatado como média com intervalo de confiança de 95%. Nove varreduras foram executadas, cada uma movendo um parâmetro:

| Varredura | Carga | O que muda | Modos |
|---|---|---|---|
| `e2-agents`, `e2-overlap`, `e2-ttl` | W-syn | número de agentes; sobreposição; TTL | B0 a B5 |
| `e2-cs-size`, `e2-think-time` | W-syn | tamanho do Content Store; tempo de reflexão | B0, B1, B2, B3, B5 |
| `e2-mixed` | W-mixed | fração de chamadas com efeito colateral | B0, B1, B2, B3, B5 |
| `e2-surface` | W-syn | fração das URLs escritas de uma forma equivalente | B0, B1, B5, B2 |
| `e2-code-burst` | W-code | chamadas por rajada | B0, B1, B5, B2 |
| `e2-code-sync` | W-code | janela em que os agentes começam | B0, B1, B5, B2 |

A `e2-surface` isola o que a canonicalização declarada pelo produtor acrescenta sobre o B5. Com variação de grafia zero, toda repetição é escrita do mesmo jeito; logo, B5 e B2 só podem diferir pela agregação das chamadas em andamento. As duas varreduras de W-code mantêm a variação de grafia em zero, porque argumentos montados por código variam menos na grafia do que argumentos escritos por um modelo.

Sustenta H1, H2, a parte (a) de H5, e H6. As regras que decidem H5 e H6 foram escritas antes das execuções. Uma estatística conta como acima de zero quando o seu intervalo de 95% está acima de zero.

- **H5 (a)** é lida da redução upstream do B2 sobre o B5. Ela precisa estar acima de zero onde quer que a grafia varie, acima de zero nos pontos sem variação de grafia em que o B5 mandou duplicatas upstream enquanto uma chamada idêntica estava em andamento, e nem acima nem abaixo de zero onde o B5 não mandou nenhuma.
- **H5 (b)** é lida do E5: cada linha do baseline precisa ser aceita em pelo menos uma tentativa, enquanto a variante do IDEM que ela espelha não é aceita em nenhuma.
- **H6** é lida da taxa de agregação do PIT do B2 e da sua redução upstream sobre o B5. As duas precisam crescer conforme a rajada aumenta e conforme a janela de início diminui.

O simulador executa o forwarder real em um relógio virtual, então o E2 mede a lógica do protocolo de forma exata e modela a rede. Trabalho de CPU não tem duração em um relógio virtual; por isso, os modos IDEM são cobrados por ele de forma explícita, a partir das medianas do E1. As linhas de base, o B5 entre elas, não são cobradas de nada. A repetição de um trace gravado não foi executada: ela espera pelo E3.

### E3: traces de agentes reais {#e3}

Um pequeno enxame de agentes de LLM responde a um conjunto fixo de perguntas de pesquisa com as ferramentas de demonstração sobre o corpus estático, e toda chamada de ferramenta é gravada. O orçamento é fixo, e o modelo e os prompts são salvos literalmente na pasta da execução. A saída são os arquivos W-trace usados por E2 e E4. É o único experimento que chama um LLM; nenhum teste e nenhum outro experimento o faz.

**O E3 não foi executado.** O repositório não tem nenhum trace de agentes reais; logo, toda carga do E2 é sintética e o seu ponto base é uma suposição. Há dois caminhos em aberto. Um é a execução descrita acima, um enxame real com orçamento fixo. O outro é um trace público como substituto. Os traces do DynamicMCPBench [DYNAMICMCPBENCH] registram chamadas de ferramenta MCP com os seus argumentos e instantes, sob uma licença que permite o reúso, mas cada trace é um agente no seu próprio objetivo; por isso, eles não conseguem mostrar como agentes que cooperam se sobrepõem. Um conjunto de dados público que tenha agentes cooperando em uma mesma tarefa, argumentos de ferramenta, instantes e uma licença clara foi procurado e não foi encontrado.

### E4: emulação de rede {#e4}

Processos reais sobre enlaces emulados. O plano falava em Mini-NDN [MINI-NDN]; o experimento foi executado, em vez disso, como uma bancada em Docker em uma só máquina, porque o Mini-NDN precisa de uma máquina Linux e a do autor não é. Cada nó é um namespace de rede que abriga um forwarder NFD e um processo Node que roda os papéis do overlay; assim, **os dois bindings atravessam as mesmas interfaces e os mesmos enlaces emulados**. O `tc netem` acrescenta os atrasos do E2 e uma perda de pacotes de 0, 1 e 5% a todo enlace.

- **Overlay.** Modos B0, B2 e B3, com os forwarders do `@idem/gateway`.
- **NDN nativo.** As mesmas duas topologias, com o PIT e o Content Store do próprio NFD e o binding nativo `@idem/ndn`, que existe e é testado contra um NFD real.

A carga é W-syn no ponto base do E2, com resultados pequenos o bastante para caber em um pacote NDN, porque a v1 não segmenta. A perda é recuperada de formas diferentes, e isso faz parte do que é comparado: o overlay anda sobre TCP, e o consumidor nativo pede de novo um Interest que ficou sem resposta durante o seu tempo de vida. Medido: bytes no enlace do produtor, latência, chamadas upstream, e em que ponto do caminho os acertos acontecem. Sustenta H4.

Dois limites da execução como ela está. Ela tem três sementes por ponto, então os seus intervalos de confiança são largos; uma execução com pelo menos dez sementes não foi feita. E o consumidor nativo retransmite depois de um tempo de vida fixo do Interest, não depois de um tempo baseado na ida e volta medida; um temporizador assim é um item em aberto.

### E5: segurança {#e5}

Execuções adversariais contra o forwarder, o produtor, o trust store e o verificador reais, em um relógio virtual. Cada uma tenta algo sobre o qual o protocolo tem uma regra:

- adulterar um Data em trânsito;
- forjar um nome cujo digest não bate com os argumentos;
- repetir um Data que já passou do seu frescor: a partir de um cache honesto, por alguém no caminho, com a idade declarada menor do que é, ou com uma data no futuro;
- pedir um resultado `private` a partir de outro contexto de autorização, inclusive escrevendo o `authContext` da vítima no Interest;
- envenenar um cache com um Data assinado por uma chave que não está no manifesto.

Toda variante é rotulada antes da execução com o que o protocolo diz dela, o que dá três tipos de linha, relatados separadamente:

| Tipo | O que é | Resultado esperado |
|---|---|---|
| **Afirmação** | uma tentativa que uma regra do protocolo precisa recusar | rejeitada em toda tentativa |
| **Limite** | algo que a versão 1 documenta e não impede: um replay ainda dentro da tolerância de relógio do tempo de vida assinado. O canal lateral de tempo é registrado do mesmo jeito, como um vazamento conhecido | não rejeitado; relatado como tal, nunca como afirmação |
| **Baseline** | o ataque de uma variante do IDEM, executado contra o cache de gateway sem assinatura do B5 | aceito; mostrado ao lado da variante do IDEM que ele espelha |

Uma tentativa só conta como rejeitada se nenhuma vítima aceitou conteúdo forjado, alheio ou fora do tempo de vida, e se nenhum Content Store guardou algum. O consumidor da suíte decide com `acceptData`, a função que todo consumidor distribuído usa. O juiz nunca reaproveita o predicado de um nó: ele sabe quais textos o produtor fez e quando, e um conteúdo feito mais do que o frescor mais 60 segundos antes de chegar ao consumidor, ou datado mais de 60 segundos no futuro, está fora do seu limite [P-8.6]. Cada afirmação também nomeia a camada que deve barrá-la (uma verificação do forwarder, o produtor ou o consumidor), e o teste da suíte falha se outra camada a barrou no lugar. A variante de limite no enlace do produtor também confere o limite: uma vez que a cópia repetida está fora do seu tempo de vida, um consumidor posterior precisa receber uma resposta nova.

O grupo do baseline tem três linhas: um resultado guardado que é reescrito dentro do cache do gateway, um resultado reescrito entre o produtor e o gateway, e uma ferramenta por usuário listada como cacheável em um cache indexado por ferramenta e argumentos. Elas são julgadas pela verdade de referência do mesmo jeito. A aceitação é o resultado esperado delas. Não são afirmações nem achados, e não são contadas junto com as linhas do IDEM.

As contagens são relatadas na página de [benchmarks](/benchmarks). Sustenta H3 e a parte (b) de H5. A página de [Segurança](/docs/security) explica a regra por trás de cada rejeição.

## O que não foi executado {#not-run}

- **E3.** Ainda não existe nenhum trace de agentes reais; logo, nenhum resultado neste site vem de uma carga gravada.
- **E4 com mais sementes.** A emulação tem três sementes por ponto. Uma execução com pelo menos dez não foi feita.
- **A metade do E1 no navegador.** Os microbenchmarks rodaram só no Node.

## Regras de relato {#reporting}

- Toda figura é produzida a partir de resultados versionados: por um script em `experiments/plots/`, ou pela página de benchmarks, que desenha os seus gráficos a partir das mesmas pastas de execução. Os ids das execuções vão embaixo de cada figura.
- Uma hipótese refutada é relatada como refutada, com os dados.
- Resultados de simulação são rotulados "simulação" e resultados de emulação, "emulação". Os dois nunca são combinados em um só número.
