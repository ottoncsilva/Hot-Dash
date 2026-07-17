"""
Microserviço de detecção de nudez (NudeNet) para o Hot Dash.

Expõe uma API HTTP simples que recebe uma imagem e devolve as regiões
explícitas detectadas (caixas rotuladas por parte do corpo). O backend do
Hot Dash (rota /api/ai/censor) chama este serviço; o navegador nunca fala
com ele diretamente.

Rodar local:
    pip install -r requirements.txt
    uvicorn app:app --host 0.0.0.0 --port 8000

Ou via Docker (ver Dockerfile / README.md).
"""

import os
import tempfile

import cv2
from fastapi import Depends, FastAPI, File, Header, HTTPException, UploadFile
from nudenet import NudeDetector

# O modelo (320n, ~ leve) já vem embutido no pacote pip do NudeNet — a
# primeira instância carrega os pesos em memória e é reaproveitada em todas
# as requisições (o detector não tem estado por requisição).
detector = NudeDetector()

app = FastAPI(title="Hot Dash · NudeNet", version="1.0.0")

# Token opcional. Se NUDENET_API_KEY estiver definido no ambiente do serviço,
# toda chamada precisa mandar o mesmo valor no header X-API-Key.
API_KEY = os.environ.get("NUDENET_API_KEY", "").strip()

# Formatos que o OpenCV (usado pelo NudeNet) consegue decodificar.
_ALLOWED_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}


def require_key(x_api_key: str | None = Header(default=None)) -> None:
    if API_KEY and x_api_key != API_KEY:
        raise HTTPException(status_code=401, detail="chave inválida")


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.post("/detect", dependencies=[Depends(require_key)])
async def detect(file: UploadFile = File(...)) -> dict:
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="arquivo vazio")

    suffix = os.path.splitext(file.filename or "")[1].lower()
    if suffix not in _ALLOWED_SUFFIXES:
        suffix = ".jpg"

    # O NudeDetector.detect() recebe um caminho de arquivo, então gravamos o
    # upload num arquivo temporário e removemos logo depois.
    tmp_path = ""
    width = 0
    height = 0
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp.write(data)
            tmp_path = tmp.name
        img = cv2.imread(tmp_path)
        if img is None:
            raise HTTPException(status_code=400, detail="imagem inválida ou não suportada")
        height, width = img.shape[:2]
        raw = detector.detect(tmp_path)
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001 — devolve erro legível ao caller
        raise HTTPException(status_code=500, detail=f"falha na detecção: {exc}")
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.unlink(tmp_path)

    # NudeNet devolve [{class, score, box:[x, y, w, h]}] em pixels.
    detections = [
        {
            "label": d.get("class"),
            "score": float(d.get("score", 0)),
            "x": int(d["box"][0]),
            "y": int(d["box"][1]),
            "w": int(d["box"][2]),
            "h": int(d["box"][3]),
        }
        for d in raw
        if d.get("box") and len(d["box"]) == 4
    ]
    return {"width": int(width), "height": int(height), "detections": detections}
