# Builder Service

Build service that processes deployment requests from a Redis queue, builds Docker images, and pushes them to AWS ECR.

## Features

- Listens to Redis queue for deployment requests
- Clones Git repositories (GitHub or custom Git providers)
- Builds Docker images using Dockerfile or Paketo buildpacks
- Pushes images to AWS ECR with automatic repository creation
- Real-time build logs via Dashboard API
- Deployment cancellation support via Redis pub/sub
- ECR lifecycle policy (keeps only 1 image per repository)
- Graceful shutdown handling

## Quick Start

```bash
# Install dependencies
npm install

# Copy environment file
cp env.example .env

# Run in development mode
npm run dev

# Run in production mode
npm run build && npm run start
```

## Configuration

Configuration is provided via environment variables. Copy `env.example` to `.env` and configure:

```bash
# Redis Configuration (same Redis as Go API)
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_USERNAME=
REDIS_PASSWORD=
REDIS_QUEUE_NAME=builder-queue
REDIS_CANCEL_CHANNEL_NAME=builder:cancel

# AWS Configuration
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your_access_key_id
AWS_SECRET_ACCESS_KEY=your_secret_access_key

# API Configuration (Go API service)
API_URL=http://127.0.0.1:3000/api
API_KEY=your_api_key_here  # Must match WEBHOOK_API_KEY in Go API

# Deployment Configuration
WORK_DIR=/tmp/builds

# Logging
LOG_LEVEL=info
```

## Architecture

### Build Flow

```
1. Receive deployment request from Redis queue
2. Clone Git repository (GitHub or custom)
3. Checkout specific commit (if provided)
4. Write environment variables to .env file
5. Create/update .dockerignore
6. Build Docker image (Dockerfile or Paketo)
7. Create ECR repository (if not exists)
8. Tag and push image to ECR
9. Update deployment status via Dashboard API
```

### Cancellation Flow

```
1. Dashboard sends cancellation to Redis channel (builder:cancel)
2. Builder receives message via pub/sub
3. If deployment is in progress, abort current operation
4. Update deployment status to CANCELLED
```

### Redis Keys

| Key/Channel | Description |
|-------------|-------------|
| `builder-queue` | Queue for deployment requests (BLPOP) |
| `builder:cancel` | Pub/sub channel for cancellation |

## Deployment

### Prerequisites

- Node.js 18+
- Docker installed and running
- AWS CLI configured (for ECR access)
- Access to Redis instance
- Network access to Dashboard API

### Option 1: Direct Installation

```bash
# Clone repository
git clone <repository-url>
cd services/builder

# Install dependencies
npm install

# Build TypeScript
npm run build

# Configure environment
cp env.example .env
# Edit .env with your values

# Run
node dist/index.js
```

### Option 2: Systemd Service

Create `/etc/systemd/system/deployra-builder.service`:

```ini
[Unit]
Description=Deployra Builder Service
After=network.target docker.service
Requires=docker.service

[Service]
Type=simple
User=deployra
WorkingDirectory=/opt/deployra/builder
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production
EnvironmentFile=/opt/deployra/builder/.env

[Install]
WantedBy=multi-user.target
```

```bash
# Enable and start service
sudo systemctl daemon-reload
sudo systemctl enable deployra-builder
sudo systemctl start deployra-builder

# Check status
sudo systemctl status deployra-builder
sudo journalctl -u deployra-builder -f
```

## Project Structure

```
builder/
├── src/
│   ├── index.ts              # Entry point
│   ├── config/
│   │   └── index.ts          # Configuration management
│   ├── services/
│   │   ├── build-processor.ts # Main build orchestration
│   │   ├── git-service.ts     # Git clone/checkout
│   │   ├── image-builder.ts   # Docker build
│   │   └── ecr-service.ts     # ECR push/repository management
│   ├── utils/
│   │   ├── dashboard-api.ts   # Dashboard API client
│   │   ├── file-system.ts     # File operations
│   │   └── logger.ts          # Winston logger
│   └── types.ts               # TypeScript types
├── Dockerfile
├── package.json
├── tsconfig.json
└── env.example
```

## Maintenance

```bash
# Stop service gracefully
# Press Ctrl+C or send SIGTERM

# Clear deployment queue
redis-cli DEL builder-queue

# View logs (systemd)
sudo journalctl -u deployra-builder -f

# Clean up old build files
rm -rf /tmp/builds/*
```

## License

Apache-2.0
