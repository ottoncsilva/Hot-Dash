# Hot Dash

Plataforma modular (uso próprio) para gestão de perfis de influencers de IA.
Cada ferramenta é um **módulo** dentro de um painel único, com login, tema
escuro premium e suporte a instalação como **app no iPhone** (PWA).

## Stack

- **Next.js 14** (App Router) + **React** + **TypeScript**
- **Tailwind CSS** + **Framer Motion** (interface e animações)
- **Firebase Authentication** (login por email/senha)
- **PWA** (instalável na tela de início do iPhone)
- **Docker** (deploy no EasyPanel / Hostinger)

## Módulos

| Módulo | Status | Descrição |
|---|---|---|
| **Limpar Metadados** | ✅ Ativo | Remove EXIF, GPS e rastros de IA de fotos (`exiftool`) e vídeos (`ffmpeg`). Nada é armazenado. |
| Gestão de Perfis | 🔜 Em breve | Cadastro das personagens e redes sociais. |
| Cofre de Senhas | 🔜 Em breve | Logins e senhas com criptografia. |

## Rodando localmente

```bash
npm install
cp .env.example .env.local   # preencha as chaves do Firebase
npm run dev                  # http://localhost:3000
```

> O módulo de metadados precisa de `exiftool` e `ffmpeg` instalados na máquina.
> No Linux: `sudo apt install libimage-exiftool-perl ffmpeg`.
> Em produção (Docker) eles já vêm na imagem — não precisa instalar nada.

## Configurando o Firebase

1. Crie um projeto em <https://console.firebase.google.com>.
2. **Authentication → Sign-in method → Email/senha → Ativar.**
3. **Authentication → Users → Adicionar usuário** (crie seu login).
4. **Configurações do projeto → Seus apps → App da Web** e copie as chaves
   para `.env.local` (dev) ou para as variáveis do EasyPanel (produção).

Variáveis necessárias (ver `.env.example`):

```
NEXT_PUBLIC_FIREBASE_API_KEY
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
NEXT_PUBLIC_FIREBASE_PROJECT_ID
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
NEXT_PUBLIC_FIREBASE_APP_ID
```

## Deploy no EasyPanel (Hostinger)

1. Suba este repositório no GitHub.
2. No EasyPanel, crie um **App** apontando para o repositório (branch desejada).
3. Build type: **Dockerfile** (já incluso na raiz).
4. Em **Environment**, adicione as variáveis `NEXT_PUBLIC_FIREBASE_*` acima.
5. Porta do container: **3000**.
6. Deploy. A cada `push` no GitHub, o EasyPanel rebuilda automaticamente.

> **Uploads grandes:** se for limpar vídeos grandes, aumente o limite de body
> do proxy (Nginx/Traefik) no EasyPanel e a variável `NEXT_PUBLIC_MAX_UPLOAD_MB`.

## Instalar como app no iPhone

Abra o site no **Safari** → botão **Compartilhar** → **Adicionar à Tela de
Início**. O app abre em tela cheia, com ícone próprio.

## Estrutura

```
src/
  app/
    api/metadata/clean/   # Módulo 1: limpeza de metadados (servidor)
    dashboard/            # Painel (protegido por login)
      metadata/           # UI do limpador de metadados
    login/                # Tela de login
  components/             # Componentes compartilhados
  context/                # AuthContext (Firebase)
  lib/                    # Inicialização do Firebase
public/
  icons/                  # Ícones do PWA
  manifest.webmanifest    # Manifesto do PWA
  sw.js                   # Service worker
```
