FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json .
RUN npm install --legacy-peer-deps
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 3001
HEALTHCHECK --interval=15s --timeout=5s CMD wget -qO- http://localhost:3001/ || exit 1
CMD ["nginx", "-g", "daemon off;"]
