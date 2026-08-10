"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { apiGet } from "@/lib/api";
import type { Profile } from "@/lib/types";

/**
 * Modelo selecionada, valendo para o painel INTEIRO.
 *
 * Antes cada tela tinha o próprio seletor (12 `useState` soltos, 12 buscas da
 * mesma lista de perfis) e trocar de modelo obrigava a reescolher em cada uma.
 * Agora a escolha é uma só, feita no menu, e todas as telas leem daqui.
 *
 * `profileId === ""` significa **Todos**. É o padrão, e é intencional: as telas
 * analíticas (Dashboard, Funil, Financeiro) mostram a operação inteira, e as
 * telas que exigem uma modelo específica (Galeria, Telegram, WhatsApp) pedem a
 * escolha em vez de adivinhar — mostrar dados de uma modelo enquanto o menu diz
 * "Todos" seria pior do que não mostrar nada.
 */
type ProfileContextValue = {
  profiles: Profile[];
  /** "" = todas as modelos. */
  profileId: string;
  setProfileId: (id: string) => void;
  /** A modelo escolhida, ou null em "Todos". */
  profile: Profile | null;
  loading: boolean;
};

const ProfileContext = createContext<ProfileContextValue | undefined>(undefined);

const STORAGE_KEY = "hotdash:profileId";

export function ProfileProvider({ children }: { children: ReactNode }) {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [profileId, setProfileIdState] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let ativo = true;
    apiGet<{ profiles: Profile[] }>("/api/profiles")
      .then((d) => {
        if (!ativo) return;
        const lista = d.profiles || [];
        setProfiles(lista);
        // A leitura do storage acontece AQUI, depois da montagem, e nunca no
        // inicializador do useState: no App Router o primeiro render também
        // roda no servidor, onde `localStorage` não existe — ler lá quebraria
        // a hidratação.
        try {
          const salvo = window.localStorage.getItem(STORAGE_KEY);
          // Só restaura se a modelo ainda existir: apagada no meio do caminho,
          // a escolha cai em "Todos" em vez de filtrar por um id fantasma que
          // não devolveria nada e pareceria tela quebrada.
          if (salvo && lista.some((p) => p.id === salvo)) setProfileIdState(salvo);
        } catch {
          /* storage bloqueado (aba anônima, política do navegador) — segue em "Todos" */
        }
      })
      .catch(() => {
        if (ativo) setProfiles([]);
      })
      .finally(() => {
        if (ativo) setLoading(false);
      });
    return () => {
      ativo = false;
    };
  }, []);

  const setProfileId = useCallback((id: string) => {
    setProfileIdState(id);
    try {
      if (id) window.localStorage.setItem(STORAGE_KEY, id);
      else window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* sem storage: a escolha vale só nesta sessão */
    }
  }, []);

  const value = useMemo<ProfileContextValue>(
    () => ({
      profiles,
      profileId,
      setProfileId,
      profile: profiles.find((p) => p.id === profileId) || null,
      loading,
    }),
    [profiles, profileId, setProfileId, loading],
  );

  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
}

export function useProfile() {
  const ctx = useContext(ProfileContext);
  if (!ctx) throw new Error("useProfile precisa estar dentro de <ProfileProvider>.");
  return ctx;
}
