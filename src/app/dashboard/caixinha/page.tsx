"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { apiGet, apiSend } from "@/lib/api";
import { showToast } from "@/lib/toast";
import { useProfile } from "@/context/ProfileContext";
import { PrecisaDeModelo } from "@/components/ProfilePicker";
import PageHeader from "@/components/PageHeader";
import Link from "next/link";
import {
  IconQuestion,
  IconSparkle,
  IconCheck,
  IconTrash,
  IconCopy,
  IconPlus,
} from "@/components/icons";

/**
 * CAIXINHA DE PERGUNTAS — o banco de ideias de Instagram de cada modelo.
 *
 * Em cima, o gerador; embaixo, a lista com a marca de USADA. A ordem não é
 * estética: a pergunta de quem abre esta tela é "o que eu posto hoje?", e a
 * resposta é a primeira ideia ainda não usada. Por isso as usadas descem e
 * ficam apagadas, em vez de sumirem — repetir uma caixinha que foi bem, meses
 * depois, é decisão de quem opera, mas tem que ser uma decisão.
 */

type Kind = "caixinha" | "duplo_sentido";

type Item = {
  id: string;
  profileId: string;
  kind: Kind;
  text: string;
  idea?: string;
  theme?: string;
  seconds?: number;
  provider?: string;
  used: boolean;
  usedAt?: number;
  createdAt: number;
};

const TIPOS: {
  key: Kind;
  label: string;
  hint: string;
  /** Como os dois campos se chamam neste tipo — a lista e o formulário seguem. */
  campo1: string;
  campo2: string;
}[] = [
  {
    key: "caixinha",
    label: "Caixinha de perguntas",
    hint: "Pergunta de seguidor + a resposta dela, curta e sem rodeio.",
    campo1: "Pergunta",
    campo2: "Resposta",
  },
  {
    key: "duplo_sentido",
    label: "Frases de duplo sentido",
    hint: "A frase do vídeo + a virada que entrega o segundo sentido.",
    campo1: "Frase",
    campo2: "Virada",
  },
];

/** Teto do par pergunta+resposta — sem piso (lib/questionBox.ts). */
const TAMANHO_MAX = 200;

/** Como cada provedor aparece na etiqueta da ideia e no botão. */
const PROVEDOR: Record<string, string> = {
  grok: "Grok",
  gemini: "Gemini",
  openai: "GPT",
  manual: "sua",
};

/** Os três, na ordem em que a tela os mostra (espelha lib/questionBox.ts). */
const PROVEDORES = ["grok", "gemini", "openai"];

/**
 * O texto como o GERADOR DE VÍDEO espera receber, linha a linha.
 *
 * Caixinha vai com os dois rótulos porque o vídeo tem as duas falas — a
 * pergunta lida na tela e a resposta dita. Frase de duplo sentido vai SÓ com a
 * frase: a virada é direção de cena, e colada na transcrição viraria texto
 * falado em voz alta.
 */
function textoDoGerador(item: Item): string[] {
  if (item.kind === "caixinha") {
    return [`Pergunta: ${item.text}`, ...(item.idea ? [`Resposta: ${item.idea}`] : [])];
  }
  return [item.text];
}

/** Os mesmos rótulos do cadastro da modelo (Modelos → Perfil da modelo). */
const COMO_ELA_E: Record<string, string> = {
  santinha: "Santinha — inocente por fora",
  safadinha: "Safadinha — safada na medida",
  explicita: "Explícita — sem papas na língua",
};

export default function CaixinhaPage() {
  const { profileId, profile } = useProfile();

  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(false);
  const [gerando, setGerando] = useState(false);
  const [kind, setKind] = useState<Kind>("caixinha");
  /**
   * Observação extra desta leva ("hoje ela é professora", "tema praia"). É um
   * RECORTE DE ASSUNTO em cima da persona do cadastro, não uma troca de
   * personagem — quem é a modelo já vem de Modelos. Fica preenchido entre as
   * levas: repetir o assunto é o uso normal, não a exceção.
   */
  const [tema, setTema] = useState("");
  /**
   * Quais IAs escrevem esta leva. Botões que acendem, não lista suspensa: são
   * três opções e a escolha muda a cada leva — quem quer só o Grok hoje clica
   * uma vez, em vez de abrir um menu para ver o que já sabe que tem lá.
   */
  const [ias, setIas] = useState<string[]>([...PROVEDORES]);
  /** Quem está de fato conectado — provedor sem chave nasce apagado. */
  const [conectados, setConectados] = useState<string[]>([...PROVEDORES]);
  const [filtro, setFiltro] = useState<"todas" | "novas" | "usadas">("todas");
  const [manualOpen, setManualOpen] = useState(false);
  const [manualText, setManualText] = useState("");
  const [manualIdea, setManualIdea] = useState("");

  const load = useCallback(async () => {
    if (!profileId) return;
    setLoading(true);
    try {
      const d = await apiGet<{ items: Item[] }>(`/api/question-box?profileId=${profileId}`);
      setItems(d.items || []);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Falha ao carregar.", "error");
    } finally {
      setLoading(false);
    }
  }, [profileId]);

  useEffect(() => {
    load();
  }, [load]);

  // Provedor sem chave não deve nascer aceso: o botão prometeria uma leva que
  // nunca vem. A tela pergunta uma vez quem está conectado e desliga o resto.
  useEffect(() => {
    (async () => {
      try {
        const d = await apiGet<{ settings: Record<string, { enabled?: boolean; hasKey?: boolean }> }>(
          "/api/settings/ai",
        );
        const ok = PROVEDORES.filter((p) => d.settings?.[p]?.enabled && d.settings?.[p]?.hasKey);
        setConectados(ok);
        setIas((antes) => {
          const cruzado = antes.filter((p) => ok.includes(p));
          return cruzado.length > 0 ? cruzado : ok;
        });
      } catch {
        // Sem a lista, deixa os três acesos: o erro real aparece ao gerar.
      }
    })();
  }, []);

  async function gerar() {
    if (!profileId) return;
    setGerando(true);
    try {
      const r = await apiSend<{ items: Item[]; provedores: string[]; erros: string[] }>(
        "/api/question-box",
        "POST",
        { action: "generate", profileId, kind, theme: tema, providers: ias },
      );
      // A lista vem inteira do servidor para não divergir da ordem dele.
      await load();
      const quantos = r.items?.length || 0;
      const de = (r.provedores || []).map((p) => PROVEDOR[p] || p).join(" + ");
      if (quantos === 0) {
        showToast("Nenhuma ideia nova — o que veio já estava na lista. Tente de novo.", "error");
      } else {
        showToast(`${quantos} ideia${quantos > 1 ? "s" : ""} nova${quantos > 1 ? "s" : ""}${de ? ` · ${de}` : ""}`, "success");
      }
      // Um provedor fora do ar não invalida a leva, mas o operador precisa
      // saber que ela veio menor do que poderia.
      if (r.erros?.length) showToast(r.erros.join(" · "), "error");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Falha ao gerar.", "error");
    } finally {
      setGerando(false);
    }
  }

  async function marcar(item: Item, used: boolean) {
    // Otimista: a marca é a ação mais repetida da tela e esperar o servidor a
    // cada clique deixaria a lista com cara de travada.
    setItems((prev) => prev.map((x) => (x.id === item.id ? { ...x, used } : x)));
    try {
      await apiSend("/api/question-box", "POST", { action: "toggle-used", id: item.id, used });
    } catch (e) {
      setItems((prev) => prev.map((x) => (x.id === item.id ? { ...x, used: !used } : x)));
      showToast(e instanceof Error ? e.message : "Falha ao marcar.", "error");
    }
  }

  // SEM confirmação: a lista é um rascunho de ideias, e no meio de uma leva de
  // nove a maioria vai fora. Um diálogo por descarte transformaria a triagem
  // numa sequência de cliques em "Sim".
  async function excluir(item: Item) {
    const antes = items;
    setItems((prev) => prev.filter((x) => x.id !== item.id));
    try {
      await apiSend("/api/question-box", "POST", { action: "delete", id: item.id });
    } catch (e) {
      // Falhou no servidor: a linha volta, senão a tela mentiria.
      setItems(antes);
      showToast(e instanceof Error ? e.message : "Falha ao excluir.", "error");
    }
  }

  async function adicionar() {
    if (!profileId || !manualText.trim()) return;
    try {
      const { item } = await apiSend<{ item: Item }>("/api/question-box", "POST", {
        action: "add",
        profileId,
        kind,
        text: manualText,
        idea: manualIdea,
        theme: tema,
      });
      setItems((prev) => [item, ...prev]);
      setManualText("");
      setManualIdea("");
      setManualOpen(false);
      showToast("Ideia adicionada.", "success");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Falha ao adicionar.", "error");
    }
  }

  const rotulos = TIPOS.find((x) => x.key === kind) || TIPOS[0];
  const temPersona = Boolean(
    profile?.bioPhysical || profile?.bioUnique || profile?.bioPersonality,
  );
  // UMA lista só. O tipo é uma etiqueta na linha, não uma gaveta: quem abre a
  // tela quer ver o que tem para postar hoje, e caixinha e frase de duplo
  // sentido concorrem pelo mesmo story — separá-las obrigava a conferir as
  // duas para saber o que sobrou.
  const visiveis = useMemo(
    () => items.filter((i) => (filtro === "novas" ? !i.used : filtro === "usadas" ? i.used : true)),
    [items, filtro],
  );
  const novas = items.filter((i) => !i.used).length;

  if (!profileId) {
    return (
      <div className="page">
        <PageHeader title="Caixinha de perguntas" />
        <PrecisaDeModelo oQue="gerar ideias de conteúdo" />
      </div>
    );
  }

  return (
    <div className="page">
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            <IconQuestion size={22} /> Caixinha de perguntas
          </span>
        }
      />

      {/* GERADOR */}
      <div className="card mt-4 p-4">
        <div className="grid gap-2 sm:grid-cols-2">
          {TIPOS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setKind(t.key)}
              className={`rounded-xl border p-3 text-left transition-colors ${
                kind === t.key
                  ? "border-emerald-500/40 bg-emerald-500/[0.07]"
                  : "border-white/10 bg-ink-850 hover:border-white/20"
              }`}
            >
              <p
                className={`text-sm font-semibold ${
                  kind === t.key ? "text-emerald-300" : "text-zinc-200"
                }`}
              >
                {t.label}
              </p>
              <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-500">{t.hint}</p>
            </button>
          ))}
        </div>

        {/* A PERSONA vem do cadastro da modelo escolhida no menu. Mostrada aqui
            porque, invisível, parecia não estar sendo usada — e o operador ia
            digitá-la de novo à mão. */}
        <div className="mt-3 rounded-xl border border-white/10 bg-ink-850 p-3">
          <div className="flex items-baseline justify-between gap-2">
            <p className="eyebrow">Persona · do cadastro de {profile?.name || "a modelo"}</p>
            <Link
              href="/dashboard/profiles"
              className="text-[11px] text-zinc-400 underline-offset-2 hover:text-white hover:underline"
            >
              editar em Modelos
            </Link>
          </div>
          {temPersona ? (
            <div className="mt-1.5 space-y-0.5 text-[12px] leading-relaxed text-zinc-300">
              {profile?.bioPhysical && (
                <p>
                  <span className="text-zinc-600">Características físicas:</span>{" "}
                  {profile.bioPhysical}
                </p>
              )}
              {profile?.bioUnique && (
                <p>
                  <span className="text-zinc-600">Mecanismo único / fetiche:</span>{" "}
                  {profile.bioUnique}
                </p>
              )}
              {profile?.bioPersonality && (
                <p>
                  <span className="text-zinc-600">Como ela é:</span>{" "}
                  {COMO_ELA_E[profile.bioPersonality]}
                </p>
              )}
            </div>
          ) : (
            <p className="mt-1.5 text-[12px] leading-relaxed text-amber-400">
              Sem características cadastradas, as ideias saem genéricas — preencha o Perfil em
              Modelos.
            </p>
          )}
        </div>

        <div className="mt-3">
          <label className="eyebrow">Observação extra (opcional)</label>
          <input
            className="input mt-1"
            placeholder="ex.: hoje ela é professora · fala da academia · tema praia"
            value={tema}
            onChange={(e) => setTema(e.target.value)}
          />
          <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">
            O assunto desta leva. Vazio, a IA escolhe sozinha.
          </p>
        </div>

        <div className="mt-3">
          <label className="eyebrow">Quais IAs escrevem</label>
          <div className="mt-1 flex flex-wrap gap-2">
            {PROVEDORES.map((p) => {
              const ligado = ias.includes(p);
              const disponivel = conectados.includes(p);
              return (
                <button
                  key={p}
                  type="button"
                  disabled={!disponivel}
                  onClick={() =>
                    setIas((antes) =>
                      antes.includes(p) ? antes.filter((x) => x !== p) : [...antes, p],
                    )
                  }
                  className={`rounded-lg border px-3 py-1.5 text-sm transition-colors ${
                    !disponivel
                      ? "cursor-not-allowed border-white/5 text-zinc-700"
                      : ligado
                        ? "border-emerald-500/40 bg-emerald-500/[0.12] font-semibold text-emerald-300"
                        : "border-white/10 text-zinc-400 hover:border-white/25 hover:text-zinc-200"
                  }`}
                  title={disponivel ? undefined : "Não conectado em Configurações → Conexão com IA"}
                >
                  {PROVEDOR[p]}
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button onClick={gerar} disabled={gerando || ias.length === 0} className="btn-primary">
            <IconSparkle size={16} /> {gerando ? "Gerando..." : "Gerar ideias"}
          </button>
          <button onClick={() => setManualOpen((v) => !v)} className="btn-ghost">
            <IconPlus size={14} /> Escrever uma
          </button>
          <p className="flex-1 text-[11px] leading-relaxed text-zinc-500">
            Cada clique pede <b>3 por IA acesa</b> —{" "}
            {ias.length > 0 ? (
              <>
                agora <b>{ias.length * 3}</b> ({ias.map((p) => PROVEDOR[p]).join(" + ")}).
              </>
            ) : (
              <b className="text-amber-400">acenda pelo menos uma IA.</b>
            )}{" "}
            O que já está aqui não se repete.
          </p>
        </div>

        {manualOpen && (
          <div className="mt-3 rounded-xl border border-white/10 bg-ink-850 p-3">
            <input
              className="input"
              placeholder={rotulos.campo1}
              value={manualText}
              onChange={(e) => setManualText(e.target.value)}
            />
            <input
              className="input mt-2"
              placeholder={rotulos.campo2}
              value={manualIdea}
              onChange={(e) => setManualIdea(e.target.value)}
            />
            {kind === "caixinha" && (
              <p
                className={`mt-1 font-mono text-[11px] ${
                  manualText.length + manualIdea.length > TAMANHO_MAX
                    ? "text-amber-400"
                    : "text-zinc-600"
                }`}
              >
                {manualText.length + manualIdea.length} caracteres · o teto é {TAMANHO_MAX}
              </p>
            )}
            <button onClick={adicionar} disabled={!manualText.trim()} className="btn-primary mt-2">
              Adicionar à lista
            </button>
          </div>
        )}
      </div>

      {/* LISTA */}
      <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1.5">
          {(
            [
              ["todas", `Todas (${items.length})`],
              ["novas", `Não usadas (${novas})`],
              ["usadas", `Usadas (${items.length - novas})`],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setFiltro(k)}
              className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${
                filtro === k
                  ? "bg-white/10 font-semibold text-white"
                  : "text-zinc-400 hover:bg-white/5 hover:text-zinc-200"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {loading && (
        <div className="grid place-items-center py-10">
          <div className="h-7 w-7 animate-spin rounded-full border border-white/15 border-t-white" />
        </div>
      )}

      {!loading && visiveis.length === 0 && (
        <div className="card mt-3 p-8 text-center text-sm text-zinc-400">
          {items.length === 0
            ? "Nenhuma ideia ainda. Clique em Gerar ideias aí em cima."
            : "Nada neste filtro."}
        </div>
      )}

      <div className="mt-3 space-y-2">
        {visiveis.map((item) => (
          <IdeiaLinha
            key={item.id}
            item={item}
            onMarcar={(v) => marcar(item, v)}
            onExcluir={() => excluir(item)}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * Uma ideia da lista.
 *
 * A marca de usada é um botão grande à esquerda, não uma caixinha de seleção
 * escondida: é o gesto que se repete dezenas de vezes por semana, e sempre no
 * celular.
 */
function IdeiaLinha({
  item,
  onMarcar,
  onExcluir,
}: {
  item: Item;
  onMarcar: (v: boolean) => void;
  onExcluir: () => void;
}) {
  // Os rótulos saem do tipo DA IDEIA, não do que está escolhido no gerador —
  // a lista mistura os dois, e uma frase de duplo sentido rotulada "Pergunta"
  // seria pior que rótulo nenhum.
  const rotulos = TIPOS.find((x) => x.key === item.kind) || TIPOS[0];
  const linhas = textoDoGerador(item);
  const tamanho = item.text.length + (item.idea?.length || 0);
  const estourou = item.kind === "caixinha" && tamanho > TAMANHO_MAX;

  async function copiar() {
    try {
      await navigator.clipboard.writeText(linhas.join("\n"));
      showToast("Copiado no formato do gerador de vídeo.", "success");
    } catch {
      showToast("Não consegui copiar.", "error");
    }
  }

  return (
    <div
      className={`card flex items-start gap-3 p-3 transition-opacity ${
        item.used ? "opacity-50" : ""
      }`}
    >
      <button
        onClick={() => onMarcar(!item.used)}
        className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg border transition-colors ${
          item.used
            ? "border-emerald-500/40 bg-emerald-500/20 text-emerald-300"
            : "border-white/15 text-zinc-600 hover:border-white/30 hover:text-zinc-300"
        }`}
        aria-label={item.used ? "Marcar como não usada" : "Marcar como usada"}
        title={item.used ? "Já usei — clique para desmarcar" : "Marcar como usada"}
      >
        <IconCheck size={16} />
      </button>

      <div className="min-w-0 flex-1">
        {/* O QUE SE VÊ É O QUE SE COPIA. Estas linhas são exatamente o texto
            que vai para a transcrição do gerador de vídeo — mesmo rótulo,
            mesma ordem, mesma quebra. Mostrar um formato e copiar outro
            obrigaria a conferir a colagem toda vez. */}
        <div
          className={`rounded-lg bg-black/25 px-2.5 py-2 text-sm leading-relaxed text-zinc-100 ${
            item.used ? "line-through decoration-white/30" : ""
          }`}
        >
          {linhas.map((linha, i) => (
            <p key={i} className={i > 0 ? "mt-1" : ""}>
              {linha}
            </p>
          ))}
        </div>
        {/* A direção de cena fica FORA do bloco copiável: ela é instrução para
            quem grava, não fala do vídeo — colada na transcrição, viraria
            texto dito em voz alta. */}
        {item.kind === "duplo_sentido" && item.idea && (
          <p className="mt-1 text-[12px] leading-relaxed text-zinc-500">
            <span className="text-zinc-600">{rotulos.campo2}:</span> {item.idea}
          </p>
        )}
        <p className="mt-1.5 flex flex-wrap items-center gap-x-2 font-mono text-[10px] uppercase tracking-wider text-zinc-600">
          {/* O TIPO abre a linha porque a lista mistura os dois: é ele que
              diz se aquilo é um story de caixinha ou um vídeo de frase. */}
          <span
            className={`rounded px-1.5 py-0.5 ${
              item.kind === "caixinha"
                ? "bg-sky-500/15 text-sky-300"
                : "bg-fuchsia-500/15 text-fuchsia-300"
            }`}
          >
            {item.kind === "caixinha" ? "caixinha" : "duplo sentido"}
          </span>
          {/* A duração vem em seguida: é o que decide se a ideia cabe na
              sequência de stories do dia, e é lida antes de gravar. */}
          {item.seconds ? (
            <span className="rounded bg-white/10 px-1.5 py-0.5 text-zinc-300">
              {item.seconds}s
            </span>
          ) : null}
          <span>{PROVEDOR[item.provider || ""] || item.provider || "ia"}</span>
          {item.theme && <span className="normal-case text-zinc-500">· {item.theme}</span>}
          {/* O tamanho só aparece quando passa da régua: número certo em toda
              linha vira ruído, número errado é o que precisa saltar. */}
          {estourou && <span className="text-amber-500">· {tamanho} caracteres</span>}
          {item.used && item.usedAt && (
            <span>· usada em {new Date(item.usedAt).toLocaleDateString("pt-BR")}</span>
          )}
        </p>
      </div>

      <div className="flex shrink-0 items-start gap-1">
        {/* COPIAR é a ação principal do cartão — é para isso que a ideia
            existe. Por isso leva rótulo, e não só um ícone entre outros. */}
        <button
          onClick={copiar}
          className="flex h-8 items-center gap-1.5 rounded-lg border border-white/10 px-2.5 text-[12px] text-zinc-300 hover:border-white/25 hover:bg-white/10 hover:text-white"
          title="Copia no formato da transcrição do gerador de vídeo"
        >
          <IconCopy size={14} /> Copiar
        </button>
        <button
          onClick={onExcluir}
          className="grid h-8 w-8 place-items-center rounded-lg text-zinc-500 hover:bg-white/10 hover:text-red-400"
          aria-label="Excluir"
        >
          <IconTrash size={15} />
        </button>
      </div>
    </div>
  );
}
