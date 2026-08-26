import "server-only";
import type { Transaction } from "@/lib/transactions";
import { buttonStyleProps } from "@/lib/settings";

/**
 * O que acontece quando UMA TRANSAÇÃO VIRA PAGA, seja qual for o provedor —
 * entrega do pedido do LTV, ativação de assinatura do Telegram (convite VIP,
 * mensagem de acesso), order bump, e o alerta de venda no celular.
 *
 * Extraído de `syncpayWebhook.ts` (só SyncPay chamava isto até aqui): o corpo
 * inteiro só trabalha com o objeto `Transaction` genérico — nada aqui é
 * SyncPay-específico. O webhook da Stripe (`stripeWebhook.ts`) chama a MESMA
 * função depois de marcar a transação como paga.
 *
 * `registra` é o logger de decisão do chamador (grava no diário de webhooks
 * daquele provedor) — mantém o rastro de "por que entrou/não entrou" por
 * provedor, sem duplicar a lógica de logging aqui dentro.
 */
export async function deliverPaidTransaction(
  transaction: Transaction,
  registra: (s: string) => void,
): Promise<void> {
  // VENDA DO LTV: a IA cobrou no meio da conversa e o conteúdo é entregue
  // ali mesmo, pelo canal da conta. Uma transação é do LTV OU do bot de
  // vendas, nunca dos dois — mas o push de venda no fim vale para as duas,
  // então isto desvia do bloco do bot em vez de sair da função.
  let ehVendaDeLtv = false;
  try {
    const { findOrderByTransaction, markOrderPaid, markOrderDelivered } = await import(
      "@/lib/ltvDb"
    );
    const pedido = findOrderByTransaction(transaction.id);
    if (pedido) {
      ehVendaDeLtv = true;
      // markOrderPaid devolve false quando a venda JÁ estava paga: o
      // gateway reenvia o mesmo webhook, e sem essa trava o cliente
      // receberia o pacote de fotos duas vezes.
      if (markOrderPaid(pedido.id)) {
        registra("venda de LTV confirmada · entregando");
        const { entregarPedido } = await import("@/lib/ltvAgent");
        await entregarPedido(pedido.id);
        markOrderDelivered(pedido.id);
        registra("conteúdo do LTV entregue");
      } else {
        registra("venda de LTV já estava paga · nada a entregar");
      }
    }
  } catch (e) {
    // A entrega falhou, mas o pagamento é real e já está registrado. Um
    // erro aqui não pode derrubar o webhook — o gateway reentregaria e a
    // venda entraria de novo. Fica no log para reenviar na mão.
    console.error("LTV: falha entregando a venda:", e);
    registra("venda de LTV confirmada · ENTREGA FALHOU");
  }

  // Verifica se existe uma inscrição do Telegram pendente para esta transação
  const { findSubscriptionByTransaction, saveSubscription, getBotConfig, getPlan, buildAccessMessage } =
    await import("@/lib/telegramDb");
  const sub = ehVendaDeLtv ? null : findSubscriptionByTransaction(transaction.id);

  // "abandoned" é um PIX pendente que um /start mais novo do mesmo lead
  // superou (ver `abandonPendingSubscriptions`) — parou de nagear, mas se for
  // pago do nada a entrega continua valendo, exatamente como um "pending".
  if (sub && (sub.status === "pending" || sub.status === "abandoned")) {
    const bot = getBotConfig(sub.botId);
    if (bot) {
      const { createTelegramInviteLink, sendTelegramMessage } = await import("@/lib/telegramApi");
      // O que foi comprado: normalmente um plano do bot, mas a compra pode
      // ter vindo de uma OFERTA DE MAILING — nome, preço e duração
      // ajustados só para aquele disparo. Quando existe, ela manda.
      const basePlan = sub.planId ? getPlan(sub.planId) : null;
      let plan: {
        name: string;
        durationDays: number;
        kind: string;
        deliverable?: string;
        deliverableButtons?: { text: string; url: string }[];
      } | null = basePlan;
      if (sub.offerId) {
        const { getMailingOffer } = await import("@/lib/telegramMailing");
        const offer = getMailingOffer(sub.offerId);
        if (offer) {
          plan = {
            name: offer.name,
            durationDays: offer.durationDays,
            kind: offer.kind,
            // Sem entregável próprio, herda o do plano de origem.
            deliverable: offer.deliverable || basePlan?.deliverable,
            deliverableButtons: basePlan?.deliverableButtons,
          };
        }
      }
      const isPackage = plan?.kind === "package";
      // Botões que acompanham o entregável ("MEU WHATSAPP" etc.). Sem eles
      // o link ia solto no meio do texto.
      const botoesEntregavel = plan?.deliverableButtons?.length
        ? {
            reply_markup: {
              inline_keyboard: plan.deliverableButtons.map((b) => [{ text: b.text, url: b.url }]),
            },
          }
        : {};

      // Tradução GUARDADA da mensagem de sucesso (D.4 do fluxo internacional)
      // — só entra em jogo quando o lead escolheu idioma no menu "Not from
      // Brazil?" E existe uma tradução salva para ele; sem isso, cai no
      // texto em português de sempre (comportamento de hoje, intacto).
      const { getTelegramUser } = await import("@/lib/telegramUsers");
      const idiomaLead = getTelegramUser(`${bot.id}_${sub.telegramUserId}`)?.language;
      const successMessageTraduzida =
        idiomaLead === "en"
          ? bot.successMessageEn?.trim()
          : idiomaLead === "es"
            ? bot.successMessageEs?.trim()
            : undefined;
      const botParaSucesso = successMessageTraduzida
        ? { ...bot, successMessage: successMessageTraduzida }
        : bot;

      try {
        if (isPackage) {
          // PACOTE (compra única): entrega o conteúdo, sem acesso VIP.
          // expiresAt = 0 marca "entregue" e faz a expiração ignorá-lo.
          sub.status = "active";
          sub.expiresAt = 0;
          sub.lastUpsellAt = Date.now();
          sub.upsellStepIndex = 0;
          saveSubscription(sub);

          const deliverable = plan?.deliverable?.trim();
          const msg = deliverable
            ? `✅ <b>Pagamento aprovado!</b>\n\n${deliverable}`
            : botParaSucesso.successMessage.replace(/{link_vip}/gi, "");
          await sendTelegramMessage(bot.botToken, String(sub.telegramUserId), msg, botoesEntregavel);
        } else {
          // ASSINATURA: gera o convite VIP com a duração REAL do plano.
          //
          // `createChatInviteLink` exige que o bot seja ADMINISTRADOR do
          // grupo com permissão de convidar por link. Quando não é, a
          // chamada falha — e antes esse erro subia para o catch lá de
          // baixo, que só escrevia no console: o cliente PAGAVA e não
          // recebia mensagem nenhuma, enquanto o painel mostrava a venda
          // como concluída. Agora a falha é isolada aqui, o acesso é
          // registrado do mesmo jeito e o cliente recebe um aviso em vez
          // de silêncio.
          let invite: { invite_link: string } | null = null;
          let erroConvite: string | null = null;
          try {
            invite = await createTelegramInviteLink(
              bot.botToken,
              bot.idVip,
              `VIP_${sub.telegramUserId}`,
            );
          } catch (e) {
            erroConvite = e instanceof Error ? e.message : "Falha ao gerar o convite do VIP.";
            console.error(
              `[hotdash] Convite VIP falhou (bot ${bot.id}, grupo ${bot.idVip}). ` +
                `O bot precisa ser ADMIN do grupo com permissão de convidar por link. Erro:`,
              erroConvite,
            );
          }
          // VITALÍCIO é `durationDays === 0`, e um `||` aqui o transformaria
          // em 30 dias — o cliente pagaria pelo vitalício e seria removido
          // do VIP um mês depois. Por isso a checagem é explícita.
          const durationDays = plan ? plan.durationDays : 30;
          sub.status = "active";
          // expiresAt = 0 significa "não expira": é o mesmo valor que os
          // pacotes usam, e a rotina de expiração já ignora (`expires_at > 0`).
          sub.expiresAt = durationDays > 0 ? Date.now() + durationDays * 24 * 60 * 60 * 1000 : 0;
          // A assinatura é gravada COM OU SEM convite: o cliente pagou, e o
          // acesso é dele. Sem link, o botão "Reenviar link" da lista de
          // assinantes resolve assim que o bot virar admin.
          if (invite) sub.inviteLink = invite.invite_link;
          sub.lastUpsellAt = Date.now();
          sub.upsellStepIndex = 0;
          saveSubscription(sub);

          if (invite) {
            // O link vai SEMPRE — no lugar do {link_vip} quando o texto o
            // tem, anexado no fim quando não tem — e sempre com o botão de
            // acesso. Antes, um texto salvo sem o marcador e sem rótulo de
            // botão fazia o cliente pagar e receber uma mensagem sem
            // caminho nenhum para o grupo.
            const { efeitoProps } = await import("@/lib/telegramEffects");
            const aprovada = buildAccessMessage(
              botParaSucesso,
              invite.invite_link,
              buttonStyleProps(bot, "access"),
              idiomaLead === "en" || idiomaLead === "es" ? idiomaLead : undefined,
            );
            await sendTelegramMessage(
              bot.botToken,
              String(sub.telegramUserId),
              aprovada.text,
              // A comemoração é justamente aqui: é a única mensagem do
              // funil que o cliente recebe DEPOIS de pagar.
              { ...aprovada.options, ...efeitoProps(bot.effectSuccess) },
            );
          } else {
            // Sem convite: o pior desfecho seria o silêncio. O cliente é
            // avisado de que o pagamento entrou e o acesso vem em seguida,
            // e o operador recebe um push para agir.
            await sendTelegramMessage(
              bot.botToken,
              String(sub.telegramUserId),
              "✅ <b>Pagamento aprovado!</b>\n\nSeu acesso está sendo liberado e o link chega " +
                "aqui em instantes. Se demorar, chame o suporte.",
            ).catch(() => {});
            try {
              const { sendPushEvent } = await import("@/lib/push");
              await sendPushEvent(
                "sale",
                "⚠️ Venda aprovada SEM link do VIP",
                "O bot não conseguiu gerar o convite — confira se ele é admin do grupo com permissão de convidar.",
                "/dashboard/telegram/bot",
              );
            } catch {
              /* push é aviso, não pode derrubar a entrega */
            }
          }

          // Entregável adicional (bônus da assinatura, ex.: WhatsApp).
          const deliverable = plan?.deliverable?.trim();
          if (deliverable) {
            await sendTelegramMessage(
              bot.botToken,
              String(sub.telegramUserId),
              deliverable,
              botoesEntregavel,
            );
          }

          // Assinatura com RENOVAÇÃO AUTOMÁTICA (cartão via Stripe —
          // checkout internacional OU "pagar no cartão" do lead brasileiro,
          // `mode: "subscription"`): dá ao cliente um jeito de cancelar
          // sozinho. Sem isso, quem quer parar de pagar e não sabe como
          // tende a contestar a cobrança no banco em vez de escrever pro
          // suporte — o botão evita virar chargeback. `stripeSubscriptionId`
          // nunca vem do PIX/SyncPay, mas PODE vir de um cartão brasileiro
          // (sem idioma salvo) — por isso o fallback em PT.
          if (sub.stripeSubscriptionId) {
            const textoManage =
              idiomaLead === "es"
                ? "🔁 Tu suscripción se renueva automáticamente cada ciclo. Puedes cancelarla cuando quieras, sin hablar con nadie:"
                : idiomaLead === "en"
                  ? "🔁 Your subscription renews automatically each cycle. You can cancel anytime, no need to talk to anyone:"
                  : "🔁 Sua assinatura renova automaticamente a cada ciclo. Você pode cancelar quando quiser, sem falar com ninguém:";
            const botaoManage =
              idiomaLead === "es" ? "⚙️ Gestionar suscripción" : idiomaLead === "en" ? "⚙️ Manage subscription" : "⚙️ Gerenciar assinatura";
            await sendTelegramMessage(bot.botToken, String(sub.telegramUserId), textoManage, {
              reply_markup: { inline_keyboard: [[{ text: botaoManage, callback_data: `manage_sub_${sub.id}` }]] },
            }).catch(() => {});
          }
        }

        // O aviso de venda no CANAL DE REGISTRO saiu a pedido — o recurso
        // não está em uso por ora, e o campo foi tirado da tela. A coluna
        // `id_registro` continua no banco de propósito: reativar é devolver
        // o campo na tela e este bloco. O alerta de venda no celular (push
        // do PWA, logo abaixo) não depende disso e continua valendo.
        // ENTREGA DO ORDER BUMP. Vai por último, depois do acesso
        // principal: o cliente comprou os dois, mas veio pelo plano — o
        // extra não pode chegar antes do que ele foi buscar.
        if ((sub.bumpCents || 0) > 0 && basePlan?.bump?.deliverable?.trim()) {
          const b = basePlan.bump;
          await sendTelegramMessage(
            bot.botToken,
            String(sub.telegramUserId),
            b.deliverable!.trim(),
            b.deliverableButtons?.length
              ? {
                  reply_markup: {
                    inline_keyboard: b.deliverableButtons.map((x) => [
                      { text: x.text, url: x.url },
                    ]),
                  },
                }
              : {},
          ).catch(() => {});
        }
      } catch (tErr) {
        console.error("Erro ao processar pagamento no Telegram:", tErr);
      }
    }
  }

  // Alerta de VENDA no celular (push do PWA). Fica FORA do fluxo do
  // Telegram de propósito: vale também para checkout externo, que não tem
  // inscrição vinculada. Vem depois da entrega ao cliente para nunca
  // atrasá-la, e num try/catch próprio — falha de push não pode derrubar
  // o webhook (o gateway reenviaria em loop).
  try {
    const { sendPushEvent } = await import("@/lib/push");
    const valStr = (transaction.amountCents / 100).toLocaleString("pt-BR", {
      style: "currency",
      // A moeda vem da PRÓPRIA transação (BRL no PIX, USD na Stripe) — um
      // valor em dólar formatado como se fosse real mentiria sobre quanto
      // entrou.
      currency: transaction.currency || "BRL",
    });
    const detalhe = [transaction.description, transaction.customer].filter(Boolean).join(" · ");
    await sendPushEvent(
      "sale",
      `💰 Venda aprovada — ${valStr}`,
      detalhe || "Pagamento confirmado.",
      "/dashboard",
    );
  } catch (pErr) {
    console.error("Erro ao enviar push de venda:", pErr);
  }
}
