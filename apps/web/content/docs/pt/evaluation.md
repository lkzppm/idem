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

## Modos comparados {#modes}

A mesma carga roda em cada modo. Dois deles são linhas de base sem IDEM.

::figure[modes] Os três modos principais. O cache local é a linha de base mais forte que não muda nada na rede: ele pega um agente se repetindo, e perde um agente repetindo outro.

| Id | Modo | Descrição |
|---|---|---|
| B0 | `mcp-direct` | cada agente chama o produtor diretamente, como faz o MCP 2026-07-28: `tools/call` não é guardado em cache |
| B1 | `mcp-local-cache` | cada agente mantém o próprio cache de resultados, por correspondência exata |
| B2 | `idem` | agentes → um forwarder de borda com PIT e CS → produtor |
| B3 | `idem-tree` | agentes → borda → forwarder regional → produtor (vários saltos) |
| B4 | `idem-noverify` | B2 com a verificação antes do cache desligada, **só** para isolar quanto a verificação custa |

B1 importa. Comparar o IDEM só com "nenhum cache" daria ao protocolo o crédito de ganhos que qualquer cache dá. A diferença que interessa é entre um cache que pertence a cada agente e um que o caminho compartilha. B4 nunca é uma opção de implantação: [P-7.1] só permite desligar a verificação como flag de experimento.

## Cargas de trabalho {#workloads}

- **W-syn, sintética.** Um conjunto de agentes, cada um fazendo um número de chamadas sobre um catálogo de páginas. A popularidade dentro do catálogo segue uma distribuição Zipf com expoente α. Um parâmetro explícito de **sobreposição entre agentes** define a fração dos pedidos de cada agente tirada de um conjunto comum a todos; o resto é próprio do agente. As varreduras variam o número de agentes em 1, 2, 4, 8, 16 e 32, a sobreposição, o tamanho do catálogo e α.
- **W-trace, gravada.** Traces de chamadas de ferramenta gravados de um enxame real de agentes no experimento E3, guardados em JSON Lines com o instante, o agente, a ferramenta, os argumentos e o tamanho do resultado de cada chamada. Os argumentos são mantidos como o modelo os escreveu, então a canonicalização é exercitada com variação de grafia real.
- **W-mixed.** Uma carga com uma fração de chamadas não cacheáveis (`send_email`) e de chamadas `private` (`my_notes`), para conferir que o bypass e o escopo se mantêm sob carga.

A carga sintética faz da sobreposição um botão, porque é dela que o resultado mais depende: sem nenhuma, um cache compartilhado não tem o que compartilhar. A carga gravada diz quanta sobreposição um enxame real de fato tem.

## Métricas {#metrics}

Todas as métricas do forwarder são calculadas a partir do fluxo de eventos do motor ([Arquitetura](/docs/architecture#events)), o mesmo fluxo que o sandbox desenha.

| Métrica | Definição |
|---|---|
| Chamadas upstream | requisições `tools/call` que chegam ao produtor |
| Redução upstream | `1 − upstream(mode) / upstream(B0)` |
| Taxa de acerto do CS | `cs_hit / (Interests cacheáveis na borda)` |
| Taxa de agregação do PIT | `pit_aggregate / (Interests cacheáveis na borda)` |
| Latência | por chamada, como o consumidor a observa; relatada como p50, p95 e p99 |
| Bytes no enlace do produtor | bytes que atravessam o enlace até o produtor |
| Custo criptográfico | tempo por operação de canonicalizar, assinar e verificar (E1) |
| Respostas vencidas | Data servido além do seu frescor; precisa ser zero |
| Violações de segurança | Data adulterado aceito, mais resultados `private` servidos entre contextos; precisa ser zero |

A taxa de acerto do CS e a taxa de agregação do PIT são relatadas separadamente de propósito. São dois mecanismos diferentes: um precisa de uma resposta já guardada, o outro só precisa que duas perguntas se sobreponham no tempo.

## Experimentos {#experiments}

### E1: microbenchmarks {#e1}

O custo de `canonicalizeArgs`, `makeName`, `signData` e `verifyData`, para cargas de 1 KB a 1 MB, no Node e em um navegador. A saída é uma distribuição de tempos por operação. Sustenta H2: é o preço pago em toda falta.

### E2: simulação guiada por traces {#e2}

O experimento principal. O `@idem/sim` roda varreduras de W-syn e repetições de W-trace nos modos B0 a B4. Cada ponto é executado com pelo menos dez sementes e relatado como média com intervalo de confiança de 95%. Os gráficos previstos: redução upstream em função do número de agentes e da sobreposição, distribuições de latência, e sensibilidade ao tamanho do Content Store e ao TTL. Sustenta H1 e H2.

O simulador executa o forwarder real em um relógio virtual, então o E2 mede a lógica do protocolo de forma exata e modela a rede.

### E3: traces de agentes reais {#e3}

Um pequeno enxame de agentes de LLM responde a um conjunto fixo de perguntas de pesquisa com as ferramentas de demonstração sobre o corpus estático, e toda chamada de ferramenta é gravada. O orçamento é fixo, e o modelo e os prompts são salvos literalmente na pasta da execução. A saída são os arquivos W-trace usados por E2 e E4. É o único experimento que chama um LLM; nenhum teste e nenhum outro experimento o faz.

### E4: emulação de rede {#e4}

Processos reais sobre enlaces emulados, de duas formas:

- **Overlay.** Contêineres para agentes, borda, forwarder regional e produtor, com `tc netem` acrescentando atraso e perda de pacotes de 0, 1 e 5% aos enlaces. Modos B0, B2 e B3.
- **NDN nativo.** As mesmas topologias no Mini-NDN, com o PIT e o Content Store do próprio NFD e o binding nativo, comparadas com o overlay.

Os gráficos previstos: bytes no enlace do produtor e tempo de conclusão em função da perda, e em que ponto do caminho os acertos acontecem. Sustenta H4. Depende do binding nativo, que ainda não está implementado.

### E5: segurança {#e5}

Execuções adversariais. Cada uma tenta algo que o protocolo precisa recusar:

- adulterar um Data em trânsito;
- forjar um nome cujo digest não bate com os argumentos;
- reenviar um Data vencido;
- pedir um resultado `private` a partir de outro contexto de autorização;
- envenenar um cache com um Data assinado por uma chave que não está no manifesto.

O resultado esperado é que toda tentativa seja rejeitada; as contagens são relatadas. Sustenta H3. A página de [Segurança](/docs/security) explica a regra por trás de cada rejeição.

## Regras de relato {#reporting}

- Toda figura é produzida por um script em `experiments/plots/` a partir de resultados versionados. O nome do script e os ids das execuções vão na legenda.
- Uma hipótese refutada é relatada como refutada, com os dados.
- Resultados de simulação são rotulados "simulação" e resultados de emulação, "emulação". Os dois nunca são combinados em um só número.
