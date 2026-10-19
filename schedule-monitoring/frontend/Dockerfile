# schedule-monitoring/frontend/Dockerfile
FROM node:18-alpine AS builder
WORKDIR /app
COPY shared/frontend/ ./shared/frontend/
COPY schedule-monitoring/frontend/package*.json ./schedule-monitoring/frontend/
RUN cd schedule-monitoring/frontend && npm ci
COPY schedule-monitoring/frontend/ ./schedule-monitoring/frontend/
RUN cd schedule-monitoring/frontend && npm run build

FROM nginx:alpine
COPY --from=builder /app/schedule-monitoring/frontend/dist /usr/share/nginx/html
COPY schedule-monitoring/frontend/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 5177
CMD ["nginx", "-g", "daemon off;"]
