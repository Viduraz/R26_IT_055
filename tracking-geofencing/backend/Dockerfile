# tracking-geofencing/backend/Dockerfile
# Build context: project root (so shared/ is accessible)
FROM python:3.10-slim

RUN apt-get update && apt-get install -y curl libgl1 libglib2.0-0 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY shared/ ./shared/

COPY tracking-geofencing/backend/requirements.txt ./tracking-geofencing/backend/requirements.txt
RUN pip install --no-cache-dir -r tracking-geofencing/backend/requirements.txt

COPY tracking-geofencing/backend/ ./tracking-geofencing/backend/

WORKDIR /app/tracking-geofencing/backend

ENV PYTHONPATH=/app

EXPOSE 8002

CMD ["python", "run.py"]
