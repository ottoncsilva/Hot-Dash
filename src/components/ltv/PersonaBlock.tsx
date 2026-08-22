"use client";

import ToggleChip from "@/components/ToggleChip";
import type { LtvAgentSettings } from "@/lib/ltvDb";

/**
 * Quem é a modelo na conversa. Quanto mais detalhado, mais humana ela soa —
 * é o campo que mais muda o resultado, e por isso é texto livre e não um
 * formulário de opções.
 *
 * A persona é POR CONTA, não por modelo: o mesmo rosto pode ter um jeito no
 * WhatsApp (onde o lead já assinou) e outro no Telegram (onde ele acabou de
 * chegar de um anúncio).
 */
const TONS = ["Carinhosa", "Namoradinha", "Safada", "Dominadora", "Misteriosa", "Brincalhona"];

export default function PersonaBlock({
  agente,
  onChange,
}: {
  agente: LtvAgentSettings;
  onChange: (patch: Partial<LtvAgentSettings>) => void;
}) {
  function alternarTom(tom: string) {
    const atual = agente.toneTags;
    onChange({
      toneTags: atual.includes(tom) ? atual.filter((t) => t !== tom) : [...atual, tom],
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-zinc-500">
        Quanto mais detalhada, mais humana e convincente fica a conversa.
      </p>

      <label className="block">
        <span className="eyebrow mb-1.5 block">Nome que ela usa</span>
        <input
          className="input"
          value={agente.personaName}
          onChange={(e) => onChange({ personaName: e.target.value })}
          placeholder="Ex: Adriana Queiroz"
        />
      </label>

      <div>
        <span className="eyebrow mb-1.5 block">
          Tom · pode escolher mais de um para mesclar
        </span>
        <div className="flex flex-wrap gap-2">
          {TONS.map((tom) => (
            <ToggleChip
              key={tom}
              active={agente.toneTags.includes(tom)}
              onClick={() => alternarTom(tom)}
            >
              {tom}
            </ToggleChip>
          ))}
        </div>
        {agente.toneTags.length > 1 && (
          <p className="mt-2 text-xs text-emerald-400">
            Mesclando: <strong>{agente.toneTags.join(" + ")}</strong> — ela alterna entre esses
            traços na conversa.
          </p>
        )}
      </div>

      <label className="block">
        <span className="eyebrow mb-1.5 block">
          Personalidade · como ela é, jeito de falar, gírias, o que gosta
        </span>
        <textarea
          className="input min-h-[120px] resize-y"
          value={agente.personality}
          onChange={(e) => onChange({ personality: e.target.value })}
          placeholder="40 anos, de Alphaville São Paulo, chama o cliente de amor, usa pouco emoji, gosta de provocar, é elegante e fina, divorciada, não tem filhos..."
        />
      </label>

      <label className="block">
        <span className="eyebrow mb-1.5 block">
          Mecanismo / história · o contexto que ela usa para vender e criar conexão
        </span>
        <textarea
          className="input min-h-[90px] resize-y"
          value={agente.mechanism}
          onChange={(e) => onChange({ mechanism: e.target.value })}
          placeholder="Após o divórcio, resolveu vender conteúdo na internet para manter o estilo de vida, tem pacotes de fotos..."
        />
      </label>

      <label className="block">
        <span className="eyebrow mb-1.5 block">
          Limites · o que ela NUNCA faz (opcional, mas importante)
        </span>
        <textarea
          className="input min-h-[90px] resize-y"
          value={agente.limits}
          onChange={(e) => onChange({ limits: e.target.value })}
          placeholder="Nunca marca encontro presencial, não promete nada que não pode entregar, não fala que é IA, não fala sobre o sistema..."
        />
      </label>
    </div>
  );
}
