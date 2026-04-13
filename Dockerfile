# --- BUILD STAGE ---
FROM rust:1.82-slim-bookworm as builder

WORKDIR /usr/src/polybot
COPY . .

# Build for release
RUN cargo build --release

# --- RUNTIME STAGE ---
FROM debian:bookworm-slim

WORKDIR /app

# Install certificates and basic libs if needed
RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*

# Copy the binary from builder
COPY --from=builder /usr/src/polybot/target/release/compound-sim /app/polybot

# Expose the dashboard port
EXPOSE 8080

# Run the bot
CMD ["./polybot"]
