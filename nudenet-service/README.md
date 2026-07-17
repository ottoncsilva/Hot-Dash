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

No EasyPanel: crie um serviço a partir deste diretório (Dockerfile), exponha
a porta 8000 e defina `NUDENET_API_KEY`.

## Configurar o Hot Dash

No `.env` do app (não neste serviço):

```
NUDENET_URL=http://hotdash-nudenet:8000
NUDENET_API_KEY=um-token-secreto   # o mesmo valor acima
```

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
