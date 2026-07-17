# Hot Dash · Serviço de detecção NudeNet

Microserviço HTTP que detecta partes explícitas em imagens usando
[NudeNet](https://github.com/notAI-tech/NudeNet) e devolve caixas rotuladas
por parte do corpo. O Hot Dash (rota `/api/ai/censor`) consome este serviço
para a censura automática por IA; o navegador nunca fala direto com ele.

## Por que um serviço separado?

O NudeNet é um modelo de visão (ONNX/Python) — não roda dentro do Next.js.
Ele fica isolado num container próprio e o app o consome via HTTP. Assim a
detecção pode escalar/atualizar sem tocar no app.

## Subir com Docker

```bash
cd nudenet-service
docker build -t hotdash-nudenet .
docker run -d --name hotdash-nudenet -p 8000:8000 \
  -e NUDENET_API_KEY=um-token-secreto \
  hotdash-nudenet
```

## Subir tudo junto (mais fácil)

Na raiz do projeto há um `docker-compose.yml` que sobe o app **e** este
serviço já conectados:

```bash
docker compose up -d --build
```

Nesse caso não precisa configurar mais nada — o app já fala com
`http://nudenet:8000`.

## No EasyPanel (passo a passo)

1. **Crie um serviço** a partir deste diretório (`nudenet-service/`, tipo
   *Dockerfile*). Porta interna **8000**. (Opcional: defina
   `NUDENET_API_KEY` no serviço se quiser exigir token.)
2. Anote o **domínio interno** que o EasyPanel dá ao serviço
   (algo como `http://meuprojeto_nudenet:8000`).
3. No **Hot Dash**, abra **Configurações → Conexão com IA → NudeNet**,
   marque *ativar*, cole a URL interna (e o token, se usou um) e salve.
   A luz de status fica **verde** quando conecta. Pronto — sem redeploy.

> Alternativa: em vez da tela de IA, dá para definir `NUDENET_URL`
> (e `NUDENET_API_KEY`) como variáveis de ambiente **no serviço do app** e
> dar *redeploy*. A configuração pela tela tem prioridade.

## API

### `GET /health`
Retorna `{"status":"ok"}`.

### `POST /detect`
`multipart/form-data` com o campo `file` (a imagem). Header `X-API-Key`
obrigatório quando `NUDENET_API_KEY` está definido.

Resposta:

```json
{
  "detections": [
    { "label": "FEMALE_BREAST_EXPOSED", "score": 0.87, "x": 120, "y": 80, "w": 90, "h": 95 }
  ]
}
```

Coordenadas em **pixels** da imagem enviada. O mapeamento rótulo → parte do
corpo (seios, vagina, pênis, bunda, ânus) é feito no lado do Hot Dash
(`src/lib/nudenet.ts`).

## Rótulos do NudeNet usados

| Rótulo NudeNet             | Parte      |
| -------------------------- | ---------- |
| `FEMALE_BREAST_EXPOSED`    | seios      |
| `FEMALE_GENITALIA_EXPOSED` | vagina     |
| `MALE_GENITALIA_EXPOSED`   | pênis      |
| `BUTTOCKS_EXPOSED`         | bunda      |
| `ANUS_EXPOSED`             | ânus       |

Rótulos `*_COVERED` (partes cobertas) são ignorados por padrão.
