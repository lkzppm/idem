import { defineMessages } from "../locale";

/** The brand page (`/brand`): the chosen mark and the explorations it was chosen from. */
export const brand = defineMessages(
  {
    meta: { title: "Brand" },
    eyebrow: "Brand",
    heading: "The mark",
    lead: "Monochrome first, with an accent variant in the two protocol colors (blue = Interest, the request; amber = Data, the answer). Sizes go down to 16 px to check the favicon.",
    chosen: "Chosen",
    chosenName: "Exchange",
    /** The chosen mark's story; `idem` is set in italics between `before` and `after`. */
    chosenBody: {
      before:
        "Two harpoons. The upper one runs right: the request, an Interest, in blue. The lower one runs left: the answer, a Data, in amber. Read together they are an equals sign, and ",
      after:
        " means “the same”. Turned half a turn the mark is itself: the answer is the question, returned. Square caps and mitred barbs, like the rest of the interface.",
    },
    tone: { accent: "accent", mono: "mono" },
    theme: { dark: "dark", light: "light" },
    appIcon: "App icon",
    earlier: "Earlier explorations",
    earlierLead: "The concepts the mark was chosen from, kept for the record.",
    concepts: {
      ditto: {
        name: "Ditto //",
        meaning:
          "The ditto mark ″ literally means “idem: the same as above”. Drawn as two slashes it is also the separator of every IDEM name (/idem/v1/…). Two strokes: the question and the identical answer.",
      },
      wedge: {
        name: "Ditto, typographic",
        meaning: "Same idea, closer to the printed ″. Warmer and more editorial; slightly weaker at 16 px.",
      },
      fanin: {
        name: "Fan-in",
        meaning:
          "Three requests merge in the Pending Interest Table; one answer leaves. Explains the mechanism at a glance.",
      },
      hub: {
        name: "Hub & wave",
        meaning:
          "The name at the center, the signed answer radiating back. Echoes the landing hero animation.",
      },
      twin: {
        name: "Twin",
        meaning:
          "Two identical tiles; where request and answer coincide, the name is solid. Reads as “same, cached”.",
      },
      dot: {
        name: "Wordmark only",
        meaning:
          "No symbol: lowercase “idem” whose dot is the Interest. Quiet, in the Vercel/Resend register.",
      },
    },
  },
  {
    meta: { title: "Marca" },
    eyebrow: "Marca",
    heading: "O símbolo",
    lead: "Monocromático antes de tudo, com uma variante de destaque nas duas cores do protocolo (azul = Interest, o pedido; âmbar = Data, a resposta). Os tamanhos descem até 16 px para conferir o favicon.",
    chosen: "Escolhido",
    chosenName: "Troca",
    chosenBody: {
      before:
        "Dois arpões. O de cima corre para a direita: o pedido, um Interest, em azul. O de baixo corre para a esquerda: a resposta, um Data, em âmbar. Lidos juntos são um sinal de igual, e ",
      after:
        " quer dizer “o mesmo”. Girado meia volta, o símbolo continua igual: a resposta é a pergunta, devolvida. Pontas retas e farpas em esquadria, como o resto da interface.",
    },
    tone: { accent: "destaque", mono: "mono" },
    theme: { dark: "escuro", light: "claro" },
    appIcon: "Ícone do app",
    earlier: "Explorações anteriores",
    earlierLead: "Os conceitos entre os quais o símbolo foi escolhido, guardados para registro.",
    concepts: {
      ditto: {
        name: "Idem //",
        meaning:
          "O sinal de idem ″ quer dizer literalmente “idem: o mesmo que acima”. Desenhado como duas barras, ele também é o separador de todo nome IDEM (/idem/v1/…). Dois traços: a pergunta e a resposta idêntica.",
      },
      wedge: {
        name: "Idem, tipográfico",
        meaning:
          "A mesma ideia, mais perto do ″ impresso. Mais caloroso e editorial; um pouco mais fraco em 16 px.",
      },
      fanin: {
        name: "Convergência",
        meaning:
          "Três pedidos se juntam na Pending Interest Table; sai uma resposta. Explica o mecanismo num relance.",
      },
      hub: {
        name: "Centro e onda",
        meaning:
          "O nome no centro, a resposta assinada irradiando de volta. Ecoa a animação do topo da página inicial.",
      },
      twin: {
        name: "Gêmeos",
        meaning:
          "Dois quadrados idênticos; onde pedido e resposta coincidem, o nome é sólido. Lê-se “o mesmo, em cache”.",
      },
      dot: {
        name: "Só o logotipo",
        meaning:
          "Sem símbolo: “idem” em minúsculas, com o pingo do i sendo o Interest. Discreto, no registro de Vercel/Resend.",
      },
    },
  },
);
