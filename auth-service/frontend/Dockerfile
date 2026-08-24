# auth-service/frontend/Dockerfile
# Build context: project root (shared/ needed for @shared alias)
FROM node:18-alpine AS builder
WORKDIR /app
# Copy shared frontend (alias resolves to ../../shared/frontend at build time)
COPY shared/frontend/ ./shared/frontend/
COPY auth-service/frontend/package*.json ./auth-service/frontend/
RUN cd auth-service/frontend && npm ci
COPY auth-service/frontend/ ./auth-service/frontend/
RUN cd auth-service/frontend && npm run build

FROM nginx:alpine
COPY --from=builder /app/auth-service/frontend/dist /usr/share/nginx/html
COPY auth-service/frontend/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 5173
CMD ["nginx", "-g", "daemon off;"]
