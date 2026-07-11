"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { apiGet, apiSend, apiUpload } from "@/lib/api";
import AuthImage from "@/components/AuthImage";
import { NETWORK_LABELS, type Profile, type SocialAccount, type SocialNetwork } from "@/lib/types";

export default function ProfileDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [savingInfo, setSavingInfo] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [avatarKey, setAvatarKey] = useState(0);
  const [editingAccount, setEditingAccount] = useState<SocialAccount | null>(null);
  const [addingAccount, setAddingAccount] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function load() {
    setLoading(true);
    try {
      const data = await apiGet<{ profile: Profile }>(`/api/profiles/${id}`);
      setProfile(data.profile);
      setName(data.profile.name);
      setNotes(data.profile.notes || "");
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
        { name, notes },
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
      setAvatarKey((k) => k + 1); // força recarregar a imagem
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha no upload.");
    } finally {
      setUploadingAvatar(false);
    }
  }

  async function removeProfile() {
    if (!confirm("Excluir este perfil e todos os seus dados?")) return;
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
        <div className="card h-40 animate-pulse" />
      </div>
    );
  }
  if (!profile) {
    return (
      <div className="mx-auto max-w-3xl">
        <p className="text-slate-300">{error || "Perfil não encontrado."}</p>
        <button
          onClick={() => router.replace("/dashboard/profiles")}
          className="btn-ghost mt-4"
        >
          ← Voltar
        </button>
      </div>
    );
  }

  const infoChanged =
    name.trim() !== profile.name || (notes || "") !== (profile.notes || "");

  return (
    <div className="mx-auto max-w-3xl">
      <button
        onClick={() => router.push("/dashboard/profiles")}
        className="mb-5 text-sm text-slate-400 transition-colors hover:text-slate-200"
      >
        ← Perfis
      </button>

      {error && (
        <div className="mb-5 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      )}

      {/* Cabeçalho do perfil */}
      <div className="card p-6">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
          <div className="relative">
            <div className="h-24 w-24 overflow-hidden rounded-2xl bg-white/5">
              <AuthImage
                key={avatarKey}
                src={profile.avatarPath ? `/api/profiles/${id}/avatar` : null}
                alt={profile.name}
                className="h-24 w-24 object-cover"
                fallback={
                  <div className="grid h-24 w-24 place-items-center bg-gradient-to-br from-brand-500/60 to-accent-500/60 text-3xl font-semibold text-white">
                    {profile.name.charAt(0).toUpperCase()}
                  </div>
                }
              />
            </div>
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploadingAvatar}
              className="mt-2 w-24 text-center text-xs text-brand-400 hover:text-brand-300"
            >
              {uploadingAvatar ? "Enviando..." : "Trocar foto"}
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

          <div className="flex-1 space-y-3">
            <div>
              <label className="mb-1 block text-xs text-slate-400">Nome</label>
              <input
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-400">
                Observações
              </label>
              <textarea
                className="input min-h-[70px] resize-y"
                placeholder="Notas sobre a personagem..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={saveInfo}
                disabled={!infoChanged || savingInfo || !name.trim()}
                className="btn-primary"
              >
                {savingInfo ? "Salvando..." : "Salvar"}
              </button>
              <button
                onClick={removeProfile}
                className="text-sm text-red-400 hover:text-red-300"
              >
                Excluir perfil
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Contas */}
      <div className="mt-6 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-white">
          Contas ({profile.accounts.length})
        </h2>
        <button onClick={() => setAddingAccount(true)} className="btn-ghost">
          + Adicionar conta
        </button>
      </div>

      <div className="mt-4 space-y-3">
        {profile.accounts.length === 0 && (
          <div className="card p-6 text-center text-sm text-slate-400">
            Nenhuma conta cadastrada. Adicione as redes desta personagem.
          </div>
        )}
        {profile.accounts.map((acc) => (
          <AccountRow
            key={acc.id}
            profileId={id}
            account={acc}
            onEdit={() => setEditingAccount(acc)}
            onChanged={(p) => setProfile(p)}
          />
        ))}
      </div>

      <AnimatePresence>
        {(addingAccount || editingAccount) && (
          <AccountModal
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
        )}
      </AnimatePresence>
    </div>
  );
}

// ---- Linha de conta ----
function AccountRow({
  profileId,
  account,
  onEdit,
  onChanged,
}: {
  profileId: string;
  account: SocialAccount;
  onEdit: () => void;
  onChanged: (p: Profile) => void;
}) {
  const [password, setPassword] = useState<string | null>(null);
  const [revealing, setRevealing] = useState(false);
  const [copied, setCopied] = useState(false);

  async function reveal() {
    if (password) {
      setPassword(null);
      return;
    }
    setRevealing(true);
    try {
      const data = await apiGet<{ password: string }>(
        `/api/profiles/${profileId}/accounts/${account.id}?reveal=1`,
      );
      setPassword(data.password);
    } catch {
      setPassword("(erro ao revelar)");
    } finally {
      setRevealing(false);
    }
  }

  async function copyPassword() {
    try {
      let pwd = password;
      if (!pwd || pwd.startsWith("(")) {
        const data = await apiGet<{ password: string }>(
          `/api/profiles/${profileId}/accounts/${account.id}?reveal=1`,
        );
        pwd = data.password;
      }
      await navigator.clipboard.writeText(pwd);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  }

  async function remove() {
    if (!confirm("Remover esta conta?")) return;
    const { profile } = await apiSend<{ profile: Profile }>(
      `/api/profiles/${profileId}/accounts/${account.id}`,
      "DELETE",
    );
    onChanged(profile);
  }

  return (
    <motion.div layout className="card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="rounded-md bg-brand-500/15 px-2 py-0.5 text-xs font-medium text-brand-300">
              {NETWORK_LABELS[account.network]}
            </span>
            <span className="truncate font-medium text-slate-100">
              {account.username}
            </span>
          </div>
          {account.url && (
            <a
              href={account.url}
              target="_blank"
              rel="noreferrer"
              className="mt-1 block truncate text-xs text-slate-400 hover:text-brand-300"
            >
              {account.url}
            </a>
          )}
          {account.login && (
            <p className="mt-1 text-xs text-slate-500">
              login: <span className="text-slate-300">{account.login}</span>
            </p>
          )}
          {account.hasPassword && (
            <div className="mt-2 flex items-center gap-2">
              <span className="font-mono text-sm text-slate-300">
                {password ?? "••••••••"}
              </span>
              <button
                onClick={reveal}
                className="text-xs text-brand-400 hover:text-brand-300"
              >
                {revealing ? "..." : password ? "ocultar" : "mostrar"}
              </button>
              <button
                onClick={copyPassword}
                className="text-xs text-brand-400 hover:text-brand-300"
              >
                {copied ? "copiado!" : "copiar"}
              </button>
            </div>
          )}
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            onClick={onEdit}
            className="text-slate-400 hover:text-slate-200"
            aria-label="Editar"
          >
            ✎
          </button>
          <button
            onClick={remove}
            className="text-slate-500 hover:text-red-400"
            aria-label="Remover"
          >
            ✕
          </button>
        </div>
      </div>
    </motion.div>
  );
}

// ---- Modal de adicionar/editar conta ----
function AccountModal({
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
  const [login, setLogin] = useState(account?.login || "");
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setErr(null);
    try {
      const payload: Record<string, unknown> = { network, username, url, login };
      // Só envia senha se o campo foi preenchido (não apaga a existente à toa).
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
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={() => !saving && onClose()}
    >
      <motion.form
        initial={{ scale: 0.95, y: 10 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.95, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
        onSubmit={save}
        className="card w-full max-w-md p-6"
      >
        <h2 className="text-lg font-semibold text-white">
          {account ? "Editar conta" : "Nova conta"}
        </h2>

        {err && (
          <p className="mt-3 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {err}
          </p>
        )}

        <div className="mt-4 grid gap-3">
          <div>
            <label className="mb-1 block text-xs text-slate-400">Rede</label>
            <select
              className="input"
              value={network}
              onChange={(e) => setNetwork(e.target.value as SocialNetwork)}
            >
              {Object.entries(NETWORK_LABELS).map(([value, label]) => (
                <option key={value} value={value} className="bg-base-800">
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-400">
              Usuário / identificador
            </label>
            <input
              className="input"
              placeholder="@usuario ou número"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-400">
              Link do perfil (opcional)
            </label>
            <input
              className="input"
              placeholder="https://..."
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-400">
              Login (e-mail/usuário de acesso)
            </label>
            <input
              className="input"
              value={login}
              onChange={(e) => setLogin(e.target.value)}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-400">
              Senha{" "}
              {account?.hasPassword && (
                <span className="text-slate-500">
                  (deixe em branco para manter)
                </span>
              )}
            </label>
            <input
              type="text"
              className="input font-mono"
              placeholder={account?.hasPassword ? "••••••••" : "senha"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <p className="mt-1 text-xs text-slate-500">
              🔒 Guardada com criptografia AES-256 no servidor.
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
      </motion.form>
    </motion.div>
  );
}
