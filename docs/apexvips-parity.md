# ApexVips — inventário de recursos (spec de paridade)

Levantamento dos recursos do ApexVips a partir das telas de configuração do bot,
para orientar a expansão do **Bot de vendas** do Hot-Dash. Este documento lista
**capacidades** (o que o painel oferece) — não guarda tokens, IDs reais de grupo
nem o texto de vendas verbatim.

Legenda: ✅ já existe no Hot-Dash · 🟡 parcial · ⛔ ainda não existe.

## Estrutura do painel (abas)
- **Editar Bot**, **Downsell**, **Upsell**, **Código de Venda**, **Aprovação
  Automática**, **Captação de Leads**, **Webhook**.
- Topo: Perfil Bot, **Variáveis**, **Share Key**, **Config Key**.
- Menu lateral: Dashboard, Ranking, Premiações, Estatísticas, Criar Bot,
  Configurar Bot, **Mailing**, Usuários, **Trackeamento**, **Redirecionadores**,
  Pagamentos, Minha Conta, Suporte.

## Editar Bot
- **Proteção Anti-Clonagem** (toggle). ⛔
- **Iniciar em Qualquer Texto** (responder a qualquer mensagem, não só `/start`). ⛔
- Username (getMe) 🟡 · Token 🟡.
- **Mensagem Inicial** (boas-vindas) com contador 0/4096. ✅
- **Mídia de boas-vindas**: múltiplas (Mídia 1/2/3), PNG/JPEG/JPG/MP4 até 25MB,
  com **Forma de envio** (Agrupadas/álbum vs separadas). No Hot-Dash é 1 mídia
  aleatória por etiqueta. 🟡 (falta múltiplas + modo de envio)
- **Áudio de boas-vindas** (OGG até 10MB). ⛔
- **ID VIP** ✅ · **ID REGISTRO** (notificações de venda + habilita envio de
  mídia) ✅ · **Link do VIP** gerado automaticamente ✅ · **Suporte Bot** ✅.

## Planos
- **Planos Assinaturas** (recorrência: Semanal/Mensal/Anual) — nome, valor,
  duração. ✅ (temos nome/preço/dias)
- **Planos Pacotes** (compra única, campo **Entregável**). ⛔
- **Order Bump** (oferta adicional atrelada a um plano). ⛔

## Botões e CTA
- **Botões Personalizados** (texto, link, **tipo**). ✅ (falta "tipo")
- **Botão de Chamada para Ação (CTA)** (liga/desliga + config). ⛔

## Pós-venda / acesso
- **Mensagem de Acesso VIP** (sucesso, com `{link}` e opção de botões). ✅

## Preço e pagamento
- **Variação de Preço** (varia o valor em X centavos p/ cima ou p/ baixo — deixa
  o PIX único e evita colisão de valores). ⛔
- **Delay Entre Mensagens** (liga/desliga; espaça envios). ⛔
- **Personalização do Pagamento**: exibição do **QR Code PIX** (mostrar QR como
  imagem/botão, além do copia-e-cola). ⛔ (hoje só copia-e-cola)

## Downsell (aba dedicada)
- **Downsell Ativo** (toggle). ✅ (via funil)
- Regra: só quem deu `/start` pela 1ª vez recebe (anti-spam). 🟡
- Lista de **Mensagens** (Duplicar/Excluir, colapsáveis), por mensagem:
  - Texto (contador /4096) ✅
  - **Tempo** de espera ✅ · **Desconto** % ✅
  - **Modo Botões** (ex.: "Planos globais: Assinaturas + Pacotes" vs planos
    específicos da mensagem) ⛔
  - **Gatilho** (ex.: "No /start (1ª entrada)") ⛔
  - **Destinatários** (ex.: "Novos (nunca compraram)") 🟡
  - **Mídia** (PNG/JPEG/MP4) + **Áudio** (OGG) por mensagem 🟡 (temos por etiqueta)
  - **Planos Assinaturas/Pacotes da Mensagem** (override por etapa) ⛔
  - **Botões da Mensagem** (override por etapa) ⛔

## Upsell (aba dedicada)
- **Upsell Ativo** (toggle). ✅ (via funil)
- Enviado automaticamente após qualquer compra. ✅
- **Modo de Envio** (ex.: "Padrão — envia todas as mensagens após cada compra"). ⛔
- Mensagens com Tempo, **Destinatários** (ex.: "Todos os cadastrados"),
  mídia/áudio, planos e botões por mensagem (igual downsell). 🟡

## Aprovação Automática (aba dedicada)
- Toggle **Aprovação Automática Ativa** + **múltiplos canais** ("Adicionar Novo
  Canal"). Por canal: ID do canal/grupo, **Mensagem** enviada ao aprovar,
  **Tempo** (Imediato), **Ação** (ex.: "Aprovar e Enviar Mensagem"), **Modo de
  Botão** (globais do bot), **mídia/áudio** anexados e **botões próprios**.
- No Hot-Dash: aprovamos entrada nas prévias (sem mensagem) e no VIP (por
  assinatura). 🟡 Falta: mensagem ao aprovar + múltiplos canais configuráveis.

## Webhook de SAÍDA (aba dedicada)
- Cadastro de webhooks de saída (URL). "3 falhas consecutivas → removido".
- Eventos: **user_joined**, **payment_created**, **payment_approved**. ⛔
- Payload rico: `customer` (chat_id, username, phone, full_name, tax_id),
  `origin` (ip, país, estado, cidade, user_agent), `transaction` (sale_code,
  plan_name/value/duration, payment_pointer, payment_platform, payment_method),
  `tracking` (click_id, slug, **UTMs** source/medium/campaign/term/content,
  utm_id). → integração externa (n8n) + atribuição de anúncios.

## Dashboard do bot (ApexVips)
- Cartões **Hoje / Mês**: nº de vendas + R$. ⛔ (temos Financeiro geral)
- **Histórico de Vendas** (gráfico 7D/30D). ⛔
- **Usuários**: Hoje/Mês/Ativos/Totais/Bloqueados/Assinaturas. 🟡
- **Log de Atividade** em tempo real (iniciou conversa / gerou PIX de R$X). ⛔
- **Conversão de Usuário** (% que compraram), **Conversão de Pagamento**
  (% PIX gerados que foram pagos), **Tempo Médio** (start→compra), **Ticket
  Médio**, **Códigos de Venda** (top 5 por faturamento). ⛔

## SyncPay — chaves de API
- Cria chave com **Client ID (pública)** + **Client Secret (privada)**, com
  **permissões por escopo**: Consulta, Venda, Saque, Rastreio. Suporta várias
  chaves nomeadas. Integração "fácil para IAs" (contexto em /llms.txt).
- No Hot-Dash já usamos client_id/secret (auth-token → cash-in). ✅
  → Só garantir a chave com permissão **Venda + Consulta** nas Configurações.
- ⚠️ **Segurança:** nunca versionar as credenciais; rotacionar chaves expostas.

## Outras abas (a detalhar)
- **Código de Venda** (identificador da venda/atribuição) 🟡 (temos providerRef)
- **Captação de Leads** ⛔ · **Mailing** (disparo em massa) ⛔
- **Trackeamento** (rastreio/atribuição/UTM) ⛔ · **Redirecionadores** (smart
  links; hoje o slt.bio cobre) ⛔
- **Ranking** / **Premiações** (gamificação) ⛔
- **Variáveis** / **Share Key** / **Config Key** (import/export de config) ⛔

---

# Resumo: necessário para operar × melhorias

## A. Já pronto (não precisa fazer)
Bot `/start` com oferta, planos, botões e suporte; PIX na SyncPay; confirmação →
convite VIP → aprovação; auto-aprovação nas prévias; funis downsell/upsell;
expiração do VIP; mensagens de boas-vindas/sucesso; canal de registro; painel de
assinantes; **liga/desliga da operação** (cutover). ✅

## B. Necessário para operar 100% sem ApexVips
1. ✅ **QR Code do PIX** no bot (imagem + copia-e-cola) — feito (lib `qrcode`).
2. ✅ **Mensagem ao aprovar** entrada nas prévias (opcional, no privado). Falta a
   versão multi-canal do ApexVips (melhoria).
3. ✅ **Dashboard de vendas do bot** (versão simples): vendas hoje/mês, ticket
   médio, assinantes VIP, PIX pendentes (reusa `overview`). Log de atividade em
   tempo real = melhoria.
4. ✅ **Planos Pacotes** (compra única + entregável) — feito, aparecem como
   ofertas no bot ao lado das assinaturas; ao pagar, entrega o conteúdo sem VIP.
   (Bônus: corrigido o bug que fixava toda assinatura em 30 dias — agora usa a
   duração real do plano via `plan_id`.)
5. **Chave SyncPay com escopo Venda + Consulta** configurada (config, não código).
6. Validar em produção o **CPF placeholder** no PIX (decisão: aceita).

## C. Melhorias (aumentam faturamento/gestão; não bloqueiam)
- **Planos Pacotes** (compra única) + **Order Bump**.
- **Variação de preço** (PIX com valor único).
- **Múltiplas mídias + modo de envio + áudio** de boas-vindas.
- **Config avançada por etapa de funil**: gatilho, destinatários, planos/botões/
  mídia por etapa, modo de botões.
- **Trackeamento/UTM + Webhooks de saída** (atribuição de anúncios, n8n).
- **Métricas avançadas** (conversão de usuário/pagamento, tempo médio, ticket
  médio, top códigos de venda).
- **Captação de Leads**, **Mailing** (disparo em massa), **Botão CTA**,
  **Delay entre mensagens**, **"Iniciar em qualquer texto"**.
- **Redirecionadores** (smart links), **Ranking/Premiações**,
  **Anti-clonagem**, **Variáveis/Share Key/Config Key**.

> Documento vivo — atualizar conforme o usuário envia mais telas do ApexVips.

## Prioridade sugerida (a validar com o usuário)
1. Alta (impacto direto em conversão): Planos Pacotes/Order Bump, Variação de
   Preço, QR Code no PIX, múltiplas mídias + áudio de boas-vindas, config
   avançada por etapa do funil (gatilho/destinatários/planos/botões).
2. Média: CTA, Delay entre mensagens, "Iniciar em qualquer texto",
   Captação de Leads, Mailing.
3. Baixa/eventual: Anti-clonagem, Ranking/Premiações, Trackeamento,
   Redirecionadores, Variáveis/Keys.

> Documento vivo — atualizar conforme o usuário envia mais telas do ApexVips.
