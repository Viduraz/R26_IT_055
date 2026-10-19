# face-verification/backend/Dockerfile
# Build context: project root (so shared/ is accessible)
FROM python:3.10-slim

RUN apt-get update && apt-get install -y curl libgl1 libglib2.0-0 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY shared/ ./shared/

COPY face-verification/backend/requirements.txt ./face-verification/backend/requirements.txt
RUN pip install --no-cache-dir -r face-verification/backend/requirements.txt

COPY face-verification/backend/ ./face-verification/backend/

WORKDIR /app/face-verification/backend

ENV PYTHONPATH=/app

EXPOSE 8001

CMD ["python", "run.py"]
