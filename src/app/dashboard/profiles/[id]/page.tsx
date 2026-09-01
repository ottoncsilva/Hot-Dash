"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { apiGet, apiSend, apiUpload } from "@/lib/api";
import AuthImage from "@/components/AuthImage";
import Modal from "@/components/Modal";
import ToggleChip from "@/components/ToggleChip";
import { useConfirm } from "@/hooks/useConfirm";
import { useProfile } from "@/context/ProfileContext";
import {
  IconArrowLeft,
  IconPlus,
  IconEdit,
  IconTrash,
  IconEye,
  IconEyeOff,
  IconCopy,
  IconLink,
  IconLock,
  IconMedia,
  IconChevronRight,
} from "@/components/icons";
import {
  NETWORK_LABELS,
  type Profile,
  type SocialAccount,
  type SocialNetwork,
} from "@/lib/types";
import { buildSocialUrl, networkMeta } from "@/lib/socialLinks";

/** De onde veio o link do VIP descoberto (espelha VIP_LINK_SOURCE_LABEL). */
const VIP_SOURCE_LABEL: Record<string, string> = {
  manual: "preenchido por você",
  bot: "conversa do bot",
  vip_publico: "@ público do canal VIP",
  vip_convite: "convite do canal VIP",
  vip_novo_convite: "convite criado agora para o canal VIP",
};
import { showToast } from "@/lib/toast";
import DetectChat from "@/components/telegram/bot/DetectChat";
import { KeyLabel } from "../../settings/_shared";

/** Junta o que era "Como ela é" (Santinha/Safadinha/Explícita) com o Tom que
 *  só existia no LTV — são a mesma ideia (o jeito dela na conversa), então
 *  viram um chip multi-select só, em vez de dois campos que se sobrepõem. */
const TONS = [
  "Carinhosa",
  "Namoradinha",
  "Safada",
  "Dominadora",
  "Misteriosa",
  "Brincalhona",
  "Santinha",
  "Explícita",
];

export default function ProfileDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { refresh: refreshProfiles } = useProfile();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [bioPhysical, setBioPhysical] = useState("");
  const [bioUnique, setBioUnique] = useState("");
  const [toneTags, setToneTags] = useState<string[]>([]);
  const [limits, setLimits] = useState("");
  const [bioVipLink, setBioVipLink] = useState("");
  // O link do VIP que o painel DESCOBRIU sozinho (bot/grupo). Só serve para
  // mostrar na tela: quem manda no envio é o campo acima, quando preenchido.
  const [vipAuto, setVipAuto] = useState<{ link: string; source?: string; problem?: string } | null>(null);
  const [vipBusy, setVipBusy] = useState(false);
  const [bioWhatsappLink, setBioWhatsappLink] = useState("");
  const [bioWhatsappButton, setBioWhatsappButton] = useState("");
  const [bioTelegramLink, setBioTelegramLink] = useState("");
  const [bioTelegramButton, setBioTelegramButton] = useState("");
  // Credenciais do bot do Telegram (vivem em telegram_bots, por perfil).
  const [botToken, setBotToken] = useState("");
  // Existe token salvo? A API só informa isso — nunca o token em si.
  const [hasToken, setHasToken] = useState(false);
  const [botIdVip, setBotIdVip] = useState("");
  const [botIdPrevias, setBotIdPrevias] = useState("");
  // Canal de Vendas — terceiro canal, OPCIONAL (ao contrário dos dois
  // acima): sem ele, o bot simplesmente não manda o relatório de venda.
  const [botIdVendas, setBotIdVendas] = useState("");
  const [botOrig, setBotOrig] = useState({ token: "", vip: "", prev: "", vendas: "" });
  const [savingInfo, setSavingInfo] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [avatarKey, setAvatarKey] = useState(0);
  const [editingAccount, setEditingAccount] = useState<SocialAccount | null>(null);
  const [addingAccount, setAddingAccount] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const { confirm, ConfirmDialog } = useConfirm();

  async function load() {
    setLoading(true);
    try {
      const data = await apiGet<{ profile: Profile }>(`/api/profiles/${id}`);
      setProfile(data.profile);
      setName(data.profile.name);
      setNotes(data.profile.notes || "");
      setBioPhysical(data.profile.bioPhysical || "");
      setBioUnique(data.profile.bioUnique || "");
      setToneTags(data.profile.toneTags || []);
      setLimits(data.profile.limits || "");
      setBioVipLink(data.profile.bioVipLink || "");
      setBioWhatsappLink(data.profile.bioWhatsappLink || "");
      setBioWhatsappButton(data.profile.bioWhatsappButton || "");
      setBioTelegramLink(data.profile.bioTelegramLink || "");
      setBioTelegramButton(data.profile.bioTelegramButton || "");
      // Credenciais do bot (não bloqueia a tela se falhar).
      try {
        const tg = await apiGet<{
          bot: { hasToken?: boolean; idVip?: string; idAquecimento?: string; idVendas?: string } | null;
        }>(`/api/telegram?profileId=${id}`);
        // O token NÃO volta da API (ver a rota: ele dá controle total do bot).
        // O campo fica vazio e o placeholder avisa que já existe um salvo —
        // digitar algo aqui é o que troca o token.
        setHasToken(Boolean(tg.bot?.hasToken));
        setBotToken("");
        setBotIdVip(tg.bot?.idVip || "");
        setBotIdPrevias(tg.bot?.idAquecimento || "");
        setBotIdVendas(tg.bot?.idVendas || "");
        // Descobre o link do VIP (com cache no servidor: só fala com o
        // Telegram na primeira vez).
        try {
          setVipAuto(
            await apiSend<{ link: string; source?: string; problem?: string }>(
              "/api/telegram",
              "POST",
              { action: "vip-link", profileId: id },
            ),
          );
        } catch {
          setVipAuto(null);
        }
        setBotOrig({
          token: "",
          vip: tg.bot?.idVip || "",
          prev: tg.bot?.idAquecimento || "",
          vendas: tg.bot?.idVendas || "",
        });
      } catch {
        /* sem bot ainda */
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao carregar.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function saveInfo() {
    setSavingInfo(true);
    setError(null);
    try {
      const { profile: p } = await apiSend<{ profile: Profile }>(
        `/api/profiles/${id}`,
        "PATCH",
        {
          name,
          notes,
          bioPhysical,
          bioUnique,
          toneTags,
          limits,
          bioVipLink,
          bioWhatsappLink,
          bioWhatsappButton,
          bioTelegramLink,
          bioTelegramButton,
        },
      );
      setProfile(p);

      // Credenciais do bot. O token só é enviado quando o operador digita um
      // novo: campo vazio com token já salvo significa "mantenha o que está lá"
      // (a rota resolve isso), então dá para editar só os IDs dos grupos.
      if ((botToken.trim() || hasToken) && botIdVip.trim() && botIdPrevias.trim()) {
        await apiSend("/api/telegram", "POST", {
          action: "save-bot-credentials",
          profileId: id,
          botToken: botToken.trim(),
          idVip: botIdVip.trim(),
          idAquecimento: botIdPrevias.trim(),
          idVendas: botIdVendas.trim(),
        });
        if (botToken.trim()) setHasToken(true);
        setBotToken("");
        setBotOrig({ token: "", vip: botIdVip.trim(), prev: botIdPrevias.trim(), vendas: botIdVendas.trim() });
      }
      showToast("Salvo!");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao salvar.");
    } finally {
      setSavingInfo(false);
    }
  }

  async function uploadAvatar(file: File) {
    setUploadingAvatar(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const { profile: p } = await apiUpload<{ profile: Profile }>(
        `/api/profiles/${id}/avatar`,
        form,
      );
      setProfile(p);
      setAvatarKey((k) => k + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha no upload.");
    } finally {
      setUploadingAvatar(false);
    }
  }

  async function removeProfile() {
    if (
      !(await confirm({
        message:
          "Excluir este perfil e todos os seus dados (contas, senhas e mídia)? Isso remove tudo do servidor.",
      }))
    )
      return;
    try {
      await apiSend(`/api/profiles/${id}`, "DELETE");
      showToast("Modelo excluído.");
      router.replace("/dashboard/profiles");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao excluir.");
    }
  }

  if (loading) {
    return (
      <div className="page-narrow">
        <div className="card h-44 animate-pulse" />
      </div>
    );
  }
  if (!profile) {
    return (
      <div className="page-narrow">
        <p className="text-zinc-300">{error || "Perfil não encontrado."}</p>
        <Link href="/dashboard/profiles" className="btn-ghost mt-4">
          <IconArrowLeft size={16} /> Voltar
        </Link>
      </div>
    );
  }

  const infoChanged =
    name.trim() !== profile.name ||
    (notes || "") !== (profile.notes || "") ||
    bioPhysical !== (profile.bioPhysical || "") ||
    bioUnique !== (profile.bioUnique || "") ||
    JSON.stringify(toneTags) !== JSON.stringify(profile.toneTags || []) ||
    limits !== (profile.limits || "") ||
    bioVipLink !== (profile.bioVipLink || "") ||
    bioWhatsappLink !== (profile.bioWhatsappLink || "") ||
    bioWhatsappButton !== (profile.bioWhatsappButton || "") ||
    bioTelegramLink !== (profile.bioTelegramLink || "") ||
    bioTelegramButton !== (profile.bioTelegramButton || "") ||
    botToken !== botOrig.token ||
    botIdVip !== botOrig.vip ||
    botIdPrevias !== botOrig.prev ||
    botIdVendas !== botOrig.vendas;

  return (
    <div className="page-narrow">
      <Link
        href="/dashboard/profiles"
        className="inline-flex items-center gap-1.5 text-sm text-zinc-500 transition-colors hover:text-zinc-200"
      >
        <IconArrowLeft size={16} /> Modelos
      </Link>

      {error && (
        <div className="mt-4 rounded-lg border border-red-500/20 bg-red-500/[0.07] px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {/* Cabeçalho */}
      <div className="card mt-4 p-5">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
          <div className="flex flex-col items-center">
            <div className="h-24 w-24 overflow-hidden rounded-xl border border-white/10 bg-ink-800">
              <AuthImage
                key={avatarKey}
                src={profile.avatarPath ? `/api/profiles/${id}/avatar` : null}
                alt={profile.name}
                className="h-24 w-24 object-cover"
                fallback={
                  <div className="grid h-24 w-24 place-items-center font-display text-3xl font-semibold text-zinc-600">
                    {profile.name.charAt(0).toUpperCase()}
                  </div>
                }
              />
            </div>
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploadingAvatar}
              className="mt-2 font-mono text-[11px] uppercase tracking-wider text-zinc-500 hover:text-zinc-200"
            >
              {uploadingAvatar ? "enviando..." : "trocar foto"}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) uploadAvatar(f);
                e.target.value = "";
              }}
            />
          </div>

          <div className="flex-1 space-y-4">
            <div>
              <div className="mb-1 font-display text-sm font-semibold text-white/90">
                Perfil da modelo · <span className="text-zinc-500 font-normal">a I.A. escreve a Copy</span>
              </div>
              <p className="text-xs text-zinc-500 mb-4">A IA escreve a legenda no fetiche da modelo, no formato do Telegram.</p>
            </div>

            <div>
              <label className="eyebrow mb-1.5 block">Nome da Modelo</label>
              <input
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            
            <div>
              <label className="eyebrow mb-1.5 block">
                Personalidade{" "}
                <span className="font-normal text-zinc-500">
                  (bio, jeito de falar, gírias, o que gosta — quanto mais detalhada, mais humana
                  fica a conversa)
                </span>
              </label>
              <textarea
                className="input min-h-[120px] resize-y"
                placeholder="Ex: 40 anos, loira, de Alphaville São Paulo, chama o cliente de amor, usa pouco emoji, gosta de provocar, é elegante e fina, divorciada, não tem filhos..."
                value={bioPhysical}
                onChange={(e) => setBioPhysical(e.target.value)}
              />
            </div>

            <div>
              <label className="eyebrow mb-1.5 block">
                Mecanismo / História{" "}
                <span className="font-normal text-zinc-500">
                  (o contexto que ela usa pra vender e criar conexão)
                </span>
              </label>
              <textarea
                className="input min-h-[90px] resize-y"
                placeholder="Ex: Após o divórcio, resolveu vender conteúdo na internet para manter o estilo de vida, tem pacotes de fotos..."
                value={bioUnique}
                onChange={(e) => setBioUnique(e.target.value)}
              />
            </div>

            <div>
              <label className="eyebrow mb-1.5 block">Tom · pode escolher mais de um para mesclar</label>
              <div className="flex flex-wrap gap-2">
                {TONS.map((tom) => (
                  <ToggleChip
                    key={tom}
                    active={toneTags.includes(tom)}
                    onClick={() =>
                      setToneTags((atual) =>
                        atual.includes(tom) ? atual.filter((t) => t !== tom) : [...atual, tom],
                      )
                    }
                  >
                    {tom}
                  </ToggleChip>
                ))}
              </div>
              {toneTags.length > 1 && (
                <p className="mt-2 text-xs text-emerald-400">
                  Mesclando: <strong>{toneTags.join(" + ")}</strong> — ela alterna entre esses
                  traços na conversa.
                </p>
              )}
            </div>

            <div>
              <label className="eyebrow mb-1.5 block">
                Limites <span className="font-normal text-zinc-500">(o que ela NUNCA faz)</span>
              </label>
              <textarea
                className="input min-h-[140px] resize-y font-mono text-xs"
                value={limits}
                onChange={(e) => setLimits(e.target.value)}
              />
              <p className="mt-1 text-[11px] text-zinc-500">
                Nasce preenchido com um texto genérico — edite à vontade. Vazio, volta a valer
                esse padrão.
              </p>
            </div>

            <div>
              <label className="eyebrow mb-1.5 block">
                Link do VIP / Bot{" "}
                <span className="font-normal text-zinc-500">(entra nos botões da copy)</span>
              </label>
              {/* O campo virou OPCIONAL: o painel descobre este link sozinho a
                  partir do token do bot e do canal VIP. Preencher aqui só serve
                  para mandar o lead para outro lugar. */}
              <input
                className="input"
                placeholder={vipAuto?.link || "Ex: https://t.me/..."}
                value={bioVipLink}
                onChange={(e) => setBioVipLink(e.target.value)}
              />
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                {vipAuto?.link ? (
                  <p className="text-[11px] text-zinc-500">
                    {bioVipLink.trim() ? (
                      <>Sem este campo, seria usado: </>
                    ) : (
                      <>Descoberto sozinho: </>
                    )}
                    <span className="font-mono text-zinc-300">{vipAuto.link}</span>
                    {vipAuto.source && <> · {VIP_SOURCE_LABEL[vipAuto.source] || vipAuto.source}</>}
                  </p>
                ) : (
                  <p className="text-[11px] text-amber-400">
                    {vipAuto?.problem || "Ainda não foi possível descobrir o link — preencha acima."}
                  </p>
                )}
                <button
                  type="button"
                  disabled={vipBusy}
                  onClick={async () => {
                    setVipBusy(true);
                    try {
                      setVipAuto(
                        await apiSend("/api/telegram", "POST", {
                          action: "vip-link",
                          profileId: id,
                          forcar: true,
                        }),
                      );
                    } catch (e) {
                      showToast(e instanceof Error ? e.message : "Falha.", "error");
                    } finally {
                      setVipBusy(false);
                    }
                  }}
                  className="btn-ghost px-2 py-1 text-[11px]"
                >
                  {vipBusy ? "Procurando..." : "Procurar de novo"}
                </button>
              </div>
            </div>

            {/* Links de SAÍDA do VIP. São dois destinos possíveis para o mesmo
                papel — puxar o lead do canal para uma conversa 1 a 1 (LTV) — e
                cada geração do Método MK escolhe UM deles. */}
            <div className="panel rounded-xl p-4 space-y-3">
              <p className="eyebrow">WhatsApp particular (posts do VIP)</p>
              <p className="text-xs text-zinc-500 -mt-1">
                Puxa o lead do canal VIP para o WhatsApp. Aparece só nos posts VIP que você marcar.
              </p>
              <div>
                <label className="eyebrow mb-1.5 block">Link do WhatsApp</label>
                <input
                  className="input"
                  placeholder="Ex: https://wa.me/55..."
                  value={bioWhatsappLink}
                  onChange={(e) => setBioWhatsappLink(e.target.value)}
                />
              </div>
              <div>
                <label className="eyebrow mb-1.5 block">Texto do botão <span className="text-zinc-500 font-normal">(máx. 25 caracteres)</span></label>
                <input
                  className="input"
                  maxLength={25}
                  placeholder="meu whatsapp particular"
                  value={bioWhatsappButton}
                  onChange={(e) => setBioWhatsappButton(e.target.value)}
                />
              </div>
            </div>

            {/* O outro destino: a conversa privada no PRÓPRIO Telegram. Vantagem
                sobre o WhatsApp — o lead não sai do app nem entrega o número,
                então a barreira para o primeiro "oi" é bem menor. */}
            <div className="panel rounded-xl p-4 space-y-3">
              <p className="eyebrow">Telegram particular (posts do VIP)</p>
              <p className="text-xs text-zinc-500 -mt-1">
                A outra opção de destino. Cada geração do Método MK do VIP escolhe
                <b> um dos dois</b> — WhatsApp ou Telegram, nunca os dois no mesmo dia.
              </p>
              <div>
                <label className="eyebrow mb-1.5 block">Link do Telegram</label>
                <input
                  className="input"
                  placeholder="Ex: https://t.me/seuusuario"
                  value={bioTelegramLink}
                  onChange={(e) => setBioTelegramLink(e.target.value)}
                />
              </div>
              <div>
                <label className="eyebrow mb-1.5 block">Texto do botão <span className="text-zinc-500 font-normal">(máx. 25 caracteres)</span></label>
                <input
                  className="input"
                  maxLength={25}
                  placeholder="meu telegram particular"
                  value={bioTelegramButton}
                  onChange={(e) => setBioTelegramButton(e.target.value)}
                />
              </div>
            </div>

            <div>
              <label className="eyebrow mb-1.5 block">Observações do Sistema</label>
              <textarea
                className="input min-h-[48px] resize-y"
                placeholder="Notas internas..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>

            {/* Credenciais do bot do Telegram — ficam no cadastro da modelo
                porque servem em vários lugares (postagens e bot de vendas). */}
            <div className="panel rounded-xl p-4">
              <p className="eyebrow">Bot do Telegram</p>
              <p className="mt-1 text-xs text-zinc-500">
                Token do @BotFather + IDs dos canais. Vale para as postagens e para o bot de vendas.
              </p>
              <div className="mt-3 space-y-3">
                <div>
                  <KeyLabel salva={hasToken}>Bot Token</KeyLabel>
                  <input
                    className="input font-mono"
                    type="password"
                    autoComplete="off"
                    placeholder={
                      hasToken ? "•••••••• (em branco = manter)" : "Ex: 123456:ABC-DEF..."
                    }
                    value={botToken}
                    onChange={(e) => setBotToken(e.target.value)}
                  />
                  {hasToken && (
                    <p className="mt-1 text-[11px] text-zinc-500">
                      O token salvo não volta para a tela — ele dá controle total do bot. Vazio, mantém o atual.
                    </p>
                  )}
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="eyebrow mb-1.5 block">ID Canal VIP</label>
                    <input
                      className="input font-mono"
                      placeholder="-100..."
                      value={botIdVip}
                      onChange={(e) => setBotIdVip(e.target.value)}
                    />
                    <p className="mt-1 text-[11px] text-zinc-500">
                      Onde o cliente entra ao pagar. O bot precisa ser <b>admin</b> lá (convidar por
                      link e remover membros).
                    </p>
                    {hasToken && (
                      <div className="mt-1.5">
                        <DetectChat profileId={id} onPick={setBotIdVip} atual={botIdVip} />
                      </div>
                    )}
                  </div>
                  <div>
                    <label className="eyebrow mb-1.5 block">ID Canal Prévias</label>
                    <input
                      className="input font-mono"
                      placeholder="-100..."
                      value={botIdPrevias}
                      onChange={(e) => setBotIdPrevias(e.target.value)}
                    />
                    <p className="mt-1 text-[11px] text-zinc-500">
                      Canal gratuito de aquecimento. Também recebe as postagens.
                    </p>
                    {hasToken && (
                      <div className="mt-1.5">
                        <DetectChat profileId={id} onPick={setBotIdPrevias} atual={botIdPrevias} />
                      </div>
                    )}
                  </div>
                  <div>
                    <label className="eyebrow mb-1.5 block">
                      ID Canal Vendas <span className="font-normal text-zinc-500">(opcional)</span>
                    </label>
                    <input
                      className="input font-mono"
                      placeholder="-100..."
                      value={botIdVendas}
                      onChange={(e) => setBotIdVendas(e.target.value)}
                    />
                    <p className="mt-1 text-[11px] text-zinc-500">
                      Canal só pra você acompanhar: o bot manda um relatório de CADA venda aprovada
                      aqui (cliente, plano, valor, gateway). Vazio, o bot não manda nada.
                    </p>
                    {hasToken && (
                      <div className="mt-1.5">
                        <DetectChat profileId={id} onPick={setBotIdVendas} atual={botIdVendas} />
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3 pt-2">
              <button
                onClick={saveInfo}
                disabled={!infoChanged || savingInfo || !name.trim()}
                className="btn-primary"
              >
                {savingInfo ? "Salvando..." : "Salvar"}
              </button>
              <button onClick={removeProfile} className="btn-danger">
                <IconTrash size={15} /> Excluir
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Atalho para mídia */}
      <Link
        href={`/dashboard/media?profile=${id}`}
        className="card group mt-3 flex items-center gap-3 p-4 transition-all hover:border-white/20 hover:bg-ink-850"
      >
        <div className="grid h-10 w-10 place-items-center rounded-lg border border-white/10 text-zinc-300">
          <IconMedia size={18} />
        </div>
        <div className="flex-1">
          <p className="text-sm font-medium text-white">Biblioteca de mídia</p>
          <p className="text-xs text-zinc-500">
            Fotos e vídeos desta personagem
          </p>
        </div>
        <IconChevronRight size={18} />
      </Link>

      {/* Contas */}
      <div className="mt-6 flex items-center justify-between">
        <h2 className="font-display text-lg font-semibold">
          Contas{" "}
          <span className="font-mono text-sm text-zinc-600">
            ({profile.accounts.length})
          </span>
        </h2>
        <button onClick={() => setAddingAccount(true)} className="btn-ghost">
          <IconPlus size={16} /> Adicionar
        </button>
      </div>

      <div className="mt-3 space-y-2.5">
        {profile.accounts.length === 0 && (
          <div className="rounded-xl border border-dashed border-white/10 p-6 text-center text-sm text-zinc-500">
            Nenhuma conta cadastrada.
          </div>
        )}
        {profile.accounts.map((acc) => (
          <AccountRow
            key={acc.id}
            profileId={id}
            account={acc}
            accounts={profile.accounts}
            onEdit={() => setEditingAccount(acc)}
            onChanged={(p) => {
              setProfile(p);
              // O menu do painel carrega os perfis uma vez só. Sem avisar, o
              // Cronograma continuaria oferecendo como destino a conta que
              // acabou de ser desligada aqui.
              void refreshProfiles();
            }}
            confirm={confirm}
          />
        ))}
      </div>

      {ConfirmDialog}

      <Modal
        open={addingAccount || editingAccount !== null}
        onClose={() => {
          setAddingAccount(false);
          setEditingAccount(null);
        }}
      >
        <AccountForm
          profileId={id}
          account={editingAccount}
          accounts={profile.accounts}
          onClose={() => {
            setAddingAccount(false);
            setEditingAccount(null);
          }}
          onSaved={(p) => {
            setProfile(p);
            void refreshProfiles();
            setAddingAccount(false);
            setEditingAccount(null);
          }}
        />
      </Modal>
    </div>
  );
}

// ---- Linha de conta ----
function AccountRow({
  profileId,
  account,
  accounts,
  onEdit,
  onChanged,
  confirm,
}: {
  profileId: string;
  account: SocialAccount;
  /** Todas as contas da modelo — só para desenhar o espelho pelos dois lados. */
  accounts: SocialAccount[];
  onEdit: () => void;
  onChanged: (p: Profile) => void;
  confirm: (opts: { message: string } | string) => Promise<boolean>;
}) {
  const [password, setPassword] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [alternando, setAlternando] = useState(false);

  // O espelho aparece dos DOIS lados: na conta de Facebook/Threads ("espelha
  // @fulana") e na de Instagram ("espelhado por @x, @y"). Quem cadastra o
  // vínculo é o lado que espelha, mas quem escolhe destino no cronograma olha
  // o Instagram — e precisa saber ali que o post vai cair em mais dois lugares.
  const espelhaAlvo = account.linkedAccountId
    ? accounts.find((a) => a.id === account.linkedAccountId)
    : undefined;
  const espelhadaPor =
    account.network === "instagram"
      ? accounts.filter((a) => a.linkedAccountId === account.id)
      : [];

  async function alternarAtiva() {
    setAlternando(true);
    try {
      const { profile } = await apiSend<{ profile: Profile }>(
        `/api/profiles/${profileId}/accounts/${account.id}`,
        "PATCH",
        { active: !account.active },
      );
      onChanged(profile);
      showToast(account.active ? "Conta desativada no cronograma." : "Conta ativada.");
    } catch (e: any) {
      showToast(e?.message || "Falha ao mudar o estado da conta.", "error");
    } finally {
      setAlternando(false);
    }
  }

  async function fetchPassword(): Promise<string> {
    const data = await apiGet<{ password: string }>(
      `/api/profiles/${profileId}/accounts/${account.id}?reveal=1`,
    );
    return data.password;
  }

  async function toggleReveal() {
    if (password) {
      setPassword(null);
      return;
    }
    try {
      setPassword(await fetchPassword());
    } catch {
      setPassword("(erro)");
    }
  }

  async function copyPassword() {
    try {
      const pwd = password && !password.startsWith("(") ? password : await fetchPassword();
      await navigator.clipboard.writeText(pwd);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  }

  async function remove() {
    if (!(await confirm("Remover esta conta? Ela será removida do servidor."))) return;
    const { profile } = await apiSend<{ profile: Profile }>(
      `/api/profiles/${profileId}/accounts/${account.id}`,
      "DELETE",
    );
    onChanged(profile);
  }

  return (
    // Conta desligada não some nem muda de lugar — só perde a cor, para a lista
    // continuar sendo o cadastro inteiro e a diferença ser visível de relance.
    <div className={`card p-4 ${account.active ? "" : "opacity-55"}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="chip">{NETWORK_LABELS[account.network]}</span>
            <span className="truncate text-sm font-medium text-zinc-100">
              {account.username}
            </span>
            <button
              onClick={alternarAtiva}
              disabled={alternando}
              title={
                account.active
                  ? "Desativar: para de ser oferecida no Cronograma. O que já está agendado continua lá."
                  : "Ativar: volta a ser oferecida no Cronograma."
              }
              className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider transition-colors disabled:opacity-50 ${
                account.active
                  ? "border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10"
                  : "border-white/15 text-zinc-500 hover:bg-white/5"
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  account.active ? "bg-emerald-400" : "bg-zinc-600"
                }`}
              />
              {account.active ? "ativa" : "inativa"}
            </button>
          </div>
          {espelhaAlvo && (
            <p className="mt-1.5 text-[11px] text-zinc-500">
              espelha <span className="text-zinc-300">@{espelhaAlvo.username}</span> — o post sai no
              Instagram e o próprio app replica aqui
            </p>
          )}
          {espelhadaPor.length > 0 && (
            <p className="mt-1.5 text-[11px] text-zinc-500">
              replica em{" "}
              <span className="text-zinc-300">
                {espelhadaPor.map((a) => `@${a.username} (${NETWORK_LABELS[a.network]})`).join(", ")}
              </span>
            </p>
          )}
          {(() => {
            const link = account.url || buildSocialUrl(account.network, account.username);
            if (!link) return null;
            return (
              <a
                href={link}
                target="_blank"
                rel="noreferrer"
                className="mt-1.5 inline-flex items-center gap-1 truncate text-xs text-zinc-500 hover:text-zinc-300"
              >
                <IconLink size={13} /> {link}
              </a>
            );
          })()}
          {account.login && (
            <p className="mt-1 font-mono text-[11px] text-zinc-600">
              login: <span className="text-zinc-400">{account.login}</span>
            </p>
          )}
          {account.hasPassword && (
            <div className="mt-2 flex items-center gap-2">
              <span className="font-mono text-sm text-zinc-300">
                {password ?? "••••••••"}
              </span>
              <button
                onClick={toggleReveal}
                className="text-zinc-500 hover:text-white"
                aria-label="Mostrar/ocultar"
              >
                {password ? <IconEyeOff size={15} /> : <IconEye size={15} />}
              </button>
              <button
                onClick={copyPassword}
                className="text-zinc-500 hover:text-white"
                aria-label="Copiar"
              >
                <IconCopy size={15} />
              </button>
              {copied && (
                <span className="font-mono text-[10px] uppercase text-zinc-500">
                  copiado
                </span>
              )}
            </div>
          )}
        </div>
        <div className="flex shrink-0 gap-1">
          {(() => {
            const link = account.url || buildSocialUrl(account.network, account.username);
            if (!link) return null;
            return (
              <button
                onClick={() => window.open(link, "_blank", "noopener,noreferrer")}
                className="grid h-8 w-8 place-items-center rounded-lg text-zinc-500 hover:bg-white/5 hover:text-white"
                aria-label="Abrir no navegador"
                title="Abrir no navegador"
              >
                <IconLink size={16} />
              </button>
            );
          })()}
          <button
            onClick={onEdit}
            className="grid h-8 w-8 place-items-center rounded-lg text-zinc-500 hover:bg-white/5 hover:text-white"
            aria-label="Editar"
          >
            <IconEdit size={16} />
          </button>
          <button
            onClick={remove}
            className="grid h-8 w-8 place-items-center rounded-lg text-zinc-500 hover:bg-white/5 hover:text-red-400"
            aria-label="Remover"
          >
            <IconTrash size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- Formulário de conta ----
function AccountForm({
  profileId,
  account,
  accounts,
  onClose,
  onSaved,
}: {
  profileId: string;
  account: SocialAccount | null;
  /** Todas as contas da modelo — a origem das opções de espelho. */
  accounts: SocialAccount[];
  onClose: () => void;
  onSaved: (p: Profile) => void;
}) {
  const [network, setNetwork] = useState<SocialNetwork>(
    account?.network || "instagram",
  );
  const [username, setUsername] = useState(account?.username || "");
  const [url, setUrl] = useState(account?.url || "");
  const [urlTouched, setUrlTouched] = useState(Boolean(account?.url));
  const [login, setLogin] = useState(account?.login || "");
  const [password, setPassword] = useState("");
  const [linkedAccountId, setLinkedAccountId] = useState(account?.linkedAccountId || "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const meta = networkMeta(network);

  // Só Facebook e Threads espelham, e só um Instagram DA MESMA MODELO — a
  // mesma regra que o servidor aplica em `espelhoValido`. Repetida aqui só para
  // a tela não oferecer o que seria recusado; quem manda é o servidor.
  const podeEspelhar = network === "facebook" || network === "threads";
  const instagramsDaModelo = accounts.filter(
    (a) => a.network === "instagram" && a.id !== account?.id,
  );

  // Preenche o link automaticamente pela máscara da rede, a menos que o
  // usuário tenha editado o campo manualmente.
  function applyNetwork(next: SocialNetwork) {
    setNetwork(next);
    if (!urlTouched) setUrl(buildSocialUrl(next, username));
  }
  function applyUsername(next: string) {
    setUsername(next);
    if (!urlTouched) setUrl(buildSocialUrl(network, next));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setErr(null);
    try {
      const payload: Record<string, unknown> = { network, username, url, login };
      if (password) payload.password = password;
      // Manda SEMPRE (string vazia limpa): trocar a rede de Facebook para
      // TikTok tem que apagar um vínculo que deixou de fazer sentido, e omitir
      // o campo deixaria o antigo gravado.
      payload.linkedAccountId = podeEspelhar ? linkedAccountId || null : null;
      const path = account
        ? `/api/profiles/${profileId}/accounts/${account.id}`
        : `/api/profiles/${profileId}/accounts`;
      const { profile } = await apiSend<{ profile: Profile }>(
        path,
        account ? "PATCH" : "POST",
        payload,
      );
      onSaved(profile);
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Falha ao salvar.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save}>
      <p className="eyebrow">{account ? "editar" : "nova"}</p>
      <h2 className="mt-1.5 font-display text-lg font-semibold">
        {account ? "Editar conta" : "Nova conta"}
      </h2>

      {err && (
        <p className="mt-3 rounded-lg border border-red-500/20 bg-red-500/[0.07] px-3 py-2 text-sm text-red-300">
          {err}
        </p>
      )}

      <div className="mt-4 grid gap-3">
        <div>
          <label className="eyebrow mb-1.5 block">Rede</label>
          <select
            className="input"
            value={network}
            onChange={(e) => applyNetwork(e.target.value as SocialNetwork)}
          >
            {Object.entries(NETWORK_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        {podeEspelhar && (
          <div>
            <label className="eyebrow mb-1.5 block">Espelha qual Instagram?</label>
            <select
              className="input"
              value={linkedAccountId}
              onChange={(e) => setLinkedAccountId(e.target.value)}
              disabled={instagramsDaModelo.length === 0}
            >
              <option value="">Nenhum — conta independente</option>
              {instagramsDaModelo.map((a) => (
                <option key={a.id} value={a.id}>
                  @{a.username}
                </option>
              ))}
            </select>
            <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-500">
              {instagramsDaModelo.length === 0
                ? "Cadastre um Instagram para esta modelo primeiro."
                : "Quem publica é o Instagram — o app dele replica aqui sozinho. No Cronograma você agenda só o post do Instagram; esta conta aparece como réplica, não como destino separado."}
            </p>
          </div>
        )}
        <div>
          <label className="eyebrow mb-1.5 block">{meta.userLabel}</label>
          <input
            className="input"
            placeholder={meta.userPlaceholder}
            value={username}
            onChange={(e) => applyUsername(e.target.value)}
          />
        </div>
        <div>
          <label className="eyebrow mb-1.5 block">
            {network === "email" ? "Link (mailto, gerado)" : "Link do perfil (gerado, editável)"}
          </label>
          <div className="flex gap-2">
            <input
              className="input flex-1"
              placeholder="https://..."
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                setUrlTouched(true);
              }}
            />
            <button
              type="button"
              onClick={() => {
                const link = url || buildSocialUrl(network, username);
                if (link) window.open(link, "_blank", "noopener,noreferrer");
              }}
              disabled={!url && !username}
              className="btn-ghost shrink-0 px-3"
              title="Abrir no navegador"
            >
              <IconLink size={15} /> Abrir
            </button>
          </div>
          {urlTouched && (
            <button
              type="button"
              onClick={() => {
                setUrlTouched(false);
                setUrl(buildSocialUrl(network, username));
              }}
              className="mt-1.5 font-mono text-[10px] uppercase tracking-wider text-zinc-500 hover:text-zinc-300"
            >
              usar link automático da rede
            </button>
          )}
        </div>
        <div>
          <label className="eyebrow mb-1.5 block">Login de acesso</label>
          <input
            className="input"
            placeholder="e-mail ou usuário"
            value={login}
            onChange={(e) => setLogin(e.target.value)}
          />
        </div>
        <div>
          <label className="eyebrow mb-1.5 block">
            Senha{" "}
            {account?.hasPassword && (
              <span className="text-zinc-600">(em branco = manter)</span>
            )}
          </label>
          <input
            type="text"
            className="input font-mono"
            placeholder={account?.hasPassword ? "••••••••" : "senha"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <p className="mt-1.5 flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-zinc-600">
            <IconLock size={12} /> criptografada aes-256 no servidor
          </p>
        </div>
      </div>

      <div className="mt-5 flex gap-3">
        <button
          type="button"
          onClick={onClose}
          className="btn-ghost flex-1"
          disabled={saving}
        >
          Cancelar
        </button>
        <button
          type="submit"
          className="btn-primary flex-1"
          disabled={saving || !username.trim()}
        >
          {saving ? "Salvando..." : "Salvar"}
        </button>
      </div>
    </form>
  );
}
