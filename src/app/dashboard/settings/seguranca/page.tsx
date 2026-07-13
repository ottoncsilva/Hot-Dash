import { IconLock } from "@/components/icons";
import { BackToSettings } from "../_shared";

export default function SecuritySettingsPage() {
  return (
    <div className="mx-auto max-w-3xl">
      <BackToSettings />
      <p className="eyebrow mt-4">segurança</p>
      <h1 className="mt-1.5 font-display text-2xl font-semibold tracking-tight">Acesso</h1>
      <div className="mt-4 card flex items-start gap-3 p-4">
        <span className="mt-0.5 text-zinc-500">
          <IconLock size={18} />
        </span>
        <p className="text-sm text-zinc-400">
          O e-mail e a senha de login ficam nas variáveis de ambiente
          (`AUTH_EMAIL` / `AUTH_PASSWORD`) no EasyPanel. Para trocar, edite lá e
          reinicie o app.
        </p>
      </div>
    </div>
  );
}
