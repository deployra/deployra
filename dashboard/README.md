# Deployra Dashboard

Next.js dashboard for Deployra - self-hosted deployment platform.

## Tech Stack

- Next.js 15
- TypeScript
- Tailwind CSS
- Shadcn UI
- Prisma (client only)

## Development

```bash
# Install dependencies
npm install

# Copy and configure environment variables
cp env.example .env

# Generate Prisma client
npx prisma generate

# Run development server
npm run dev
```

Dashboard will be available at `http://localhost:3000`.

## Build

```bash
# Local build
npm run build

# Docker build
docker build -t dashboard:latest .
```

## Kubernetes Deployment

1. Update `k8s/dashboard-secret.yaml` with your values.

2. Update `k8s/dashboard-service.yaml` with your domain:
```yaml
labels:
  domain-0: app.yourdomain.com
```

3. Update `k8s/dashboard-deployment.yaml` with your ECR registry.

4. Apply manifests:
```bash
kubectl apply -f k8s/
```

## Database Seeds

```bash
npx ts-node prisma/seed-user.ts           # Default admin user
npx ts-node prisma/seed-service-types.ts  # Service types (web, mysql, etc.)
npx ts-node prisma/seed-instance-types.ts # Instance types (512MB, 1GB, etc.)
```

**Default credentials:**
```
Email:    admin@deployra.local
Password: admin123
```

## License

Apache-2.0
