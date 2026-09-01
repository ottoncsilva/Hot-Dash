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
  /**
   * Recarrega a lista do servidor.
   *
   * A carga é feita UMA vez, na montagem do provider — que fica montado o
   * painel inteiro. Sem isto, mexer no cadastro (desativar uma conta, criar
   * outra) só aparecia nas outras telas depois de um F5: o Cronograma seguia
   * oferecendo como destino uma conta que o operador tinha acabado de
   * desligar, e parecia que o botão não funcionava.
   */
  refresh: () => Promise<void>;
};

const ProfileContext = createContext<ProfileContextValue | undefined>(undefined);

const STORAGE_KEY = "hotdash:profileId";

export function ProfileProvider({ children }: { children: ReactNode }) {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [profileId, setProfileIdState] = useState("");
  const [loading, setLoading] = useState(true);

  // A primeira carga também restaura a escolha salva; as recargas seguintes
  // (`refresh`) só atualizam a lista — mexer na escolha ali dentro faria o menu
  // pular de modelo sozinho ao salvar uma conta.
  const carregar = useCallback(async (primeira: boolean) => {
    try {
      const d = await apiGet<{ profiles: Profile[] }>("/api/profiles");
      const lista = d.profiles || [];
      setProfiles(lista);
      if (!primeira) return;
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
    } catch {
      if (primeira) setProfiles([]);
    } finally {
      if (primeira) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void carregar(true);
  }, [carregar]);

  const refresh = useCallback(() => carregar(false), [carregar]);

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
      refresh,
    }),
    [profiles, profileId, setProfileId, loading, refresh],
  );

  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
}

export function useProfile() {
  const ctx = useContext(ProfileContext);
  if (!ctx) throw new Error("useProfile precisa estar dentro de <ProfileProvider>.");
  return ctx;
}
