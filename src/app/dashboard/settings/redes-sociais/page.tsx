"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiGet, apiSend } from "@/lib/api";
import { IconCopy, IconInstagram } from "@/components/icons";
import { BackToSettings } from "../_shared";
import CampoSecreto from "@/components/CampoSecreto";
import { showToast } from "@/lib/toast";
import type { InstagramAppSettingsPublic } from "@/lib/settings";

/**
 * REDES SOCIAIS — o que vale para todas as modelos de uma vez.
 *
 * O aplicativo da Meta morava na tela do Instagram do LTV, junto das contas.
 * Mas ele não é do LTV nem de uma modelo: é UM aplicativo para a operação
 * inteira, cadastrado uma vez e esquecido. Ficar lá dentro dava a impressão de
 * que era ajuste do canal de DM, e quem procurava por ele em Configurações não
 * achava.
 *
 * É este o lugar de tudo que for configuração de rede social daqui pra frente.
 * A tela do LTV continua com o que é dela: as contas conectadas e o agente de
 * cada uma.
 */

/** Como está o recebimento de mensagens, perguntado à Meta. */
type Webhook = { ativo: boolean; callbackUrl?: string; campos: string[]; erro?: string };

export default function RedesSociaisPage() {
  const [app, setApp] = useState<InstagramAppSettingsPublic | null>(null);
  const [webhook, setWebhook] = useState<Webhook | null>(null);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [carregando, setCarregando] = useState(true);

  const carregar = useCallback(async () => {
    try {
      // Sem `profileId`: aqui não há modelo selecionada, e o aplicativo é um
      // só para todas.
      const d = await apiGet<{
        app: InstagramAppSettingsPublic;
        webhook: Webhook | null;
        webhookUrl: string;
      }>("/api/instagram/accounts");
      setApp(d.app);
      setWebhook(d.webhook);
      setWebhookUrl(d.webhookUrl || "");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Falha ao carregar.", "error");
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  return (
    <div className="page-narrow">
      <BackToSettings />
      <h1 className="mt-4 font-display text-2xl font-semibold tracking-tight">Redes sociais</h1>
      <p className="mt-2 text-sm text-zinc-500">
        Conexões que valem para todas as modelos. As contas de cada uma ficam em LTV → Instagram.
      </p>

      {carregando ? (
        <div className="mt-4 card h-40 animate-pulse" />
      ) : (
        <InstagramApp
          app={app}
          webhook={webhook}
          webhookUrl={webhookUrl}
          onSaved={(a, w) => {
            setApp(a);
            if (w !== undefined) setWebhook(w);
          }}
        />
      )}

      <Manual base={app?.publicBaseUrl || ""} />
    </div>
  );
}

/**
 * O aplicativo da Meta — um só, para TODAS as modelos.
 *
 * A operação inteira fala com a Meta por este app. Guardar um por modelo
 * criaria N apps para cadastrar e N App Reviews para pedir no dia em que a
 * operação virar Tech Provider.
 */
function InstagramApp({
  app,
  webhook,
  webhookUrl,
  onSaved,
}: {
  app: InstagramAppSettingsPublic | null;
  webhook: Webhook | null;
  webhookUrl: string;
  onSaved: (a: InstagramAppSettingsPublic, w?: Webhook | null) => void;
}) {
  const [appId, setAppId] = useState("");
  const [secret, setSecret] = useState("");
  const [base, setBase] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [ligando, setLigando] = useState(false);
  const [erroWebhook, setErroWebhook] = useState<string | null>(null);

  useEffect(() => {
    if (!app) return;
    setAppId(app.appId);
    setBase(app.publicBaseUrl);
    // O segredo nunca volta do servidor: o campo nasce vazio e só é enviado
    // quando alguém digita algo novo.
    setSecret("");
  }, [app]);

  const pronto = Boolean(app?.appId && app?.hasSecret && app?.publicBaseUrl);

  async function salvar() {
    setSalvando(true);
    setErroWebhook(null);
    try {
      const r = await apiSend<{
        app: InstagramAppSettingsPublic;
        webhook: Webhook | null;
        webhookErro?: string;
      }>("/api/instagram/accounts", "POST", {
        action: "save-app",
        appId,
        publicBaseUrl: base,
        ...(secret ? { appSecret: secret } : {}),
      });
      onSaved(r.app, r.webhook);
      setSecret("");
      setErroWebhook(r.webhookErro || null);
      showToast(
        r.webhook?.ativo ? "Salvo — e o recebimento de mensagens já está ligado." : "Salvo!",
        r.webhookErro ? "error" : "success",
      );
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Falha ao salvar.", "error");
    } finally {
      setSalvando(false);
    }
  }

  /** Tentar de novo sem reeditar nada — o motivo mais comum de falha é o painel
   *  ainda não estar no ar no endereço informado, e isso se resolve esperando. */
  async function ligarWebhook() {
    setLigando(true);
    setErroWebhook(null);
    try {
      const r = await apiSend<{ ok: boolean; erro?: string; webhook: Webhook }>(
        "/api/instagram/accounts",
        "POST",
        { action: "configurar-webhook" },
      );
      if (app) onSaved(app, r.webhook);
      setErroWebhook(r.erro || null);
      showToast(r.ok ? "Recebimento ligado." : r.erro || "A Meta recusou.", r.ok ? "success" : "error");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Falha.", "error");
    } finally {
      setLigando(false);
    }
  }

  const callback = base ? `${base.replace(/\/+$/, "")}/api/instagram/callback` : "";

  return (
    <div className="mt-4 card p-4">
      <div className="flex items-center gap-2.5">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-white/10 bg-white/[0.03] text-zinc-400">
          <IconInstagram size={16} />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-medium text-zinc-100">Aplicativo da Meta</p>
          <p className="text-[11px] text-zinc-500">
            Um só para todas as modelos.{" "}
            <span className={pronto && webhook?.ativo ? "text-emerald-400" : "text-amber-400"}>
              {!pronto
                ? "Ainda falta preencher."
                : webhook?.ativo
                  ? "Configurado, recebendo mensagens."
                  : "Configurado — falta ligar o recebimento."}
            </span>
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 border-t border-white/[0.06] pt-4">
        <div>
          <label className="eyebrow mb-1.5 block">Endereço público do painel</label>
          <input
            className="input"
            value={base}
            onChange={(e) => setBase(e.target.value)}
            placeholder="https://painel.seudominio.com"
          />
          <p className="mt-1 text-[11px] text-zinc-600">
            Sem barra no fim. É daqui que saem as duas URLs abaixo, e a Meta compara letra por letra
            com o que está cadastrado no app.
          </p>
        </div>

        {base && (
          /* A ÚNICA URL que ainda precisa ser colada à mão. As configurações de
             login do app não são expostas pela API da Meta — o recebimento de
             mensagens é, e por isso ele se resolve sozinho logo abaixo. */
          <UrlParaCopiar label="OAuth Redirect URI (colar na Meta)" url={callback} />
        )}

        <div>
          <label className="eyebrow mb-1.5 block">Instagram App ID</label>
          <CampoSecreto
            tipo="texto"
            className="input"
            name="instagram-app-id"
            value={appId}
            onChange={setAppId}
          />
        </div>
        <div>
          <label className="eyebrow mb-1.5 block">
            Instagram App Secret {app?.hasSecret && <span className="text-emerald-400">· salvo</span>}
          </label>
          <CampoSecreto
            className="input"
            name="instagram-app-secret"
            value={secret}
            onChange={setSecret}
            placeholder={app?.hasSecret ? "•••••••• (deixe vazio para manter)" : ""}
          />
          <p className="mt-1 text-[11px] text-zinc-600">
            Também é ele que assina o webhook — sem o segredo certo, nenhuma mensagem é aceita.
          </p>
        </div>
        <button type="button" onClick={salvar} disabled={salvando} className="btn-primary">
          {salvando ? "Salvando e ligando..." : "Salvar aplicativo"}
        </button>

        <Recebimento
          webhook={webhook}
          webhookUrl={webhookUrl}
          erro={erroWebhook}
          ocupado={ligando}
          pronto={pronto}
          onLigar={ligarWebhook}
        />
      </div>

      {pronto && (
        <p className="mt-3 border-t border-white/[0.06] pt-3 text-[11px] text-zinc-600">
          Aplicativo pronto. As contas de cada modelo se conectam em{" "}
          <Link href="/dashboard/ltv/instagram" className="text-zinc-400 underline underline-offset-2 hover:text-white">
            LTV → Instagram
          </Link>
          .
        </p>
      )}
    </div>
  );
}

/**
 * O RECEBIMENTO DE MENSAGENS, e se ele está mesmo de pé.
 *
 * Este era o passo que o operador fazia à mão no console da Meta e o único que
 * errava em silêncio: esquecer de assinar o campo `messages` deixa tudo com
 * cara de certo e nada chega. O painel se cadastra sozinho ao salvar as
 * credenciais — e o que se vê aqui não é o que ACHAMOS que configuramos, é o
 * que a Meta respondeu quando a tela perguntou.
 */
function Recebimento({
  webhook,
  webhookUrl,
  erro,
  ocupado,
  pronto,
  onLigar,
}: {
  webhook: Webhook | null;
  webhookUrl: string;
  erro: string | null;
  ocupado: boolean;
  pronto: boolean;
  onLigar: () => void;
}) {
  if (!pronto) return null;

  const ativo = Boolean(webhook?.ativo);
  // Cadastrado, mas entregando em OUTRO lugar. Acontece ao trocar o domínio do
  // painel: a Meta continua mandando para o endereço velho, e sem dizer isso a
  // tela mostraria "não configurado" sem explicar por quê.
  const outroDestino =
    webhook && !webhook.ativo && webhook.callbackUrl && webhook.callbackUrl !== webhookUrl;

  return (
    <div
      className={`rounded-xl border p-3 ${
        ativo ? "border-emerald-500/25 bg-emerald-500/[0.05]" : "border-amber-500/25 bg-amber-500/[0.06]"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className={`text-xs font-medium ${ativo ? "text-emerald-300" : "text-amber-300"}`}>
            {ativo ? "Recebendo mensagens" : "Recebimento não está de pé"}
          </p>
          <p className="mt-0.5 text-[11px] text-zinc-500">
            {ativo
              ? "A Meta confirmou que entrega as mensagens neste painel. Nada a fazer no site dela."
              : "O painel tenta ligar sozinho ao salvar. Se não deu, tente de novo aqui."}
          </p>
        </div>
        {!ativo && (
          <button
            type="button"
            onClick={onLigar}
            disabled={ocupado}
            className="shrink-0 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-[11px] font-bold text-amber-300 transition-colors hover:bg-amber-500/20 disabled:opacity-40"
          >
            {ocupado ? "Ligando..." : "Ligar agora"}
          </button>
        )}
      </div>

      {erro && (
        <p className="mt-2 rounded-lg border border-red-500/20 bg-red-500/[0.07] px-2.5 py-1.5 text-[11px] leading-relaxed text-red-300">
          A Meta respondeu: {erro}
        </p>
      )}

      {outroDestino && (
        <p className="mt-2 text-[11px] leading-relaxed text-amber-400/80">
          O aplicativo está cadastrado, mas entregando em <code>{webhook!.callbackUrl}</code> — não
          neste painel. Trocou o endereço? Clique em Ligar agora para apontar para cá.
        </p>
      )}

      {webhook?.erro && !erro && (
        <p className="mt-2 text-[11px] text-zinc-500">Não deu para conferir com a Meta: {webhook.erro}</p>
      )}

      {!ativo && webhookUrl && (
        <div className="mt-2.5 border-t border-white/[0.06] pt-2.5">
          <p className="mb-1.5 text-[11px] text-zinc-600">
            Se preferir fazer à mão no site da Meta, o endereço é este — e o campo a assinar é{" "}
            <code>messages</code>. A palavra de verificação o painel guarda sozinho.
          </p>
          <UrlParaCopiar label="URL do Webhook" url={webhookUrl} />
        </div>
      )}
    </div>
  );
}

function UrlParaCopiar({ label, url }: { label: string; url: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-black/20 px-3 py-2">
      <span className="shrink-0 font-mono text-[10px] uppercase tracking-wider text-zinc-500">{label}</span>
      <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-zinc-300">{url}</span>
      <button
        type="button"
        title="Copiar"
        onClick={() => {
          navigator.clipboard.writeText(url).catch(() => {});
          showToast("Copiado!", "success");
        }}
        className="shrink-0 text-zinc-600 transition-colors hover:text-white"
      >
        <IconCopy size={13} />
      </button>
    </div>
  );
}

/**
 * O MANUAL, ao lado dos campos que ele manda preencher.
 *
 * Nasce fechado: quem já conectou não precisa rolar por cima dele toda vez.
 * Fica aqui, e não num documento à parte, porque metade dos passos é copiar um
 * valor de um lado e colar do outro — e um manual noutra aba não tem os
 * valores desta instalação.
 */
function Manual({ base }: { base: string }) {
  const [aberto, setAberto] = useState(false);
  const callback = base ? `${base.replace(/\/+$/, "")}/api/instagram/callback` : "(preencha o endereço público acima)";

  return (
    <div className="mt-4 card p-4">
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <div>
          <p className="text-sm font-semibold text-white">Como conectar o aplicativo da Meta</p>
          <p className="mt-0.5 text-xs text-zinc-500">Sete passos, uma vez só para toda a operação.</p>
        </div>
        <span className="shrink-0 text-xs text-zinc-500">{aberto ? "recolher ▲" : "abrir ▼"}</span>
      </button>

      {aberto && (
        <ol className="mt-4 space-y-4 border-t border-white/[0.06] pt-4 text-xs leading-relaxed text-zinc-400">
          <Passo n={1} titulo="A conta da modelo precisa ser profissional">
            No app do Instagram, em Configurações → Tipo de conta, mude para <b>Comercial</b> ou{" "}
            <b>Criador de conteúdo</b>. Conta pessoal não recebe mensagem por API, e o erro só
            aparece lá no fim, na hora de conectar.
          </Passo>

          <Passo n={2} titulo="Crie o aplicativo">
            Em <Ext href="https://developers.facebook.com/apps">developers.facebook.com/apps</Ext> →{" "}
            <b>Criar aplicativo</b>. Quando perguntar o que você quer fazer, escolha a opção que
            menciona <b>Instagram</b> (ou o tipo <b>Empresa</b>) e, dentro do app, adicione o
            produto <b>Instagram</b>.
          </Passo>

          <Passo n={3} titulo="Pegue o App ID e o App Secret do INSTAGRAM">
            No menu do app, <b>Instagram → Configuração da API</b>. É de lá que saem o{" "}
            <b>Instagram App ID</b> e o <b>Instagram App Secret</b> — e não os do topo da página,
            que são do aplicativo do Facebook. Esse é o erro mais comum: os dois pares existem,
            parecem iguais, e o par errado só falha na hora de conectar a conta.
          </Passo>

          <Passo n={4} titulo="Cole a URL de retorno lá na Meta">
            Ainda em Configuração da API, na parte de login do Instagram, procure o campo de{" "}
            <b>URIs de redirecionamento do OAuth</b> e cole exatamente:
            <code className="mt-1.5 block break-all rounded-lg border border-white/10 bg-black/30 px-2.5 py-1.5 font-mono text-[11px] text-zinc-300">
              {callback}
            </code>
            Letra por letra, com https e sem barra no fim — a Meta compara o texto inteiro e recusa
            por um caractere de diferença.
          </Passo>

          <Passo n={5} titulo="Preencha os três campos aqui em cima e salve">
            Endereço público do painel, Instagram App ID e Instagram App Secret. Ao salvar, o painel
            registra o recebimento de mensagens na Meta sozinho — é o passo que antes se fazia à mão
            e era o que mais falhava calado.
          </Passo>

          <Passo n={6} titulo="Confira a tarja verde">
            Tem que aparecer <b className="text-emerald-400">Recebendo mensagens</b>. Amarelo é
            recebimento fora do ar: clique em <b>Ligar agora</b>. Se a Meta recusar, ela diz o
            motivo na própria tela — quase sempre é o painel ainda não estar no ar no endereço
            informado.
          </Passo>

          <Passo n={7} titulo="Conecte a conta de cada modelo">
            Em <Link href="/dashboard/ltv/instagram" className="text-zinc-200 underline underline-offset-2">LTV → Instagram</Link>,
            escolha a modelo e clique em <b>+ Conectar conta</b>. O painel copia um link: mande para
            a modelo abrir <b>no celular dela</b>, já logada na conta certa. Quem autoriza é ela, não
            você — o login é dela.
          </Passo>

          <li className="rounded-lg border border-white/10 bg-black/20 p-3 text-[11px] text-zinc-500">
            <b className="text-zinc-300">Trocou o domínio do painel?</b> Volte no passo 4 com a URL
            nova, atualize o endereço público aqui em cima e clique em Ligar agora. A Meta continua
            entregando no endereço velho até alguém avisar.
          </li>
        </ol>
      )}
    </div>
  );
}

function Passo({ n, titulo, children }: { n: number; titulo: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-white/10 bg-white/[0.03] font-mono text-[11px] text-zinc-400">
        {n}
      </span>
      <div className="min-w-0">
        <p className="text-xs font-semibold text-zinc-200">{titulo}</p>
        <p className="mt-1">{children}</p>
      </div>
    </li>
  );
}

function Ext({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-zinc-200 underline underline-offset-2 hover:text-white"
    >
      {children}
    </a>
  );
}
