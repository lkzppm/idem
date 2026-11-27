Esta página situa o IDEM em sistemas que estão em uso hoje, no fim de 2026. Cada cenário tem as mesmas cinco partes: o que se usa **hoje**, **o que se repete**, **onde o IDEM fica**, **o que ele dá** (mecanismo por mecanismo, e só os mecanismos que se aplicam) e **o que ele não resolve**.

Toda afirmação sobre o mundo de fora traz uma chave de referência. Os cenários não se apoiam em evidências igualmente fortes, e por isso cada um diz de que tipo é a sua: *medida* (alguém contou as chamadas repetidas), *prática documentada* (as pessoas descrevem o sistema que operam, e ninguém contou as repetições) ou *por analogia* (o argumento vem de como o NDN se comporta, sem nenhum relato atual por trás). A página não traz nenhum resultado dos experimentos do próprio IDEM. Eles ficam na página de [benchmarks](/benchmarks), e a [última tabela](#experiments) diz qual experimento representa qual cenário.

## Enxames de pesquisa {#research-swarms}

*Evidência: medida.*

**Hoje.** Um agente líder divide uma pergunta e entrega as partes a subagentes que buscam e leem em paralelo. A Anthropic descreve assim o seu sistema de pesquisa: o agente líder "spins up 3-5 subagents in parallel" e os subagentes "use 3+ tools in parallel" [ANTHROPIC-RESEARCH]. O ArcticSwarm, um sistema de pesquisa descrito em um preprint de 2026, roda até 16 subagentes em uma mesma pergunta [ARCTICSWARM].

**O que se repete.** Subagentes que trabalham na mesma pergunta acabam nas mesmas páginas. Uma tabela publicada conta isso, para um enxame com GPT-5 em 120 perguntas do BrowseComp [ARCTICSWARM]:

| Ferramenta | Chamadas | Repetições de uma chamada já feita na mesma pergunta | Do total de chamadas: repetições da chamada de *outro* subagente |
|---|---|---|---|
| `web_fetch` | 6.803 | 2.221 (32,6%) | 30,7% |
| `pdf_read` | 664 | 286 (43,1%) | 27,6% |
| `web_search` | 20.017 | 83 (0,4%) | não informado |

Uma chamada conta como repetição quando a sua chave já tinha sido pedida na mesma pergunta: a URL normalizada e o intervalo de páginas, nas duas ferramentas de busca de conteúdo; a consulta normalizada, na pesquisa. As buscas de página convergem; as pesquisas em texto livre, não. No `pdf_read`, cerca de um terço das repetições é um agente repetindo a si mesmo, o que um cache dentro do agente pegaria; o resto vem de outro subagente, e um cache dentro de cada agente não tem como ver. A tabela só existe na versão 1 do artigo. A versão 2 a retirou e manteve o mecanismo que ela motivava: um cache compartilhado por todos os agentes de uma pergunta, indexado pela URL normalizada.

A Anthropic relata o mesmo efeito, sem uma taxa: com descrições de tarefa vagas, os subagentes "performed the exact same searches as other agents", o que a equipe tratou como um defeito de prompt e corrigiu com instruções melhores [ANTHROPIC-RESEARCH].

Entre sessões vale a segunda medição. Em traces de produção de 24 horas, 27% das consultas distintas de uma aplicação de busca com agentes se repetem e respondem por 67,3% das suas 373.678 chamadas de busca, e em outra aplicação 24% das URLs distintas se repetem e respondem por 64% de 4.389 buscas de página [AGENTSYSBENCH]. Isso é recorrência entre usuários e sessões ao longo de um dia, não sobreposição dentro de uma tarefa.

::figure[swarm] O caso que a medição do enxame descreve: vários subagentes pedem a mesma página. Um Interest segue adiante e todos os subagentes recebem o mesmo Data assinado.

**Onde o IDEM fica.** O produtor é o serviço que executa a busca da página ou a leitura do PDF, porque quem executa a ferramenta é quem assina. O forwarder é a borda no endpoint MCP do enxame: dentro do harness, ou um gateway que a organização já opera. Os subagentes não mudam nada além da URL do servidor MCP, já que a borda é um endpoint MCP comum.

**O que ele dá.**

| Mecanismo | Neste cenário |
|---|---|
| Content Store | um segundo subagente que pede uma página dentro do período de frescor é respondido na borda, e o produtor não é acionado |
| Agregação no PIT | subagentes que pedem a mesma página no mesmo instante compartilham um único pedido ao produtor. Nenhuma das duas medições acima conta chamadas que se sobrepõem no tempo, então não se sabe com que frequência isso acontece em um enxame real |
| Canonicalização | o ArcticSwarm normaliza URLs no próprio código. No IDEM o produtor declara as normalizações, e todo nó aplica as mesmas |
| Assinatura | ela passa a importar quando o cache sai do processo do enxame: compartilhado por vários enxames, equipes ou organizações. Dentro de um único processo não há de quem desconfiar |

**O que ele não resolve.** Pesquisas em texto livre não coincidem, e a correspondência exata não faz nada por elas. Um cache dentro do harness já recolhe as repetições de uma pergunta, então o IDEM só acrescenta algo quando o cache é compartilhado além de um processo ou de um domínio de confiança. E um período de frescor fica com bem menos do que a recorrência bruta sugere: reproduzido sobre os traces de produção, um cache de correspondência exata com TTL de 10 minutos elimina 35,2% das chamadas de busca *redundantes*, o que equivale a 19,3% da latência agregada de busca [AGENTSYSBENCH].

## Chamadas de ferramenta emitidas por código {#code}

*Evidência: o mecanismo está documentado; ninguém mediu a repetição.*

**Hoje.** Em vez de pedir ao modelo uma chamada de ferramenta por turno, o host pede um programa, e é o programa que faz as chamadas. O Code Mode, da Cloudflare, converte as ferramentas MCP em uma API TypeScript e roda o código do modelo em um sandbox sem acesso à Internet; cada chamada volta ao supervisor do agente, "which holds the access tokens and adds them into requests sent on to MCP" [CODE-MODE]. Na chamada programática de ferramentas da Anthropic, o Claude escreve Python que chama as ferramentas como funções; quando uma função é chamada, "code execution pauses and the API returns a `tool_use` block", a aplicação que chamou a API fornece o resultado, e várias chamadas podem rodar em paralelo [PTC]. Um terceiro padrão apresenta cada ferramenta como um arquivo cujo corpo chama o cliente MCP do harness [CODE-EXEC-MCP]. Há ainda uma variante do lado do servidor, em que o servidor MCP expõe duas ferramentas, `search()` e `execute()`, e roda ele mesmo o código [CODE-MODE-MCP].

**O que se repete.** Ninguém mediu: nenhuma dessas páginas informa com que frequência as chamadas de ferramenta se repetem. O que elas documentam é um formato. As chamadas saem de um programa em laços e em leques ("checking 50 endpoints or looking up 20 records" [PTC]), e por isso chegam juntas, em vez de uma por turno do modelo. A nossa leitura desse formato, que não é uma medição, pesa para os dois lados. Código monta argumentos de forma mecânica, então dois programas que pedem a mesma coisa tendem a escrevê-la do mesmo jeito. Mas o leque típico é uma chamada por entidade, o que dá nomes distintos dentro de um mesmo programa. Se há repetição aqui, ela está entre agentes e sessões que rodam código parecido.

**Onde o IDEM fica.** Em todos os desenhos do lado do cliente a chamada de ferramenta não é executada dentro do sandbox. Ela sai do sandbox e é executada por um componente de fora: o conector do runtime, que encapsula o servidor MCP [CODE-MODE-DOCS], a aplicação que responde ao bloco `tool_use` [PTC] ou o cliente MCP do harness [CODE-EXEC-MCP]. É nesse componente que entra um consumidor IDEM, e apontá-lo para uma borda IDEM muda uma URL. O prompt, o código gerado e o modelo ficam como estão.

A variante do lado do servidor é diferente. A chamada que o agente enxerga é `execute`, com um programa como argumento, e um programa não é uma pergunta com uma resposta só. O IDEM só pode ficar atrás desse servidor, nas chamadas que ele faz aos servidores de baixo, e só quem o opera pode colocá-lo ali.

**O que ele dá.**

| Mecanismo | Neste cenário |
|---|---|
| Agregação no PIT | rajadas de vários agentes se sobrepõem no tempo mais do que chamadas espaçadas por turnos do modelo. Se isso torna a agregação relevante é a hipótese H6, em teste |
| Content Store | reaproveitamento entre sessões e entre agentes que rodam código parecido |
| Assinatura | o resultado é verificado pelo consumidor fora do sandbox, antes de o programa recebê-lo |

**O que ele não resolve.**

- **A assinatura cobre o que a ferramenta devolveu, não o que o modelo lê.** O programa filtra e remodela os resultados antes que o modelo veja qualquer coisa: "Tool results from programmatic calls are not added to Claude's context: Only the final code output is" [PTC]; "The agent sees five rows instead of 10,000" [CODE-EXEC-MCP]. O IDEM responde pela entrada do programa.
- **O IDEM não economiza tokens.** As economias que essas páginas relatam vêm de manter as definições de ferramenta e os resultados intermediários fora do contexto do modelo. O IDEM atua no caminho entre o consumidor e a ferramenta e deixa o contexto como estava.
- **A canonicalização pesa menos.** Argumentos escritos por código variam menos do que argumentos escritos por um modelo. Argumentos de forma livre, como uma string SQL, não são normalizados pela canonicalização.
- **Uma chamada em espera continua dentro do prazo do sandbox.** No desenho da Anthropic, uma chamada pendente "times out after about 4 minutes" [PTC].
- **O replay dentro de um runtime nunca chega ao IDEM.** O runtime durável do Code Mode guarda o resultado de uma chamada e devolve o valor gravado nas passagens seguintes da mesma execução [CODE-MODE-DOCS]. Uma chamada assim não é feita de novo, então nenhum período de frescor se aplica a ela.

## Servidores de documentação para agentes de código {#docs-servers}

*Evidência: prática documentada; ninguém mediu a repetição.*

**Hoje.** Agentes de código leem documentação de bibliotecas, e as empresas que hospedam documentação relatam isso a partir do próprio tráfego. A Mintlify escreveu em abril de 2026 que "AI coding agents now account for 45.3% of all requests", e em julho que os agentes respondem por 66% do tráfego web medido nas documentações que ela hospeda, onde os seus servidores MCP "handled 1.42 million tool calls" no mês até aquele momento [MINTLIFY-AGENTS][MINTLIFY-MIDYEAR]. A Fern relata que os agentes foram 60,6% das requisições em seus sites em setembro de 2026 [FERN-DOCS]. O Context7 serve documentação de bibliotecas a agentes por meio de ferramentas MCP, desconta cada chamada de uma cota, responde `429` além dos limites de taxa e recomenda cache aos seus usuários: "Documentation updates are relatively infrequent, so caching responses for several hours or days reduces API calls and improves performance" [CONTEXT7-API].

**O que se repete.** Nenhuma fonte mede com que frequência agentes diferentes pedem a mesma página ou a mesma consulta. A expectativa é um argumento, não uma contagem: a documentação de uma versão já lançada é a mesma para todos que perguntam, e o próprio provedor diz que ela muda pouco. Um cache dentro de um agente serve só àquele agente, e o servidor não distingue uma sessão da outra: os clientes MCP "do not expose a persistent conversation identifier to remote docs servers", de modo que "calls arrive as stateless requests" [MINTLIFY-MIDYEAR].

**Onde o IDEM fica.** O servidor de documentação é o produtor: assina cada página e cada resultado de busca, e o seu manifesto declara essas ferramentas cacheáveis, públicas, com o tempo de vida que ele aceita. O forwarder é o gateway de uma equipe, a saída de um conjunto de runners de CI ou a borda do próprio provedor. Os agentes mudam a URL do servidor de documentação, ou nada, se o gateway já é o ponto onde se conectam.

**O que ele dá.**

| Mecanismo | Neste cenário |
|---|---|
| Content Store | uma página de uma versão lançada é buscada no produtor uma vez por período de frescor em cada forwarder. A recomendação do provedor de guardar em cache por horas ou dias vira um tempo de vida que ele assina, em vez de uma linha em um guia |
| Agregação no PIT | jobs de CI que começam juntos e pedem as mesmas páginas compartilham um pedido. Isso é raciocínio, não medição |
| Assinatura | um agente age com base no que a documentação diz: instala, configura e escreve código. Um cache capaz de alterar uma página é um ponto de ataque. Com a página assinada, o cache não consegue mudá-la sem que se perceba |
| Manifesto assinado | é o provedor, e não a equipe que opera o cache, quem decide quais ferramentas são cacheáveis e por quanto tempo |

**O que ele não resolve.** Mais da metade das chamadas MCP que a Mintlify contou eram buscas (56,57%) [MINTLIFY-MIDYEAR], e uma consulta em texto livre só coincide com outra quando as duas são idênticas depois da canonicalização. Documentação atrás de login é `private`: é reaproveitada pelo mesmo usuário e não é compartilhada com ninguém. E o provedor precisa assinar. Enquanto não assina, o único caminho é um proxy-producer que assina em nome próprio ([seção 9.1 do protocolo](/docs/protocol#s9-1)), e isso carrega a palavra de quem o opera, não a do provedor.

## Gateways MCP corporativos {#gateways}

*Evidência: prática documentada.*

**Hoje.** Empresas colocam um gateway entre os seus agentes e as suas ferramentas internas. O da PayPal "handled more than 3.6 million MCP tool calls" em um mês, com "close to 200 active MCP servers and 3,318 callable tools" atrás dele [PAYPAL-MCP]. A Cloudflare opera servidores MCP na frente de recursos públicos e na frente de "private corporate resources", administrados por uma equipe central [CF-ENTERPRISE-MCP]. A Sierra relata que 89% dos seus funcionários usam o gateway da empresa para conectar agentes a 45 serviços [SIERRA-MCP]. A Alibaba Cloud descreve o seu gateway MCP de produção em um artigo revisado por pares [MCP-GATEWAY].

Nenhum desses relatos fala em cache de resultados de ferramenta. O gateway da Alibaba guarda em cache metadados de sessão e intenções de busca de ferramenta, não resultados [MCP-GATEWAY]. A documentação de MCP do Kong, do LiteLLM, do Agent Router e do agentgateway descreve roteamento, autenticação, controle de acesso e limite de taxa; não encontramos nela um cache de resultados de `tools/call` [KONG-MCP][LITELLM-MCP][AGENT-ROUTER-MCP][AGENTGATEWAY]. O AI Gateway da Cloudflare guarda em cache as respostas dos provedores de modelo [CF-AIGW-CACHE]. O guia de um fornecedor é explícito: "Avoid caching tools/call, as that is a function call with side effects" [GRAVITEE-MCP].

Onde resultados de ferramenta são guardados em cache hoje, o cache é um complemento em que quem chama precisa confiar. O middleware do FastMCP guarda em cache dentro do servidor, particionado por token de acesso, e, uma vez instalado, guarda toda ferramenta por uma hora, por padrão [FASTMCP-CACHE]. O crate `mcp-proxy` guarda em cache em um proxy, com TTL configurado, e consegue fundir chamadas idênticas em trânsito [MCP-PROXY]. Um plugin do ContextForge registra um acerto de cache para as ferramentas listadas na sua configuração, mas, nas palavras dele, "Cannot short-circuit tool execution" [CONTEXTFORGE-CACHE].

**O que se repete.** Ninguém informa. Os relatos destacam a propriedade oposta: "Users, agents, and external clients can share a route without sharing the same permissions" [PAYPAL-MCP]. A maior parte dos resultados atrás de um gateway assim depende de quem pergunta. O que poderia ser compartilhado é o que é igual para todo funcionário, e nenhuma fonte diz de que tamanho é essa parte.

**Onde o IDEM fica.** O gateway é o forwarder de borda, e os agentes já se conectam a ele. Os servidores MCP internos são os produtores. Ou eles assinam os seus resultados, ou o operador coloca um proxy-producer na frente deles ([seção 9.1 do protocolo](/docs/protocol#s9-1)): ele assina com nome próprio e chave própria, de modo que todo Data diz quem o assinou, a política de cache é a do operador e a confiança passa para o proxy.

::figure[scope] Como fica o Content Store do gateway com os dois tipos de ferramenta: uma entrada compartilhada para um resultado público, uma partição por contexto de autorização para os privados.

**O que ele dá.**

| Mecanismo | Neste cenário |
|---|---|
| Escopo assinado | o produtor declara cada ferramenta `public` ou `private`, e o escopo vai assinado dentro de cada resultado. Um resultado `private` só é guardado na borda, em uma partição indexada por um contexto de autorização que a borda deriva da credencial e nunca aceita vindo da requisição [P-8.3][P-8.4] |
| Manifesto assinado | o operador não precisa adivinhar quais ferramentas são somente leitura. A recomendação de evitar cache de `tools/call` existe porque um gateway não tem um sinal confiável; o manifesto é esse sinal, vindo de quem sabe |
| Content Store | uma entrada serve a todos os funcionários no caso de uma ferramenta `public`, e às repetições de cada usuário no caso de uma `private` |
| Assinatura | um gateway é, nas palavras do artigo da Alibaba, "a trust boundary that holds backend credentials" [MCP-GATEWAY]. Quando os produtores assinam, um consumidor que verifica não depende do cache do gateway para a integridade |

Um aviso de segurança mostra para que servem as regras de escopo. Os plugins de cache do Kong, que guardam respostas HTTP e respostas de modelo, e não resultados de ferramenta, podiam "cache a response to a request that carried an `Authorization` or `Proxy-Authorization` header, and later serve that response to a caller that sends no credentials" [KONG-CVE]. No IDEM, esse é o caso contra o qual a partição foi escrita, e a regra tem um teste que não pode ser removido.

**O que ele não resolve.** Se a maioria das chamadas é por usuário, um cache compartilhado tem pouco a compartilhar, e o que sobra é o reaproveitamento pelo mesmo usuário e a verificação. Um resultado `private` não é cifrado: a borda que o guarda consegue lê-lo. Uma resposta rápida continua revelando que alguém já fez a mesma pergunta. Ferramentas com efeito colateral passam direto, intactas. E atrás de um proxy-producer a assinatura é a do proxy, então o consumidor confia no operador do gateway como confia hoje.

## APIs de ferramenta cobradas por chamada e com limite de taxa {#metered}

*Evidência: o modelo de cobrança está documentado; nada além disso.*

**Hoje.** Serviços de pesquisa e de busca de páginas vendidos a agentes cobram por chamada. Tavily: "Each request costs 1 API credit" em uma pesquisa básica [TAVILY-CREDITS]. Firecrawl: "Every API call that you make consumes credits" [FIRECRAWL-BILLING]. A ferramenta de busca na web da Anthropic: "Each web search counts as one use", cobrada além dos tokens [ANTHROPIC-WEB-SEARCH]. O Context7 para de responder a uma conta gratuita quando as chamadas do mês acabam [CONTEXT7-API].

**O que se repete.** Essas páginas não dizem nada sobre repetição. A evidência é o trace de produção do [primeiro cenário](#research-swarms): 67,3% das chamadas de busca de uma aplicação vieram de consultas que se repetem dentro de um dia [AGENTSYSBENCH].

**Onde o IDEM fica.** O provedor é o produtor. Ele assina cada resultado e declara no manifesto por quanto tempo o resultado de cada ferramenta pode ser reaproveitado. O forwarder é o gateway do cliente ou a borda do próprio provedor.

**O que ele dá.**

| Mecanismo | Neste cenário |
|---|---|
| Content Store e PIT | uma chamada respondida por um forwarder não chega ao provedor. Se o provedor mede na origem, essa chamada não é cobrada nem contada no limite de taxa |
| Manifesto assinado | o provedor define o tempo de vida que aceita, por ferramenta. O reaproveitamento de um resultado pago fica limitado por quem o vendeu |
| Assinatura | o cliente consegue conferir que um resultado reaproveitado é do provedor e não foi alterado onde estava guardado |

**O que ele não resolve.** Se um provedor quer isso é uma questão comercial, não de protocolo: um cache na frente do medidor reduz o que o provedor fatura, e nenhuma das páginas lidas diz se um provedor aceita que os seus resultados sejam servidos de novo por outra parte. Um provedor que não assina deixa como única saída um proxy-producer, cuja política de cache é a de quem o opera: ele não carrega nem a autorização do provedor nem o tempo de vida que o provedor escolheria. E resultados de busca envelhecem: o mesmo trace mostra quão pouco um tempo de vida curto retém da recorrência (35,2% das chamadas de busca redundantes, com 10 minutos) [AGENTSYSBENCH].

## Publicadores e carga na origem {#publishers}

*Evidência: a carga é medida; o encaixe do IDEM é por analogia.*

**Hoje.** Leitores automáticos são uma parte grande do que as origens servem. A Wikimedia constatou que pelo menos 65% do seu tráfego mais custoso vem de bots, embora os bots sejam cerca de 35% das suas visualizações de página, porque os crawlers fazem "bulk read" de páginas pouco populares, que não estão em nenhum cache e precisam ser servidas pelo data center central [WIKIMEDIA-CRAWLERS]. A Cloudflare relatou em julho de 2026 que "more than 50% of traffic on the Internet is now non-human" [CF-AGENTIC-INTERNET].

**O que se repete.** Menos do que esses números sugerem, para este protocolo. A maior parte da carga é coleta para treinamento. Nos doze meses até agosto de 2025, "80% of AI crawling was for training, compared with 18% for search and just 2% for user actions" [CF-CRAWL-CLICK]. Só o último tipo é um agente buscando uma página para um usuário por meio de uma ferramenta, que é o tráfego que o IDEM enxerga. A coleta para treinamento lê em massa e alcança a cauda longa, o padrão que derrota os caches segundo a própria Wikimedia.

**Onde o IDEM fica.** Alguém precisa assinar. Ou o publicador atua como produtor de uma ferramenta de busca do seu próprio conteúdo, ou um serviço de busca de páginas assina como proxy-producer, e nesse caso a assinatura fala pelo serviço, não pelo publicador.

**O que ele dá.**

| Mecanismo | Neste cenário |
|---|---|
| Content Store | uma página que muitos agentes buscam é tirada da origem uma vez por período de frescor em cada forwarder, e é o publicador quem escolhe o período |
| Assinatura | uma cópia servida por um intermediário pode ser conferida com a chave do publicador. A web tem um precedente: os Signed HTTP Exchanges permitem que um publicador assine uma resposta, com a sua janela de validade, para que qualquer intermediário possa servi-la [SXG] |

**O que ele não resolve.** Nenhuma origem assina resultados de ferramenta hoje, então este cenário descreve o que seria possível, não algo que basta ligar. Ele não faz nada quanto aos crawlers de treinamento, que não passam por uma chamada de ferramenta. E caches HTTP já guardam respostas por URL [RFC9111]. O que o IDEM acrescentaria é uma cópia que o leitor consegue verificar em um cache no qual não confia, e o precedente não anima: o draft dos Signed HTTP Exchanges expirou sem ser adotado por um grupo de trabalho [SXG].

## Conferir de onde veio uma resposta {#origin}

*Evidência: o problema é medido; o IDEM cobre só a autenticidade de origem.*

**Hoje.** O nome de uma ferramenta não diz quem a fornece. Em um estudo controlado, o atacante "only operates another MCP server that is visible to the same client and advertises tools with chosen metadata". Quando esse servidor copiou o nome e a descrição da ferramenta legítima e ofereceu um schema compatível, três dos cinco clientes de modelo testados escolheram a ferramenta do atacante em todas as 50 tentativas [MISBINDING]. No caminho, um gateway é uma parte que guarda credenciais e trata toda chamada [MCP-GATEWAY]. Um proxy construído para injetar falhas em chamadas de ferramenta, para pesquisa, consegue fabricar erros e alterar conteúdos, e os seus autores observam que as mesmas primitivas "could be repurposed adversarially by an attacker already positioned on the MCP path" [MCP-FAULTS].

**O que se repete.** Nada precisa se repetir. Este cenário trata da assinatura, não do cache.

**Onde o IDEM fica.** No consumidor. O produtor faz parte de todo nome, e o consumidor é configurado com os produtores que aceita e, onde não dá para confiar no primeiro contato, com as chaves deles.

**O que ele dá.**

| Mecanismo | Neste cenário |
|---|---|
| Nome e chave | um Data só é aceito se o seu key locator indicar o produtor do nome e se a chave for uma das que o manifesto confiável daquele produtor lista [P-5.2]. Um servidor sósia não consegue produzir Data para o nome de outro produtor |
| Assinatura | um resultado alterado por um gateway, por um cache ou por qualquer um no caminho falha na verificação antes que o agente o veja [P-5.5] |
| Manifesto assinado | o schema digest do manifesto liga a definição de ferramenta que o consumidor vê à política que o produtor assinou [P-6.1] |

**O que ele não resolve.**

- **Ele não impede que um agente escolha a ferramenta errada.** O atacante daquele estudo pode perfeitamente assinar um manifesto para o próprio nome. O IDEM ajuda quando o produtor é fixado por configuração ou pelo usuário, não quando um modelo escolhe uma ferramenta pelas descrições.
- **Uma assinatura diz quem respondeu, não se a resposta está certa.** Em um perfil de falhas calibrado com relatos de falha de 1.774 repositórios MCP, as falhas silenciosas de conteúdo (saída errada, inválida ou levemente errada) pesam 19,1% do perfil; os autores ressaltam que ele reflete a mistura dos relatos, não uma taxa de falha [MCP-FAULTS]. Um produtor assina uma resposta errada como qualquer outra, e um cache a serve até o fim do seu tempo de vida.
- **Ele não registra linhagem.** Um Data do IDEM vale por si e não diz a partir de que foi calculado. Esse é o assunto do Codexproof [CODEXPROOF]; veja [Trabalhos relacionados](/docs/related-work#agent-networking).
- **O primeiro contato é aceito em confiança**, a menos que a chave esteja fixada ([Segurança](/docs/security#limits)).

## Redes restritas e com perda {#lossy}

*Evidência: por analogia com o NDN; não encontramos nenhum relato atual.*

**Hoje.** Agentes rodam, sim, na borda da rede. A AWS descreve servidores MCP empacotados para locais "where connectivity is unreliable", e a sua resposta a um enlace interrompido é rodar as ferramentas localmente e guardar os resultados até o enlace voltar [AWS-GREENGRASS-MCP]. Não encontramos nenhum relato de agentes que chamem ferramentas remotas somente leitura por um enlace com perda, nem medição alguma de MCP em um enlace assim.

**O que se repete.** Não foi medido. O argumento é o do NDN: um Data guardado perto do consumidor sobrevive a um caminho interrompido até o produtor, e o artigo que apresenta o NDN diz que até conteúdo dinâmico pode se beneficiar do cache em caso de "retransmission after a packet loss" [NDN-2014].

**Onde o IDEM fica.** No binding nativo. Os nomes são carregados pelo NDN, os forwarders são roteadores NDN com o próprio PIT e o próprio Content Store, e o produtor responde atrás de um deles. Aqui o lado do agente muda, sim: ele precisa de um consumidor NDN, ou de um gateway local que seja um.

**O que ele dá.**

| Mecanismo | Neste cenário |
|---|---|
| Content Store no caminho | um resultado perdido no último enlace não precisa ser produzido de novo: o Interest retransmitido é respondido pelo nó mais próximo que o guarda |
| Agregação no PIT | retransmissões e chamadas idênticas para um nome ainda pendente entram na entrada que já está em espera |
| Assinatura | o NDN a exige de qualquer forma, e é ela que permite a qualquer roteador do caminho responder |

**O que ele não resolve.** O experimento E4 fez essa comparação, e o resultado foi misto: menos bytes no enlace do produtor e nenhum ganho no tempo de recuperação em relação ao TCP, nas configurações testadas. Os números e as configurações estão na página de [benchmarks](/benchmarks). Ferramentas `private` não podem usar o binding nativo [P-9.4]. Um resultado que não cabe em um pacote NDN não é segmentado na versão 1. E uma chamada é um Interest e um Data, o que não serve a uma ferramenta que demora a responder; o RICE descreve o mecanismo que serviria [RICE].

## Onde o IDEM não se encaixa {#not-fit}

| Caso | Por quê |
|---|---|
| Ferramentas com efeito colateral | enviar, gravar, comprar. Nunca recebem nome nem vão para o cache; a chamada passa direto, como MCP comum |
| Respostas que dependem de quem pergunta | um resultado `private` só é reaproveitado pelo mesmo contexto de autorização. Não há o que compartilhar, e o IDEM vira um cache por usuário com assinatura |
| Dados que precisam estar em dia ao segundo | um resultado em cache tem a idade que o produtor permite, e o tempo de vida assinado ainda aceita uma tolerância de relógio por cima (60 segundos por padrão) [P-8.6]. Uma ferramenta cuja resposta não pode ter um minuto de idade não deveria ser declarada cacheável |
| Perguntas parecidas, mas não idênticas | a correspondência é exata depois da canonicalização. Trabalhos sobre caches com correspondência aproximada relatam um custo em acurácia [PLAN-CACHE][WA-CACHE] |
| Ferramentas que demoram a responder | não há thunks nem resultado assíncrono; uma chamada dura o que dura uma requisição |
| Economizar tokens | o IDEM não guarda em cache saídas de modelo nem prompts. Isso é o que faz o cache de prompt dos provedores [PROMPT-CACHING], e a chamada de ferramentas por código mantém os resultados fora do contexto [PTC] |
| Um agente, um processo, nada compartilhado | um cache dentro do processo basta, e não há de quem desconfiar |

## Cenários e experimentos {#experiments}

Cada experimento está descrito na página de [Avaliação](/docs/evaluation), e os seus resultados estão em [Benchmarks](/benchmarks). "Não medido" quer dizer que nenhum experimento do IDEM representa o cenário.

| Cenário | Evidência externa | Experimento do IDEM |
|---|---|---|
| [Enxames de pesquisa](#research-swarms) | medida | varreduras `e2-agents`, `e2-overlap` e `e2-think-time` do E2; `e2-surface` para argumentos escritos de formas diferentes |
| [Chamadas emitidas por código](#code) | mecanismo documentado, repetição não medida | varreduras `e2-code-burst` (tamanho da rajada) e `e2-code-sync` (quão juntos os agentes começam) do E2, para a hipótese H6 |
| [Servidores de documentação](#docs-servers) | prática documentada, repetição não medida | não medido. A `e2-ttl` varia o período de frescor na carga sintética |
| [Gateways corporativos](#gateways) | prática documentada | `e2-mixed` (chamadas não cacheáveis e chamadas `private` sob carga); E5 para o isolamento dos resultados `private` |
| [APIs cobradas por chamada](#metered) | modelo de cobrança documentado | não medido. As chamadas que chegam ao produtor são contadas em toda varredura do E2; nenhum modelo de cobrança é simulado |
| [Publicadores](#publishers) | carga medida, encaixe por analogia | não medido |
| [Conferir a origem](#origin) | problema medido | E5: adulteração, nomes forjados, chaves fora do manifesto |
| [Redes com perda](#lossy) | por analogia | E4 |
