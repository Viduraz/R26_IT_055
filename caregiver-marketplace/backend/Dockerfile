# caregiver-marketplace/backend/Dockerfile
# Build context: project root (so shared/ is accessible)
FROM python:3.10-slim

RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY shared/ ./shared/

COPY caregiver-marketplace/backend/requirements.txt ./caregiver-marketplace/backend/requirements.txt
RUN pip install --no-cache-dir -r caregiver-marketplace/backend/requirements.txt

COPY caregiver-marketplace/backend/ ./caregiver-marketplace/backend/

WORKDIR /app/caregiver-marketplace/backend

ENV PYTHONPATH=/app

EXPOSE 8006

CMD ["python", "run.py"]
