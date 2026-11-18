## A ideia em uma linha {#idea}

> Se a pergunta é a mesma, a resposta é a mesma, e ela não precisa atravessar a rede de novo.

O IDEM (*Interest-Driven Exchange for Models*) é uma camada orientada a conteúdo para o [Model Context Protocol](https://modelcontextprotocol.io) (MCP), o protocolo que agentes de LLM usam para chamar ferramentas externas. Ele muda o que uma chamada de ferramenta *é* na rede:

- uma **chamada de ferramenta somente leitura** vira um **nome**, derivado do produtor, da ferramenta e dos argumentos canonicalizados;
- o **resultado** vira um objeto **Data**, assinado pelo produtor que executou a ferramenta;
- qualquer nó do caminho pode guardar esse Data e servi-lo depois, porque quem o recebe **verifica a assinatura** e não precisa confiar no nó que o entregou;
- pedidos idênticos que estão em trânsito ao mesmo tempo são **agregados**: um segue adiante, todos recebem a resposta.

É o modelo de Named Data Networking [NDN-2014] aplicado à chamada de ferramentas. *Idem*, em latim, quer dizer "o mesmo".

::figure[swarm] Três agentes pedem a mesma página ao mesmo tempo. O forwarder de borda reconhece um único nome, envia um Interest adiante e entrega aos três o Data assinado pelo produtor.

## O problema {#problem}

Na revisão 2026-07-28 o MCP passou a ser sem estado: cada requisição é autocontida e o protocolo se comporta como uma API HTTP comum [MCP-CHANGELOG]. O modelo de comunicação continua sendo uma mensagem de um endereço para outro, e disso decorrem três lacunas.

1. **Chamadas de ferramenta não são cacheáveis pelo protocolo.** O mecanismo de cache do MCP cobre as requisições de descoberta e de listagem e `resources/read`. `tools/call` fica de fora [MCP-CACHE].
2. **Resultados não carregam integridade nem procedência.** O `cacheScope` do MCP é um rótulo. A especificação diz aos servidores que não dependam dele para controle de acesso [MCP-CACHE], e a documentação do SDK o chama de "a label, not a lock" [MCP-PY-CACHE]. Uma resposta servida por um intermediário não pode ser conferida por quem a recebe.
3. **Enxames de agentes se repetem.** Quando vários subagentes trabalham na mesma tarefa, eles buscam as mesmas páginas e leem os mesmos arquivos. Uma medição publicada de um enxame de pesquisa mostrou que uma grande parte das buscas repetia outra já feita na mesma tarefa, quase sempre por um subagente *diferente* [ARCTICSWARM]. Um cache dentro de cada agente não enxerga essas repetições.

## O que o IDEM faz a respeito {#approach}

As redes orientadas a conteúdo foram desenhadas para essa classe de problema. O consumidor pede um *dado nomeado* em vez de contatar uma máquina; todo pacote Data é assinado e liga um nome ao seu conteúdo, então pode vir de qualquer cache; pedidos idênticos se fundem ao longo do caminho [NDN-2014][SRM-NDN]. O IDEM aplica cada peça às chamadas de ferramenta:

| Peça | No IDEM | Leia mais |
|---|---|---|
| Nome | produtor + ferramenta + versão do schema + digest dos argumentos canônicos | [Nomes](/docs/concepts#names) |
| Data | o resultado da ferramenta, assinado pelo produtor, com um período de frescor e um escopo | [Interest e Data](/docs/concepts#interest-and-data) |
| Forwarder | um gateway com um **PIT** (agregação), um **CS** (cache) e um **FIB** (roteamento por produtor) | [O forwarder](/docs/concepts#forwarder) |
| Confiança | um manifesto assinado pelo produtor diz quais ferramentas são cacheáveis e lista suas chaves | [Assinaturas e confiança](/docs/concepts#trust) |
| Verificação | o consumidor verifica todo Data, seja qual for o caminho que ele fez | [Segurança](/docs/security) |

Três coisas são próprias das chamadas de ferramenta e não existem no NDN clássico.

- **Os argumentos são escritos por um modelo.** Dois agentes que querem dizer o mesmo pedido o escrevem de formas diferentes (ordem das chaves, host em maiúsculas, porta padrão). Por isso a canonicalização faz parte do protocolo, e só são aplicadas as normalizações que o produtor declarou.
- **O produtor autoriza o cache.** As anotações de ferramenta do MCP, como `readOnlyHint`, são dicas não confiáveis. No IDEM uma ferramenta só é cacheável se o manifesto assinado do produtor disser que é.
- **Os agentes atuais continuam funcionando.** A borda pode ser um endpoint MCP comum. Um agente que não sabe nada de IDEM se conecta a ela, e suas chamadas repetidas são nomeadas, agregadas e guardadas em cache no caminho.

## Onde ele fica na pilha {#stack}

O IDEM toma emprestado o *modelo* de uma arquitetura da camada de rede e o executa onde ficam os caches HTTP e as CDNs.

| Binding | Camada | Pilha |
|---|---|---|
| Overlay HTTP (implementado) | overlay na camada de aplicação, como um cache HTTP ou uma CDN, mas com objetos nomeados e assinados | MCP / IDEM → HTTP → TLS → TCP/QUIC → IP |
| NDN nativo (implementado; ainda não rodado no NFD) | os nomes são carregados pelo NDN, que substitui o IP na camada de rede | nomes IDEM → NDN → enlace / túneis UDP |

Neste projeto, "transporte" sempre quer dizer um transporte do MCP (stdio, Streamable HTTP), nunca a camada 4 do modelo OSI. O IDEM não promete segmentação, controle de fluxo nem controle de congestionamento: isso continua com o TCP e o QUIC (ADR-010).

## Quando se aplica, e quando não {#fit}

O IDEM ajuda quando tudo isto vale:

- a ferramenta é **somente leitura** e o produtor a declara cacheável no manifesto assinado;
- **vários consumidores** fazem perguntas que se sobrepõem (um enxame de subagentes, muitos usuários de um serviço), ou um consumidor pergunta de novo dentro do período de frescor;
- uma resposta com alguns segundos ou minutos de idade é aceitável, por um período que o produtor escolhe.

Nestes casos ele deliberadamente não faz nada, e a chamada segue como MCP comum:

- **ferramentas com efeito colateral** (enviar um e-mail, gravar um arquivo) sempre passam direto;
- pedidos apenas *parecidos*: a correspondência é exata depois da canonicalização, e correspondência semântica é trabalho futuro;
- resultados de ferramenta em várias idas e voltas (`input_required`), que o próprio MCP não guarda em cache;
- argumentos que não validam contra o schema da ferramenta.

O IDEM também não substitui o MCP. É uma camada por baixo e ao lado dele.

## O que existe hoje {#status}

O IDEM é um protótipo de pesquisa da disciplina EEL878 (Redes de Computadores I, UFRJ). Isto é o que está implementado nesta versão do site:

| Parte | Estado |
|---|---|
| `@idem/core`: nomes, canonicalização, assinaturas, manifesto, motor do forwarder | implementado, testado contra as regras MUST do protocolo |
| `@idem/gateway`: IDEM sobre HTTP (handler do produtor, forwarder, cliente que verifica) | implementado |
| `@idem/mcp`: produtor e borda como endpoints MCP, verificação de resultados | implementado; o wrapper `withIdem(server)` está planejado |
| `@idem/sim`: simulador determinístico sobre o motor real | implementado |
| `@idem/ndn`: binding NDN nativo (NDNts) | implementado e testado sobre um forwarder NDN em processo; execuções no NFD do Mini-NDN pendentes |
| Experimentos | veja o método em [Avaliação](/docs/evaluation) e o que já foi medido em [Resultados](/results) |

As hipóteses que o projeto testa são enunciadas antes de qualquer medição, e uma hipótese refutada com método correto é relatada como refutada.

## Como ler esta documentação {#map}

- **[Conceitos](/docs/concepts)** explica as ideias em ordem, com figuras. Comece por aqui.
- **[Arquitetura](/docs/architecture)** mostra os pacotes, o motor único do forwarder e os fluxos.
- **[Protocolo](/docs/protocol)** é o texto normativo, vindo da especificação do repositório. Cada regra tem um id, como [P-2.1], que os testes citam.
- **[Segurança](/docs/security)** percorre o modelo de ameaças e a regra por trás de cada defesa.
- **[Referência da API](/docs/api)** lista o que cada pacote exporta.
- **[Como usar o sandbox](/docs/sandbox)** diz o que você está vendo quando abre o [sandbox](/sandbox).
- **[Avaliação](/docs/evaluation)** descreve os experimentos; **[Decisões](/docs/decisions)** e **[Referências](/docs/references)** registram por que as coisas são como são e em que se apoiam.
