FROM nginx:alpine
RUN apk add --no-cache curl
COPY dist /usr/share/nginx/html

# Proxy configuration - connects to bot1 and bot2 services
RUN echo 'server { \
    listen 80; \
    server_name _; \
    root /usr/share/nginx/html; \
    index index.html; \
    location / { \
        try_files $uri $uri/ /index.html; \
    } \
    # Default: proxy to bot1 \
    location /api/ { \
        proxy_pass http://bot1:8000/api/; \
        proxy_set_header Host $host; \
        proxy_set_header X-Real-IP $remote_addr; \
    } \
    # Bot 2 API \
    location /api/bot2/ { \
        proxy_pass http://bot2:8000/api/; \
        proxy_set_header Host $host; \
        proxy_set_header X-Real-IP $remote_addr; \
    } \
    # Default websocket to bot1 \
    location /ws { \
        proxy_pass http://bot1:8000/ws; \
        proxy_set_header Upgrade $http_upgrade; \
        proxy_set_header Connection "Upgrade"; \
        proxy_set_header Host $host; \
    } \
    # Bot 2 websocket \
    location /ws/bot2 { \
        proxy_pass http://bot2:8000/ws; \
        proxy_set_header Upgrade $http_upgrade; \
        proxy_set_header Connection "Upgrade"; \
        proxy_set_header Host $host; \
    } \
    location /health { \
        proxy_pass http://bot1:8000/health; \
    } \
}' > /etc/nginx/conf.d/default.conf

HEALTHCHECK --interval=10s --timeout=5s CMD curl -sf http://localhost:80/ || exit 1
CMD ["nginx", "-g", "daemon off;"]
EXPOSE 80