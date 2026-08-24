# anomaly-detection/backend/Dockerfile
# Build context: project root (so shared/ is accessible)
FROM python:3.10-slim

RUN apt-get update && apt-get install -y curl libgl1 libglib2.0-0 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY shared/ ./shared/

COPY anomaly-detection/backend/requirements.txt ./anomaly-detection/backend/requirements.txt
RUN pip install --no-cache-dir -r anomaly-detection/backend/requirements.txt

COPY anomaly-detection/backend/ ./anomaly-detection/backend/

WORKDIR /app/anomaly-detection/backend

ENV PYTHONPATH=/app

EXPOSE 8003

# ML model weights (lstm_weights.pt, ae_weights.pt) are mounted via volume at runtime.
# See docker-compose.yml volumes section.
CMD ["python", "run.py"]
