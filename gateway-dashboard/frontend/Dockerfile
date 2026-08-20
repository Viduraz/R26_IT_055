# gateway-dashboard/frontend/Dockerfile
FROM node:18-alpine AS builder
WORKDIR /app
COPY shared/frontend/ ./shared/frontend/
COPY gateway-dashboard/frontend/package*.json ./gateway-dashboard/frontend/
RUN cd gateway-dashboard/frontend && npm ci
COPY gateway-dashboard/frontend/ ./gateway-dashboard/frontend/
RUN cd gateway-dashboard/frontend && npm run build

FROM nginx:alpine
COPY --from=builder /app/gateway-dashboard/frontend/dist /usr/share/nginx/html
COPY gateway-dashboard/frontend/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 5178
CMD ["nginx", "-g", "daemon off;"]
