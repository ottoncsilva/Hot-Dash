"use client";

import { useEffect, useState } from "react";

/**
 * CATÁLOGO DE APARELHOS dos previews.
 *
 * O preview existe para responder uma pergunta só: o que cabe na primeira tela
 * do lead. A resposta muda com o aparelho — um Galaxy de 360pt de largura corta
 * um rótulo de botão que passa folgado num iPhone Pro Max, e uma mensagem que
 * cabe inteira no 16 Pro Max exige rolagem no 12. Testar num tamanho só é
 * testar no aparelho errado para boa parte do público.
 *
 * As medidas são em PONTOS (iOS) e DP (Android) — a mesma unidade em que o CSS
 * mede, e a única em que essa comparação faz sentido: o iPhone 16 Pro Max tem
 * 1320 pixels de largura e 440 pontos, e é o segundo número que decide quantas
 * letras cabem no botão.
 *
 * Oito aparelhos, escolhidos por cobertura e não por catálogo: as três larguras
 * da linha comum do iPhone (390 · 393 · 402), as duas dos Plus/Pro Max
 * (430 · 440) e os três tamanhos que dominam o Android (360 do Galaxy e do Moto
 * G, 412 do Ultra). Quem couber no menor e não cortar no maior está coberto.
 */
export type Plataforma = "ios" | "android";

export type Aparelho = {
  id: string;
  nome: string;
  plataforma: Plataforma;
  /** Largura da tela em pontos (iOS) ou dp (Android). */
  largura: number;
  altura: number;
  /** Área segura do topo: notch, ilha ou barra de status. */
  seguraTopo: number;
  /** O recorte do topo, que é o que dá a cara do aparelho. */
  topo: "notch" | "ilha" | "furo";
  /** Raio do canto da TELA e espessura da moldura, em pontos. */
  raio: number;
  moldura: number;
};

/**
 * Alturas das barras do TELEGRAM, por plataforma.
 *
 * Não são iguais nos dois: o cabeçalho de conversa do Android é mais alto
 * (56dp contra 44pt) e a área de baixo do iPhone reserva 34pt para o indicador
 * de home, contra 24 da barra de gestos do Android. São ~20pt de diferença na
 * janela de conversa — o bastante para uma linha de texto ou meio botão.
 */
export const CHROME: Record<Plataforma, { cabecalho: number; digitacao: number; seguraBase: number }> = {
  ios: { cabecalho: 44, digitacao: 50, seguraBase: 34 },
  android: { cabecalho: 56, digitacao: 48, seguraBase: 24 },
};

/**
 * Corpo de texto do Telegram em cada plataforma. O app do Android desenha a
 * mensagem 1pt menor que o do iOS — o que muda onde a linha quebra.
 */
export const FONTES: Record<Plataforma, { texto: number; botao: number; linha: number }> = {
  ios: { texto: 17, botao: 15, linha: 22 },
  android: { texto: 16, botao: 14, linha: 21 },
};

export const APARELHOS: Aparelho[] = [
  // --- iPhone, linha comum -------------------------------------------------
  {
    id: "iphone-12-14",
    nome: "iPhone 12 · 13 · 14",
    plataforma: "ios",
    largura: 390,
    altura: 844,
    seguraTopo: 47,
    topo: "notch",
    raio: 47,
    moldura: 12,
  },
  {
    id: "iphone-15-16",
    nome: "iPhone 15 · 16",
    plataforma: "ios",
    largura: 393,
    altura: 852,
    seguraTopo: 59,
    topo: "ilha",
    raio: 49,
    moldura: 12,
  },
  {
    id: "iphone-17",
    nome: "iPhone 16 Pro · 17",
    plataforma: "ios",
    largura: 402,
    altura: 874,
    seguraTopo: 62,
    topo: "ilha",
    raio: 55,
    moldura: 12,
  },
  // --- iPhone Plus / Pro Max ----------------------------------------------
  {
    id: "iphone-plus",
    nome: "iPhone 15 · 16 Plus · 15 Pro Max",
    plataforma: "ios",
    largura: 430,
    altura: 932,
    seguraTopo: 59,
    topo: "ilha",
    raio: 53,
    moldura: 12,
  },
  {
    id: "iphone-pro-max",
    nome: "iPhone 16 · 17 Pro Max",
    plataforma: "ios",
    largura: 440,
    altura: 956,
    seguraTopo: 62,
    topo: "ilha",
    raio: 55,
    moldura: 12,
  },
  // --- Android -------------------------------------------------------------
  {
    id: "galaxy-s",
    nome: "Galaxy S24 · S25",
    plataforma: "android",
    largura: 360,
    altura: 780,
    seguraTopo: 24,
    topo: "furo",
    raio: 32,
    moldura: 9,
  },
  {
    id: "galaxy-ultra",
    nome: "Galaxy S24 · S25 Ultra",
    plataforma: "android",
    largura: 412,
    altura: 883,
    seguraTopo: 24,
    topo: "furo",
    raio: 24,
    moldura: 9,
  },
  {
    id: "moto-g",
    nome: "Moto G",
    plataforma: "android",
    largura: 360,
    altura: 800,
    seguraTopo: 24,
    topo: "furo",
    raio: 28,
    moldura: 9,
  },
];

/** O padrão continua sendo o iPhone 12/13/14 — o aparelho mais comum da base. */
export const APARELHO_PADRAO = APARELHOS[0];

/** Altura da janela de CONVERSA: o que sobra depois das barras. É esta medida
 *  que decide o que cabe na primeira tela. */
export function alturaDaConversa(ap: Aparelho): number {
  const c = CHROME[ap.plataforma];
  return ap.altura - ap.seguraTopo - c.cabecalho - c.digitacao - c.seguraBase;
}

const CHAVE = "hotdash:preview-aparelho";

/**
 * Aparelho escolhido, LEMBRADO entre as telas e entre as sessões.
 *
 * Quem testa no Galaxy testa no Galaxy nas duas telas: a escolha é sobre o
 * público da operação, não sobre a tela que está aberta. Ter que reescolher a
 * cada aba faria o operador conferir a configuração num aparelho e a aprovação
 * em outro sem perceber.
 *
 * A leitura acontece num efeito, e não no estado inicial, de propósito: o
 * servidor não tem `localStorage`, e ler na primeira renderização faria o HTML
 * do servidor divergir do que o navegador desenha.
 */
export function useAparelho(): [Aparelho, (id: string) => void] {
  const [id, setId] = useState(APARELHO_PADRAO.id);

  useEffect(() => {
    try {
      const salvo = window.localStorage.getItem(CHAVE);
      if (salvo && APARELHOS.some((a) => a.id === salvo)) setId(salvo);
    } catch {
      // Navegador com armazenamento bloqueado: segue no padrão.
    }
  }, []);

  function escolher(novo: string) {
    setId(novo);
    try {
      window.localStorage.setItem(CHAVE, novo);
    } catch {
      // idem
    }
  }

  return [APARELHOS.find((a) => a.id === id) || APARELHO_PADRAO, escolher];
}
