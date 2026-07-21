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

## Outras abas (a detalhar com as próximas telas)
- **Código de Venda** ⛔ · **Aprovação Automática** (config) 🟡 (temos VIP+prévias)
- **Captação de Leads** ⛔ · **Webhook** (config própria) 🟡
- **Mailing** (disparo em massa) ⛔ · **Trackeamento** (rastreio/atribuição) ⛔
- **Redirecionadores** (links de redirecionamento) ⛔
- **Ranking** / **Premiações** (gamificação de afiliados/leads) ⛔
- **Variáveis** / **Share Key** / **Config Key** (import/export de config) ⛔

## Prioridade sugerida (a validar com o usuário)
1. Alta (impacto direto em conversão): Planos Pacotes/Order Bump, Variação de
   Preço, QR Code no PIX, múltiplas mídias + áudio de boas-vindas, config
   avançada por etapa do funil (gatilho/destinatários/planos/botões).
2. Média: CTA, Delay entre mensagens, "Iniciar em qualquer texto",
   Captação de Leads, Mailing.
3. Baixa/eventual: Anti-clonagem, Ranking/Premiações, Trackeamento,
   Redirecionadores, Variáveis/Keys.

> Documento vivo — atualizar conforme o usuário envia mais telas do ApexVips.
