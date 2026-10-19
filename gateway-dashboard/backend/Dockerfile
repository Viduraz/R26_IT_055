# gateway-dashboard/backend/Dockerfile
# Build context: project root (so shared/ is accessible)
FROM python:3.10-slim

RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY shared/ ./shared/

COPY gateway-dashboard/backend/requirements.txt ./gateway-dashboard/backend/requirements.txt
RUN pip install --no-cache-dir -r gateway-dashboard/backend/requirements.txt

COPY gateway-dashboard/backend/ ./gateway-dashboard/backend/

WORKDIR /app/gateway-dashboard/backend

ENV PYTHONPATH=/app

EXPOSE 8005

CMD ["python", "run.py"]
