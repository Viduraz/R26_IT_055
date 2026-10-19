# auth-service/backend/Dockerfile
# Build context: project root (so shared/ is accessible)
FROM python:3.10-slim

# Install curl for health checks
RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy shared utilities first (avoids cache busting on service changes)
COPY shared/ ./shared/

# Copy service backend
COPY auth-service/backend/requirements.txt ./auth-service/backend/requirements.txt
RUN pip install --no-cache-dir -r auth-service/backend/requirements.txt

COPY auth-service/backend/ ./auth-service/backend/

# run.py uses parents[2] to find root, so WORKDIR must match the structure
WORKDIR /app/auth-service/backend

ENV PYTHONPATH=/app

EXPOSE 8000

CMD ["python", "run.py"]
