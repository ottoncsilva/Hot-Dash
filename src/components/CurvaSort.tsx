"use client";

/**
 * Controle de ordenação das curvas de vendas (por dia da semana e por hora),
 * usado no Dashboard e no Relatório do Financeiro.
 *
 * "Cronológica" é o padrão porque a pergunta natural desses cards é a FORMA da
 * curva — de que horas o público compra e de que horas não compra. As outras
 * duas servem para a pergunta inversa: qual faixa rende mais. Como as três
 * ordens respondem coisas diferentes, o controle fica visível no cabeçalho do
 * card em vez de escondido num menu.
 */
export type CurvaOrdem = "cron" | "count" | "cents";

export const ORDEM_OPCOES: { value: CurvaOrdem; label: string }[] = [
  { value: "cron", label: "Ordem do dia" },
  { value: "count", label: "Mais vendas" },
  { value: "cents", label: "Maior valor" },
];

/**
 * Altura fixa de cada faixa e quantas ficam visíveis.
 *
 * O card de horas tem 24 faixas e o de dias tem 7. Fixando a altura da linha e
 * mostrando 7, os dois cards ficam com a MESMA altura — o de dias preenche
 * exato, o de horas rola por dentro. Sem altura fixa por linha as duas colunas
 * ficariam desalinhadas, porque a faixa sem venda não tem a linha de médias.
 */
export const FAIXA_ALTURA = 48;
export const FAIXAS_VISIVEIS = 7;
export const FAIXA_GAP = 4;
export const ALTURA_LISTA =
  FAIXAS_VISIVEIS * FAIXA_ALTURA + (FAIXAS_VISIVEIS - 1) * FAIXA_GAP;

/**
 * Altura da tabela de curva do Relatório: cabeçalho fixo + as mesmas 7 linhas.
 * Lá a linha é de uma só (`py-2` + `text-sm` + divisória ≈ 37px), menor que a
 * do card do Dashboard, que carrega a segunda linha de médias.
 */
const LINHA_TABELA = 37;
const CABECALHO_TABELA = 32;
export const ALTURA_TABELA = CABECALHO_TABELA + FAIXAS_VISIVEIS * LINHA_TABELA;

/** Comparador para as três ordens, dado como ler quantidade e valor da faixa. */
export function ordenarFaixas<T extends { key: number }>(
  faixas: T[],
  ordem: CurvaOrdem,
  ler: (f: T) => { count: number; cents: number },
): T[] {
  const copia = [...faixas];
  if (ordem === "cron") return copia.sort((a, b) => a.key - b.key);
  // Desempate pela ordem do dia, para a lista não "tremer" entre renders quando
  // várias faixas empatam em zero.
  return copia.sort((a, b) => {
    const va = ler(a);
    const vb = ler(b);
    const diff = ordem === "count" ? vb.count - va.count : vb.cents - va.cents;
    return diff !== 0 ? diff : a.key - b.key;
  });
}

export default function CurvaSort({
  value,
  onChange,
  id,
}: {
  value: CurvaOrdem;
  onChange: (v: CurvaOrdem) => void;
  id?: string;
}) {
  return (
    <select
      id={id}
      aria-label="Ordenar as faixas"
      value={value}
      onChange={(e) => onChange(e.target.value as CurvaOrdem)}
      className="rounded-md border border-white/10 bg-white/[0.04] px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-zinc-400 outline-none transition-colors hover:bg-white/[0.07] focus:border-white/30 print:hidden"
    >
      {ORDEM_OPCOES.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
