"use client";

import { useEffect, useState } from "react";
import { apiGet, apiSend } from "@/lib/api";
import { showToast } from "@/lib/toast";
import Switch from "@/components/Switch";
import { BackToSettings } from "../_shared";

type DynamicPrice = { enabled: boolean; cents: number; direction: "up" | "down" | "random" };
type Role = { key: string; label: string; hint: string };
type Styles = Record<string, string>;

/** As três cores que o Telegram aceita (Bot API 9.4), mais o padrão. */
const CORES: { key: string; label: string; dot: string; ring: string }[] = [
  { key: "", label: "Padrão", dot: "bg-zinc-500", ring: "border-white/10 text-zinc-300" },
  { key: "primary", label: "Azul", dot: "bg-indigo-400", ring: "border-indigo-500/50 text-indigo-300" },
  { key: "success", label: "Verde", dot: "bg-emerald-400", ring: "border-emerald-500/50 text-emerald-300" },
  { key: "danger", label: "Vermelho", dot: "bg-red-400", ring: "border-red-500/50 text-red-300" },
];

export default function BotSettingsPage() {
  const [preco, setPreco] = useState<DynamicPrice>({ enabled: false, cents: 9, direction: "random" });
  const [estilos, setEstilos] = useState<Styles>({});
  const [roles, setRoles] = useState<Role[]>([]);
  const [savingPreco, setSavingPreco] = useState(false);
  const [savingCores, setSavingCores] = useState(false);

  useEffect(() => {
    apiGet<{ dynamicPrice: DynamicPrice; buttonStyles: Styles; roles: Role[] }>("/api/settings/bot")
      .then((d) => {
        setPreco(d.dynamicPrice);
        setEstilos(d.buttonStyles || {});
        setRoles(d.roles || []);
      })
      .catch(() => {});
  }, []);

  async function salvarPreco() {
    setSavingPreco(true);
    try {
      const d = await apiSend<{ dynamicPrice: DynamicPrice }>("/api/settings/bot", "PATCH", {
        dynamicPrice: preco,
      });
      setPreco(d.dynamicPrice);
      showToast("Salvo!");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Falha.", "error");
    } finally {
      setSavingPreco(false);
    }
  }

  async function salvarCores() {
    setSavingCores(true);
    try {
      const d = await apiSend<{ buttonStyles: Styles }>("/api/settings/bot", "PATCH", {
        buttonStyles: estilos,
      });
      setEstilos(d.buttonStyles || {});
      showToast("Salvo!");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Falha.", "error");
    } finally {
      setSavingCores(false);
    }
  }

  return (
    <div className="page-narrow">
      <BackToSettings />

      {/* ---------------- Bloco 1: preço dinâmico ---------------- */}
      <div className="card mt-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-display text-lg font-semibold">Preço dinâmico</h2>
            <p className="mt-1 text-xs leading-relaxed text-zinc-400">
              Soma ou subtrai alguns centavos do valor, de forma <b>única por cliente</b>. A conta
              vem do ID do Telegram, então o mesmo lead recebe sempre o mesmo valor — é isso que
              permite casar um PIX recebido com quem devia pagá-lo, mesmo quando o comprovante não
              traz mais nada. Dificulta o estorno indevido e o &quot;já paguei&quot; de quem não pagou.
            </p>
          </div>
          <Switch
            checked={preco.enabled}
            onChange={(v) => setPreco({ ...preco, enabled: v })}
            ariaLabel="Preço dinâmico"
          />
        </div>

        {preco.enabled && (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div>
              <label className="eyebrow block">Variação em centavos</label>
              <input
                type="number"
                min={1}
                max={100}
                className="input mt-1.5"
                value={preco.cents}
                onChange={(e) => setPreco({ ...preco, cents: Number(e.target.value) })}
              />
              <p className="mt-1 text-[11px] text-zinc-500">De 1 até 100 centavos.</p>
            </div>
            <div>
              <label className="eyebrow block">Direção da variação</label>
              <select
                className="input mt-1.5"
                value={preco.direction}
                onChange={(e) =>
                  setPreco({ ...preco, direction: e.target.value as DynamicPrice["direction"] })
                }
              >
                <option value="random">Aleatório (fixo por lead)</option>
                <option value="up">Sempre para cima</option>
                <option value="down">Sempre para baixo</option>
              </select>
              <p className="mt-1 text-[11px] text-zinc-500">
                No aleatório o sentido também vem do ID, então não muda entre as tentativas do mesmo
                cliente.
              </p>
            </div>
          </div>
        )}

        <button onClick={salvarPreco} disabled={savingPreco} className="btn-primary mt-4">
          {savingPreco ? "Salvando..." : "Salvar preço dinâmico"}
        </button>
      </div>

      {/* ---------------- Bloco 2: cores dos botões ---------------- */}
      <div className="card mt-3 p-4">
        <h2 className="font-display text-lg font-semibold">Cores dos botões</h2>
        <p className="mt-1 text-xs leading-relaxed text-zinc-400">
          Cor dos botões que o bot mostra dentro do Telegram. Cada papel do fluxo tem a sua, porque
          a intenção muda: a lista de planos pede destaque, copiar a chave é auxiliar, e o acesso ao
          VIP depois do pagamento merece o verde.
        </p>
        <p className="mt-2 rounded-lg border border-indigo-500/25 bg-indigo-500/[0.07] p-2.5 text-[11px] leading-relaxed text-zinc-300">
          A cor chegou na <b>Bot API 9.4</b> (fev/2026) e aparece nos apps atualizados. Em apps
          antigos o botão sai na cor padrão — o texto e a ação continuam funcionando, então não há
          risco em ligar.
        </p>

        <div className="mt-4 space-y-3">
          {roles.map((r) => (
            <div key={r.key} className="panel p-3">
              <p className="text-sm font-semibold text-white">{r.label}</p>
              <p className="mt-0.5 text-[11px] text-zinc-500">{r.hint}</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {CORES.map((c) => {
                  const ativo = (estilos[r.key] || "") === c.key;
                  return (
                    <button
                      key={c.key}
                      type="button"
                      onClick={() => setEstilos({ ...estilos, [r.key]: c.key })}
                      className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs transition-colors ${
                        ativo ? `${c.ring} bg-white/5` : "border-white/10 text-zinc-400 hover:text-zinc-200"
                      }`}
                    >
                      <span className={`h-2 w-2 rounded-full ${c.dot}`} />
                      {c.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          {roles.length === 0 && (
            <p className="py-6 text-center text-sm text-zinc-500">Carregando…</p>
          )}
        </div>

        <button onClick={salvarCores} disabled={savingCores} className="btn-primary mt-4">
          {savingCores ? "Salvando..." : "Salvar cores"}
        </button>
      </div>
    </div>
  );
}
