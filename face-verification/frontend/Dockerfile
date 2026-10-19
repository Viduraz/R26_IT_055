# face-verification/frontend/Dockerfile
FROM node:18-alpine AS builder
WORKDIR /app
COPY shared/frontend/ ./shared/frontend/
COPY face-verification/frontend/package*.json ./face-verification/frontend/
RUN cd face-verification/frontend && npm ci
COPY face-verification/frontend/ ./face-verification/frontend/
RUN cd face-verification/frontend && npm run build

FROM nginx:alpine
COPY --from=builder /app/face-verification/frontend/dist /usr/share/nginx/html
COPY face-verification/frontend/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 5174
CMD ["nginx", "-g", "daemon off;"]
