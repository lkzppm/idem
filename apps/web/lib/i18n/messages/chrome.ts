import { defineMessages } from "../locale";

/**
 * The site chrome: header, main nav, language and theme switches, the home section nav, the footer,
 * the placeholder page and the site-wide metadata. Protocol terms (Interest, Data) and names stay in
 * English in both languages.
 */
export const chrome = defineMessages(
  {
    meta: {
      title: "IDEM — Tool calls, as named data",
      description:
        "IDEM (Interest-Driven Exchange for Models) turns read-only MCP tool calls into names and their results into signed data that any node can serve and every consumer verifies. Research prototype, UFRJ EEL878.",
    },
    header: {
      /** Accessible name of the logo link. */
      home: "IDEM, home",
      /** Accessible name of the main nav landmark. */
      nav: "Main",
      tabs: { sandbox: "Sandbox", docs: "Docs", results: "Results" },
    },
    theme: { toLight: "Switch to light theme", toDark: "Switch to dark theme" },
    language: {
      /** Accessible name of the language radio group. */
      label: "Language",
      /** Shown on the switch while the page re-renders in the new language. */
      switching: "Switching language",
    },
    sectionNav: {
      label: "On this page",
      top: "Back to top",
    },
    footer: {
      thesis:
        "Interest-Driven Exchange for Models. If the question is the same, the answer is the same, and it does not need to cross the network again.",
      site: "Site",
      author: "Author",
      portfolio: "Portfolio",
      links: { home: "Home", sandbox: "Sandbox", docs: "Docs", results: "Results", brand: "Brand" },
      newTab: "opens in a new tab",
      prototype: "Research prototype",
      course: "EEL878 Computer Networks I",
      school: "UFRJ/Poli",
      term: "2026/2",
    },
    placeholder: { sandbox: "Open the sandbox", docs: "Read the docs" },
  },
  {
    meta: {
      title: "IDEM — Chamadas de ferramenta como dados nomeados",
      description:
        "IDEM (Interest-Driven Exchange for Models) transforma chamadas de ferramenta MCP somente leitura em nomes, e seus resultados em dados assinados que qualquer nó pode servir e todo consumidor verifica. Protótipo de pesquisa, UFRJ EEL878.",
    },
    header: {
      home: "IDEM, início",
      nav: "Principal",
      tabs: { sandbox: "Sandbox", docs: "Docs", results: "Resultados" },
    },
    theme: { toLight: "Mudar para o tema claro", toDark: "Mudar para o tema escuro" },
    language: {
      label: "Idioma",
      switching: "Trocando o idioma",
    },
    sectionNav: {
      label: "Nesta página",
      top: "Voltar ao topo",
    },
    footer: {
      thesis:
        "Interest-Driven Exchange for Models. Se a pergunta é a mesma, a resposta é a mesma, e ela não precisa atravessar a rede de novo.",
      site: "Site",
      author: "Autor",
      portfolio: "Portfólio",
      links: { home: "Início", sandbox: "Sandbox", docs: "Docs", results: "Resultados", brand: "Marca" },
      newTab: "abre em uma nova aba",
      prototype: "Protótipo de pesquisa",
      course: "EEL878 Redes de Computadores I",
      school: "UFRJ/Poli",
      term: "2026/2",
    },
    placeholder: { sandbox: "Abrir o sandbox", docs: "Ler a documentação" },
  },
);
