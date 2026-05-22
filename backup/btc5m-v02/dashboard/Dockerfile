# Dockerfile for Dashboard
FROM node:18-slim

WORKDIR /app

# Copy dependency files
COPY package*.json ./

# Install dependencies
RUN npm install --production

# Copy source code
COPY . .

# Ensure port 3000 is open
EXPOSE 3000

# Set bot API default (can be overridden by compose)
ENV BOT_API=http://bot:8082
ENV PORT=3000

CMD ["node", "server.js"]
