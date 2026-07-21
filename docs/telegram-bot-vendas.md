# Bot de vendas do Telegram (substituição do ApexVips)

O Hot-Dash roda toda a operação de vendas no Telegram — o mesmo que o ApexVips
fazia: recebe o lead no `/start`, apresenta ofertas com downsell/upsell, gera PIX
na SyncPay, confirma o pagamento e coloca o pagante no grupo VIP; aceita novos
leads no grupo de prévias; e expira/reconduz o VIP vencido.

A configuração fica em **Telegram → Bot de vendas** (o menu Telegram tem dois
submenus: *Automação de postagens* e *Bot de vendas*). Token e IDs dos grupos são
compartilhados com a *Automação de postagens*.

## Passo a passo de migração

1. **Reutilize o mesmo bot** do ApexVips (mesmo token do BotFather). Assim o
   cutover é instantâneo: ao registrar o webhook aqui, o do ApexVips é
   substituído automaticamente (um bot só tem um webhook).
2. O bot precisa ser **admin** dos grupos **VIP** e **Prévias**, com permissão de
   *adicionar/aprovar membros*.
3. Configure os grupos para **exigir aprovação** de novos membros (ou use links
   de convite com “solicitar entrada”). Sem isso, o Telegram não envia o evento
   `chat_join_request` e a aprovação automática não roda.
4. Em **Automação de postagens**: informe o **Token do Bot** e os **IDs** dos
   grupos VIP e Prévias e salve. (Isso já registra o webhook.)
5. Em **Configurações → Pagamentos**: preencha `client_id`/`client_secret` da
   SyncPay. O `webhook_url` (postback) é enviado automaticamente a cada cobrança.
6. Em **Telegram → Bot de vendas**:
   - **Conexão do bot**: confira o status do webhook (deve ficar *ativo*); se
     preciso, clique em **Registrar / atualizar webhook**.
   - **Mensagens**: boas-vindas (`{nome}`), sucesso (`{link_vip}`), suporte e
     canal de registro/vendas.
   - **Ofertas/Planos**: nome, preço, duração (dias).
   - **Funis**: etapas de downsell (não pagou) e upsell (pós-venda).
   - **Botões personalizados** (opcional).
7. Em **Editar Perfil** da modelo, preencha o **Link do Bot/Assinatura VIP**
   (usado como CTA nos posts de prévias).
8. Aponte o link das prévias (no slt.bio/Instagram) para o convite do grupo de
   prévias — o bot passa a aceitar os novos leads automaticamente.

## Teste ponta a ponta

Crie um plano de **R$ 1**, dê `/start` no bot, gere o PIX e pague:
o pagamento confirma (webhook SyncPay), a assinatura ativa, chega o link do VIP e
a entrada é aprovada; o canal de registro recebe a notificação. Depois valide o
downsell (lead que não paga), o upsell (assinante) e a expiração.

## Segurança

O webhook do bot é registrado com um `secret_token` (derivado do
`SESSION_SECRET`), validado no header `X-Telegram-Bot-Api-Secret-Token` a cada
update. O webhook da SyncPay é validado por token na URL.

> Observação: assinantes VIP que já existiam no ApexVips não estão no banco do
> Hot-Dash, então não são expirados automaticamente. Se quiser que o Hot-Dash
> gerencie a expiração deles, registre as assinaturas ativas atuais.
