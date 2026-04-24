FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json .
RUN npm install --legacy-peer-deps
COPY . .
RUN npm run build

FROM nginx:alpine
RUN apk add --no-cache curl
COPY --from=builder /app/dist /usr/share/nginx/html

RUN echo 'server { \
    listen 3001; \
    server_name _; \
    root /usr/share/nginx/html; \
    index index.html; \
    location / { \
        try_files $uri $uri/ /index.html; \
    } \
    location /api/ { \
        proxy_pass http://bot1-sim:8000; \
        proxy_set_header Host $host; \
    } \
    location /ws { \
        proxy_pass http://bot1-sim:8000/ws; \
        proxy_set_header Upgrade $http_upgrade; \
        proxy_set_header Connection "Upgrade"; \
    } \
    location /health { \
        proxy_pass http://bot1-sim:8000/health; \
    } \
}' > /etc/nginx/conf.d/default.conf

HEALTHCHECK --interval=10s --timeout=5s CMD curl -sf http://localhost:3001/ || exit 1
CMD ["nginx", "-g", "daemon off;"]
EXPOSE 3001