# PostgreSQL Proxy

TCP proxy that routes PostgreSQL connections to appropriate Kubernetes services based on the username extracted from the startup message.

## Features

- Watches Kubernetes services with configurable label selector
- Extracts username from PostgreSQL startup packets
- Routes connections based on username-to-service mappings
- DNS caching with configurable TTL
- Connection pooling and buffer management
- Graceful shutdown handling

## Quick Start

```bash
# Build
go build -o postgresql-proxy .

# Run locally
./postgresql-proxy -config config.json
```

## Configuration

Configuration is provided via JSON file with `-config` flag. If not provided, default values are used.

```json
{
  "listen_addr": ":5432",
  "kube_config_path": "",
  "label_selector": "managedBy=kubestrator,type=postgresql",
  "max_connections": 1000000,
  "connection_timeout": "1s",
  "read_buffer_size": 65536,
  "write_buffer_size": 65536,
  "use_proxy_proto": false
}
```

### User Mapping

PostgreSQL services must have labels that map usernames to the service. The proxy watches services and builds a routing table based on these labels.

```yaml
apiVersion: v1
kind: Service
metadata:
  name: postgresql-users
  labels:
    managedBy: kubestrator
    type: postgresql
    username-0: "user_admin"
    username-1: "user_reader"
spec:
  ports:
    - port: 5432
```

## Deployment

### Prerequisites

- AWS CLI configured with appropriate permissions
- Docker installed
- kubectl configured to access your Kubernetes cluster
- PostgreSQL instances deployed as services with appropriate labels

### Step 1: Create ECR Repository

```bash
aws ecr create-repository --repository-name deployra/postgresql-proxy --region <REGION>
```

### Step 2: Build and Push Docker Image

```bash
# Build
docker build -t postgresql-proxy:latest .

# Login to ECR
aws ecr get-login-password --region <REGION> | docker login --username AWS --password-stdin <AWS_ACCOUNT_ID>.dkr.ecr.<REGION>.amazonaws.com

# Tag
docker tag postgresql-proxy:latest <AWS_ACCOUNT_ID>.dkr.ecr.<REGION>.amazonaws.com/deployra/postgresql-proxy:latest

# Push
docker push <AWS_ACCOUNT_ID>.dkr.ecr.<REGION>.amazonaws.com/deployra/postgresql-proxy:latest
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

### Step 5: Update Deployment Image

Edit `k8s/proxy-deployment.yaml` and replace `<YOUR_ECR_REGISTRY>` with your ECR registry URL:

```yaml
image: <AWS_ACCOUNT_ID>.dkr.ecr.<REGION>.amazonaws.com/deployra/postgresql-proxy:latest
```

### Step 6: Deploy to Kubernetes

```bash
kubectl apply -f k8s/
```

### Step 7: Verify Deployment

```bash
kubectl get pods -n system-apps -l app=postgresql-proxy
kubectl logs -n system-apps -l app=postgresql-proxy
```

## Project Structure

```
postgresql/
├── main.go
├── Dockerfile
├── go.mod
├── go.sum
├── pkg/
│   ├── config/
│   │   └── config.go
│   ├── kubernetes/
│   │   └── kubernetes.go
│   └── proxy/
│       ├── server.go
│       ├── dns.go
│       └── buffer_pool.go
└── k8s/
    ├── proxy-deployment.yaml
    ├── proxy-service.yaml
    ├── proxy-rbac.yaml
    ├── proxy-networkpolicy.yaml
    └── proxy-pdb.yaml
```

## License

Apache-2.0
