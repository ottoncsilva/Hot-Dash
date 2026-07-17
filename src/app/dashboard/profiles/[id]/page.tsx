"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { apiGet, apiSend, apiUpload } from "@/lib/api";
import AuthImage from "@/components/AuthImage";
import Modal from "@/components/Modal";
import { useConfirm } from "@/hooks/useConfirm";
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

export default function ProfileDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [bioPhysical, setBioPhysical] = useState("");
  const [bioUnique, setBioUnique] = useState("");
  const [bioPersonality, setBioPersonality] = useState<"santinha" | "safadinha" | "explicita">("safadinha");
  const [bioVipLink, setBioVipLink] = useState("");
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
      setBioPersonality(data.profile.bioPersonality || "safadinha");
      setBioVipLink(data.profile.bioVipLink || "");
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
          bioPersonality,
          bioVipLink,
        },
      );
      setProfile(p);
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
      router.replace("/dashboard/profiles");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao excluir.");
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl">
        <div className="card h-44 animate-pulse" />
      </div>
    );
  }
  if (!profile) {
    return (
      <div className="mx-auto max-w-3xl">
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
    bioPersonality !== (profile.bioPersonality || "safadinha") ||
    bioVipLink !== (profile.bioVipLink || "");

  return (
    <div className="mx-auto max-w-3xl">
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
              <div className="flex items-center gap-2 mb-1 font-display text-sm font-semibold text-white/90">
                <svg className="h-4.5 w-4.5 text-emerald-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <circle cx="12" cy="10" r="3" />
                  <path d="M7 21v-2a3 3 0 0 1 6 0v2" />
                </svg>
                Perfil da modelo · <span className="text-zinc-500 font-normal">a I.A. escreve a Copy</span>
              </div>
              <p className="text-xs text-zinc-500 mb-4">A I.A. cria uma legenda com micro-história no fetiche da modelo, no formato certo pro Telegram.</p>
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
              <label className="eyebrow mb-1.5 block">Características Físicas</label>
              <textarea
                className="input min-h-[72px] resize-y"
                placeholder="Ex: Loira corpo levemente malhado, silicone médio..."
                value={bioPhysical}
                onChange={(e) => setBioPhysical(e.target.value)}
              />
            </div>

            <div>
              <label className="eyebrow mb-1.5 block">Mecanismo Único / Fetiche <span className="text-zinc-500 font-normal">(o diferencial — vira a história)</span></label>
              <input
                className="input"
                placeholder="Ex: Coroa 40 anos divorciada"
                value={bioUnique}
                onChange={(e) => setBioUnique(e.target.value)}
              />
            </div>

            <div>
              <label className="eyebrow mb-1.5 block">Como ela é</label>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { id: "santinha", title: "Santinha", desc: "inocente por fora" },
                  { id: "safadinha", title: "Safadinha", desc: "safada na medida" },
                  { id: "explicita", title: "Explícita", desc: "sem papas na língua" }
                ].map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setBioPersonality(item.id as any)}
                    className={`flex flex-col items-start px-3 py-2 rounded-lg border transition-all text-left ${
                      bioPersonality === item.id
                        ? 'border-emerald-500 bg-emerald-500/10 text-emerald-400 shadow-md'
                        : 'border-white/[0.06] bg-zinc-900/40 text-zinc-400 hover:bg-zinc-900/60'
                    }`}
                  >
                    <span className={`text-xs font-bold ${bioPersonality === item.id ? 'text-emerald-400' : 'text-zinc-200'}`}>{item.title}</span>
                    <span className="text-[10px] text-zinc-500 mt-0.5">{item.desc}</span>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="eyebrow mb-1.5 block">Link do VIP / Bot <span className="text-zinc-500 font-normal">(entra nos botões da copy)</span></label>
              <input
                className="input"
                placeholder="Ex: https://t.me/..."
                value={bioVipLink}
                onChange={(e) => setBioVipLink(e.target.value)}
              />
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
        className="card group mt-3 flex items-center gap-3 p-4 transition-all hover:border-white/20 hover:bg-white/[0.04]"
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
            onEdit={() => setEditingAccount(acc)}
            onChanged={(p) => setProfile(p)}
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
          onClose={() => {
            setAddingAccount(false);
            setEditingAccount(null);
          }}
          onSaved={(p) => {
            setProfile(p);
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
  onEdit,
  onChanged,
  confirm,
}: {
  profileId: string;
  account: SocialAccount;
  onEdit: () => void;
  onChanged: (p: Profile) => void;
  confirm: (opts: { message: string } | string) => Promise<boolean>;
}) {
  const [password, setPassword] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

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
    <div className="card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="chip">{NETWORK_LABELS[account.network]}</span>
            <span className="truncate text-sm font-medium text-zinc-100">
              {account.username}
            </span>
          </div>
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
  onClose,
  onSaved,
}: {
  profileId: string;
  account: SocialAccount | null;
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
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const meta = networkMeta(network);

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
