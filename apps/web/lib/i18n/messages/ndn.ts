import { defineMessages } from "../locale";

/**
 * The native NDN view of one sandbox exchange (`components/sandbox/ndn-packet.tsx`, ADR-026).
 * Protocol and packet-format terms (Interest, Data, TLV, Name, Content, KeyLocator, NDN, NFD,
 * TLV-TYPE names), names, digests and numbers are never translated.
 */
export const ndn = defineMessages(
  {
    title: "Native NDN",
    blurb: "The same exchange as NDN TLV packets, built in this page with NDNts from the real ones.",
    packet: "Packet",
    interest: "Interest",
    data: "Data",
    name: "Name",
    tree: "TLV",
    bytes: "Bytes",
    size: (ndnBytes: number, overlayBytes: number) =>
      `${ndnBytes} B as NDN TLV · ${overlayBytes} B as overlay JSON`,
    field: (type: number, length: number) => `type ${type} · length ${length}`,
    hoverHint: "Point at or focus a field to light up its bytes.",
    pending: "Building the packets…",
    waiting: "The Interest is ready; the Data has not arrived yet.",
    verify: {
      title: "Signatures, checked here on the Data bytes",
      outer: "NDN signature",
      outerNote: "made in this page by a throwaway translator key",
      inner: "IDEM signature",
      innerNote: "the producer's own, inside Content",
      ok: "valid",
      bad: "invalid",
    },
    translatorNote:
      "This page does not hold the producer's private key, so the NDN-level signature on this Data is a translator's, and its KeyLocator says so. A native producer signs with its own key. The IDEM signature inside Content is the producer's either way.",
    unavailable: {
      private:
        "Private results never travel on native NDN: NFD aggregates and caches by name alone, with no authorization context, so this call stays on the overlay.",
      plain: "A plain call has no IDEM name, so it has no native packet.",
      tooLarge: (max: number) =>
        `This Data is larger than an NDN packet (${max} bytes), and the native binding does not segment.`,
      error: (m: string) => `Could not build the packets: ${m}`,
    },
  },
  {
    title: "NDN nativo",
    blurb:
      "A mesma troca como pacotes TLV do NDN, montados nesta página com o NDNts a partir dos pacotes reais.",
    packet: "Pacote",
    interest: "Interest",
    data: "Data",
    name: "Name",
    tree: "TLV",
    bytes: "Bytes",
    size: (ndnBytes: number, overlayBytes: number) =>
      `${ndnBytes} B em TLV do NDN · ${overlayBytes} B em JSON do overlay`,
    field: (type: number, length: number) => `tipo ${type} · tamanho ${length}`,
    hoverHint: "Aponte ou foque um campo para destacar seus bytes.",
    pending: "Montando os pacotes…",
    waiting: "O Interest está pronto; o Data ainda não chegou.",
    verify: {
      title: "Assinaturas, conferidas aqui nos bytes do Data",
      outer: "Assinatura NDN",
      outerNote: "feita nesta página por uma chave descartável de tradutor",
      inner: "Assinatura IDEM",
      innerNote: "a do próprio produtor, dentro do Content",
      ok: "válida",
      bad: "inválida",
    },
    translatorNote:
      "Esta página não tem a chave privada do produtor, então a assinatura NDN deste Data é de um tradutor, e o KeyLocator diz isso. Um produtor nativo assina com a própria chave. A assinatura IDEM dentro do Content é a do produtor nos dois casos.",
    unavailable: {
      private:
        "Resultados privados nunca trafegam no NDN nativo: o NFD agrega e guarda em cache só pelo nome, sem contexto de autorização, então esta chamada fica no overlay.",
      plain: "Uma chamada simples não tem nome IDEM, então não tem pacote nativo.",
      tooLarge: (max: number) =>
        `Este Data é maior que um pacote NDN (${max} bytes), e o binding nativo não segmenta.`,
      error: (m: string) => `Não foi possível montar os pacotes: ${m}`,
    },
  },
);
