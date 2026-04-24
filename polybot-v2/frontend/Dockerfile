FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json .
RUN npm install --legacy-peer-deps
COPY . .
RUN npm run build

FROM nginx:alpine
# Install envsubst for variable substitution
RUN apk add --no-cache gettext
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf.template /etc/nginx/conf.d/default.conf.template
# Environment variables for runtime configuration
ENV PORT=3001
ENV BACKEND_HOST=backend
ENV BACKEND_PORT=8000
# Generate nginx.conf from template using envsubst
RUN envsubst '${PORT}-${BACKEND_HOST}-${BACKEND_PORT}' < /etc/nginx/conf.d/default.conf.template > /etc/nginx/conf.d/default.conf
EXPOSE ${PORT}
HEALTHCHECK --interval=15s --timeout=5s CMD wget -qO- http://localhost:${PORT}/ || exit 1
CMD ["nginx","-g","daemon off;"]
