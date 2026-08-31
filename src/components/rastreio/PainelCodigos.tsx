"use client";

import { useEffect, useMemo, useState } from "react";
import { apiGet } from "@/lib/api";
import { periodQuery, type PeriodState } from "@/components/PeriodPicker";
import { useProfile } from "@/context/ProfileContext";
import type { PeriodKey } from "@/lib/periods";
import Resumo, { type NumeroDoResumo } from "./Resumo";
import TabelaRolante from "./TabelaRolante";

type CodeRow = {
  code: string;
  profileId: string | null;
  profileName: string;
  cliques: number;
  starts: number;
  gerados: number;
  pagos: number;
  paidCents: number;
  netCents: number;
  pendingCents: number;
  bots: string[];
};
type Group = { profileId: string | null; profileName: string; codes: CodeRow[] };
type Data = { period?: PeriodKey; groups?: Group[] };

function brl(cents: number) {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function n(v: number): string {
  return v.toLocaleString("pt-BR");
}

/**
 * A passagem de uma etapa para a seguinte, em porcentagem.
 *
 * `null` quando a etapa anterior é zero: dividir por zero não dá 0%, dá "não dá
 * para saber" — e escrever 0% ali acusaria uma queda que não houve.
 */
function pct(parte: number, total: number): string | null {
  if (total <= 0) return null;
  const v = (parte / total) * 100;
  return `${v >= 10 ? v.toFixed(0) : v.toFixed(1)}%`;
}

/** "sem código" é ausência de rastreio, não um código chamado assim — por isso
 *  o rótulo é diferente do resto e não vai em fonte de código. */
const SEM_CODIGO = "sem código";

type Coluna = "codigo" | "cliques" | "starts" | "gerados" | "pagos" | "conversao" | "faturamento";

const VALOR: Record<Coluna, (c: CodeRow) => number | string> = {
  codigo: (c) => c.code || SEM_CODIGO,
  cliques: (c) => c.cliques,
  starts: (c) => c.starts,
  gerados: (c) => c.gerados,
  pagos: (c) => c.pagos,
  conversao: (c) => (c.starts > 0 ? c.pagos / c.starts : 0),
  faturamento: (c) => c.paidCents,
};

/**
 * RASTREIO → CÓDIGOS: o funil de cada `?start=CODIGO`, em lista densa.
 *
 * ---------------------------------------------------------------------------
 * POR QUE DEIXOU DE SER UM CARD POR CÓDIGO
 * ---------------------------------------------------------------------------
 * Era um card de 250px de altura para mostrar quatro números. Num monitor de
 * 1440px sobrava tanta largura que "Cliques 260" e "Starts 71" ficavam a 380px
 * um do outro — a mesma tela cabia cinco códigos e o olho tinha de rolar para
 * comparar dois. Muito espaço para pouca informação, e a comparação, que é o
 * trabalho de verdade desta tela, ficava impossível.
 *
 * Código é uma LINHA de números. Linha se compara: o olho desce a coluna
 * "Vendas" e acha o vencedor sem ler nada. Vinte códigos cabem de uma vez onde
 * antes cabiam cinco.
 *
 * A tabela é a mesma do Financeiro (cabeçalho em mono, fios finos, rolagem
 * lateral com máscara no celular) — trocar de tela não pode parecer trocar de
 * sistema.
 *
 * ---------------------------------------------------------------------------
 * O QUE CADA COLUNA DIZ
 * ---------------------------------------------------------------------------
 * Cliques → Starts → Cobranças → Vendas é o funil, e a linha pequena embaixo de
 * cada número é a passagem desde a etapa anterior. Assim a linha se lê nos dois
 * sentidos: na horizontal, o caminho de um código; na vertical, quem ganha de
 * quem em cada etapa.
 *
 * A ordenação está nos CABEÇALHOS, não num seletor à parte: clicar em "Vendas"
 * é mais direto que abrir uma lista e procurar "Vendas (maior)", e devolve a
 * barra de filtros para o que ela é boa — buscar e esconder.
 */
export default function PainelCodigos({ period }: { period: PeriodState }) {
  // A modelo vem do Rastreio, que a compartilha com a aba de Links — e ela é a
  // mesma do menu (ver ProfileContext). Antes esta tela tinha um <select>
  // próprio: a mesma escolha em dois controles diferentes, e trocar de aba
  // perdia o filtro.
  const { profileId } = useProfile();
  const [data, setData] = useState<Data | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [ordem, setOrdem] = useState<Coluna>("faturamento");
  const [crescente, setCrescente] = useState(false);
  // Código que nunca gerou cobrança polui a lista quando se está procurando o
  // que dá dinheiro — mas não pode sumir por padrão, senão uma divulgação que
  // não converteu vira um buraco invisível.
  const [soComVenda, setSoComVenda] = useState(false);

  useEffect(() => {
    setErro(null);
    setData(null);
    apiGet<Data>(`/api/links/codigos?${periodQuery(period)}`)
      .then(setData)
      .catch((e) => setErro(e instanceof Error ? e.message : "Falha ao carregar."));
  }, [period]);

  const grupos = useMemo(() => {
    if (!data?.groups) return [];
    const termo = busca.trim().toLowerCase();
    return data.groups
      .filter((g) => !profileId || g.profileId === profileId)
      .map((g) => ({
        ...g,
        codes: g.codes
          .filter((c) => (soComVenda ? c.pagos > 0 : true))
          .filter((c) => {
            if (!termo) return true;
            const nome = c.code || SEM_CODIGO;
            return (
              nome.toLowerCase().includes(termo) ||
              c.bots.some((b) => b.toLowerCase().includes(termo))
            );
          })
          .sort((a, b) => {
            const va = VALOR[ordem](a);
            const vb = VALOR[ordem](b);
            const cmp =
              typeof va === "string" && typeof vb === "string"
                ? va.localeCompare(vb, "pt-BR")
                : (vb as number) - (va as number);
            return crescente ? -cmp : cmp;
          }),
      }))
      .filter((g) => g.codes.length > 0);
  }, [data, profileId, busca, ordem, crescente, soComVenda]);

  const linhas = useMemo(() => grupos.flatMap((g) => g.codes), [grupos]);

  // Resumo do topo: soma do que está VISÍVEL, não do acervo inteiro — senão o
  // número do topo contradiz a lista logo abaixo dele.
  const total = useMemo(() => {
    const paidCents = linhas.reduce((s, c) => s + c.paidCents, 0);
    // O que chegou SEM rastreio nenhum: a métrica que diz o tamanho do ponto
    // cego. Sozinha, a linha "sem código" fica perdida no meio da lista
    // ordenada por faturamento, e é justamente a que precisa saltar.
    const semCodigo = linhas.filter((c) => !c.code);
    const semCodigoCents = semCodigo.reduce((s, c) => s + c.paidCents, 0);
    return {
      codigos: linhas.filter((c) => c.code).length,
      cliques: linhas.reduce((s, c) => s + c.cliques, 0),
      starts: linhas.reduce((s, c) => s + c.starts, 0),
      pagos: linhas.reduce((s, c) => s + c.pagos, 0),
      paidCents,
      semCodigoStarts: semCodigo.reduce((s, c) => s + c.starts, 0),
      semCodigoCents,
      semCodigoPct: paidCents > 0 ? (semCodigoCents / paidCents) * 100 : 0,
    };
  }, [linhas]);

  /** A barra do faturamento é proporcional ao MAIOR código da lista, não ao
   *  total: o que se quer de relance é quem ganha de quem, e contra o total
   *  tudo vira um tracinho. Mesma regra da barra de cliques em Links. */
  const maiorFaturamento = useMemo(
    () => Math.max(0, ...linhas.map((c) => c.paidCents)),
    [linhas],
  );

  const numeros: NumeroDoResumo[] = useMemo(() => {
    const lista: NumeroDoResumo[] = [
      { rotulo: "Códigos", valor: n(total.codigos), nota: "com movimento no período" },
      { rotulo: "Cliques", valor: total.cliques > 0 ? n(total.cliques) : "—", nota: "nos links do SLT" },
      { rotulo: "Starts", valor: n(total.starts), nota: "entraram no bot" },
      { rotulo: "Vendas", valor: n(total.pagos), nota: "pagas" },
      { rotulo: "Faturamento", valor: brl(total.paidCents), nota: "o que estes códigos trouxeram", cor: "text-emerald-400" },
    ];
    // Só entra quando existe: sem nada fora do rastreio, um número zerado todo
    // dia vira ruído que ninguém lê.
    if (total.semCodigoCents > 0 || total.semCodigoStarts > 0) {
      lista.push({
        rotulo: "Sem código",
        valor: total.semCodigoCents > 0 ? `${total.semCodigoPct.toFixed(0)}%` : n(total.semCodigoStarts),
        nota: total.semCodigoCents > 0 ? `${brl(total.semCodigoCents)} fora do rastreio` : "starts, nenhuma venda",
        cor: "text-amber-400",
      });
    }
    return lista;
  }, [total]);

  const filtrando = busca !== "" || soComVenda;

  function ordenarPor(c: Coluna) {
    if (c === ordem) setCrescente((v) => !v);
    else {
      setOrdem(c);
      setCrescente(false);
    }
  }

  if (erro) {
    return (
      <div className="mt-4 card border-red-500/30 bg-red-500/[0.07] p-4 text-sm text-red-300">{erro}</div>
    );
  }
  if (!data) {
    return (
      <div className="mt-4 space-y-3">
        <div className="h-24 animate-pulse rounded-xl bg-white/[0.03]" />
        <div className="h-64 animate-pulse rounded-xl bg-white/[0.03]" />
      </div>
    );
  }

  return (
    <>
      <Resumo numeros={numeros} />

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <input
          className="input w-full py-1.5 text-xs sm:w-56"
          placeholder="Buscar código ou bot..."
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
        />
        <label className="flex shrink-0 cursor-pointer items-center gap-2 py-1.5 text-xs text-zinc-400 hover:text-zinc-200">
          <input
            type="checkbox"
            checked={soComVenda}
            onChange={(e) => setSoComVenda(e.target.checked)}
            className="h-4 w-4 accent-emerald-500"
          />
          Só com venda
        </label>
        {filtrando && (
          <button
            type="button"
            onClick={() => {
              setBusca("");
              setSoComVenda(false);
            }}
            className="btn-ghost py-1.5 text-xs"
          >
            Limpar
          </button>
        )}
        <p className="ml-auto font-mono text-[11px] text-zinc-600">
          {linhas.length} {linhas.length === 1 ? "linha" : "linhas"}
        </p>
      </div>

      {grupos.length === 0 ? (
        <p className="mt-4 card p-6 text-center text-sm text-zinc-500">
          {data.groups && data.groups.length > 0
            ? "Nenhum código com esse filtro."
            : "Nenhum código de rastreio no período. Os códigos aparecem sozinhos assim que um lead entra por um link com ?start=CODIGO."}
        </p>
      ) : (
        <>
        {/* CELULAR: sem tabela. Sete colunas não cabem em 390px, e a rolagem
            lateral esconderia justamente o dinheiro — a coluna pela qual esta
            tela existe. Aqui a linha empilha: identidade e valor em cima, o
            funil numa faixa de quatro embaixo. */}
        <div className="mt-4 card divide-y divide-white/[0.06] lg:hidden">
          {grupos.map((g) => (
            <div key={g.profileId || "sem-modelo"}>
              <div className="bg-white/[0.015] px-3 py-1.5">
                <span className={`eyebrow ${g.profileId ? "" : "text-amber-400"}`}>{g.profileName}</span>
                <span className="ml-2 font-mono text-[10px] text-zinc-600">({g.codes.length})</span>
              </div>
              {g.codes.map((c) => (
                <LinhaCompacta key={`${g.profileId || ""}|${c.code}`} codigo={c} maior={maiorFaturamento} />
              ))}
            </div>
          ))}
        </div>

        <div className="hidden lg:block">
        <TabelaRolante larguraMinima={900}>
          <thead>
            <tr className="border-b border-white/[0.06] bg-white/[0.02] font-mono text-[10px] uppercase tracking-wider text-zinc-500">
              <Cabecalho coluna="codigo" ordem={ordem} crescente={crescente} aoClicar={ordenarPor} className="w-[210px] min-w-[190px]">
                Código
              </Cabecalho>
              {/* A folga da tabela vira informação em vez de ar. Antes sobravam
                  600px vazios entre o nome do bot e o primeiro número; agora
                  eles carregam quanto do faturamento do período é deste código
                  — a mesma barra que a aba de Links usa para o clique, aqui
                  para o dinheiro. Sem ordenação própria: ela é proporcional ao
                  faturamento, e dois cabeçalhos ordenando pela mesma coisa só
                  confundem. */}
              <th className="w-full min-w-[140px] p-3 font-normal uppercase tracking-wider">
                % do faturamento
              </th>
              <Cabecalho coluna="cliques" ordem={ordem} crescente={crescente} aoClicar={ordenarPor} numerica className="w-[92px] min-w-[92px]">
                Cliques
              </Cabecalho>
              <Cabecalho coluna="starts" ordem={ordem} crescente={crescente} aoClicar={ordenarPor} numerica className="w-[92px] min-w-[92px]">
                Starts
              </Cabecalho>
              <Cabecalho coluna="gerados" ordem={ordem} crescente={crescente} aoClicar={ordenarPor} numerica className="w-[92px] min-w-[92px]">
                Cobranças
              </Cabecalho>
              <Cabecalho coluna="pagos" ordem={ordem} crescente={crescente} aoClicar={ordenarPor} numerica className="w-[92px] min-w-[92px]">
                Vendas
              </Cabecalho>
              <Cabecalho coluna="conversao" ordem={ordem} crescente={crescente} aoClicar={ordenarPor} numerica className="w-[92px] min-w-[92px]">
                Conv.
              </Cabecalho>
              <Cabecalho coluna="faturamento" ordem={ordem} crescente={crescente} aoClicar={ordenarPor} numerica className="w-[150px] min-w-[150px]">
                Faturamento
              </Cabecalho>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.04]">
            {grupos.map((g) => (
              <FragmentoDoGrupo
                key={g.profileId || "sem-modelo"}
                grupo={g}
                maiorFaturamento={maiorFaturamento}
                totalCents={total.paidCents}
              />
            ))}
          </tbody>
        </TabelaRolante>
        </div>
        </>
      )}
    </>
  );
}

/** Uma modelo e os códigos dela. O cabeçalho é uma LINHA da mesma tabela, não
 *  uma tabela nova por modelo: assim as colunas ficam alinhadas de ponta a
 *  ponta e dá para comparar código de modelos diferentes sem conferir na mão. */
function FragmentoDoGrupo({
  grupo,
  maiorFaturamento,
  totalCents,
}: {
  grupo: Group;
  maiorFaturamento: number;
  totalCents: number;
}) {
  return (
    <>
      <tr className="border-t border-white/[0.06] bg-white/[0.015]">
        <td colSpan={8} className="px-3 py-1.5">
          <span className={`eyebrow ${grupo.profileId ? "" : "text-amber-400"}`}>
            {grupo.profileName}
          </span>
          <span className="ml-2 font-mono text-[10px] text-zinc-600">({grupo.codes.length})</span>
        </td>
      </tr>
      {grupo.codes.map((c) => (
        <LinhaDoCodigo
          key={`${grupo.profileId || ""}|${c.code}`}
          codigo={c}
          maior={maiorFaturamento}
          totalCents={totalCents}
        />
      ))}
    </>
  );
}

function LinhaDoCodigo({
  codigo,
  maior,
  totalCents,
}: {
  codigo: CodeRow;
  maior: number;
  totalCents: number;
}) {
  const conversao = codigo.starts > 0 ? (codigo.pagos / codigo.starts) * 100 : null;
  // A barra é proporcional ao MAIOR código, o número é a fatia do TOTAL. São
  // duas perguntas diferentes — "ganha de quem?" e "quanto do meu faturamento
  // é isto?" — e contra o total a barra do segundo colocado já vira um risco.
  const largura =
    maior > 0 && codigo.paidCents > 0 ? Math.max(2, Math.round((codigo.paidCents / maior) * 100)) : 0;
  const participacao =
    totalCents > 0 && codigo.paidCents > 0 ? pct(codigo.paidCents, totalCents) || "" : "—";

  return (
    <tr className="align-top transition-colors hover:bg-white/[0.03]">
      <td className="px-3 py-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {codigo.code ? (
            // Roxo, o mesmo da pílula de deep-link em Links: é a marca visual de
            // "este caminho dá para seguir até a venda".
            <span
              className="rounded-md border border-violet-500/30 bg-violet-500/10 px-1.5 py-0.5 font-mono text-[11px] text-violet-300"
              title={`Deep-link: t.me/<bot>?start=${codigo.code}`}
            >
              {codigo.code}
            </span>
          ) : (
            // Âmbar, o mesmo que Links usa para "sem rede": não é erro, é o que
            // está fora do rastreio — e precisa saltar dentro de uma lista
            // ordenada por faturamento, onde essa linha cai em qualquer posição.
            <span
              className="rounded-md border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[11px] text-amber-400"
              title="Lead que entrou pelo link sem ?start=CODIGO, ou venda cujo código não foi possível recuperar de nenhuma fonte."
            >
              {SEM_CODIGO}
            </span>
          )}
          {codigo.starts === 0 && codigo.gerados > 0 && (
            <span
              className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-[10px] text-zinc-500"
              title="A venda trouxe o código, mas nenhum /start com ele caiu neste período — normal quando o lead entrou antes da janela escolhida."
            >
              sem start
            </span>
          )}
        </div>
        {codigo.bots.length > 0 && (
          <p className="mt-0.5 truncate font-mono text-[11px] leading-[14px] text-zinc-600" title={codigo.bots.join(", ")}>
            {codigo.bots.map((b) => `@${b}`).join(" · ")}
          </p>
        )}
      </td>

      <td className="px-3 py-2">
        <div className="flex items-center gap-2">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
            <div
              className="h-full rounded-full bg-emerald-500/70 transition-all duration-300"
              style={{ width: `${largura}%` }}
            />
          </div>
          <span className="w-10 shrink-0 text-right font-mono text-[11px] text-zinc-500">
            {participacao}
          </span>
        </div>
      </td>

      {/* Traço, e não zero, quando não há clique: zero afirma que ninguém
          clicou; traço diz que não há de onde saber — é o caso das Prévias,
          cujo link é convite de grupo e não carrega código. */}
      <Numero valor={codigo.cliques > 0 ? n(codigo.cliques) : "—"} apagado={codigo.cliques === 0} />
      <Numero valor={n(codigo.starts)} queda={codigo.cliques > 0 ? pct(codigo.starts, codigo.cliques) : null} />
      <Numero valor={n(codigo.gerados)} queda={pct(codigo.gerados, codigo.starts)} />
      <Numero valor={n(codigo.pagos)} queda={pct(codigo.pagos, codigo.gerados)} destaque />
      <Numero valor={conversao !== null ? `${conversao.toFixed(conversao >= 10 ? 0 : 1)}%` : "—"} apagado={conversao === null} />

      <td className="px-3 py-2 text-right">
        <p className={`font-mono text-[13px] ${codigo.paidCents > 0 ? "text-emerald-400" : "text-zinc-600"}`}>
          {brl(codigo.paidCents)}
        </p>
        {codigo.pendingCents > 0 && (
          <p className="mt-0.5 text-[10px] leading-[12px] text-amber-400/80" title="Cobrança gerada e ainda não paga">
            {brl(codigo.pendingCents)} na mesa
          </p>
        )}
      </td>
    </tr>
  );
}

/**
 * A mesma linha, no celular.
 *
 * Não é o card de antes: aquele gastava 250px para mostrar quatro números e
 * cabiam três na tela. Aqui a identidade e o dinheiro dividem a primeira linha
 * — os dois que se procura — e o funil vem embaixo numa faixa de quatro, com a
 * passagem de cada etapa por baixo do número. Cerca de 110px por código.
 *
 * O mesmo conteúdo da tabela do desktop, nas mesmas cores e com as mesmas
 * regras (traço quando não há clique, roxo no código, âmbar fora do rastreio):
 * é a MESMA linha em outro formato, não outra tela.
 */
function LinhaCompacta({ codigo, maior }: { codigo: CodeRow; maior: number }) {
  const conversao = codigo.starts > 0 ? (codigo.pagos / codigo.starts) * 100 : null;
  const largura =
    maior > 0 && codigo.paidCents > 0 ? Math.max(2, Math.round((codigo.paidCents / maior) * 100)) : 0;

  return (
    <div className="px-3 py-2.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            {codigo.code ? (
              <span className="rounded-md border border-violet-500/30 bg-violet-500/10 px-1.5 py-0.5 font-mono text-[11px] text-violet-300">
                {codigo.code}
              </span>
            ) : (
              <span className="rounded-md border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[11px] text-amber-400">
                {SEM_CODIGO}
              </span>
            )}
            {codigo.starts === 0 && codigo.gerados > 0 && (
              <span className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-[10px] text-zinc-500">
                sem start
              </span>
            )}
          </div>
          {codigo.bots.length > 0 && (
            <p className="mt-0.5 truncate font-mono text-[11px] leading-[14px] text-zinc-600">
              {codigo.bots.map((b) => `@${b}`).join(" · ")}
            </p>
          )}
        </div>
        <div className="shrink-0 text-right">
          <p className={`font-mono text-[13px] ${codigo.paidCents > 0 ? "text-emerald-400" : "text-zinc-600"}`}>
            {brl(codigo.paidCents)}
          </p>
          {codigo.pendingCents > 0 && (
            <p className="text-[10px] leading-[13px] text-amber-400/80">{brl(codigo.pendingCents)} na mesa</p>
          )}
        </div>
      </div>

      <div className="mt-1.5 h-[3px] overflow-hidden rounded-full bg-white/[0.06]">
        <div className="h-full rounded-full bg-emerald-500/70" style={{ width: `${largura}%` }} />
      </div>

      <div className="mt-1.5 grid grid-cols-5 gap-1">
        <EtapaCompacta rotulo="cliques" valor={codigo.cliques > 0 ? n(codigo.cliques) : "—"} apagado={codigo.cliques === 0} />
        <EtapaCompacta rotulo="starts" valor={n(codigo.starts)} queda={codigo.cliques > 0 ? pct(codigo.starts, codigo.cliques) : null} />
        <EtapaCompacta rotulo="cobr." valor={n(codigo.gerados)} queda={pct(codigo.gerados, codigo.starts)} />
        <EtapaCompacta rotulo="vendas" valor={n(codigo.pagos)} queda={pct(codigo.pagos, codigo.gerados)} destaque />
        <EtapaCompacta
          rotulo="conv."
          valor={conversao !== null ? `${conversao.toFixed(conversao >= 10 ? 0 : 1)}%` : "—"}
          apagado={conversao === null}
        />
      </div>
    </div>
  );
}

function EtapaCompacta({
  rotulo,
  valor,
  queda,
  destaque,
  apagado,
}: {
  rotulo: string;
  valor: string;
  queda?: string | null;
  destaque?: boolean;
  apagado?: boolean;
}) {
  return (
    <div>
      <p className="font-mono text-[9px] uppercase tracking-wider text-zinc-600">{rotulo}</p>
      <p
        className={`font-mono text-[13px] leading-[16px] ${
          apagado ? "text-zinc-600" : destaque ? "text-emerald-400" : "text-zinc-100"
        }`}
      >
        {valor}
      </p>
      {/* Altura reservada: sem ela as cinco colunas ficam de alturas
          diferentes e a faixa serrilha de linha para linha. */}
      <p className="min-h-[12px] font-mono text-[9px] leading-[12px] text-zinc-600">{queda ?? ""}</p>
    </div>
  );
}

/** Célula numérica do funil: o número em cima, a passagem desde a etapa
 *  anterior embaixo. A segunda linha tem altura reservada mesmo vazia — sem
 *  isso as linhas da tabela mudam de altura e o ritmo da coluna some. */
function Numero({
  valor,
  queda,
  destaque,
  apagado,
}: {
  valor: string;
  queda?: string | null;
  destaque?: boolean;
  apagado?: boolean;
}) {
  return (
    <td className="px-3 py-2 text-right">
      <p
        className={`font-mono text-[13px] ${
          apagado ? "text-zinc-600" : destaque ? "text-emerald-400" : "text-zinc-100"
        }`}
      >
        {valor}
      </p>
      <p className="mt-1 min-h-[12px] font-mono text-[10px] leading-[12px] text-zinc-600">
        {queda ?? ""}
      </p>
    </td>
  );
}

/** Cabeçalho que ordena. A seta só aparece na coluna ativa: uma seta em cada
 *  coluna vira ruído e nenhuma delas informa qual está valendo. */
function Cabecalho({
  coluna,
  ordem,
  crescente,
  aoClicar,
  numerica,
  className = "",
  children,
}: {
  coluna: Coluna;
  ordem: Coluna;
  crescente: boolean;
  aoClicar: (c: Coluna) => void;
  numerica?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const ativa = ordem === coluna;
  return (
    <th className={`p-0 font-normal ${className}`} aria-sort={ativa ? (crescente ? "ascending" : "descending") : "none"}>
      <button
        type="button"
        onClick={() => aoClicar(coluna)}
        className={`flex w-full items-center gap-1 p-3 uppercase tracking-wider transition-colors hover:text-zinc-200 ${
          numerica ? "justify-end" : ""
        } ${ativa ? "text-zinc-200" : ""}`}
      >
        {children}
        <span className={`text-[8px] ${ativa ? "" : "invisible"}`}>{crescente ? "▲" : "▼"}</span>
      </button>
    </th>
  );
}
