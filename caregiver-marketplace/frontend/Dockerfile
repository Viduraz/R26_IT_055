# caregiver-marketplace/frontend/Dockerfile
FROM node:18-alpine AS builder
WORKDIR /app
COPY shared/frontend/ ./shared/frontend/
COPY caregiver-marketplace/frontend/package*.json ./caregiver-marketplace/frontend/
RUN cd caregiver-marketplace/frontend && npm ci
COPY caregiver-marketplace/frontend/ ./caregiver-marketplace/frontend/
RUN cd caregiver-marketplace/frontend && npm run build

FROM nginx:alpine
COPY --from=builder /app/caregiver-marketplace/frontend/dist /usr/share/nginx/html
COPY caregiver-marketplace/frontend/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 5179
CMD ["nginx", "-g", "daemon off;"]
