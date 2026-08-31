"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { showToast } from "@/lib/toast";
import TelegramCalendar from "@/components/telegram/TelegramCalendar";
import { useConfirm } from "@/hooks/useConfirm";
import Switch from "@/components/Switch";
import type { Profile } from "@/lib/types";
import { DEFAULT_CTA_BUTTONS, DEFAULT_VIP_CTA_BUTTONS, CTA_BUTTON_MAX } from "@/lib/postTypes";
import { whatsappAccounts, telegramAccounts } from "@/lib/socialLinks";
import { useProfile } from "@/context/ProfileContext";
import { PrecisaDeModelo } from "@/components/ProfilePicker";
import PageHeader from "@/components/PageHeader";

const toast = {
  success: (msg: string) => showToast(msg, "success"),
  error: (msg: string) => showToast(msg, "error"),
  warning: (msg: string) => showToast(msg, "warning"),
};

type Tag = { id: string; name: string; color: string };

type TelegramSettings = {
  /** O token NÃO vem da API (ver a rota GET: ele dá controle total do bot e
   *  não pode circular no navegador). Só se sabe se existe um salvo. */
  hasToken: boolean;
  idVip: string;
  idAquecimento: string;
  enabled: boolean;
  vipPostInterval: number;
  vipTags: string;
  vipPrompt: string;
  vipCtaButtons: string;
  vipScheduleType: "manual" | "interval" | "fixed" | "mk";
  vipFixedTimes: string;
  warmupPostInterval: number;
  warmupTags: string;
  warmupPrompt: string;

  warmupScheduleType: "manual" | "interval" | "fixed" | "mk";
  warmupFixedTimes: string;
  warmupSeedReaction: boolean;
  warmupSeedEmoji: string;
  warmupMkPrompt: string;
  warmupCtaButtons: string;
  /** Geração automática do dia seguinte, um por canal — ver
   *  `lib/telegramAutoGeneration.ts`. */
  vipAutoGenerate: boolean;
  warmupAutoGenerate: boolean;
};

/** Marca "estou acompanhando um job, mas ele veio sem id". Ver o uso no
 *  acompanhamento das Prévias. */
const SEM_ID = "sem-id";

export default function TelegramUnifiedPage() {
  const { confirm, ConfirmDialog } = useConfirm();
  const [availableTags, setAvailableTags] = useState<Tag[]>([]);
  // Modelo escolhida no menu — vale para o painel inteiro.
  const { profileId: selectedProfileId, profiles } = useProfile();
  const [loading, setLoading] = useState(false);
  
  // Estados para inserção de novo horário fixo
  const [newVipTime, setNewVipTime] = useState("");
  const [showNewVipTimeInput, setShowNewVipTimeInput] = useState(false);
  const [newWarmupTime, setNewWarmupTime] = useState("");
  const [showNewWarmupTimeInput, setShowNewWarmupTimeInput] = useState(false);

  // Estados do gerador
  const [daysToGenerateVip, setDaysToGenerateVip] = useState(7);
  const [daysToGenerateWarmup, setDaysToGenerateWarmup] = useState(7);
  const [generatingVip, setGeneratingVip] = useState(false);
  // O Método MK do VIP tem estado próprio: ele roda em lotes no servidor e a
  // tela acompanha por polling, enquanto `generatingVip` cobre os geradores
  // antigos, que respondem dentro da própria requisição.
  const [generatingVipMk, setGeneratingVipMk] = useState(false);
  // Destino do convite na PRÓXIMA geração do Método MK do VIP. Escolha da
  // geração, não configuração salva: volta em "nenhum" a cada visita, porque o
  // contato particular é produto à parte. É UM destino por geração — misturar
  // WhatsApp e Telegram no mesmo dia divide a atenção e nenhum vira hábito.
  const [vipContato, setVipContato] = useState<"nenhum" | "whatsapp" | "telegram">("nenhum");
  // Qual conta da modelo o convite leva. "" = o link particular do cadastro.
  // Como o destino, é escolha DESTA geração — cada rodada pode sair diferente.
  const [vipContatoAccountId, setVipContatoAccountId] = useState("");
  const [generatingWarmup, setGeneratingWarmup] = useState(false);

  const [settings, setSettings] = useState<TelegramSettings>({
    hasToken: false,
    idVip: "",
    idAquecimento: "",
    vipAutoGenerate: false,
    warmupAutoGenerate: false,
    enabled: false,
    vipPostInterval: 120,
    vipTags: "",
    vipPrompt: "",
    vipCtaButtons: DEFAULT_VIP_CTA_BUTTONS,
    vipScheduleType: "manual",
    vipFixedTimes: "",
    warmupPostInterval: 120,
    warmupTags: "",
    warmupPrompt: "",
    warmupScheduleType: "manual",
    warmupFixedTimes: "",
    warmupSeedReaction: false,
    warmupSeedEmoji: "🔥",
    warmupMkPrompt: "",
    warmupCtaButtons: DEFAULT_CTA_BUTTONS,
  });

  // Cadastro COMPLETO da modelo (contas + links do particular), buscado toda vez
  // que esta tela abre. A lista do menu (`useProfile`) é carregada UMA vez, na
  // montagem do painel: cadastrar o Telegram em Modelos e vir para cá sem
  // recarregar a página deixava a conta invisível aqui, e a tela dizia "não
  // configurado" com o Telegram cadastrado.
  const [profileCadastro, setProfileCadastro] = useState<Profile | null>(null);

  useEffect(() => {
    if (!selectedProfileId) {
      setProfileCadastro(null);
      return;
    }
    let vivo = true;
    fetch(`/api/profiles/${selectedProfileId}`)
      .then((r) => r.json())
      .then((d) => {
        if (vivo) setProfileCadastro(d.profile || null);
      })
      .catch(() => {
        /* fica com o que o menu já tinha */
      });
    return () => {
      vivo = false;
    };
  }, [selectedProfileId]);

  useEffect(() => {
    if (!selectedProfileId) return;
    // Zera a escolha de conta ao trocar de modelo: as contas são de cada uma,
    // e uma conta da modelo A não pode ficar selecionada na B.
    setVipContatoAccountId("");
    setLoading(true);
    fetch(`/api/telegram?profileId=${selectedProfileId}`).then((r) => r.json()).then((d) => {
      if (d.availableTags) setAvailableTags(d.availableTags);
      
      const rawVipEnabled = Boolean(d.autopost?.enabled);
      const rawWarmupEnabled = Boolean(d.autopost?.enabled);

      let vipInt = d.autopost?.vip_post_interval || 120;
      if (vipInt <= 24) vipInt = vipInt * 60; // Conversão retroativa inteligente (horas para minutos)
      
      let warmupInt = d.autopost?.warmup_post_interval || 120;
      if (warmupInt <= 24) warmupInt = warmupInt * 60; // Conversão retroativa inteligente

      const vipType = d.autopost?.vip_schedule_type || (rawVipEnabled ? "interval" : "manual");
      const warmupType = d.autopost?.warmup_schedule_type || (rawWarmupEnabled ? "interval" : "manual");

      setSettings({
        hasToken: Boolean(d.bot?.hasToken),
        idVip: d.bot?.idVip || "",
        idAquecimento: d.bot?.idAquecimento || "",
        vipAutoGenerate: Boolean(d.autopost?.vip_auto_generate),
        warmupAutoGenerate: Boolean(d.autopost?.warmup_auto_generate),
        enabled: rawVipEnabled || rawWarmupEnabled,
        vipPostInterval: vipInt,
        vipTags: d.autopost?.vip_tags || "",
        vipPrompt: d.autopost?.vip_prompt || "",
        vipCtaButtons: d.autopost?.vip_cta_buttons || DEFAULT_VIP_CTA_BUTTONS,
        vipScheduleType: vipType as any,
        vipFixedTimes: d.autopost?.vip_fixed_times || "",
        warmupPostInterval: warmupInt,
        warmupTags: d.autopost?.warmup_tags || "",
        warmupPrompt: d.autopost?.warmup_prompt || "",
        warmupScheduleType: warmupType as any,
        warmupFixedTimes: d.autopost?.warmup_fixed_times || "",
        warmupSeedReaction: Boolean(d.autopost?.warmup_seed_reaction),
        warmupSeedEmoji: d.autopost?.warmup_seed_emoji || "🔥",
        warmupMkPrompt: d.autopost?.warmup_mk_prompt || "",
        warmupCtaButtons: d.autopost?.warmup_cta_buttons || DEFAULT_CTA_BUTTONS,
      });
    }).finally(() => setLoading(false));
  }, [selectedProfileId]);

  /**
   * `mudanca` existe para o interruptor de geração automática salvar NA HORA:
   * `setSettings` é assíncrono, então salvar logo depois de chamá-lo mandaria
   * o valor ANTIGO. Passando a mudança aqui, o que vai para o servidor é o que
   * a pessoa acabou de clicar.
   */
  const saveSettings = async (mudanca?: Partial<TelegramSettings>, aviso?: string) => {
    try {
      const res = await fetch("/api/telegram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save-telegram-config",
          profileId: selectedProfileId,
          ...settings,
          ...mudanca,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Erro ao salvar configurações.");
      }
      toast.success(aviso ?? "Configurações salvas com sucesso!");
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  /** Liga/desliga a geração automática de um canal e grava na hora — um
   *  interruptor que depende do "Salvar" lá embaixo é um interruptor que volta
   *  sozinho quando a pessoa sai da tela sem apertar. */
  const alternarGeracaoAutomatica = (canal: "vip" | "warmup", ligado: boolean) => {
    const chave = canal === "vip" ? "vipAutoGenerate" : "warmupAutoGenerate";
    setSettings((s) => ({ ...s, [chave]: ligado }));
    void saveSettings({ [chave]: ligado } as Partial<TelegramSettings>, ligado
      ? "Geração automática ligada — o dia seguinte passa a ser montado sozinho."
      : "Geração automática desligada.");
  };

  // Método MK das Prévias. A rota só ENFILEIRA e responde na hora; quem escreve
  // a copy é o agendador do servidor, em lotes de 8 posts por minuto (a copy de
  // um dia inteiro não cabe no tempo de uma requisição). Por isso a tela
  // acompanha por polling em vez de esperar a resposta.
  const [generatingPrevias, setGeneratingPrevias] = useState(false);
  // QUAL job esta tela está acompanhando.
  //
  // Sem isto a barra só aparecia depois de um F5. O GET devolve o ÚLTIMO job do
  // perfil, terminado ou não — e o efeito de acompanhamento dispara a primeira
  // consulta assim que `generatingPrevias` vira true, ou seja, ENQUANTO o POST
  // ainda está indo. Essa consulta encontrava o job da geração ANTERIOR, já
  // `done`, concluía "acabou", desligava a barra e ainda soltava o aviso de
  // sucesso da rodada passada. Quando o POST enfim respondia, o job novo até
  // entrava no estado, mas a barra já estava desligada e o polling, parado.
  //
  // Guardando o id, o acompanhamento só age sobre o job que é nosso: enquanto
  // não soubermos qual é, nenhuma consulta conclui nada.
  const previasJobIdRef = useRef<string | null>(null);
  const [previasJob, setPreviasJob] = useState<{
    id?: string;
    status: string;
    total: number;
    done: number;
    created: number;
    today: number;
    error?: string | null;
    aiError?: string | null;
    reserveCount?: number;
  } | null>(null);

  // Retoma um job que já estava rodando. A barra vive em estado local desta
  // aba, então recarregar a página (ou abrir noutro aparelho) escondia uma
  // geração que seguia firme no servidor — e o clique seguinte só trazia o 409
  // "já existe uma geração em andamento", sem barra nenhuma na tela.
  useEffect(() => {
    if (!selectedProfileId) return;
    let vivo = true;
    void (async () => {
      try {
        const res = await fetch(
          `/api/telegram/generate-previas?profileId=${encodeURIComponent(selectedProfileId)}`,
        );
        const d = await res.json();
        if (!vivo) return;
        const job = d.job;
        if (job && (job.status === "pending" || job.status === "processing")) {
          previasJobIdRef.current = job.id || SEM_ID;
          setPreviasJob(job);
          setGeneratingPrevias(true);
        }
      } catch {
        /* silencioso: isto é só a retomada da barra */
      }
    })();
    return () => {
      vivo = false;
    };
  }, [selectedProfileId]);

  useEffect(() => {
    if (!selectedProfileId || !generatingPrevias) return;
    let vivo = true;
    const consultar = async () => {
      try {
        const res = await fetch(
          `/api/telegram/generate-previas?profileId=${encodeURIComponent(selectedProfileId)}`,
        );
        const d = await res.json();
        if (!vivo) return;
        const job = d.job;
        const seguido = previasJobIdRef.current;
        // Ainda não sabemos qual job é o nosso (o POST não respondeu): esperar.
        if (!seguido || !job) return;
        // Job de outra rodada — o GET devolve o último do perfil, não o nosso.
        // `SEM_ID` é a saída de emergência: se um dia a resposta vier sem id,
        // perde-se a conferência de identidade, mas o acompanhamento continua —
        // barra presa para sempre seria pior que o defeito que isto conserta.
        if (seguido !== SEM_ID && job.id && job.id !== seguido) return;
        setPreviasJob(job);
        if (job.status === "done" || job.status === "error") {
          previasJobIdRef.current = null;
          setGeneratingPrevias(false);
          window.dispatchEvent(new Event("reloadTelegramCalendar"));
          if (job.status === "error") {
            toast.error(job.error || "Erro ao gerar prévias.");
          } else {
            const hoje = job.today
              ? ` (${job.today} ainda hoje)`
              : " (nenhum ainda hoje — o dia já acabou)";
            const reserva = job.reserveCount || 0;
            if (reserva > 0) {
              toast.error(
                `${job.created} post(s) de prévias gerados${hoje}, mas ${reserva} saíram com o TEXTO DE RESERVA` +
                  ` (a IA falhou neles). Revise no calendário antes de deixar ir ao ar.` +
                  (job.aiError ? ` Motivo: ${job.aiError}` : ""),
              );
            } else if (job.aiError) {
              toast.error(`Parcial: ${job.aiError}`);
            } else {
              toast.success(`${job.created} post(s) de prévias gerados${hoje}. Veja no calendário.`);
            }
          }
        } else {
          // Cada lote agenda posts novos: o calendário atualiza junto.
          window.dispatchEvent(new Event("reloadTelegramCalendar"));
        }
      } catch {
        /* tenta de novo no próximo tick */
      }
    };
    void consultar();
    const t = setInterval(consultar, 5000);
    return () => {
      vivo = false;
      clearInterval(t);
    };
  }, [selectedProfileId, generatingPrevias]);

  /**
   * Encerra a geração em andamento e libera o botão. Os posts já escritos nos
   * lotes anteriores continuam no calendário — cancelar é parar de gerar, não
   * desfazer o que já ficou pronto.
   */
  const cancelarGeracao = async (grupo: "previas" | "vip") => {
    if (!selectedProfileId) return;
    const rota = grupo === "previas" ? "generate-previas" : "generate-vip";
    try {
      const res = await fetch(
        `/api/telegram/${rota}?profileId=${encodeURIComponent(selectedProfileId)}`,
        { method: "DELETE" },
      );
      if (!res.ok) throw new Error("Não deu para cancelar a geração.");
      if (grupo === "previas") {
        previasJobIdRef.current = null;
        setGeneratingPrevias(false);
        setPreviasJob(null);
      } else {
        vipJobIdRef.current = null;
        setGeneratingVipMk(false);
        setMkVipJob(null);
      }
      toast.success("Geração cancelada. Os posts já criados seguem no calendário.");
      window.dispatchEvent(new Event("reloadTelegramCalendar"));
    } catch (err: any) {
      toast.error(err.message || "Não deu para cancelar a geração.");
    }
  };

  const generatePrevias = async (daysOverride?: number) => {
    setGeneratingPrevias(true);
    setPreviasJob(null);
    // Zera o job seguido: até o POST responder, nenhuma consulta pode concluir
    // nada — o que estiver gravado no servidor ainda é da rodada anterior.
    previasJobIdRef.current = null;
    try {
      const res = await fetch("/api/telegram/generate-previas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId: selectedProfileId, days: daysOverride ?? 1 }),
      });
      const d = await res.json();
      // Já havia uma geração rodando: em vez de só reclamar, adota o job que a
      // rota devolve — a barra aparece e o acompanhamento recomeça.
      if (res.status === 409 && d.job) {
        previasJobIdRef.current = d.job.id || SEM_ID;
        setPreviasJob(d.job);
        toast.error(d.error || "Já existe uma geração em andamento.");
        return;
      }
      if (!res.ok) throw new Error(d.error || "Erro ao gerar prévias.");
      if (d.job?.total === 0) {
        setGeneratingPrevias(false);
        toast.success(d.message || "Nenhum horário livre no período.");
        return;
      }
      previasJobIdRef.current = d.job.id || SEM_ID;
      setPreviasJob(d.job);
      toast.success(`Programação montada: ${d.job.total} posts. Escrevendo as legendas…`);
    } catch (err: any) {
      setGeneratingPrevias(false);
      toast.error(err.message);
    }
  };

  // Método MK do VIP. Igual às Prévias: a rota só ENFILEIRA e responde na hora;
  // quem escreve a copy é o agendador do servidor, em lotes. O convite pro
  // particular é escolha DESTA geração (`vipContato`), não configuração salva.
  // Mesma história das Prévias: o id do job que esta tela acompanha. Ver o
  // comentário longo em `previasJobIdRef` — o defeito era idêntico aqui.
  const vipJobIdRef = useRef<string | null>(null);
  const [mkVipJob, setMkVipJob] = useState<{
    id?: string;
    status: string;
    total: number;
    done: number;
    created: number;
    today: number;
    error?: string | null;
    aiError?: string | null;
    reserveCount?: number;
  } | null>(null);

  // Mesma retomada das Prévias: sem isto a barra do VIP só existe na aba que
  // clicou no botão.
  useEffect(() => {
    if (!selectedProfileId) return;
    let vivo = true;
    void (async () => {
      try {
        const res = await fetch(
          `/api/telegram/generate-vip?profileId=${encodeURIComponent(selectedProfileId)}`,
        );
        const d = await res.json();
        if (!vivo) return;
        const job = d.job;
        if (job && (job.status === "pending" || job.status === "processing")) {
          vipJobIdRef.current = job.id || SEM_ID;
          setMkVipJob(job);
          setGeneratingVipMk(true);
        }
      } catch {
        /* silencioso: isto é só a retomada da barra */
      }
    })();
    return () => {
      vivo = false;
    };
  }, [selectedProfileId]);

  useEffect(() => {
    if (!selectedProfileId || !generatingVipMk) return;
    let vivo = true;
    const consultar = async () => {
      try {
        const res = await fetch(
          `/api/telegram/generate-vip?profileId=${encodeURIComponent(selectedProfileId)}`,
        );
        const d = await res.json();
        if (!vivo) return;
        const job = d.job;
        const seguido = vipJobIdRef.current;
        // Ainda não sabemos qual job é o nosso (o POST não respondeu): esperar.
        if (!seguido || !job) return;
        // Job de outra rodada — o GET devolve o último do perfil, não o nosso.
        // `SEM_ID` é a saída de emergência: se um dia a resposta vier sem id,
        // perde-se a conferência de identidade, mas o acompanhamento continua —
        // barra presa para sempre seria pior que o defeito que isto conserta.
        if (seguido !== SEM_ID && job.id && job.id !== seguido) return;
        setMkVipJob(job);
        if (job.status === "done" || job.status === "error") {
          vipJobIdRef.current = null;
          setGeneratingVipMk(false);
          window.dispatchEvent(new Event("reloadTelegramCalendar"));
          if (job.status === "error") {
            toast.error(job.error || "Erro ao gerar VIP.");
          } else {
            const hoje = job.today
              ? ` (${job.today} ainda hoje)`
              : " (nenhum ainda hoje — o dia já acabou)";
            const reserva = job.reserveCount || 0;
            if (reserva > 0) {
              toast.error(
                `${job.created} post(s) do VIP gerados${hoje}, mas ${reserva} saíram com o TEXTO DE RESERVA` +
                  ` (a IA falhou neles). Revise no calendário antes de deixar ir ao ar.` +
                  (job.aiError ? ` Motivo: ${job.aiError}` : ""),
              );
            } else if (job.aiError) {
              toast.error(`Parcial: ${job.aiError}`);
            } else {
              toast.success(`${job.created} post(s) do VIP gerados${hoje}. Veja no calendário.`);
            }
          }
        } else {
          // Cada lote agenda posts novos: o calendário atualiza junto.
          window.dispatchEvent(new Event("reloadTelegramCalendar"));
        }
      } catch {
        /* tenta de novo no próximo tick */
      }
    };
    void consultar();
    const t = setInterval(consultar, 5000);
    return () => {
      vivo = false;
      clearInterval(t);
    };
  }, [selectedProfileId, generatingVipMk]);

  const generateVipMk = async (daysOverride?: number) => {
    setGeneratingVipMk(true);
    setMkVipJob(null);
    vipJobIdRef.current = null;
    try {
      const res = await fetch("/api/telegram/generate-vip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profileId: selectedProfileId,
          days: daysOverride ?? 1,
          contato: vipContato === "nenhum" ? null : vipContato,
          // A conta EFETIVA, não a bruta: sem link no cadastro, a lista assume a
          // primeira conta sozinha e é ela que precisa ir para a geração.
          contatoAccountId: vipContaSel,
        }),
      });
      const d = await res.json();
      // Idem Prévias: o 409 vira acompanhamento do job que já está rodando.
      if (res.status === 409 && d.job) {
        vipJobIdRef.current = d.job.id || SEM_ID;
        setMkVipJob(d.job);
        toast.error(d.error || "Já existe uma geração em andamento.");
        return;
      }
      if (!res.ok) throw new Error(d.error || "Erro ao gerar VIP.");
      if (d.job?.total === 0) {
        setGeneratingVipMk(false);
        toast.success(d.message || "Nenhum horário livre no período.");
        return;
      }
      vipJobIdRef.current = d.job.id || SEM_ID;
      setMkVipJob(d.job);
      toast.success(`Programação montada: ${d.job.total} posts. Escrevendo as legendas…`);
    } catch (err: any) {
      setGeneratingVipMk(false);
      toast.error(err.message);
    }
  };

  const generateSchedule = async (target: "vip" | "warmup", single = false) => {
    const days = target === "vip" ? daysToGenerateVip : daysToGenerateWarmup;
    
    const setGen = target === "vip" ? setGeneratingVip : setGeneratingWarmup;
    setGen(true);
    try {
      const res = await fetch("/api/telegram/generate-schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profileId: selectedProfileId,
          target,
          days,
          single,
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Erro ao gerar posts.");
      // Emit event so calendar component reloads
      window.dispatchEvent(new Event("reloadTelegramCalendar"));
      // Se a IA falhou (ou não está conectada), os posts saem com o texto padrão
      // — avisa o motivo em vez de fingir sucesso total.
      if (d.aiError) {
        toast.error(`Posts gerados, mas as legendas usaram o texto padrão. Motivo: ${d.aiError}`);
        return;
      }
      toast.success(
        single
          ? "Postagem única gerada com sucesso! Verifique o calendário."
          : `${d.generated} posts gerados com sucesso! Verifique o calendário.`
      );
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setGen(false);
    }
  };

  const addFixedTime = (target: "vip" | "warmup", time: string) => {
    if (!time) return;
    const key = target === "vip" ? "vipFixedTimes" : "warmupFixedTimes";
    const currentVal = settings[key];
    const currentList = currentVal.split(",").map(t => t.trim()).filter(Boolean);
    if (!currentList.includes(time)) {
      const newList = [...currentList, time].sort();
      setSettings({
        ...settings,
        [key]: newList.join(", ")
      });
    }
    if (target === "vip") {
      setShowNewVipTimeInput(false);
      setNewVipTime("");
    } else {
      setShowNewWarmupTimeInput(false);
      setNewWarmupTime("");
    }
  };

  const removeFixedTime = (target: "vip" | "warmup", time: string) => {
    const key = target === "vip" ? "vipFixedTimes" : "warmupFixedTimes";
    const currentVal = settings[key];
    const newList = currentVal.split(",").map(t => t.trim()).filter(t => t !== time && Boolean(t));
    setSettings({
      ...settings,
      [key]: newList.join(", ")
    });
  };

  const setScheduleType = (target: "vip" | "warmup", type: "manual" | "interval" | "fixed" | "mk") => {
    const nextSettings = { ...settings };
    if (target === "vip") {
      nextSettings.vipScheduleType = type;
    } else {
      nextSettings.warmupScheduleType = type;
    }
    // O autopost é ativado se pelo menos um canal não for manual
    nextSettings.enabled = nextSettings.vipScheduleType !== "manual" || nextSettings.warmupScheduleType !== "manual";
    setSettings(nextSettings);
  };

  const toggleTag = (target: "vipTags" | "warmupTags", tagName: string) => {
    const currentList = settings[target].split(",").map(t => t.trim().toLowerCase()).filter(Boolean);
    const lowerName = tagName.toLowerCase();
    
    let newList;
    if (currentList.includes(lowerName)) {
      newList = currentList.filter(t => t !== lowerName);
    } else {
      newList = [...currentList, lowerName];
    }
    setSettings({ ...settings, [target]: newList.join(", ") });
  };

  const hasTag = (target: "vipTags" | "warmupTags", tagName: string) => {
    return settings[target].split(",").map(t => t.trim().toLowerCase()).filter(Boolean).includes(tagName.toLowerCase());
  };

  // Destinos que o convite do VIP pode usar: as contas cadastradas em Contas da
  // modelo, mais o "particular" do cadastro como padrão. `vipWaTarget` é o link
  // que a próxima geração usaria DE FATO — é ele que a tela mostra para
  // conferência e é ele que diz se o aviso de "falta configurar" aparece.
  //
  // O cadastro recém-buscado manda; a lista do menu é só o que aparece enquanto
  // a busca não volta (assim o nome da modelo não pisca vazio).
  const vipProfile =
    profileCadastro || profiles.find((p) => p.id === selectedProfileId);
  const vipContas =
    vipContato === "telegram"
      ? telegramAccounts(vipProfile?.accounts)
      : whatsappAccounts(vipProfile?.accounts);
  const vipPadraoCadastro =
    vipContato === "telegram" ? vipProfile?.bioTelegramLink : vipProfile?.bioWhatsappLink;
  // O "padrão do cadastro" só é uma opção de verdade quando existe. Sem ele, a
  // lista começa direto na primeira conta: antes o campo abria em "padrão do
  // cadastro — não configurado" e a tela avisava que faltava cadastrar, mesmo
  // com a conta cadastrada logo abaixo, sem seleção nenhuma.
  const vipTemPadrao = Boolean(vipPadraoCadastro);
  const vipContaSel =
    vipTemPadrao || vipContas.length === 0
      ? vipContatoAccountId
      : vipContatoAccountId || vipContas[0].id;
  const vipWaTarget = vipContaSel
    ? vipContas.find((a) => a.id === vipContaSel)?.url || ""
    : vipPadraoCadastro || "";
  const vipContatoNome = vipContato === "telegram" ? "Telegram" : "WhatsApp";

  // Configuração de automação é sempre de UMA modelo — com "Todas" no menu
  // não há o que editar.
  if (!selectedProfileId) {
    return (
      <div className="page">
        <PageHeader title="Automação do Telegram" />
        <PrecisaDeModelo oQue="configurar a automação do Telegram" />
      </div>
    );
  }

  return (
    <div className="page pb-20 text-white">
      <PageHeader
        title="Automação do Telegram"
      />

      {/* A modelo é escolhida no menu; aqui só se confirma QUAL está sendo
          editada — esta tela grava configuração, então errar de modelo é caro. */}
      <div className="mb-6 mt-6 rounded-xl border border-sky-500/30 bg-sky-500/5 p-4 shadow-lg">
        <h2 className="text-sm font-bold uppercase tracking-wider text-sky-400">Modelo em edição</h2>
        <p className="mt-0.5 font-display text-lg font-semibold text-white">{vipProfile?.name}</p>
        <p className="text-xs text-zinc-400">
          Tudo nesta página vale para ela. Troque no seletor do menu.
        </p>
      </div>

      {loading ? (
        <div className="grid flex-1 place-items-center py-20"><div className="h-8 w-8 animate-spin rounded-full border border-white/20 border-t-white" /></div>
      ) : (
        <div className="mt-6">
          
          {/* As credenciais do bot (token + IDs dos canais) ficam no cadastro
              da modelo, pois servem em mais lugares.

              Este aviso vivia SEMPRE na tela, mesmo com tudo configurado: ele
              testava `settings.botToken`, e o token nunca chega ao navegador
              (a rota GET o remove de propósito e manda só `hasToken`). Um
              alerta que nunca sai é um alerta que ninguém lê — e escondia o
              caso real. Agora só aparece quando falta MESMO, e diz o que
              falta, nesta modelo. */}
          <AvisoDeCadastro
            profileName={vipProfile?.name}
            hasToken={settings.hasToken}
            idVip={settings.idVip}
            idAquecimento={settings.idAquecimento}
          />

          <div className="grid gap-8 lg:grid-cols-2">

            {/* VIP Group */}
            <div className="space-y-6">
              <div className="rounded-xl border border-sky-500/20 bg-sky-950/10 p-5 space-y-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <h3 className="font-semibold text-sky-400 flex items-center gap-2">Canal VIP</h3>
                    <div className="flex flex-wrap items-center gap-2">
                       {settings.vipScheduleType === "manual" && (
                         <button type="button" onClick={() => generateSchedule("vip", true)} disabled={generatingVip} className="rounded-lg bg-sky-500/20 text-sky-300 px-3 py-1.5 text-xs font-semibold hover:bg-sky-500/30 transition-colors disabled:opacity-50 [@media(pointer:coarse)]:min-h-[44px] [@media(pointer:coarse)]:px-4">
                           {generatingVip ? "⏳ Gerando..." : "✨ Gerar postagem única (IA)"}
                         </button>
                       )}
                       <div className="flex items-center gap-1.5 bg-black/10 p-1.5 rounded-lg border border-white/5">
                         <input type="number" min={1} max={30} value={daysToGenerateVip} onChange={e => setDaysToGenerateVip(parseInt(e.target.value) || 1)} className="w-12 rounded border border-sky-500/20 bg-sky-950/20 px-2 py-1 text-xs text-sky-200 text-center focus:outline-none" title="Dias a gerar" />
                         <button
                           type="button"
                           onClick={() => settings.vipScheduleType === "mk" ? generateVipMk(daysToGenerateVip) : generateSchedule("vip", false)}
                           disabled={generatingVip || generatingVipMk}
                           className="rounded-lg bg-sky-500/20 text-sky-300 px-3 py-1.5 text-xs font-semibold hover:bg-sky-500/30 transition-colors disabled:opacity-50 [@media(pointer:coarse)]:min-h-[44px] [@media(pointer:coarse)]:px-4"
                         >
                           {generatingVipMk && mkVipJob?.total
                             ? `⏳ ${mkVipJob.done} de ${mkVipJob.total}`
                             : (generatingVip || generatingVipMk)
                               ? "⏳ Gerando..."
                               : settings.vipScheduleType === "mk"
                                 ? "✨ Gerar dias (Método MK)"
                                 : "✨ Gerar postagens com IA em massa"}
                         </button>
                       </div>
                       <GeracaoAutomatica
                         canal="vip"
                         ligado={settings.vipAutoGenerate}
                         disponivel={settings.vipScheduleType === "mk"}
                         onAlternar={(v) => alternarGeracaoAutomatica("vip", v)}
                       />
                    </div>
                 </div>

                {/* Progresso da geração do Método MK. A geração roda no servidor
                    em lotes, então continua mesmo se esta tela for fechada. */}
                {generatingVipMk && mkVipJob && mkVipJob.total > 0 && (
                  <div className="rounded-xl border border-sky-500/20 bg-sky-950/20 px-4 py-3">
                    <div className="flex items-center justify-between text-xs text-sky-200">
                      <span>Escrevendo as legendas no servidor…</span>
                      <span className="font-mono">
                        {mkVipJob.done} / {mkVipJob.total}
                      </span>
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-sky-500/15">
                      <div
                        className="h-full rounded-full bg-sky-400 transition-all duration-500"
                        style={{
                          width: `${Math.round((100 * mkVipJob.done) / mkVipJob.total)}%`,
                        }}
                      />
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-3">
                      <p className="text-[11px] text-zinc-500">
                        Pode fechar esta tela — a geração continua rodando.
                      </p>
                      <button
                        type="button"
                        onClick={() => cancelarGeracao("vip")}
                        className="shrink-0 text-[11px] font-semibold text-rose-300 underline underline-offset-2 hover:text-rose-200"
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                )}

                {/* Agendamento VIP */}
                <div className="space-y-4 rounded-xl border border-white/[0.06] bg-zinc-950/60 p-5">
                  <h4 className="text-xs font-bold text-zinc-300">Agendamento</h4>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <button
                      type="button"
                      onClick={() => setScheduleType("vip", "manual")}
                      className={`flex flex-col items-start px-3 py-2 rounded-lg border transition-all text-left ${
                        settings.vipScheduleType === "manual"
                          ? 'border-emerald-500 bg-emerald-500/10 text-emerald-400 shadow-md'
                          : 'border-white/[0.06] bg-zinc-900/40 text-zinc-400 hover:bg-zinc-900/60'
                      }`}
                    >
                      <span className={`text-xs font-bold ${settings.vipScheduleType === "manual" ? 'text-emerald-400' : 'text-zinc-200'}`}>Manual</span>
                      <span className="text-[10px] text-zinc-500 mt-0.5">Só no botão</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setScheduleType("vip", "interval")}
                      className={`flex flex-col items-start px-3 py-2 rounded-lg border transition-all text-left ${
                        settings.vipScheduleType === "interval"
                          ? 'border-emerald-500 bg-emerald-500/10 text-emerald-400 shadow-md'
                          : 'border-white/[0.06] bg-zinc-900/40 text-zinc-400 hover:bg-zinc-900/60'
                      }`}
                    >
                      <span className={`text-xs font-bold ${settings.vipScheduleType === "interval" ? 'text-emerald-400' : 'text-zinc-200'}`}>Intervalo</span>
                      <span className="text-[10px] text-zinc-500 mt-0.5">A cada X min</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setScheduleType("vip", "fixed")}
                      className={`flex flex-col items-start px-3 py-2 rounded-lg border transition-all text-left ${
                        settings.vipScheduleType === "fixed"
                          ? 'border-emerald-500 bg-emerald-500/10 text-emerald-400 shadow-md'
                          : 'border-white/[0.06] bg-zinc-900/40 text-zinc-400 hover:bg-zinc-900/60'
                      }`}
                    >
                      <span className={`text-xs font-bold ${settings.vipScheduleType === "fixed" ? 'text-emerald-400' : 'text-zinc-200'}`}>Horários</span>
                      <span className="text-[10px] text-zinc-500 mt-0.5">Horas fixas</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setScheduleType("vip", "mk")}
                      className={`flex flex-col items-start px-3 py-2 rounded-lg border transition-all text-left ${
                        settings.vipScheduleType === "mk"
                          ? 'border-emerald-500 bg-emerald-500/10 text-emerald-400 shadow-md'
                          : 'border-white/[0.06] bg-zinc-900/40 text-zinc-400 hover:bg-zinc-900/60'
                      }`}
                    >
                      <span className={`text-xs font-bold ${settings.vipScheduleType === "mk" ? 'text-emerald-400' : 'text-zinc-200'}`}>Método MK 💬</span>
                      <span className="text-[10px] text-zinc-500 mt-0.5">Dia planejado (20–25)</span>
                    </button>
                  </div>

                  {/* Método MK do VIP: relacionamento + convite pro WhatsApp
                      opcional, decidido a cada geração. */}
                  {settings.vipScheduleType === "mk" && (
                    <div className="space-y-3 pt-2">
                      <p className="text-[11px] text-zinc-400">
                        Planeja o dia do VIP para quem <b>já comprou</b>: <b>20 a 25 posts/dia</b> de relacionamento e
                        engajamento. A IA <b>analisa cada foto</b> e escreve a legenda.
                      </p>
                      {/* Escolha DESTA geração: o contato particular é produto
                          à parte, então nasce em "nenhum". Um destino por vez —
                          os dois no mesmo dia dividem a atenção. */}
                      <div className="rounded-lg border border-white/[0.06] bg-zinc-900/40 px-3 py-2.5">
                        <p className="text-[11px] font-bold text-zinc-200">
                          Convite nesta geração
                        </p>
                        <div className="mt-2 grid grid-cols-3 gap-1.5">
                          {(
                            [
                              ["nenhum", "Nenhum"],
                              ["whatsapp", "WhatsApp"],
                              ["telegram", "Telegram"],
                            ] as const
                          ).map(([valor, rotulo]) => (
                            <button
                              key={valor}
                              type="button"
                              onClick={() => {
                                setVipContato(valor);
                                // A conta escolhida é de UMA rede: trocar de
                                // destino tem de zerar, senão sobraria o id de
                                // um WhatsApp numa geração de Telegram.
                                setVipContatoAccountId("");
                              }}
                              className={`rounded-lg border px-2 py-1.5 text-[11px] font-semibold transition-colors ${
                                vipContato === valor
                                  ? "border-emerald-500 bg-emerald-500/15 text-emerald-300"
                                  : "border-white/[0.08] bg-zinc-900/40 text-zinc-400 hover:bg-zinc-900/70"
                              }`}
                            >
                              {rotulo}
                            </button>
                          ))}
                        </div>
                        <p className="mt-2 text-[11px] text-zinc-500">
                          {vipContato === "nenhum"
                            ? "O dia sai sem venda nenhuma — nenhum post leva botão."
                            : `~8 posts/dia vão com o botão do seu ${vipContatoNome} particular, nos horários de pico. A legenda é escrita citando o ${vipContatoNome}.`}
                        </p>
                      </div>
                      {/* Qual número o convite leva. Só aparece com o convite
                          ligado — sem ele não há destino nenhum a escolher. */}
                      {vipContato !== "nenhum" && (
                        <div className="rounded-lg border border-white/[0.06] bg-zinc-900/40 px-3 py-2.5">
                          <label
                            htmlFor="vip-wa-account"
                            className="text-[11px] font-bold text-zinc-200"
                          >
                            Qual {vipContatoNome} enviar
                          </label>
                          <select
                            id="vip-wa-account"
                            value={vipContaSel}
                            onChange={(e) => setVipContatoAccountId(e.target.value)}
                            className="input mt-1.5 py-1.5 text-xs"
                          >
                            {/* Sem link no cadastro E com contas na lista, esta
                                opção sairia de fábrica apontando para lugar
                                nenhum — some, e a primeira conta assume. */}
                            {(vipTemPadrao || vipContas.length === 0) && (
                              <option value="">
                                {vipContatoNome} particular (padrão do cadastro)
                                {vipPadraoCadastro ? "" : " — não configurado"}
                              </option>
                            )}
                            {vipContas.map((a) => (
                              <option key={a.id} value={a.id}>
                                {a.label}
                              </option>
                            ))}
                          </select>
                          <p className="mt-1.5 text-[11px] text-zinc-500">
                            Os destinos vêm das <b>Contas</b> da modelo. O texto do botão vem do cadastro — aqui só o destino.
                          </p>
                          {/* Conferência: o link EXATO que vai ser gravado nos
                              posts desta geração. É o mesmo cálculo que a rota
                              faz — conta escolhida, senão o link do cadastro. */}
                          {vipWaTarget ? (
                            <div className="mt-2 rounded-lg border border-emerald-500/20 bg-emerald-500/[0.06] px-2.5 py-2">
                              <p className="text-[11px] font-bold text-emerald-300">
                                Link que vai nos posts
                              </p>
                              <a
                                href={vipWaTarget}
                                target="_blank"
                                rel="noreferrer"
                                className="mt-0.5 block break-all font-mono text-[11px] text-emerald-200 underline decoration-emerald-500/40 hover:decoration-emerald-300"
                              >
                                {vipWaTarget}
                              </a>
                              <p className="mt-1 text-[10px] text-zinc-500">
                                {vipContaSel
                                  ? "Veio da conta escolhida acima."
                                  : `Veio do ${vipContatoNome} particular do cadastro da modelo.`}
                              </p>
                            </div>
                          ) : null}
                        </div>
                      )}
                      {vipContato !== "nenhum" && !vipWaTarget && (
                        <p className="text-[11px] text-amber-400">
                          ⚠️ Cadastre um {vipContatoNome} em <b>Contas</b> ou preencha o{" "}
                          <b>Link do {vipContatoNome}</b> no cadastro da modelo — sem isso, esses
                          posts saem sem o botão.
                        </p>
                      )}
                      <p className="text-[11px] text-emerald-300/80">
                        Escolha os <b>dias</b> e clique em <b>“Gerar dias (Método MK)”</b> ali em cima.
                      </p>
                    </div>
                  )}

                  {settings.vipScheduleType === "interval" && (
                    <div className="flex items-center gap-2 text-sm text-zinc-300 pt-2">
                      <span>Postar a cada</span>
                      <input
                        type="number"
                        min={1}
                        value={settings.vipPostInterval}
                        onChange={(e) => setSettings({ ...settings, vipPostInterval: parseInt(e.target.value) || 120 })}
                        className="w-20 rounded-lg border border-white/[0.08] bg-zinc-900 px-3 py-1.5 text-center text-sm font-semibold text-white focus:outline-none"
                      />
                      <span>minutos</span>
                    </div>
                  )}

                  {settings.vipScheduleType === "fixed" && (
                    <div className="space-y-2 pt-2">
                      <div className="flex flex-wrap gap-2 items-center">
                        {settings.vipFixedTimes.split(",").map(t => t.trim()).filter(Boolean).map(time => (
                          <div key={time} className="flex items-center gap-1.5 rounded-lg bg-zinc-900 border border-white/[0.08] px-2.5 py-1.5 text-xs text-white">
                            <svg className="h-3.5 w-3.5 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <circle cx="12" cy="12" r="10" strokeWidth="2"/>
                              <path d="M12 6v6l4 2" strokeWidth="2"/>
                            </svg>
                            <span>{time}</span>
                            <button
                              type="button"
                              onClick={() => removeFixedTime("vip", time)}
                              className="text-red-500/70 hover:text-red-400 transition-colors ml-1 p-0.5 rounded hover:bg-white/5"
                            >
                              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path d="M6 18L18 6M6 6l12 12" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                              </svg>
                            </button>
                          </div>
                        ))}

                        {showNewVipTimeInput ? (
                          <input
                            type="time"
                            autoFocus
                            onBlur={(e) => addFixedTime("vip", e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") addFixedTime("vip", (e.target as HTMLInputElement).value);
                              if (e.key === "Escape") setShowNewVipTimeInput(false);
                            }}
                            className="rounded-lg border border-white/[0.08] bg-zinc-900 px-2 py-1.5 text-xs text-white focus:outline-none w-24"
                          />
                        ) : (
                          <button
                            type="button"
                            onClick={() => setShowNewVipTimeInput(true)}
                            className="flex items-center gap-1 rounded-lg border border-dashed border-white/20 bg-zinc-900/20 hover:bg-zinc-900/40 px-3 py-1.5 text-xs font-semibold text-zinc-300 hover:text-white transition-colors [@media(pointer:coarse)]:min-h-[44px] [@media(pointer:coarse)]:px-4"
                          >
                            <span>+ Horário</span>
                          </button>
                        )}
                      </div>
                      <p className="text-[10px] text-zinc-500">Fuso de Brasília. A cada horário, posta o próximo da fila.</p>
                    </div>
                  )}

                </div>

                {/* Etiquetas VIP */}
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-zinc-300">Etiquetas Permitidas (Quais mídias podem ir pro VIP?)</label>
                  <div className="flex flex-wrap gap-2">
                    {availableTags.map(tag => (
                      <button 
                        key={tag.id}
                        onClick={() => toggleTag("vipTags", tag.name)}
                        className={`px-3 py-1 text-xs rounded-full border transition-colors [@media(pointer:coarse)]:min-h-[44px] [@media(pointer:coarse)]:px-4 ${hasTag("vipTags", tag.name) ? 'bg-sky-500/20 border-sky-500/50 text-sky-200' : 'bg-transparent border-white/10 text-zinc-500 hover:border-white/20'}`}
                      >
                        {tag.name}
                      </button>
                    ))}
                    {availableTags.length === 0 && <span className="text-xs text-zinc-600">Nenhuma etiqueta cadastrada no sistema.</span>}
                  </div>
                </div>

                {/* VIP Prompt */}
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-zinc-300">Prompt de Geração de Legenda (VIP)</label>
                  <p className="text-[11px] text-zinc-500 mb-1">As instruções completas para a IA: o que olhar na foto, o tom de voz e os modelos de legenda.</p>
                  <textarea 
                     rows={8}
                     placeholder="Ex: Analise a foto anexada e crie uma legenda sedutora. Siga estes modelos como exemplo: 'Que tal um docinho hoje? 🍬', etc..."
                     value={settings.vipPrompt}
                     onChange={(e) => setSettings({ ...settings, vipPrompt: e.target.value })}
                     className="w-full rounded-lg border border-white/[0.08] bg-zinc-900 px-3 py-2 text-sm text-white focus:outline-none resize-none font-mono"
                  />
                </div>

                {/* Botões da copy (VIP) — frases de CTA (1 por linha). Aqui o
                    destino é o WhatsApp particular, não o VIP: quem está no VIP
                    já é assinante, e a conversa no privado é o que vira LTV. */}
                <div className="space-y-2 rounded-lg border border-blue-500/10 bg-blue-900/10 p-3">
                  <label className="text-xs font-semibold text-blue-300">
                    Botões da copy (VIP) <span className="text-blue-200/50 font-normal">— 1 por linha</span>
                  </label>
                  <p className="text-[11px] text-blue-200/60">
                    Nos posts de convite ao <b>WhatsApp particular</b>: 1 frase vira o <b>botão</b> (máx.{" "}
                    <b>{CTA_BUTTON_MAX} caracteres</b>) e outras 3 viram <b>hiperlinks</b> na
                    legenda, sem limite. Vazio usa as frases-padrão.
                  </p>
                  <textarea
                    rows={8}
                    value={settings.vipCtaButtons}
                    onChange={(e) => setSettings({ ...settings, vipCtaButtons: e.target.value })}
                    placeholder={DEFAULT_VIP_CTA_BUTTONS}
                    className="w-full rounded-lg border border-white/[0.08] bg-zinc-900 px-3 py-2 text-sm text-white focus:outline-none resize-y font-mono"
                  />
                </div>

              </div>
            </div>

            {/* Warmup Group */}
            <div className="space-y-6">
              <div className="rounded-xl border border-orange-500/20 bg-orange-950/10 p-5 space-y-6">
                              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <h3 className="font-semibold text-orange-400 flex items-center gap-2">Canal Prévias</h3>
                    <div className="flex flex-wrap items-center gap-2">
                       {settings.warmupScheduleType === "manual" && (
                         <button type="button" onClick={() => generateSchedule("warmup", true)} disabled={generatingWarmup} className="rounded-lg bg-orange-500/20 text-orange-300 px-3 py-1.5 text-xs font-semibold hover:bg-orange-500/30 transition-colors disabled:opacity-50 [@media(pointer:coarse)]:min-h-[44px] [@media(pointer:coarse)]:px-4">
                           {generatingWarmup ? "⏳ Gerando..." : "✨ Gerar postagem única (IA)"}
                         </button>
                       )}
                       <div className="flex items-center gap-1.5 bg-black/10 p-1.5 rounded-lg border border-white/5">
                         <input type="number" min={1} max={30} value={daysToGenerateWarmup} onChange={e => setDaysToGenerateWarmup(parseInt(e.target.value) || 1)} className="w-12 rounded border border-orange-500/20 bg-orange-950/20 px-2 py-1 text-xs text-orange-200 text-center focus:outline-none" title="Dias a gerar" />
                         <button
                           type="button"
                           onClick={() => settings.warmupScheduleType === "mk" ? generatePrevias(daysToGenerateWarmup) : generateSchedule("warmup", false)}
                           disabled={generatingWarmup || generatingPrevias}
                           className="rounded-lg bg-orange-500/20 text-orange-300 px-3 py-1.5 text-xs font-semibold hover:bg-orange-500/30 transition-colors disabled:opacity-50 [@media(pointer:coarse)]:min-h-[44px] [@media(pointer:coarse)]:px-4"
                         >
                           {generatingPrevias && previasJob?.total
                             ? `⏳ ${previasJob.done} de ${previasJob.total}`
                             : (generatingWarmup || generatingPrevias)
                               ? "⏳ Gerando..."
                               : settings.warmupScheduleType === "mk"
                                 ? "✨ Gerar dias (Método MK)"
                                 : "✨ Gerar postagens com IA em massa"}
                         </button>
                       </div>
                       <GeracaoAutomatica
                         canal="warmup"
                         ligado={settings.warmupAutoGenerate}
                         disponivel={settings.warmupScheduleType === "mk"}
                         onAlternar={(v) => alternarGeracaoAutomatica("warmup", v)}
                       />
                    </div>
                 </div>

                {/* Progresso da geração do Método MK. A geração roda no servidor
                    em lotes, então continua mesmo se esta tela for fechada. */}
                {generatingPrevias && previasJob && previasJob.total > 0 && (
                  <div className="rounded-xl border border-orange-500/20 bg-orange-950/20 px-4 py-3">
                    <div className="flex items-center justify-between text-xs text-orange-200">
                      <span>Escrevendo as legendas no servidor…</span>
                      <span className="font-mono">
                        {previasJob.done} / {previasJob.total}
                      </span>
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-orange-500/15">
                      <div
                        className="h-full rounded-full bg-orange-400 transition-all duration-500"
                        style={{
                          width: `${Math.round((100 * previasJob.done) / previasJob.total)}%`,
                        }}
                      />
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-3">
                      <p className="text-[11px] text-zinc-500">
                        Pode fechar esta tela — a geração continua rodando.
                      </p>
                      <button
                        type="button"
                        onClick={() => cancelarGeracao("previas")}
                        className="shrink-0 text-[11px] font-semibold text-rose-300 underline underline-offset-2 hover:text-rose-200"
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                )}

                {/* Agendamento Prévias */}
                <div className="space-y-4 rounded-xl border border-white/[0.06] bg-zinc-950/60 p-5">
                  <h4 className="text-xs font-bold text-zinc-300">Agendamento</h4>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <button
                      type="button"
                      onClick={() => setScheduleType("warmup", "manual")}
                      className={`flex flex-col items-start px-3 py-2 rounded-lg border transition-all text-left ${
                        settings.warmupScheduleType === "manual"
                          ? 'border-emerald-500 bg-emerald-500/10 text-emerald-400 shadow-md'
                          : 'border-white/[0.06] bg-zinc-900/40 text-zinc-400 hover:bg-zinc-900/60'
                      }`}
                    >
                      <span className={`text-xs font-bold ${settings.warmupScheduleType === "manual" ? 'text-emerald-400' : 'text-zinc-200'}`}>Manual</span>
                      <span className="text-[10px] text-zinc-500 mt-0.5">Só no botão</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setScheduleType("warmup", "interval")}
                      className={`flex flex-col items-start px-3 py-2 rounded-lg border transition-all text-left ${
                        settings.warmupScheduleType === "interval"
                          ? 'border-emerald-500 bg-emerald-500/10 text-emerald-400 shadow-md'
                          : 'border-white/[0.06] bg-zinc-900/40 text-zinc-400 hover:bg-zinc-900/60'
                      }`}
                    >
                      <span className={`text-xs font-bold ${settings.warmupScheduleType === "interval" ? 'text-emerald-400' : 'text-zinc-200'}`}>Intervalo</span>
                      <span className="text-[10px] text-zinc-500 mt-0.5">A cada X min</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setScheduleType("warmup", "fixed")}
                      className={`flex flex-col items-start px-3 py-2 rounded-lg border transition-all text-left ${
                        settings.warmupScheduleType === "fixed"
                          ? 'border-emerald-500 bg-emerald-500/10 text-emerald-400 shadow-md'
                          : 'border-white/[0.06] bg-zinc-900/40 text-zinc-400 hover:bg-zinc-900/60'
                      }`}
                    >
                      <span className={`text-xs font-bold ${settings.warmupScheduleType === "fixed" ? 'text-emerald-400' : 'text-zinc-200'}`}>Horários</span>
                      <span className="text-[10px] text-zinc-500 mt-0.5">Horas fixas</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setScheduleType("warmup", "mk")}
                      className={`flex flex-col items-start px-3 py-2 rounded-lg border transition-all text-left ${
                        settings.warmupScheduleType === "mk"
                          ? 'border-emerald-500 bg-emerald-500/10 text-emerald-400 shadow-md'
                          : 'border-white/[0.06] bg-zinc-900/40 text-zinc-400 hover:bg-zinc-900/60'
                      }`}
                    >
                      <span className={`text-xs font-bold ${settings.warmupScheduleType === "mk" ? 'text-emerald-400' : 'text-zinc-200'}`}>Método MK 🌶️</span>
                      <span className="text-[10px] text-zinc-500 mt-0.5">Dia planejado (30–35)</span>
                    </button>
                  </div>

                  {/* Método MK: gera um dia estruturado (metodologia) por IA. */}
                  {settings.warmupScheduleType === "mk" && (
                    <div className="space-y-3 pt-2">
                      <p className="text-[11px] text-zinc-400">
                        Planeja o dia inteiro: <b>30 a 35 posts/dia</b>, misturando humanização, engajamento e conversão,
                        nos horários de maior venda. A IA <b>analisa cada foto</b> e escreve a
                        legenda; só os posts de conversão levam o link do VIP (~14/dia). Cada dia leva{" "}
                        <b>4 a 6 vídeos</b>, nunca dois seguidos: os marcados como{" "}
                        <b>Video Censurado</b> vão nas horas que mais vendem, com a chamada pro VIP, e os
                        outros vídeos (reels, lifestyle) entram 1 ou 2 por dia no pico de audiência, só pra
                        engajar. Se a galeria tiver menos vídeos que isso nas etiquetas permitidas, o dia usa
                        só os que existem.
                      </p>
                      <p className="text-[11px] text-emerald-300/80">
                        Escolha os <b>dias</b> e clique em <b>“Gerar dias (Método MK)”</b> ali em cima
                        (canto superior direito das Prévias).
                      </p>
                    </div>
                  )}

                  {settings.warmupScheduleType === "interval" && (
                    <div className="flex items-center gap-2 text-sm text-zinc-300 pt-2">
                      <span>Postar a cada</span>
                      <input
                        type="number"
                        min={1}
                        value={settings.warmupPostInterval}
                        onChange={(e) => setSettings({ ...settings, warmupPostInterval: parseInt(e.target.value) || 120 })}
                        className="w-20 rounded-lg border border-white/[0.08] bg-zinc-900 px-3 py-1.5 text-center text-sm font-semibold text-white focus:outline-none"
                      />
                      <span>minutos</span>
                    </div>
                  )}

                  {settings.warmupScheduleType === "fixed" && (
                    <div className="space-y-2 pt-2">
                      <div className="flex flex-wrap gap-2 items-center">
                        {settings.warmupFixedTimes.split(",").map(t => t.trim()).filter(Boolean).map(time => (
                          <div key={time} className="flex items-center gap-1.5 rounded-lg bg-zinc-900 border border-white/[0.08] px-2.5 py-1.5 text-xs text-white">
                            <svg className="h-3.5 w-3.5 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <circle cx="12" cy="12" r="10" strokeWidth="2"/>
                              <path d="M12 6v6l4 2" strokeWidth="2"/>
                            </svg>
                            <span>{time}</span>
                            <button
                              type="button"
                              onClick={() => removeFixedTime("warmup", time)}
                              className="text-red-500/70 hover:text-red-400 transition-colors ml-1 p-0.5 rounded hover:bg-white/5"
                            >
                              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path d="M6 18L18 6M6 6l12 12" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                              </svg>
                            </button>
                          </div>
                        ))}

                        {showNewWarmupTimeInput ? (
                          <input
                            type="time"
                            autoFocus
                            onBlur={(e) => addFixedTime("warmup", e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") addFixedTime("warmup", (e.target as HTMLInputElement).value);
                              if (e.key === "Escape") setShowNewWarmupTimeInput(false);
                            }}
                            className="rounded-lg border border-white/[0.08] bg-zinc-900 px-2 py-1.5 text-xs text-white focus:outline-none w-24"
                          />
                        ) : (
                          <button
                            type="button"
                            onClick={() => setShowNewWarmupTimeInput(true)}
                            className="flex items-center gap-1 rounded-lg border border-dashed border-white/20 bg-zinc-900/20 hover:bg-zinc-900/40 px-3 py-1.5 text-xs font-semibold text-zinc-300 hover:text-white transition-colors [@media(pointer:coarse)]:min-h-[44px] [@media(pointer:coarse)]:px-4"
                          >
                            <span>+ Horário</span>
                          </button>
                        )}
                      </div>
                      <p className="text-[10px] text-zinc-500">Fuso de Brasília. A cada horário, posta o próximo da fila.</p>
                    </div>
                  )}

                </div>

                {/* Etiquetas Prévias */}
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-zinc-300">Etiquetas Permitidas (Quais mídias podem ir pras Prévias?)</label>
                  <div className="flex flex-wrap gap-2">
                    {availableTags.map(tag => (
                      <button 
                        key={tag.id}
                        onClick={() => toggleTag("warmupTags", tag.name)}
                        className={`px-3 py-1 text-xs rounded-full border transition-colors [@media(pointer:coarse)]:min-h-[44px] [@media(pointer:coarse)]:px-4 ${hasTag("warmupTags", tag.name) ? 'bg-orange-500/20 border-orange-500/50 text-orange-200' : 'bg-transparent border-white/10 text-zinc-500 hover:border-white/20'}`}
                      >
                        {tag.name}
                      </button>
                    ))}
                    {availableTags.length === 0 && <span className="text-xs text-zinc-600">Nenhuma etiqueta cadastrada no sistema.</span>}
                  </div>
                </div>

                {/* Prévias Prompt e Link */}
                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-zinc-300">Prompt de Geração de Legenda (Prévias)</label>
                  <p className="text-[11px] text-zinc-500 mb-1">As instruções completas para a IA: o que olhar na foto, o tom de voz e os modelos de legenda.</p>
                  <textarea 
                     rows={8}
                     placeholder="Ex: Analise a foto anexada e crie uma legenda convidativa. Siga estes modelos como exemplo: 'Vem ver o que te espera no VIP 🔥', etc..."
                       value={settings.warmupPrompt}
                       onChange={(e) => setSettings({ ...settings, warmupPrompt: e.target.value })}
                       className="w-full rounded-lg border border-white/[0.08] bg-zinc-900 px-3 py-2 text-sm text-white focus:outline-none resize-none font-mono"
                    />
                  </div>
                  <div className="space-y-2 rounded-lg border border-orange-500/10 bg-orange-900/10 p-3">
                    <label className="text-xs font-semibold text-orange-300 flex items-center gap-2">Link da Legenda (Call To Action) <span className="bg-orange-500/20 text-orange-400 px-1.5 py-0.5 rounded text-[10px]">Sempre anexado no final</span></label>
                    <p className="text-xs text-orange-200/60 mt-1">
                      O link do VIP vem do cadastro da modelo (campo "Link do Bot/Assinatura VIP").
                    </p>
                  </div>

                  {/* Botões da copy — frases de CTA (1 por linha). O sistema
                      escolhe 1 por post e anexa como BOTÃO com o link do VIP. */}
                  <div className="space-y-2 rounded-lg border border-orange-500/10 bg-orange-900/10 p-3">
                    <label className="text-xs font-semibold text-orange-300">
                      Botões da copy <span className="text-orange-200/50 font-normal">— 1 por linha (a IA escolhe 1 por post)</span>
                    </label>
                    <p className="text-[11px] text-orange-200/60">
                      Cada linha vira um <b>botão</b> com o link do VIP, de até <b>{CTA_BUTTON_MAX} caracteres</b>. Vazio
                      usa as frases-padrão.
                    </p>
                    <textarea
                      rows={8}
                      value={settings.warmupCtaButtons}
                      onChange={(e) => setSettings({ ...settings, warmupCtaButtons: e.target.value })}
                      placeholder={DEFAULT_CTA_BUTTONS}
                      className="w-full rounded-lg border border-white/[0.08] bg-zinc-900 px-3 py-2 text-sm text-white focus:outline-none resize-y font-mono"
                    />
                    {(() => {
                      const over = settings.warmupCtaButtons
                        .split("\n")
                        .map((l) => l.trim())
                        .filter((l) => l.length > CTA_BUTTON_MAX);
                      return over.length > 0 ? (
                        <p className="text-[11px] text-amber-400">
                          ⚠️ {over.length} linha(s) passam de {CTA_BUTTON_MAX} caracteres e serão cortadas.
                        </p>
                      ) : null;
                    })()}
                  </div>
                </div>

              </div>
            </div>

          </div>

          {/* Controle único do autopost + salvar — logo abaixo das configurações,
              acima do calendário (substitui os 3 toggles antigos). */}
          <div className="mt-8 flex flex-col gap-4 rounded-xl border border-white/[0.06] bg-zinc-950/60 p-5 sm:flex-row sm:items-center sm:justify-between">
            <label className="flex items-center gap-3 cursor-pointer">
              <Switch
                checked={settings.enabled}
                onChange={(v) => setSettings({ ...settings, enabled: v })}
                ariaLabel="Postagem automática"
              />
              <span className="flex flex-col">
                <span className="text-sm font-bold text-white">
                  Postagem automática {settings.enabled ? "ligada" : "desligada"}
                </span>
                <span className="text-[11px] text-zinc-500">
                  {settings.enabled
                    ? "Posta sozinho conforme o cronograma de cada canal (VIP e Prévias)."
                    : "Nada é postado automaticamente — só pelos botões de gerar/postar."}
                </span>
              </span>
            </label>
            <button type="button" onClick={() => saveSettings()} className="rounded-lg bg-sky-600 px-8 py-3 text-sm font-semibold hover:bg-sky-500 transition-colors shadow-lg shadow-sky-900/20 whitespace-nowrap">Salvar Todas Configurações</button>
          </div>

          <div className="mt-8 border-t border-white/[0.06] pt-8">
            <TelegramCalendar profileId={selectedProfileId} profiles={profiles} />
          </div>
        </div>
      )}
      {ConfirmDialog}
    </div>
  );
}

/**
 * Interruptor da GERAÇÃO AUTOMÁTICA, ao lado do "Gerar dias" de cada canal.
 *
 * Ligado, o agendador monta sozinho a programação do dia seguinte, uma vez por
 * dia, à noite — o canal fica sempre um dia à frente e ninguém precisa abrir o
 * painel para conferir se tem coisa programada. Ver
 * `lib/telegramAutoGeneration.ts`.
 *
 * Fora do Método MK ele aparece DESLIGADO e explica por quê, em vez de sumir:
 * um interruptor que some deixa a pessoa procurando; um que aceita o clique e
 * não faz nada é pior ainda. Os outros modos geram dentro da própria
 * requisição, sem fila, e não dá para pendurar isso no tique de um minuto.
 */
function GeracaoAutomatica({
  canal,
  ligado,
  disponivel,
  onAlternar,
}: {
  canal: "vip" | "warmup";
  ligado: boolean;
  disponivel: boolean;
  onAlternar: (v: boolean) => void;
}) {
  const cor =
    canal === "vip"
      ? { on: "bg-sky-500", texto: "text-sky-200", borda: "border-sky-500/20" }
      : { on: "bg-orange-500", texto: "text-orange-200", borda: "border-orange-500/20" };

  return (
    <button
      type="button"
      role="switch"
      aria-checked={ligado && disponivel}
      disabled={!disponivel}
      onClick={() => onAlternar(!ligado)}
      title={
        disponivel
          ? "Todo dia, à noite, monta sozinho a programação do dia seguinte — sempre com as fotos que estão na galeria naquele momento."
          : "Disponível no Método MK. Nos outros modos a geração roda na hora do clique, sem fila, e não pode ser agendada."
      }
      className={`flex items-center gap-2 rounded-lg border ${cor.borda} bg-black/10 px-2.5 py-1.5 text-xs font-semibold transition-colors ${
        disponivel ? "hover:bg-white/5" : "cursor-not-allowed opacity-40"
      } [@media(pointer:coarse)]:min-h-[44px]`}
    >
      <span
        className={`relative h-4 w-8 shrink-0 rounded-full transition-colors ${
          ligado && disponivel ? cor.on : "bg-white/15"
        }`}
      >
        <span
          className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all duration-200 ${
            ligado && disponivel ? "left-[18px]" : "left-0.5"
          }`}
        />
      </span>
      <span className={ligado && disponivel ? cor.texto : "text-zinc-500"}>
        Geração automática
      </span>
    </button>
  );
}

/**
 * Só aparece quando falta MESMO alguma coisa para esta modelo postar — e diz
 * exatamente o que falta, com o nome dela.
 *
 * O aviso anterior era fixo na tela porque testava o token, que a rota GET
 * nunca devolve ao navegador (ver o comentário lá). Além de errado, um alerta
 * permanente treina quem usa a ignorá-lo: quando faltasse de verdade, ele já
 * seria invisível.
 *
 * Cada canal é citado por nome: com dois canais e um token, "configure os IDs
 * dos canais" obriga o operador a abrir o cadastro e conferir os dois para
 * descobrir qual está vazio.
 */
function AvisoDeCadastro({
  profileName,
  hasToken,
  idVip,
  idAquecimento,
}: {
  profileName?: string;
  hasToken: boolean;
  idVip: string;
  idAquecimento: string;
}) {
  const faltando: string[] = [];
  if (!hasToken) faltando.push("o Token do bot");
  if (!idVip.trim()) faltando.push("o ID do Canal VIP");
  if (!idAquecimento.trim()) faltando.push("o ID do Canal de Prévias");
  if (faltando.length === 0) return null;

  // "a, b e c" — lista em português, não uma enumeração com vírgula solta.
  const lista =
    faltando.length === 1
      ? faltando[0]
      : `${faltando.slice(0, -1).join(", ")} e ${faltando[faltando.length - 1]}`;

  return (
    <div className="mb-8 max-w-4xl rounded-xl border border-amber-500/20 bg-amber-500/[0.06] p-4">
      <p className="text-sm text-amber-200">
        ⚠️ Falta {lista} {profileName ? <>de <b>{profileName}</b></> : "desta modelo"}. Sem isso a
        automação não posta.
      </p>
      <Link
        href="/dashboard/profiles"
        className="mt-2 inline-block text-xs font-semibold text-amber-300 underline underline-offset-2 hover:text-amber-200"
      >
        Abrir Modelos e completar o cadastro
      </Link>
    </div>
  );
}
