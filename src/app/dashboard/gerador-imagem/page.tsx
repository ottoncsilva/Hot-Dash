"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiGet, apiSend } from "@/lib/api";
import { showToast } from "@/lib/toast";
import { useProfile } from "@/context/ProfileContext";
import { PrecisaDeModelo } from "@/components/ProfilePicker";
import PageHeader from "@/components/PageHeader";
import Link from "next/link";
import MediaPicker from "@/components/telegram/bot/MediaPicker";
import { IconSparkle, IconUpload, IconClose } from "@/components/icons";
import type { Profile } from "@/lib/types";
import {
  FORMATOS,
  IMAGE_RESOLUCOES,
  custoImagem,
  formatarUsd,
  formatarBrl,
  aplicarMencoes,
  resolverFotos,
  citacoesInvalidas,
  migrarFotosAntigas,
} from "@/lib/aiMediaOptions";
import { promptImagemPadrao } from "@/lib/aiMediaPrompts";
import ResultadosGerados from "@/components/ResultadosGerados";
import PromptComFotos, { montarCitaveis } from "@/components/PromptComFotos";
import { salvarResultado } from "@/lib/resultadosDb";
import type { Cotacao } from "@/lib/cotacao";

/**
 * GERADOR DE IMAGEM — bytedance-seed/seedream-5-0-pro, via OpenRouter.
 *
 * A ideia por trás dos dois campos de referência é fazer o mesmo trabalho que
 * um editor de fotos faz recortando um rosto para colar em outra cena, só que
 * pedindo para o modelo entender e refazer, não copiar pixel a pixel:
 *
 *   • "imagem a copiar" — a COMPOSIÇÃO a reproduzir: pose, enquadramento,
 *     cenário, luz. É a mesma foto do assinante que a modelo quer imitar.
 *   • "referências da modelo" — QUEM deve aparecer: rosto e corpo, tirados da
 *     própria Galeria dela, para a identidade sair fiel.
 *
 * O servidor manda as fotos da modelo PRIMEIRO e a imagem a copiar por
 * ÚLTIMO — a mesma ordem que os prompts escritos à mão já usavam (quem é a
 * pessoa, depois a cena a reproduzir). É essa ordem que o prompt padrão e a
 * citação com @ pressupõem.
 */

const OPCOES_FORMATO = ["auto", ...FORMATOS] as const;
type AspectRatio = (typeof OPCOES_FORMATO)[number];

const MAX_REFERENCIAS_GALERIA = 13; // + 1 imagem a copiar = 14, o teto do modelo

/**
 * Lê um arquivo de imagem e devolve um data: URL JÁ REDIMENSIONADO (maior
 * lado até `maxDim`, JPEG). A foto que o operador arrasta aqui costuma vir
 * direto do celular do assinante — vários MB, resolução de câmera — e mandar
 * isso cru infla o pedido à toa: o modelo lê a composição, não conta pixels.
 */
function arquivoParaBase64Redimensionado(file: File, maxDim = 1280, quality = 0.85): Promise<string> {
  return new Promise((resolve, reject) => {
    const leitor = new FileReader();
    leitor.onerror = () => reject(new Error("Falha ao ler o arquivo."));
    leitor.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Arquivo não é uma imagem válida."));
      img.onload = () => {
        const escala = Math.min(1, maxDim / Math.max(img.width, img.height));
        const w = Math.round(img.width * escala);
        const h = Math.round(img.height * escala);
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("Canvas indisponível."));
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = String(leitor.result);
    };
    leitor.readAsDataURL(file);
  });
}

export default function GeradorImagemPage() {
  const { profileId, profile } = useProfile();

  const [conectado, setConectado] = useState<boolean | null>(null);
  const [referenciasModelo, setReferenciasModelo] = useState<string[]>([]);
  const [copiaFile, setCopiaFile] = useState<File | null>(null);
  const [copiaPreview, setCopiaPreview] = useState<string | null>(null);
  const [copiaBase64, setCopiaBase64] = useState<string | null>(null);
  const [extra, setExtra] = useState("");
  const [promptBase, setPromptBase] = useState("");
  const [editandoPrompt, setEditandoPrompt] = useState(false);
  const [rascunhoPrompt, setRascunhoPrompt] = useState("");
  const [salvandoPrompt, setSalvandoPrompt] = useState(false);
  const [resolution, setResolution] = useState<"1K" | "2K">("2K");
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("auto");
  const [seed, setSeed] = useState("");
  const [avancadoAberto, setAvancadoAberto] = useState(false);
  const [gerando, setGerando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [recarregar, setRecarregar] = useState(0);
  const [cotacao, setCotacao] = useState<Cotacao | null>(null);
  const dropRef = useRef<HTMLDivElement>(null);

  // A tela precisa saber se o OpenRouter está pronto ANTES de tentar gerar —
  // sem isso o operador só descobriria depois de preencher tudo e clicar.
  useEffect(() => {
    apiGet<{ settings: { openrouter?: { enabled?: boolean; hasKey?: boolean } } }>("/api/settings/ai")
      .then((d) => setConectado(Boolean(d.settings?.openrouter?.enabled && d.settings?.openrouter?.hasKey)))
      .catch(() => setConectado(null));
  }, []);

  // As referências e o prompt vivem no PERFIL, não na tela: são da modelo e
  // valem para toda geração seguinte. Trocar de modelo recarrega os dela.
  useEffect(() => {
    if (!profileId) return;
    setReferenciasModelo([]);
    setPromptBase("");
    apiGet<{ profile: Profile }>(`/api/profiles/${profileId}`)
      .then((d) => {
        const refs = d.profile?.imagegenReferenceIds || [];
        setReferenciasModelo(refs);
        // Prompt salvo com o marcador antigo (`@[foto:id]`) vira o legível.
        setPromptBase(migrarFotosAntigas(d.profile?.imagegenPromptBase || "", refs));
      })
      .catch(() => {});
  }, [profileId]);

  useEffect(() => {
    return () => {
      if (copiaPreview) URL.revokeObjectURL(copiaPreview);
    };
  }, [copiaPreview]);

  // Cotação do dia, para o custo aparecer também em real.
  useEffect(() => {
    apiGet<{ cotacao: Cotacao | null }>("/api/cotacao")
      .then((d) => setCotacao(d.cotacao))
      .catch(() => setCotacao(null));
  }, []);

  async function escolherCopia(file: File | null) {
    if (!file) {
      setCopiaFile(null);
      setCopiaPreview((p) => {
        if (p) URL.revokeObjectURL(p);
        return null;
      });
      setCopiaBase64(null);
      return;
    }
    if (!file.type.startsWith("image/")) {
      showToast("Escolha um arquivo de imagem.", "error");
      return;
    }
    setCopiaFile(file);
    setCopiaPreview((p) => {
      if (p) URL.revokeObjectURL(p);
      return URL.createObjectURL(file);
    });
    try {
      setCopiaBase64(await arquivoParaBase64Redimensionado(file));
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Falha ao ler a imagem.", "error");
      setCopiaBase64(null);
    }
  }

  /** Guarda a escolha de referências no perfil da modelo, não só na tela. */
  function trocarReferencias(ids: string[]) {
    setReferenciasModelo(ids);
    if (!profileId) return;
    apiSend(`/api/profiles/${profileId}`, "PATCH", { imagegenReferenceIds: ids }).catch(() =>
      showToast("Não deu para memorizar as referências.", "error"),
    );
  }

  /** O texto que realmente vai ao modelo: o prompt da modelo mais o que o
   *  operador acrescentou nesta geração. */
  const promptEfetivo = (
    (promptBase.trim() || promptImagemPadrao(Boolean(copiaBase64), referenciasModelo.length > 0)) +
    (extra.trim() ? `\n\n${extra.trim()}` : "")
  ).trim();

  function abrirEditorPrompt() {
    setRascunhoPrompt(
      promptBase.trim() || promptImagemPadrao(Boolean(copiaBase64), referenciasModelo.length > 0),
    );
    setEditandoPrompt(true);
  }

  async function salvarPromptBase() {
    if (!profileId) return;
    setSalvandoPrompt(true);
    try {
      await apiSend(`/api/profiles/${profileId}`, "PATCH", { imagegenPromptBase: rascunhoPrompt });
      setPromptBase(rascunhoPrompt.trim());
      setEditandoPrompt(false);
      showToast("Prompt padrão salvo.", "success");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Falha ao salvar.", "error");
    } finally {
      setSalvandoPrompt(false);
    }
  }

  async function gerar() {
    if (!profileId) return;
    if (!promptEfetivo) {
      showToast("Escreva o prompt da imagem.", "error");
      return;
    }
    setGerando(true);
    setErro(null);
    try {
      const seedNum = seed.trim() ? Number(seed.trim()) : undefined;
      const r = await apiSend<{ base64: string; mediaType: string; costUsd?: number }>(
        "/api/ai/image-gen",
        "POST",
        {
          // aplicarMencoes cuida dos marcadores trazidos de outra ferramenta
          // (`@[id:rótulo:tipo]`); resolverFotos, dos nossos.
          prompt: resolverFotos(
            aplicarMencoes(promptEfetivo, {}),
            referenciasModelo.length,
            Boolean(copiaBase64),
          ),
          resolution,
          aspectRatio,
          seed: seedNum,
          copyImageBase64: copiaBase64 || undefined,
          referenceMediaIds: referenciasModelo,
        },
      );
      // base64 -> Blob: o resultado é guardado como arquivo no banco local,
      // não como data: URL (que ocuparia ~33% a mais e é texto).
      const bin = atob(r.base64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      await salvarResultado({
        id: crypto.randomUUID(),
        tipo: "imagem",
        blob: new Blob([bytes], { type: r.mediaType }),
        mediaType: r.mediaType,
        costUsd: r.costUsd,
        legenda: `${resolution} · ${aspectRatio}`,
        createdAt: Date.now(),
      });
      setRecarregar((n) => n + 1);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Falha ao gerar a imagem.";
      setErro(msg);
      showToast(msg, "error");
    } finally {
      setGerando(false);
    }
  }

  if (!profileId) {
    return (
      <div className="page">
        <PageHeader title="Gerador de Imagem" />
        <PrecisaDeModelo oQue="gerar imagens com IA" />
      </div>
    );
  }

  // O que dá para citar com @: as referências escolhidas, na ordem em que são
  // enviadas, mais a imagem a copiar (que vai por último).
  const fotosCitaveis = montarCitaveis(
    referenciasModelo,
    (id) => `/api/media/${id}/thumbnail`,
    copiaPreview,
  );
  // Citação a uma posição que não existe: avisa em vez de mandar calado a
  // foto errada — é o preço de o marcador ser legível (e posicional).
  const citacoesRuins = citacoesInvalidas(
    promptEfetivo,
    referenciasModelo.length,
    Boolean(copiaBase64),
  );
  const totalReferencias = referenciasModelo.length + (copiaBase64 ? 1 : 0);
  const custoEstimado = custoImagem(resolution, totalReferencias);

  return (
    <div className="page">
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            <IconSparkle size={22} /> Gerador de Imagem
          </span>
        }
      />

      {conectado === false && (
        <div className="card mt-4 border-amber-500/30 bg-amber-500/[0.06] p-4 text-sm text-amber-300">
          O OpenRouter ainda não está conectado.{" "}
          <Link href="/dashboard/settings/ia" className="underline underline-offset-2 hover:text-white">
            Ative e cole a chave em Configurações → Conexão com IA
          </Link>{" "}
          para gerar imagens.
        </div>
      )}

      <div className="card mt-4 p-4">
        {/* REFERÊNCIAS DA MODELO */}
        <div>
          <label className="eyebrow">Referências da modelo (rosto e corpo)</label>
          <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-500">
            Escolhidas da Galeria de {profile?.name || "a modelo"}. É daqui que sai a identidade da
            imagem gerada — ficam memorizadas no cadastro dela e valem para as próximas gerações.
          </p>
          <div className="mt-2">
            <MediaPicker
              profileId={profileId}
              selected={referenciasModelo}
              onChange={trocarReferencias}
              max={MAX_REFERENCIAS_GALERIA}
              apenasImagens
            />
          </div>
        </div>

        {/* IMAGEM A COPIAR */}
        <div className="mt-5">
          <label className="eyebrow">Imagem a copiar (composição, pose, cenário)</label>
          <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-500">
            Opcional. A foto que você quer reproduzir — o pedido do assinante, por exemplo. Fica só
            nesta geração, não entra na Galeria. É enviada por ÚLTIMO, depois das fotos da modelo:
            por isso o prompt pode se referir a ela como “a última imagem de referência”.
          </p>
          <div className="mt-2">
            {copiaPreview ? (
              <div className="relative inline-block">
                <img
                  src={copiaPreview}
                  alt=""
                  className="h-32 w-24 rounded-lg border border-white/10 object-cover"
                />
                <button
                  type="button"
                  onClick={() => escolherCopia(null)}
                  className="absolute -right-1.5 -top-1.5 grid h-6 w-6 place-items-center rounded-full bg-black/80 text-white hover:bg-red-500/80"
                  aria-label="Remover imagem a copiar"
                >
                  <IconClose size={13} />
                </button>
              </div>
            ) : (
              <div
                ref={dropRef}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  escolherCopia(e.dataTransfer.files?.[0] || null);
                }}
                className="grid h-32 w-24 cursor-pointer place-items-center rounded-lg border border-dashed border-white/15 text-zinc-500 transition-colors hover:border-emerald-500/40 hover:text-emerald-300"
                onClick={() => document.getElementById("copia-input")?.click()}
              >
                <IconUpload size={18} />
                <input
                  id="copia-input"
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => escolherCopia(e.target.files?.[0] || null)}
                />
              </div>
            )}
          </div>
        </div>

        {/* PROMPT PADRÃO (da modelo) + ACRÉSCIMO (desta geração) */}
        <div className="mt-5">
          <div className="flex items-center justify-between">
            <label className="eyebrow">Prompt padrão de {profile?.name || "a modelo"}</label>
            {!editandoPrompt && (
              <button type="button" onClick={abrirEditorPrompt} className="btn-ghost px-2 py-1 text-[11px]">
                Editar prompt padrão
              </button>
            )}
          </div>

          {editandoPrompt ? (
            <div className="mt-1">
              <PromptComFotos
                className="input max-h-[420px] min-h-[160px] w-full resize-y overflow-y-auto font-mono text-[12px]"
                value={rascunhoPrompt}
                onChange={setRascunhoPrompt}
                fotos={fotosCitaveis}
              />
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button onClick={salvarPromptBase} disabled={salvandoPrompt} className="btn-primary px-3 py-1.5 text-xs">
                  {salvandoPrompt ? "Salvando..." : "Salvar prompt padrão"}
                </button>
                <button onClick={() => setEditandoPrompt(false)} className="btn-ghost px-3 py-1.5 text-xs">
                  Cancelar
                </button>
                <button
                  onClick={() =>
                    setRascunhoPrompt(
                      promptImagemPadrao(Boolean(copiaBase64), referenciasModelo.length > 0),
                    )
                  }
                  className="btn-ghost px-3 py-1.5 text-xs"
                >
                  Restaurar texto de fábrica
                </button>
              </div>
            </div>
          ) : (
            <p className="mt-1 max-h-[220px] overflow-y-auto whitespace-pre-wrap rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-[12px] leading-relaxed text-zinc-400">
              {promptBase.trim() || promptImagemPadrao(Boolean(copiaBase64), referenciasModelo.length > 0)}
            </p>
          )}
        </div>

        <div className="mt-4">
          <label className="eyebrow">Acrescentar nesta geração (opcional)</label>
          <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-500">
            Entra no fim do prompt padrão — o que muda só nesta imagem: roupa, cenário, pose, clima.
            Digite <span className="font-mono text-zinc-400">@</span> para citar uma imagem
            específica; na hora de enviar ela vira a posição real (“a 2ª imagem de referência”).
          </p>
          <PromptComFotos
            className="input mt-1 max-h-[220px] min-h-[70px] w-full resize-y overflow-y-auto"
            placeholder="ex.: de biquíni vermelho, na varanda — digite @ para citar uma das imagens"
            value={extra}
            onChange={setExtra}
            fotos={fotosCitaveis}
          />
        </div>

        {citacoesRuins.length > 0 && (
          <p className="mt-3 rounded-lg border border-amber-500/25 bg-amber-500/[0.07] px-3 py-2 text-[11px] leading-relaxed text-amber-300">
            O prompt cita {citacoesRuins.join(", ")}, que não existe(m) na seleção atual. Essas
            citações vão virar “uma das imagens de referência” — ajuste o texto ou escolha as
            imagens que faltam.
          </p>
        )}

        {/* RESOLUÇÃO */}
        <div className="mt-5">
          <label className="eyebrow">Resolução</label>
          <div className="mt-1.5 flex gap-2">
            {IMAGE_RESOLUCOES.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setResolution(r)}
                className={`rounded-lg border px-4 py-1.5 text-sm transition-colors ${
                  resolution === r
                    ? "border-emerald-500/40 bg-emerald-500/[0.12] font-semibold text-emerald-300"
                    : "border-white/10 text-zinc-400 hover:border-white/25 hover:text-zinc-200"
                }`}
              >
                {r}
              </button>
            ))}
          </div>
        </div>

        {/* FORMATO */}
        <div className="mt-5">
          <label className="eyebrow">Formato</label>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {OPCOES_FORMATO.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setAspectRatio(f)}
                className={`rounded-lg border px-2.5 py-1 font-mono text-[12px] transition-colors ${
                  aspectRatio === f
                    ? "border-emerald-500/40 bg-emerald-500/[0.12] font-semibold text-emerald-300"
                    : "border-white/10 text-zinc-400 hover:border-white/25 hover:text-zinc-200"
                }`}
              >
                {f === "auto" ? "Auto" : f}
              </button>
            ))}
          </div>
        </div>

        {/* AVANÇADO */}
        <div className="mt-4">
          <button
            type="button"
            onClick={() => setAvancadoAberto((v) => !v)}
            className="text-[11px] text-zinc-500 hover:text-zinc-300"
          >
            {avancadoAberto ? "▾" : "▸"} avançado
          </button>
          {avancadoAberto && (
            <div className="mt-2 max-w-[220px]">
              <label className="eyebrow mb-1 block">Seed (opcional)</label>
              <input
                className="input font-mono"
                type="number"
                placeholder="aleatória"
                value={seed}
                onChange={(e) => setSeed(e.target.value)}
              />
              <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">
                A mesma seed tende a repetir o mesmo resultado — útil para variar só um detalhe do
                prompt sem perder o resto da composição.
              </p>
            </div>
          )}
        </div>

        {erro && (
          <p className="mt-4 rounded-lg border border-red-500/20 bg-red-500/[0.07] px-3 py-2 text-sm text-red-300">
            {erro}
          </p>
        )}

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button onClick={gerar} disabled={gerando || conectado === false} className="btn-primary">
            <IconSparkle size={16} /> {gerando ? "Gerando..." : "Gerar imagem"}
          </button>
          <span
            className="rounded-lg border border-white/10 bg-black/20 px-2.5 py-1 font-mono text-[12px] text-zinc-300"
            title="Preço de tabela do Seedream: a imagem em 1K ou 2K, mais US$ 0,003 por referência enviada. O valor real da geração aparece embaixo de cada resultado."
          >
            ~{formatarUsd(custoEstimado)}
            {cotacao && ` · ~${formatarBrl(custoEstimado, cotacao.brlPorUsd)}`}
          </span>
          <p className="text-[11px] text-zinc-500">
            {totalReferencias}/14 referências enviadas
            {cotacao && ` · dólar a R$ ${cotacao.brlPorUsd.toFixed(2).replace(".", ",")} (${cotacao.fonte})`}
          </p>
        </div>
      </div>

      <ResultadosGerados
        tipo="imagem"
        profileId={profileId}
        recarregar={recarregar}
        brlPorUsd={cotacao?.brlPorUsd}
      />
    </div>
  );
}
