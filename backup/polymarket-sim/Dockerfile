# -----------------------------------------------------------------------
# Stage 1: Build
# -----------------------------------------------------------------------
FROM rust:1-alpine AS builder

# Install build dependencies
RUN apk add --no-cache musl-dev openssl-dev pkgconfig

# Create app directory
WORKDIR /app

# Copy all source code
COPY . .

# Build the application (dependencies will be downloaded and compiled)
RUN cargo build --release

# -----------------------------------------------------------------------
# Stage 2: Runtime
# -----------------------------------------------------------------------
FROM alpine:3.19

# Install OpenSSL (required by reqwest with rustls-tls)
RUN apk add --no-cache ca-certificates

# Create non-root user
RUN adduser -D -u 1000 appuser

WORKDIR /home/appuser

# Copy binary from builder
COPY --from=builder /app/target/release/polymarket-sim .

# Ensure proper permissions
RUN chown appuser:appuser /home/appuser/polymarket-sim

# Switch to non-root user
USER appuser

# Environment variables
ENV PORT=3000
ENV STARTING_CAPITAL=1000
ENV RUST_LOG=info

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget -q --spider http://localhost:3000/ || exit 1

# Run the application
CMD ["./polymarket-sim"]