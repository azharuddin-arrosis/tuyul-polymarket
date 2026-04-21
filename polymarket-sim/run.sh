#!/bin/bash

# polymarket-sim build & run script
# Usage: ./run.sh [build|start|stop|restart|logs]

set -e

cd "$(dirname "$0")"

IMAGE="polymarket-sim:latest"
CONTAINER="polymarket-sim"

case "${1:-build}" in
    build)
        echo "🏗️  Building Docker image..."
        docker build -t "$IMAGE" .
        echo "✅ Build complete!"
        ;;

    start)
        echo "🚀 Starting polymarket-sim..."
        docker-compose up -d
        echo "✅ Started! Access at http://localhost:3001"
        echo "📝 Use './run.sh logs' to view logs"
        ;;

    stop)
        echo "🛑 Stopping polymarket-sim..."
        docker-compose down
        echo "✅ Stopped!"
        ;;

    restart)
        echo "🔄 Restarting polymarket-sim..."
        docker-compose restart
        echo "✅ Restarted!"
        ;;

    logs)
        echo "📋 Showing logs (Ctrl+C to exit)..."
        docker-compose logs -f
        ;;

    rebuild)
        echo "🔨 Rebuilding and starting..."
        docker-compose down
        docker build -t "$IMAGE" .
        docker-compose up -d
        echo "✅ Build and start complete!"
        ;;

    *)
        echo "Usage: $0 {build|start|stop|restart|logs|rebuild}"
        echo ""
        echo "Commands:"
        echo "  build    - Build Docker image"
        echo "  start   - Start container"
        echo "  stop    - Stop container"
        echo "  restart - Restart container"
        echo "  logs    - View logs (follow mode)"
        echo "  rebuild - Rebuild and start"
        exit 1
        ;;
esac