# --- BUILD STAGE ---
FROM rust:latest as builder

# Speed up cargo index
ENV CARGO_REGISTRIES_CRATES_IO_PROTOCOL=sparse

# Install build dependencies
RUN apt-get update && apt-get install -y pkg-config libssl-dev && rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/polybot

# Copy all source files at once
COPY . .

# Build both binaries directly
RUN cargo build --release


# --- RUNTIME STAGE ---
FROM debian:bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y ca-certificates libssl3 && rm -rf /var/lib/apt/lists/*

# Copy binaries from the target folder
COPY --from=builder /usr/src/polybot/target/release/farm_bot /app/farm_bot
COPY --from=builder /usr/src/polybot/target/release/real_bot /app/real_bot

EXPOSE 8080 9090
# Default command
CMD ["./farm_bot"]
