# tracking-geofencing/frontend/Dockerfile
FROM node:18-alpine AS builder
WORKDIR /app
COPY shared/frontend/ ./shared/frontend/
COPY tracking-geofencing/frontend/package*.json ./tracking-geofencing/frontend/
RUN cd tracking-geofencing/frontend && npm ci
COPY tracking-geofencing/frontend/ ./tracking-geofencing/frontend/
RUN cd tracking-geofencing/frontend && npm run build

FROM nginx:alpine
COPY --from=builder /app/tracking-geofencing/frontend/dist /usr/share/nginx/html
COPY tracking-geofencing/frontend/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 5175
CMD ["nginx", "-g", "daemon off;"]
