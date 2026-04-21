# -----------------------------------------------------------------------
# Stage 1: Build
# -----------------------------------------------------------------------
FROM rust:1-alpine AS builder

# Install build dependencies
RUN apk add --no-cache musl-dev openssl-dev pkgconfig

# Create app directory
WORKDIR /app

# Copy manifest first for better caching
COPY Cargo.toml Cargo.lock ./

# Create dummy main.rs to build dependencies
RUN mkdir src && \
    echo "fn main() {}" > src/main.rs

# Build dependencies
RUN cargo build --release
RUN rm -rf src

# Copy source code
COPY . .

# Build the application
RUN touch src/main.rs src/models.rs src/polymarket.rs
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

# Create directory for static files
RUN mkdir -p /home/appuser/static

# Copy static files
COPY static/ ./static/

# Ensure proper permissions
RUN chown -R appuser:appuser /home/appuser

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