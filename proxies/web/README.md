# Web Proxy

HTTP/HTTPS reverse proxy that routes web traffic to appropriate Kubernetes services based on domain names with automatic SSL certificate management and scale-to-zero functionality.

## Features

- Watches Kubernetes services with configurable label selector
- Routes requests based on domain-to-service mappings
- Automatic SSL certificate generation via Let's Encrypt (ACME)
- Wildcard certificate support via Cloudflare DNS-01 challenge
- Scale-to-zero functionality with automatic wake-up on request
- WebSocket support with configurable timeouts
- DNS caching with 5-minute TTL
- Nginx-like access logging
- Graceful shutdown handling

## Quick Start

```bash
# Build
go build -o web-proxy .

# Run proxy mode
./web-proxy -config config.json

# Run scale-to-zero timer mode
./web-proxy -config config.json -timer
```

## Configuration

Configuration is provided via JSON file with `-config` flag. If not provided, default values are used.

```json
{
  "http_addr": ":80",
  "https_addr": ":443",
  "enable_https": true,
  "email": "admin@example.com",
  "acme_server_url": "https://acme-v02.api.letsencrypt.org/directory",
  "kube_config_path": "",
  "label_selector": "managedBy=kubestrator,type=web",
  "redis_addr": "redis:6379",
  "redis_password": "",
  "redis_db": 0,
  "idle_timeout_minutes": 10,
  "check_interval_seconds": 60,
  "proxy_read_timeout": 30,
  "proxy_write_timeout": 30,
  "websocket_read_timeout": 3600,
  "websocket_write_timeout": 3600,
  "wildcard_domain": "example.com",
  "cloudflare_api_token": "",
  "enable_wildcard": false
}
```

## Architecture

### Certificate Storage

SSL certificates are stored in multiple locations for redundancy and performance:

1. **Kubernetes Secrets** (Primary Storage)
   - Location: `system-apps` namespace
   - Naming: `cert-{domain}` (dots replaced with dashes)
   - Example: `cert-example-com` for `example.com`
   - Wildcard: `cert-wildcard-{domain}` for `*.example.com`
   - Contains: `cert.pem` and `key.pem`
   - Label: `type=certificate`

2. **Redis Cache** (Fast Access)
   - Keys: `cert:{domain}:cert` and `cert:{domain}:key`
   - TTL: 85 days (certificates valid for 90 days)
   - Used for quick lookups without hitting Kubernetes API

3. **Memory Cache** (Runtime)
   - In-memory map for fastest access
   - Populated from Redis/Kubernetes on startup
   - Updated when new certificates are obtained

### Certificate Flow

```
Request → Memory Cache → Redis Cache → Kubernetes Secret → ACME (Let's Encrypt)
```

### Scale-to-Zero

The proxy supports automatic scaling of deployments to zero replicas when idle:

1. **Access Tracking**: Each request records access time in Redis
   - Key: `service:access:{namespace}:{deployment-name}`
   - Value: Unix timestamp

2. **Deployment Status**: Cached deployment status
   - Key: `deployment:status:{namespace}:{deployment-name}`
   - Value: `1` (active) or `0` (inactive)
   - TTL: 24 hours

3. **CrashLoop Detection**: Prevents scaling up broken deployments
   - Key: `deployment:crashloop:{namespace}:{deployment-name}`

4. **Timer Mode**: Separate process checks idle services
   - Runs every `check_interval_seconds` (default: 60s)
   - Scales down after `idle_timeout_minutes` of inactivity (default: 10min)

### Request Flow

```
1. HTTP Request arrives
2. Check if HTTPS redirect needed
3. Look up service in routing table by Host header
4. If scale-to-zero enabled and deployment is down:
   a. Check if in CrashLoopBackOff (block if yes)
   b. Scale deployment to 1 replica
   c. Wait up to 30 seconds for ready state
5. Record access time in Redis
6. Resolve service DNS via cache
7. Proxy request to backend
8. Log request with upstream info
```

## Domain Mapping

Web services must have labels that map domains to the service:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: my-web-app-service
  namespace: user-project-123
  labels:
    managedBy: kubestrator
    type: web
    project: "project-123"
    service: "my-web-app"
    scaleToZeroEnabled: "true"
    domain-0: "example.com"
    domain-1: "www.example.com"
    domain-2: "api.example.com"
spec:
  ports:
    - port: 80
  selector:
    app: my-web-app
```

### Required Labels

| Label | Description |
|-------|-------------|
| `managedBy` | Must be `kubestrator` |
| `type` | Must be `web` |
| `project` | Project identifier |
| `service` | Service identifier |
| `domain-N` | Domain names (N = 0, 1, 2, ...) |

### Optional Labels

| Label | Description |
|-------|-------------|
| `scaleToZeroEnabled` | Set to `true` to enable scale-to-zero |

## Wildcard Certificates

For subdomains (e.g., `*.deployra.app`), wildcard certificates use DNS-01 challenge via Cloudflare:

1. Set `enable_wildcard: true`
2. Set `wildcard_domain: "deployra.app"`
3. Set `cloudflare_api_token` with DNS edit permissions
4. Subdomains like `app.deployra.app` will use the wildcard cert
5. The base domain `deployra.app` is also covered

## Deployment

### Prerequisites

- AWS CLI configured with appropriate permissions
- Docker installed
- kubectl configured to access your Kubernetes cluster
- (Optional) Cloudflare account for wildcard certificates

### Step 1: Create ECR Repository

```bash
aws ecr create-repository --repository-name deployra/web-proxy --region <REGION>
```

### Step 2: Build and Push Docker Image

```bash
# Build
docker build -t web-proxy:latest .

# Login to ECR
aws ecr get-login-password --region <REGION> | docker login --username AWS --password-stdin <AWS_ACCOUNT_ID>.dkr.ecr.<REGION>.amazonaws.com

# Tag
docker tag web-proxy:latest <AWS_ACCOUNT_ID>.dkr.ecr.<REGION>.amazonaws.com/deployra/web-proxy:latest

# Push
docker push <AWS_ACCOUNT_ID>.dkr.ecr.<REGION>.amazonaws.com/deployra/web-proxy:latest
```

### Step 3: Create Namespace

```bash
kubectl create namespace system-apps
```

### Step 4: Create ECR Pull Secret

```bash
kubectl create secret docker-registry ecr-credentials \
  --namespace system-apps \
  --docker-server=<AWS_ACCOUNT_ID>.dkr.ecr.<REGION>.amazonaws.com \
  --docker-username=AWS \
  --docker-password=$(aws ecr get-login-password --region <REGION>)
```

### Step 5: Update Deployment Images

Edit `k8s/proxy-deployment.yaml` and `k8s/proxy-timer-deployment.yaml`, replace `<YOUR_ECR_REGISTRY>` with your ECR registry URL:

```yaml
image: <AWS_ACCOUNT_ID>.dkr.ecr.<REGION>.amazonaws.com/deployra/web-proxy:latest
```

### Step 6: Deploy to Kubernetes

```bash
# Deploy Redis first (required for state management)
kubectl apply -f k8s/redis_deployment.yaml
kubectl apply -f k8s/redis_service.yaml
kubectl apply -f k8s/redis_pdb.yaml

# Wait for Redis to be ready
kubectl wait --for=condition=ready pod -l app=redis -n system-apps --timeout=60s

# Deploy web proxy
kubectl apply -f k8s/
```

### Step 7: Verify Deployment

```bash
# Check proxy pods
kubectl get pods -n system-apps -l app=web-proxy
kubectl get pods -n system-apps -l app=web-proxy-timer

# Check logs
kubectl logs -n system-apps -l app=web-proxy
kubectl logs -n system-apps -l app=web-proxy-timer
```

## Modes of Operation

### Proxy Mode (Default)

```bash
./web-proxy -config config.json
```

- Handles HTTP/HTTPS traffic
- Routes requests to backend services
- Manages SSL certificates
- Tracks service access times

### Timer Mode

```bash
./web-proxy -config config.json -timer
```

- Runs as a separate deployment
- Periodically checks for idle services
- Scales down services that exceed idle timeout
- Does NOT handle web traffic

## Project Structure

```
web/
├── main.go                    # Entry point, mode selection
├── Dockerfile
├── go.mod
├── go.sum
├── pkg/
│   ├── config/
│   │   └── config.go          # Configuration management
│   ├── kubernetes/
│   │   └── client.go          # K8s client, service watcher, secrets
│   ├── redis/
│   │   └── client.go          # Redis client, access tracking
│   └── proxy/
│       ├── server.go          # HTTP/HTTPS servers, request routing
│       ├── cert_manager.go    # ACME certificates, renewal
│       ├── dns.go             # DNS caching
│       └── logger.go          # Access logging
└── k8s/
    ├── proxy-deployment.yaml       # Main proxy deployment
    ├── proxy-timer-deployment.yaml # Scale-to-zero timer
    ├── proxy-service.yaml          # LoadBalancer service
    ├── proxy-rbac.yaml             # ServiceAccount, Role, RoleBinding
    ├── proxy-pdb.yaml              # PodDisruptionBudget
    ├── proxy-timer-pdb.yaml
    ├── redis_deployment.yaml       # Redis for state
    ├── redis_service.yaml
    └── redis_pdb.yaml
```

## Rate Limiting

Let's Encrypt has rate limits. The proxy handles this by:

1. Storing rate limit status in Redis: `cert:{domain}:ratelimit`
2. Extracting retry time from ACME error responses
3. Blocking certificate requests until cooldown expires
4. Default cooldown: 1 hour if retry time not parseable

## License

Apache-2.0
