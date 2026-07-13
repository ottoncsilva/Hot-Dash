# Hot Dash

Plataforma modular (uso próprio) para gestão de perfis de influencers de IA.
Cada ferramenta é um **módulo** dentro de um painel único, com login, tema
escuro premium e suporte a instalação como **app no iPhone** (PWA).

**100% na sua VPS** — sem serviços externos: banco, mídia e login ficam todos
no seu servidor.

## Stack

- **Next.js 14** (App Router) + **React** + **TypeScript**
- **Tailwind CSS** + **Framer Motion** (interface e animações)
- **SQLite** (`better-sqlite3`) — banco em arquivo no disco da VPS
- **Login por variáveis de ambiente** + sessão em cookie assinado (HMAC)
- **PWA** (instalável na tela de início do iPhone)
- **Docker** (deploy no EasyPanel / Hostinger)

## Módulos

| Módulo | Status | Descrição |
|---|---|---|
| **Dashboard** | ✅ Ativo | Visão geral: métricas e atalhos dos módulos. |
| **Modelos** | ✅ Ativo | Personagens de IA com foto, redes sociais e credenciais (senhas criptografadas AES-256). |
| **Biblioteca de Mídia** | ✅ Ativo | Fotos e vídeos vinculados ao modelo, metadados removidos no upload, download no celular. |
| **Pagamentos** | ✅ Ativo | Dashboard de vendas/receita + cobrança PIX. Provedor SyncPay (chaves nas Configurações). |
| **Limpar Metadados** | ✅ Ativo | Remove EXIF, GPS e rastros de IA de fotos (`exiftool`) e vídeos (`ffmpeg`) avulsos. |
| **Configurações** | ✅ Ativo | Ordem/visibilidade do menu e chaves dos provedores de pagamento. |

Visual **monocromático high-tech** (preto/branco/cinza), tipografia Space
Grotesk + mono, ícones de linha próprios.

## Arquitetura de segurança

- **Login:** e-mail/senha nas variáveis `AUTH_EMAIL` / `AUTH_PASSWORD`. A
  sessão é um **cookie HttpOnly assinado** (HMAC-SHA256) — não há senha no
  código nem no banco.
- **Gateway seguro:** todo dado passa por rotas de API no servidor, protegidas
  pela sessão. O navegador nunca acessa o banco diretamente.
- **Senhas das contas:** cifradas com **AES-256-GCM** antes de ir ao banco.
  A chave-mestra (`APP_ENCRYPTION_KEY`) fica só na VPS.
- **Banco e mídia:** SQLite + arquivos no **disco da VPS** (`MEDIA_STORAGE_DIR`),
  servidos apenas para usuários autenticados.

## Rodando localmente

```bash
npm install
cp .env.example .env.local   # preencha as variáveis (veja abaixo)
npm run dev                  # http://localhost:3000
```

Gere os segredos:

```bash
openssl rand -base64 32   # SESSION_SECRET
openssl rand -base64 32   # APP_ENCRYPTION_KEY
```

Defina no `.env.local`:

```
AUTH_EMAIL=seu@email.com
AUTH_PASSWORD=suaSenhaForte
SESSION_SECRET=<gerado acima>
APP_ENCRYPTION_KEY=<gerado acima>
MEDIA_STORAGE_DIR=./data          # em produção: /app/data
```

> O módulo de metadados precisa de `exiftool` e `ffmpeg` na máquina.
> No Linux: `sudo apt install libimage-exiftool-perl ffmpeg`.
> Em produção (Docker) eles já vêm na imagem — não precisa instalar nada.

> ⚠️ **Nunca troque a `APP_ENCRYPTION_KEY` depois de cadastrar senhas** — as
> senhas já salvas ficariam ilegíveis. Guarde-a em local seguro.

## Deploy no EasyPanel (Hostinger)

1. Suba este repositório no GitHub.
2. No EasyPanel, crie um **App** apontando para o repositório (branch `main`).
3. Build type: **Dockerfile** (já incluso na raiz).
4. Em **Environment**, adicione as variáveis do `.env.example`
   (`AUTH_EMAIL`, `AUTH_PASSWORD`, `SESSION_SECRET`, `APP_ENCRYPTION_KEY`).
5. Porta do container: **3000**.
6. **Monte um volume persistente** apontando para `/app/data` (o banco SQLite e
   a mídia ficam aí — sem o volume, os dados somem a cada deploy).
7. Deploy. A cada `push` no GitHub, o EasyPanel rebuilda automaticamente.

> **Uploads grandes:** para vídeos grandes, aumente o limite de body do proxy
> (Nginx/Traefik) no EasyPanel e a variável `NEXT_PUBLIC_MAX_UPLOAD_MB`.

## Instalar como app no iPhone

Abra o site no **Safari** → botão **Compartilhar** → **Adicionar à Tela de
Início**. O app abre em tela cheia, com ícone próprio.

## Estrutura

```
src/
  app/
    api/
      auth/               # login, logout, sessão (cookie)
      metadata/clean/     # Módulo 1: limpeza de metadados
      profiles/           # Módulo 2: perfis + contas (CRUD)
    dashboard/
      metadata/           # UI do limpador de metadados
      profiles/           # UI de perfis (lista + detalhe)
    login/                # Tela de login
  components/             # Componentes compartilhados
  context/                # AuthContext (sessão por cookie)
  lib/
    db.ts                 # SQLite (banco na VPS)
    profiles.ts           # Camada de dados dos perfis
    crypto.ts             # AES-256-GCM (senhas)
    session.ts            # Cookie de sessão assinado
    storage.ts            # Arquivos no disco da VPS
    metadata.ts           # exiftool / ffmpeg
public/
  icons/                  # Ícones do PWA
  manifest.webmanifest    # Manifesto do PWA
  sw.js                   # Service worker
```
