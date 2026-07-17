FROM python:3.11-slim

# libGL/glib são exigidos pelo OpenCV (dependência do NudeNet).
RUN apt-get update \
    && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Pré-carrega os pesos do NudeNet na imagem para o primeiro request não
# pagar o download/inicialização.
RUN python -c "from nudenet import NudeDetector; NudeDetector()"

COPY app.py .

EXPOSE 8000

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
