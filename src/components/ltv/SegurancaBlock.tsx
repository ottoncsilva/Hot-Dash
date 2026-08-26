"use client";

import Switch from "@/components/Switch";
import OpcaoCartao from "./OpcaoCartao";
import type { LtvAgentSettings } from "@/lib/ltvDb";

/**
 * Ritmo e limites. Este bloco parece detalhe de ajuste fino e é o oposto:
 * automação em conta real é o que o WhatsApp e o Telegram mais bloqueiam, e o
 * que segura a conta viva é exatamente isto — responder como gente, não passar
 * de um volume plausível e nunca puxar conversa sozinha.
 */
export default function SegurancaBlock({
  agente,
  onChange,
}: {
  agente: LtvAgentSettings;
  onChange: (patch: Partial<LtvAgentSettings>) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-3 text-sm text-zinc-300">
        A inteligência que conversa com os leads é o <strong>Grok</strong>, configurado em
        Configurações → Conexão com IA. Não há o que escolher aqui.
      </div>

      <div>
        <span className="eyebrow mb-2 block">
          Ritmo das respostas · tempo humano protege a conta e cria desejo no lead
        </span>
        <div className="grid gap-3 sm:grid-cols-2">
          <OpcaoCartao
            active={agente.rhythm === "humano"}
            onClick={() => onChange({ rhythm: "humano" })}
            title="Humano (recomendado)"
          >
            Sem janela em segundos: às vezes responde em meio minuto, às vezes deixa o lead
            20 ou 30 minutos esperando. Depois das 2h da manhã ela dorme e só responde às
            7h ou 8h do dia seguinte.
          </OpcaoCartao>
          <OpcaoCartao
            active={agente.rhythm === "fixo"}
            onClick={() => onChange({ rhythm: "fixo" })}
            title="Rápido fixo"
          >
            Sempre no tempo mínimo. Menos natural e mais risco para a conta.
          </OpcaoCartao>
        </div>
      </div>

      {/* A janela em segundos só faz sentido no ritmo fixo. No humano o atraso é
          sorteado numa escala de minutos (e some na madrugada), então mostrar
          dois campos de segundos que não valem nada só confundiria. */}
      {agente.rhythm === "fixo" && (
        <div className="flex flex-wrap items-center gap-2 text-sm text-zinc-300">
          <span>entre</span>
          <input
            type="number"
            min={0}
            className="input w-24"
            value={agente.delayMinS}
            onChange={(e) => onChange({ delayMinS: Number(e.target.value) })}
          />
          <span>e</span>
          <input
            type="number"
            min={0}
            className="input w-24"
            value={agente.delayMaxS}
            onChange={(e) => onChange({ delayMaxS: Number(e.target.value) })}
          />
          <span>segundos</span>
        </div>
      )}

      <label className="block">
        <span className="eyebrow mb-1.5 block">Limite diário de mensagens por conta</span>
        <input
          type="number"
          min={0}
          className="input w-32"
          value={agente.dailyLimit}
          onChange={(e) => onChange({ dailyLimit: Number(e.target.value) })}
        />
        <span className="mt-1 block text-xs text-zinc-500">
          Chegando no limite, a IA para de responder até o dia seguinte. Zero = sem limite.
        </span>
      </label>

      <div className="flex items-start gap-3 border-t border-white/[0.06] pt-4">
        <Switch
          checked={agente.onlyReplyFirst}
          onChange={(v) => onChange({ onlyReplyFirst: v })}
          ariaLabel="Só responder quem falar primeiro"
        />
        <div>
          <p className="font-semibold text-white">Só responder quem falar primeiro</p>
          <p className="text-xs text-zinc-500">
            Recomendado — muito mais seguro contra bloqueio da conta.
          </p>
        </div>
      </div>

      <div className="flex items-start gap-3 border-t border-white/[0.06] pt-4">
        <Switch
          checked={agente.reengageEnabled}
          onChange={(v) => onChange({ reengageEnabled: v })}
          ariaLabel="Retomar contato com quem sumiu"
        />
        <div>
          <p className="font-semibold text-white">Retomar contato com quem sumiu</p>
          <p className="text-xs text-zinc-500">
            Se o lead parar de responder por um tempo (algumas horas), a IA manda sozinha uma
            mensagem puxando o papo de volta — no máximo 2 tentativas por silêncio, e para até
            ele voltar a falar. <b>Desligado por padrão</b>: mandar mensagem sem o lead ter
            falado primeiro é o tipo de automação que mais chama atenção do WhatsApp/Telegram —
            ligue só se souber que a conta aguenta.
          </p>
        </div>
      </div>
    </div>
  );
}
