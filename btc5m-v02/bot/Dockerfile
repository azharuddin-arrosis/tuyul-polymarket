# Dockerfile for Rust Bot
FROM rust:1.75-slim-bookworm as builder

WORKDIR /usr/src/app
COPY . .

# Install dependencies for building
RUN apt-get update && apt-get install -y pkg-config libssl-dev && rm -rf /var/lib/apt/lists/*

# Build binary
RUN cargo build --release

# Final runtime stage
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y ca-certificates libssl3 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=builder /usr/src/app/target/release/btc5m-bot /app/btc5m-bot

# Ensure port 8082 is open
EXPOSE 8082

# Run bot
CMD ["./btc5m-bot"]
