<p align="center">
  <a href="https://deployra.com">
    <img src="https://deployra.com/_next/image?url=%2Ficon-512.png&w=1920&q=75" alt="Deployra Logo" width="100">
  </a>
</p>

<h1 align="center">Deployra</h1>

<p align="center">
  <b>Open-source & self-hostable alternative to Vercel, Netlify, Heroku, and Render.</b>
  <br />
  Deploy your applications, databases, and services with ease.
</p>

<p align="center">
  <a href="https://deployra.com">Website</a> •
  <a href="https://docs.deployra.com">Documentation</a> •
  <a href="https://deployra.com/register">Cloud</a> •
  <a href="#self-hosting">Self-Hosting</a> •
  <a href="https://github.com/deployra/deployra/issues">Issues</a>
</p>

---

## About

Deployra is a self-hostable platform that lets you deploy and manage your applications, databases, and services on your own infrastructure. No surprise bills, complete control.

**Why Deployra?**

- 🚀 **Simple Deployments** - Connect your Git repository and deploy with a single click
- 🔒 **Self-Hosted** - Run on your own servers, keep your data private
- 💰 **Cost Effective** - No per-seat pricing, no usage limits
- 🌐 **Hetzner Cloud** - Optimized for cost-effective Hetzner infrastructure
- 📊 **Built-in Monitoring** - Real-time logs, metrics, and alerts
- 🔄 **Auto-Scaling** - Scale your applications based on demand

<p align="center">
  <img src="https://deployra.com/_next/image?url=%2Fcreate-service.png&w=1920&q=75" alt="Service Types" width="400">
  <img src="https://deployra.com/_next/image?url=%2Fservice-deploys.png&w=1920&q=75" alt="Service Deploys" width="400">
</p>

## Features

| Feature | Description |
|---------|-------------|
| **Web Services** | Deploy any application with Docker or Buildpacks |
| **Private Services** | Internal services without public exposure |
| **MySQL** | Managed MySQL databases with automatic backups |
| **PostgreSQL** | Managed PostgreSQL databases |
| **Memory** | Managed in-memory store (Valkey) for caching and queues |
| **Custom Domains** | SSL certificates with automatic renewal |
| **Environment Variables** | Secure secrets management |
| **Cron Jobs** | Scheduled tasks for your services |
| **GitHub Integration** | Deploy on push |
| **Real-time Logs** | Stream logs from your services |
| **Metrics** | CPU and memory monitoring |

## Components

Deployra is built from several microservices that work together:

| Component | Description |
|-----------|-------------|
| **[API](api/)** | Go REST API that handles authentication, project management, and orchestration. The central brain that coordinates all operations. |
| **[Dashboard](dashboard/)** | Web interface for managing your projects, services, and deployments. Connect your GitHub repos and monitor everything from here. |
| **[Kubestrator](services/kubestrator/)** | Kubernetes orchestrator that creates and manages deployments, services, and configs. Translates your deploy requests into Kubernetes resources. |
| **[Kumonitor](services/kumonitor/)** | Monitoring service that collects metrics, logs, and events from all running services. Powers the real-time dashboards. |
| **[Builder](services/builder/)** | Builds Docker images from your source code using Buildpacks or Dockerfiles. Pushes images to ECR for deployment. Runs outside Kubernetes (requires a separate VM). We're planning to replace this with GitHub/GitLab runners in the future. |
| **[Ingress Proxy](proxies/ingress/)** | TCP proxy at the edge that forwards external traffic to internal services. Entry point for all HTTP, MySQL, PostgreSQL, and Memory connections. |
| **[Web Proxy](proxies/web/)** | Routes incoming HTTP traffic to the correct user services based on domain. Handles auto SSL, load balancing, and scale to zero. |
| **[MySQL Proxy](proxies/mysql/)** | Secure proxy for external MySQL connections. Allows users to connect to their databases from outside the cluster. |
| **[PostgreSQL Proxy](proxies/postgresql/)** | Secure proxy for external PostgreSQL connections. Same as MySQL proxy but for PostgreSQL databases. |
| **[Memory Proxy](proxies/memory/)** | Secure proxy for external memory connections (Valkey). Enables remote access to memory instances. |

## Getting Started

### Cloud

The fastest way to get started is with our managed cloud:

1. Go to [deployra.com](https://deployra.com)
2. Create an account
3. Connect your GitHub repository
4. Deploy!

### Self-Hosting

Self-host Deployra on your own infrastructure for complete control.

> ⚠️ **Note:** Self-hosting is currently complex. You'll need to manually configure secrets, build Docker images, push to a registry, and deploy each service one by one. We're working on an installation script to automate this process.

#### Minimum Requirements

| Component | Specification | Hetzner Type |
|-----------|---------------|--------------|
| **Control Plane** | 2 vCPU, 4GB RAM | cx22 |
| **Agent Nodes** | 2 vCPU, 4GB RAM (x2) | cx22 |
| **Load Balancer** | Basic | lb11 |
| **Storage** | 2x 10GB volumes for system, more for user databases | Hetzner Volumes |
| **Builder VM** | 4GB RAM (separate, outside K8s) | cx22 or local |
| **Domain** | With Cloudflare DNS | - |
| **Container Registry** | AWS ECR (only supported registry for now) | - |

#### Prerequisites

- [Hetzner Cloud](https://hetzner.cloud) account
- AWS account (for ECR container registry)
- Domain name

#### Quick Start

1. **Set up Kubernetes cluster on Hetzner Cloud**

   See [infra/terraform/README.md](infra/terraform/README.md) for detailed setup instructions.

2. **Create namespace and secrets**

   ```bash
   kubectl create namespace system-apps

   # Create ECR credentials
   kubectl create secret docker-registry ecr-credentials \
     --namespace system-apps \
     --docker-server=<AWS_ACCOUNT_ID>.dkr.ecr.<REGION>.amazonaws.com \
     --docker-username=AWS \
     --docker-password=$(aws ecr get-login-password --region <REGION>)
   ```

3. **Build and deploy services**

   Each service needs to be configured, built, and deployed. For each component:

   ```bash
   # 1. Go to service directory
   cd <service-directory>

   # 2. Read the README.md for configuration
   # 3. Update k8s/*-secret.yaml with your values

   # 4. Build and push Docker image
   docker build -t <AWS_ACCOUNT_ID>.dkr.ecr.<REGION>.amazonaws.com/deployra/<service>:latest .
   docker push <AWS_ACCOUNT_ID>.dkr.ecr.<REGION>.amazonaws.com/deployra/<service>:latest

   # 5. Update k8s/*-deployment.yaml with your ECR registry
   # 6. Deploy to Kubernetes
   kubectl apply -f k8s/
   ```

   **Deploy in this order:**

   | Order | Component | Directory |
   |-------|-----------|-----------|
   | 1 | Ingress Proxy | `proxies/ingress/` |
   | 2 | Web Proxy | `proxies/web/` |
   | 3 | MySQL Proxy | `proxies/mysql/` |
   | 4 | PostgreSQL Proxy | `proxies/postgresql/` |
   | 5 | Memory Proxy | `proxies/memory/` |
   | 6 | MySQL & Memory | `api/k8s/` (database manifests) |
   | 7 | API | `api/` |
   | 8 | Dashboard | `dashboard/` |
   | 9 | Kubestrator | `services/kubestrator/` |
   | 10 | Kumonitor | `services/kumonitor/` |
   | 11 | Builder | `services/builder/` |
   | 12 | Kronjob | `services/kronjob/` |

4. **Configure DNS**

   Point your domain to the load balancer IP:

   ```
   app.yourdomain.com    → Load Balancer IP
   api.yourdomain.com    → Load Balancer IP
   *.yourdomain.com      → Load Balancer IP (for custom domains)
   ```

5. **Run database migrations and seeds**

   ```bash
   cd dashboard
   npx prisma migrate deploy
   npx ts-node prisma/seed-user.ts
   npx ts-node prisma/seed-service-types.ts
   npx ts-node prisma/seed-instance-types.ts
   ```

6. **Access Dashboard**

   Open `https://app.yourdomain.com` and login with default credentials:

   ```
   Email:    admin@deployra.local
   Password: admin123
   ```

   **Change these credentials after first login!**

## Why I Built This

### The Problem with Existing Solutions

**They're expensive.** Vercel, Netlify, Render, and similar platforms charge per-seat, per-resource, or have unpredictable usage-based pricing. A small team can easily spend $500+/month on basic infrastructure.

**Scaling limitations.** Self-hosted alternatives have various constraints:
- [Coolify](https://coolify.io/docs/knowledge-base/internal/scalability) supports multi-server (experimental) but Kubernetes is only "planned, no ETA"
- [Dokku](https://dokku.com/docs/deployment/schedulers/k3s/) added K3s as a core plugin in v0.33.0, but Docker is still the default - K3s is opt-in per app

Deployra runs on Kubernetes from day one.

### Why Ingress Proxy?

Instead of creating separate load balancers for HTTP, MySQL, PostgreSQL, and Memory traffic, we use a **single load balancer** that routes all traffic to an **Ingress Proxy**. This TCP proxy inspects the destination port and forwards traffic to the appropriate internal proxy (80/443 → Web, 3306 → MySQL, 5432 → PostgreSQL, 6379 → Memory).

### How Database Routing Works

All users connect to the same MySQL/PostgreSQL/Memory endpoint. So how do we route each connection to the correct database?

**The secret: Username-based routing.**

When a client connects to MySQL, PostgreSQL, or Valkey, the protocol includes the username in the initial handshake.

Each database proxy:
1. **Accepts the connection** from the client
2. **Reads the initial packet** without forwarding it
3. **Extracts the username** from the protocol-specific location
4. **Looks up the username** in a routing table (built from Kubernetes service labels)
5. **Connects to the target database** inside Kubernetes
6. **Forwards the original packet** and proxies all subsequent traffic

## Architecture

```
                    ┌─────────────────────────────┐
                    │   Hetzner Load Balancer     │
                    └──────────────┬──────────────┘
                                   │
                                   ▼
                    ┌─────────────────────────────┐
                    │       Ingress Proxy         │
                    │  (TCP routing by port)      │
                    └──────────────┬──────────────┘
                                   │
       ┌───────────┬───────────────┼───────────────┬───────────┐
       │           │               │               │           │
       ▼           ▼               ▼               ▼           ▼
   ┌───────┐  ┌────────┐     ┌─────────┐    ┌──────────┐ ┌─────────┐
   │ :80   │  │ :443   │     │ :3306   │    │  :5432   │ │ :6379   │
   │ :443  │  │        │     │         │    │          │ │         │
   └───┬───┘  └────┬───┘     └────┬────┘    └────┬─────┘ └────┬────┘
       │           │              │              │            │
       ▼           ▼              ▼              ▼            ▼
   ┌───────────────────┐    ┌──────────┐  ┌────────────┐ ┌─────────┐
   │    Web Proxy      │    │  MySQL   │  │ PostgreSQL │ │ Memory  │
   │ (HTTP routing)    │    │  Proxy   │  │   Proxy    │ │  Proxy  │
   └─────────┬─────────┘    └────┬─────┘  └─────┬──────┘ └────┬────┘
             │                   │              │             │
    ┌────────┼────────┐          │              │             │
    ▼        ▼        ▼          ▼              ▼             ▼
┌───────┐┌───────┐┌───────┐  ┌───────┐     ┌───────┐     ┌───────┐
│  API  ││ Dash- ││ User  │  │ User  │     │ User  │     │ User  │
│       ││ board ││ Apps  │  │ MySQL │     │ PgSQL │     │Memory │
└───┬───┘└───────┘└───────┘  └───────┘     └───────┘     └───────┘
    │
    │ manages
    ▼
┌─────────────────────────────────────────┐
│            Kubernetes                    │
│  ┌────────────┐ ┌──────────┐ ┌────────┐ │
│  │Kubestrator │ │Kumonitor │ │Kronjob │ │
│  │ (deploys)  │ │ (metrics)│ │ (cron) │ │
│  └────────────┘ └──────────┘ └────────┘ │
└─────────────────────────────────────────┘
```

**Flow:**
1. All traffic hits **Hetzner Load Balancer**
2. **Ingress Proxy** routes by port (80/443 → Web, 3306 → MySQL, 5432 → PostgreSQL, 6379 → Memory)
3. **Web Proxy** routes HTTP traffic to API, Dashboard, or user apps based on domain
4. **Database Proxies** route connections to user databases
5. **API** orchestrates Kubernetes through Kubestrator, Kumonitor, and Kronjob

## Project Structure

```
deployra/
├── api/                    # Go REST API
├── dashboard/              # Next.js dashboard
├── services/
│   ├── kubestrator/       # Kubernetes orchestrator
│   ├── kumonitor/         # Monitoring service
│   ├── builder/           # Docker image builder
│   └── kronjob/           # Cron job runner
├── proxies/
│   ├── ingress/           # TCP ingress proxy
│   ├── web/               # HTTP proxy
│   ├── mysql/             # MySQL proxy
│   ├── postgresql/        # PostgreSQL proxy
│   └── memory/            # Memory proxy (Valkey)
└── infra/
    └── terraform/         # Infrastructure as code
```

## Configuration

Each component has its own `env.example` and `k8s/*-secret.yaml` files. See the README in each directory for configuration details.

## Contributing

We welcome contributions!

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## Support

- 📖 [Documentation](https://docs.deployra.com)
- 🐛 [Issue Tracker](https://github.com/deployra/deployra/issues)
- 𝕏 [X](https://x.com/deployracom)
- 📧 [Email](mailto:support@deployra.com)

## License

Deployra is open-source software licensed under the [Apache License 2.0](LICENSE).

---