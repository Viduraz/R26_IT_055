# anomaly-detection/frontend/Dockerfile
FROM node:18-alpine AS builder
WORKDIR /app
COPY shared/frontend/ ./shared/frontend/
COPY anomaly-detection/frontend/package*.json ./anomaly-detection/frontend/
RUN cd anomaly-detection/frontend && npm ci
COPY anomaly-detection/frontend/ ./anomaly-detection/frontend/
RUN cd anomaly-detection/frontend && npm run build

FROM nginx:alpine
COPY --from=builder /app/anomaly-detection/frontend/dist /usr/share/nginx/html
COPY anomaly-detection/frontend/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 5176
CMD ["nginx", "-g", "daemon off;"]
