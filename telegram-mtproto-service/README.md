# Hot Dash · Chip do Telegram (MTProto)

O LTV do Telegram fala pela **conta real da modelo** — o chip dela —, não por
bot. Um bot não tem histórico, aparece marcado como bot e o lead percebe na
hora. Conta real só existe via **MTProto**, que exige conexão aberta o tempo
todo: não cabe numa rota do Next (o bot de vendas funciona por webhook justamente
por isso). Daí o container separado.

O painel fala com este serviço por HTTP; as mensagens que chegam voltam para o
painel por webhook.

## API do Telegram (obrigatória)

Diferente da Bot API, MTProto exige credenciais de aplicativo. Pegue as suas em
<https://my.telegram.org> → **API development tools**: saem um `api_id` e um
`api_hash`. São por conta de desenvolvedor, não por chip — um par serve para
todas as modelos.

## Variáveis de ambiente

| Variável | Obrigatória | Para que serve |
| --- | --- | --- |
| `TELEGRAM_API_ID` | sim | `api_id` do my.telegram.org |
| `TELEGRAM_API_HASH` | sim | `api_hash` do my.telegram.org |
| `CHIP_API_TOKEN` | sim | Segredo compartilhado com o painel. Sem ele, qualquer um manda mensagem pelo chip |
| `WEBHOOK_URL` | sim | `https://seu-painel/api/webhooks/telegram-chip` |
| `PORT` | não | Padrão 8100 |
| `SESSIONS_DIR` | não | Onde ficam as sessões. Padrão `/data` |

## Subir

```bash
docker compose up -d telegram-chip
```

Depois informe a URL e o token em **Configurações → Conexão com IA → Chip do
Telegram**. Com a URL em branco, o LTV do Telegram fica desligado.

## O volume não é opcional

As sessões ficam em `/data`. Perder o volume significa **pedir o código do
Telegram de novo para cada modelo** — e pedir código demais é o caminho curto
para o chip levar bloqueio. O painel também guarda a sessão cifrada no banco e
a reenvia quando o serviço não a tem, mas o volume é o caminho normal.

## Endpoints

Todos exigem `Authorization: Bearer $CHIP_API_TOKEN`, menos `/health`.

| Método | Rota | O que faz |
| --- | --- | --- |
| `GET` | `/health` | Vivo? Quantas contas conectadas? |
| `POST` | `/sessions/start` | `{accountId, phone}` → manda o código para o telefone |
| `POST` | `/sessions/confirm` | `{accountId, code, password?}` → devolve a sessão. Responde 409 `password_needed` quando a conta tem verificação em duas etapas |
| `POST` | `/sessions/:id/status` | Conectado? Qual número? |
| `POST` | `/sessions/:id/send` | `{peerRef, text}` ou `{peerRef, mediaUrl, mediaName, voice?}` |
| `POST` | `/sessions/:id/typing` | Mostra "digitando…" |
| `DELETE` | `/sessions/:id` | Encerra a sessão no Telegram e apaga do disco |

## O risco que não dá para esconder

Automação em conta real é o que o Telegram mais bloqueia. O que segura o chip
vivo são os controles do painel, em **Inteligência e segurança**: ritmo humano
nas respostas, limite diário de mensagens e "só responder quem falar primeiro".
Não são enfeite. Comece com um número descartável antes de pôr o chip bom.
