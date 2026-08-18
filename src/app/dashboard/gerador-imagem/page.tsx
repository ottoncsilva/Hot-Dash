"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiGet, apiSend, apiUpload } from "@/lib/api";
import { showToast } from "@/lib/toast";
import { useProfile } from "@/context/ProfileContext";
import { PrecisaDeModelo } from "@/components/ProfilePicker";
import PageHeader from "@/components/PageHeader";
import Link from "next/link";
import MediaPicker from "@/components/telegram/bot/MediaPicker";
import {
  IconSparkle,
  IconUpload,
  IconDownload,
  IconClose,
  IconCheck,
  IconTrash,
} from "@/components/icons";
import type { MediaItem } from "@/lib/types";

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
 * O servidor sempre manda a imagem a copiar como a PRIMEIRA referência — é
 * essa ordem que o prompt padrão desta tela pressupõe.
 */

type AspectRatio =
  | "auto" | "1:1" | "4:5" | "3:4" | "9:16" | "16:9" | "3:2" | "2:3" | "4:3" | "5:4"
  | "1:2" | "2:1" | "9:19.5" | "19.5:9" | "9:20" | "20:9" | "9:21" | "21:9";

const FORMATOS: { value: AspectRatio; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "1:1", label: "1:1" },
  { value: "4:5", label: "4:5" },
  { value: "3:4", label: "3:4" },
  { value: "9:16", label: "9:16" },
  { value: "16:9", label: "16:9" },
  { value: "3:2", label: "3:2" },
  { value: "2:3", label: "2:3" },
  { value: "4:3", label: "4:3" },
  { value: "5:4", label: "5:4" },
  { value: "1:2", label: "1:2" },
  { value: "2:1", label: "2:1" },
  { value: "9:19.5", label: "9:19.5" },
  { value: "19.5:9", label: "19.5:9" },
  { value: "9:20", label: "9:20" },
  { value: "20:9", label: "20:9" },
  { value: "9:21", label: "9:21" },
  { value: "21:9", label: "21:9" },
];

const MAX_REFERENCIAS_GALERIA = 13; // + 1 imagem a copiar = 14, o teto do modelo

/** O que vai no campo de prompt quando o operador clica em "usar padrão" —
 *  muda conforme o que já foi escolhido, porque a instrução certa depende de
 *  ter ou não uma composição para reproduzir. */
function promptPadrao(temCopia: boolean, temReferencias: boolean): string {
  if (temCopia && temReferencias) {
    return (
      "Reproduza fielmente a composição, a pose, o enquadramento, a iluminação e o cenário da " +
      "primeira imagem de referência — mas troque a pessoa pela mostrada nas imagens de " +
      "referência seguintes, mantendo o rosto, o corpo e as características dela com fidelidade. " +
      "Resultado fotorrealista, sem marca d'água, sem texto na imagem."
    );
  }
  if (temCopia) {
    return (
      "Reproduza fielmente a composição, a pose, o enquadramento, a iluminação e o cenário da " +
      "imagem de referência. Resultado fotorrealista, sem marca d'água, sem texto na imagem."
    );
  }
  if (temReferencias) {
    return (
      "Uma foto fotorrealista da pessoa mostrada nas imagens de referência, mantendo fielmente o " +
      "rosto e o corpo dela. Cenário: [descreva o local, a roupa, a pose, a luz e o clima da cena]. " +
      "Sem marca d'água, sem texto na imagem."
    );
  }
  return (
    "Foto fotorrealista, still de câmera profissional, luz natural suave, still shot editorial. " +
    "[descreva a cena, o local, a pose, o estilo de roupa e a expressão]. Sem marca d'água, sem " +
    "texto na imagem."
  );
}

type Resultado = {
  id: string;
  dataUrl: string;
  mediaType: string;
  costUsd?: number;
  resolution: string;
  aspectRatio: string;
  createdAt: number;
  salvando: "idle" | "salvando" | "salvo";
};

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
  const [prompt, setPrompt] = useState("");
  const [resolution, setResolution] = useState<"1K" | "2K">("2K");
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("auto");
  const [seed, setSeed] = useState("");
  const [avancadoAberto, setAvancadoAberto] = useState(false);
  const [gerando, setGerando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [resultados, setResultados] = useState<Resultado[]>([]);
  const dropRef = useRef<HTMLDivElement>(null);

  // A tela precisa saber se o OpenRouter está pronto ANTES de tentar gerar —
  // sem isso o operador só descobriria depois de preencher tudo e clicar.
  useEffect(() => {
    apiGet<{ settings: { openrouter?: { enabled?: boolean; hasKey?: boolean } } }>("/api/settings/ai")
      .then((d) => setConectado(Boolean(d.settings?.openrouter?.enabled && d.settings?.openrouter?.hasKey)))
      .catch(() => setConectado(null));
  }, []);

  useEffect(() => {
    return () => {
      if (copiaPreview) URL.revokeObjectURL(copiaPreview);
    };
  }, [copiaPreview]);

  const custoTotal = resultados.reduce((s, r) => s + (r.costUsd || 0), 0);

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

  function usarPromptPadrao() {
    setPrompt(promptPadrao(Boolean(copiaBase64), referenciasModelo.length > 0));
  }

  async function gerar() {
    if (!profileId) return;
    if (!prompt.trim()) {
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
          prompt: prompt.trim(),
          resolution,
          aspectRatio,
          seed: seedNum,
          copyImageBase64: copiaBase64 || undefined,
          referenceMediaIds: referenciasModelo,
        },
      );
      setResultados((prev) => [
        {
          id: crypto.randomUUID(),
          dataUrl: `data:${r.mediaType};base64,${r.base64}`,
          mediaType: r.mediaType,
          costUsd: r.costUsd,
          resolution,
          aspectRatio,
          createdAt: Date.now(),
          salvando: "idle",
        },
        ...prev,
      ]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Falha ao gerar a imagem.";
      setErro(msg);
      showToast(msg, "error");
    } finally {
      setGerando(false);
    }
  }

  async function salvarNaGaleria(item: Resultado) {
    if (!profileId) return;
    setResultados((prev) => prev.map((r) => (r.id === item.id ? { ...r, salvando: "salvando" } : r)));
    try {
      const res = await fetch(item.dataUrl);
      const blob = await res.blob();
      const ext = item.mediaType.includes("png") ? "png" : item.mediaType.includes("webp") ? "webp" : "jpg";
      const form = new FormData();
      form.append("file", new File([blob], `seedream-${item.id.slice(0, 8)}.${ext}`, { type: item.mediaType }));
      await apiUpload<{ media: MediaItem }>(`/api/profiles/${profileId}/media`, form);
      setResultados((prev) => prev.map((r) => (r.id === item.id ? { ...r, salvando: "salvo" } : r)));
      showToast("Salvo na Galeria.", "success");
    } catch (e) {
      setResultados((prev) => prev.map((r) => (r.id === item.id ? { ...r, salvando: "idle" } : r)));
      showToast(e instanceof Error ? e.message : "Falha ao salvar.", "error");
    }
  }

  function baixar(item: Resultado) {
    const a = document.createElement("a");
    a.href = item.dataUrl;
    a.download = `seedream-${item.id.slice(0, 8)}.${item.mediaType.includes("png") ? "png" : "jpg"}`;
    a.click();
  }

  function descartar(id: string) {
    setResultados((prev) => prev.filter((r) => r.id !== id));
  }

  if (!profileId) {
    return (
      <div className="page">
        <PageHeader title="Gerador de Imagem" />
        <PrecisaDeModelo oQue="gerar imagens com IA" />
      </div>
    );
  }

  const totalReferencias = referenciasModelo.length + (copiaBase64 ? 1 : 0);

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
            imagem gerada.
          </p>
          <div className="mt-2">
            <MediaPicker
              profileId={profileId}
              selected={referenciasModelo}
              onChange={setReferenciasModelo}
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
            nesta geração, não entra na Galeria.
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

        {/* PROMPT */}
        <div className="mt-5">
          <div className="flex items-center justify-between">
            <label className="eyebrow">Prompt</label>
            <button type="button" onClick={usarPromptPadrao} className="btn-ghost px-2 py-1 text-[11px]">
              Usar prompt padrão
            </button>
          </div>
          <textarea
            className="input mt-1 min-h-[110px] resize-y"
            placeholder="Descreva a imagem — ou clique em “Usar prompt padrão” para começar de um modelo pronto."
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
        </div>

        {/* RESOLUÇÃO */}
        <div className="mt-5">
          <label className="eyebrow">Resolução</label>
          <div className="mt-1.5 flex gap-2">
            {(["1K", "2K"] as const).map((r) => (
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
            {FORMATOS.map((f) => (
              <button
                key={f.value}
                type="button"
                onClick={() => setAspectRatio(f.value)}
                className={`rounded-lg border px-2.5 py-1 font-mono text-[12px] transition-colors ${
                  aspectRatio === f.value
                    ? "border-emerald-500/40 bg-emerald-500/[0.12] font-semibold text-emerald-300"
                    : "border-white/10 text-zinc-400 hover:border-white/25 hover:text-zinc-200"
                }`}
              >
                {f.label}
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
          <p className="text-[11px] text-zinc-500">
            {totalReferencias}/14 referências enviadas
            {custoTotal > 0 && ` · gasto nesta sessão: $${custoTotal.toFixed(3)}`}
          </p>
        </div>
      </div>

      {/* RESULTADOS */}
      {resultados.length > 0 && (
        <div className="mt-5">
          <p className="eyebrow mb-2">Resultados desta sessão</p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {resultados.map((item) => (
              <div key={item.id} className="card overflow-hidden p-0">
                <img src={item.dataUrl} alt="" className="w-full bg-black/30 object-contain" />
                <div className="p-3">
                  <p className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">
                    {item.resolution} · {item.aspectRatio}
                    {typeof item.costUsd === "number" && ` · $${item.costUsd.toFixed(3)}`}
                  </p>
                  <div className="mt-2 flex gap-1.5">
                    <button
                      onClick={() => salvarNaGaleria(item)}
                      disabled={item.salvando !== "idle"}
                      className="btn-ghost flex-1 px-2 py-1.5 text-xs"
                    >
                      {item.salvando === "salvando" ? (
                        "Salvando..."
                      ) : item.salvando === "salvo" ? (
                        <>
                          <IconCheck size={13} /> Salvo
                        </>
                      ) : (
                        "Salvar na Galeria"
                      )}
                    </button>
                    <button
                      onClick={() => baixar(item)}
                      className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-zinc-500 hover:bg-white/10 hover:text-white"
                      aria-label="Baixar"
                    >
                      <IconDownload size={15} />
                    </button>
                    <button
                      onClick={() => descartar(item.id)}
                      className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-zinc-500 hover:bg-white/10 hover:text-red-400"
                      aria-label="Descartar"
                    >
                      <IconTrash size={15} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
