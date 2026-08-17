"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { apiGet, apiSend } from "@/lib/api";
import { showToast } from "@/lib/toast";
import { useProfile } from "@/context/ProfileContext";
import { PrecisaDeModelo } from "@/components/ProfilePicker";
import PageHeader from "@/components/PageHeader";
import { useConfirm } from "@/hooks/useConfirm";
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
    hint: "Pergunta de seguidor + a resposta dela, em 140–160 caracteres.",
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

/** A régua do par pergunta+resposta (lib/questionBox.ts). */
const TAMANHO_MIN = 140;
const TAMANHO_MAX = 160;

/** Como cada provedor aparece na etiqueta da ideia. */
const PROVEDOR: Record<string, string> = {
  grok: "Grok",
  gemini: "Gemini",
  openai: "GPT",
  manual: "sua",
};

export default function CaixinhaPage() {
  const { profileId } = useProfile();
  const { confirm, ConfirmDialog } = useConfirm();

  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(false);
  const [gerando, setGerando] = useState(false);
  const [kind, setKind] = useState<Kind>("caixinha");
  /**
   * O personagem desta leva ("massagista morena de 20 anos"). É o campo que
   * mais muda o resultado: é dele que saem as metáforas, e metáfora de
   * profissão é o que faz o duplo sentido funcionar sem palavra proibida.
   * Fica preenchido entre as levas — gerar três vezes o mesmo personagem é o
   * uso normal, não a exceção.
   */
  const [tema, setTema] = useState("");
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

  async function gerar() {
    if (!profileId) return;
    setGerando(true);
    try {
      const r = await apiSend<{ items: Item[]; provedores: string[]; erros: string[] }>(
        "/api/question-box",
        "POST",
        { action: "generate", profileId, kind, theme: tema },
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

  async function excluir(item: Item) {
    if (!(await confirm("Excluir esta ideia da lista?"))) return;
    try {
      await apiSend("/api/question-box", "POST", { action: "delete", id: item.id });
      setItems((prev) => prev.filter((x) => x.id !== item.id));
    } catch (e) {
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
  const doTipo = useMemo(() => items.filter((i) => i.kind === kind), [items, kind]);
  const visiveis = useMemo(
    () =>
      doTipo.filter((i) => (filtro === "novas" ? !i.used : filtro === "usadas" ? i.used : true)),
    [doTipo, filtro],
  );
  const novas = doTipo.filter((i) => !i.used).length;

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
      {ConfirmDialog}
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

        {/* PERSONAGEM DA LEVA. Fica em cima do botão porque é a decisão que vem
            antes de gerar — e é ela que mais muda o que volta. */}
        <div className="mt-3">
          <label className="eyebrow">Personagem desta leva</label>
          <input
            className="input mt-1"
            placeholder="ex.: massagista morena de 20 anos · professora · ruiva bem vermelhinha, pele branquinha"
            value={tema}
            onChange={(e) => setTema(e.target.value)}
          />
          <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">
            É daqui que saem as metáforas — o universo da profissão é o que faz o duplo sentido
            funcionar sem palavra proibida. Deixe vazio para usar só a bio da modelo.
          </p>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button onClick={gerar} disabled={gerando} className="btn-primary">
            <IconSparkle size={16} /> {gerando ? "Gerando..." : "Gerar ideias"}
          </button>
          <button onClick={() => setManualOpen((v) => !v)} className="btn-ghost">
            <IconPlus size={14} /> Escrever uma
          </button>
          <p className="flex-1 text-[11px] leading-relaxed text-zinc-500">
            Cada clique pede <b>3 para o Grok, 3 para o Gemini e 3 para o GPT</b>, ao mesmo tempo.
            Poucos de cada um rende mais ângulo do que muitos de um só — e o que já está aqui não
            se repete.
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
                {manualText.length + manualIdea.length} caracteres · a régua é {TAMANHO_MIN}–
                {TAMANHO_MAX}
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
              ["todas", `Todas (${doTipo.length})`],
              ["novas", `Não usadas (${novas})`],
              ["usadas", `Usadas (${doTipo.length - novas})`],
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
          {doTipo.length === 0
            ? "Nenhuma ideia ainda. Clique em Gerar ideias aí em cima."
            : "Nada neste filtro."}
        </div>
      )}

      <div className="mt-3 space-y-2">
        {visiveis.map((item) => (
          <IdeiaLinha
            key={item.id}
            item={item}
            rotulos={rotulos}
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
  rotulos,
  onMarcar,
  onExcluir,
}: {
  item: Item;
  rotulos: { campo1: string; campo2: string };
  onMarcar: (v: boolean) => void;
  onExcluir: () => void;
}) {
  // Copia o PAR inteiro, que é o que vai para o story — copiar só a pergunta
  // obrigaria a voltar aqui para pegar a resposta.
  const parInteiro = item.idea ? `${item.text}\n${item.idea}` : item.text;
  const tamanho = item.text.length + (item.idea?.length || 0);
  const estourou = item.kind === "caixinha" && tamanho > TAMANHO_MAX;

  async function copiar() {
    try {
      await navigator.clipboard.writeText(parInteiro);
      showToast("Copiado.", "success");
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
        <p
          className={`text-sm leading-relaxed text-zinc-100 ${
            item.used ? "line-through decoration-white/30" : ""
          }`}
        >
          <span className="mr-1 font-mono text-[10px] uppercase tracking-wider text-zinc-600">
            {rotulos.campo1}
          </span>
          {item.text}
        </p>
        {item.idea && (
          <p className="mt-1 text-[13px] leading-relaxed text-zinc-300">
            <span className="mr-1 font-mono text-[10px] uppercase tracking-wider text-zinc-600">
              {rotulos.campo2}
            </span>
            {item.idea}
          </p>
        )}
        <p className="mt-1.5 flex flex-wrap items-center gap-x-2 font-mono text-[10px] uppercase tracking-wider text-zinc-600">
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

      <div className="flex shrink-0 gap-1">
        <button
          onClick={copiar}
          className="grid h-8 w-8 place-items-center rounded-lg text-zinc-500 hover:bg-white/10 hover:text-white"
          aria-label="Copiar texto"
        >
          <IconCopy size={15} />
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
