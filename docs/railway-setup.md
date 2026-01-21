# Railway Deployment Setup

This document describes how to set up Railway deployment for GitDeploy using Docker and GitHub Container Registry (GHCR).

## Architecture

```
Push to main
     │
     ▼
┌─────────────────┐
│ Quality Checks  │ (type check, format, unit tests)
└────────┬────────┘
         ↓
┌─────────────────┐
│Integration Tests│ (E2E with Playwright)
└────────┬────────┘
         ↓
┌─────────────────┐
│  Build Docker   │
│  Push to GHCR   │ → ghcr.io/donedgardo/launchpad:latest
└────────┬────────┘
         ↓
┌─────────────────┐
│ Deploy Railway  │ (pulls from GHCR)
└─────────────────┘
```

**Benefits of this approach:**

- **Build once, deploy anywhere** - Same image can deploy to Railway, AWS, Fly.io, etc.
- **Faster deploys** - Railway pulls pre-built image instead of rebuilding
- **Consistent** - Same image in dev, staging, and production
- **Versioned** - Each commit gets a unique image tag (SHA)
- **Rollback** - Instantly deploy any previous version

## Prerequisites

- Railway account at [railway.app](https://railway.app)
- GitHub repository access (to add secrets)
- Docker (for local testing, optional)

## Docker Image

The application uses a multi-stage Docker build for optimal image size and security:

```
Dockerfile
├── Build stage (node:20-alpine)
│   ├── Install all dependencies
│   ├── Compile TypeScript → dist/
│   └── Build Tailwind CSS
└── Production stage (node:20-alpine)
    ├── Install production dependencies only
    ├── Copy compiled dist/ from builder
    ├── Run as non-root user (nodejs)
    └── Health check on /health endpoint
```

### Container Registry

Images are automatically pushed to GitHub Container Registry:

```
ghcr.io/donedgardo/launchpad:latest    # Latest main branch
ghcr.io/donedgardo/launchpad:<sha>     # Specific commit
```

### Local Docker Testing

```bash
# Build the image
docker build -t gitdeploy:local .

# Run locally (with env vars)
docker run -p 3000:3000 \
  -e MONGODB_URI="mongodb://host.docker.internal:27017/gitdeploy" \
  -e COOKIE_SECRET_SIGNATURE="local-secret" \
  -e PUBLIC_URL="http://localhost:3000" \
  -e GH_APP_ID="123456" \
  -e GH_APP_CLIENT_ID="your-client-id" \
  -e GH_APP_CLIENT_SECRET="your-client-secret" \
  -e GH_APP_PRIVATE_KEY="your-private-key" \
  -e GH_APP_NAME="your-app-name" \
  gitdeploy:local
```

## Step 1: Install Railway CLI

```bash
npm install -g @railway/cli
```

## Step 2: Login to Railway

```bash
railway login
```

This opens a browser window to authenticate.

## Step 3: Create Railway Project

```bash
cd /path/to/launchpad
railway init
```

Or link to existing project:

```bash
railway link
```

## Step 4: Configure Railway Service with GHCR Image

In the Railway dashboard:

1. Go to your project
2. Click "New" → "Docker Image"
3. Enter the image URL: `ghcr.io/donedgardo/launchpad:latest`
4. Click "Deploy"

> **Note:** The image is public, so no authentication is needed. For private images, you'd need Railway Pro and add GitHub credentials.

### Environment Variables

Configure these in Railway (Service → Variables):

| Variable                  | Description                                                                |
| ------------------------- | -------------------------------------------------------------------------- |
| `MONGODB_URI`             | MongoDB connection string (use Railway's MongoDB or MongoDB Atlas)         |
| `PORT`                    | Railway sets this automatically                                            |
| `PUBLIC_URL`              | Your Railway app URL (e.g., `https://gitdeploy-production.up.railway.app`) |
| `COOKIE_SECRET_SIGNATURE` | Random secret for signing cookies (generate with `openssl rand -hex 32`)   |
| `GH_APP_ID`               | GitHub App ID                                                              |
| `GH_APP_CLIENT_ID`        | GitHub App Client ID                                                       |
| `GH_APP_CLIENT_SECRET`    | GitHub App Client Secret                                                   |
| `GH_APP_PRIVATE_KEY`      | GitHub App Private Key (base64 encoded)                                    |
| `GH_APP_NAME`             | GitHub App name                                                            |

### Add MongoDB (Option A: Railway MongoDB)

1. In your Railway project, click "New" → "Database" → "MongoDB"
2. Copy the `MONGODB_URI` from the MongoDB service variables
3. Add it to your app service's variables

### Add MongoDB (Option B: MongoDB Atlas)

1. Create a free cluster at [MongoDB Atlas](https://cloud.mongodb.com)
2. Whitelist Railway IPs or allow all IPs (0.0.0.0/0) for simplicity
3. Copy the connection string and add to Railway variables

## Step 5: Get Railway Credentials

### Railway Token

1. Go to [Railway Account Tokens](https://railway.app/account/tokens)
2. Click "Create Token"
3. Name it (e.g., "GitHub Actions Deploy")
4. Copy the token

### Service ID

1. Go to your Railway project dashboard
2. Click on your service
3. Go to Settings
4. Find the Service ID (also visible in the URL: `railway.app/project/.../service/[SERVICE_ID]`)

## Step 6: Add Secrets to GitHub

Go to your GitHub repository:
**Settings → Secrets and variables → Actions**

### Add Secret:

| Name            | Value                              |
| --------------- | ---------------------------------- |
| `RAILWAY_TOKEN` | Your Railway API token from Step 5 |

### Add Variable:

| Name                 | Value                       |
| -------------------- | --------------------------- |
| `RAILWAY_SERVICE_ID` | Your service ID from Step 5 |

## Step 7: Deploy

### Automatic Deployment (CI/CD)

The GitHub Actions workflow (`.github/workflows/ci.yml`) automatically:

1. Runs quality checks and tests
2. Builds Docker image and pushes to GHCR
3. Triggers Railway to redeploy with the new image

Just push to `main` and everything happens automatically.

### Manual Deploy

```bash
# Trigger redeploy via CLI (pulls latest image from GHCR)
railway redeploy --service <service-id>

# Or deploy a specific image tag
# (update service settings in Railway dashboard to use specific tag)
```

### Deploy a Specific Version

To rollback or deploy a specific version:

1. Go to Railway dashboard → Service → Settings
2. Change the image tag from `latest` to a specific SHA
3. Example: `ghcr.io/donedgardo/launchpad:abc1234`

## Troubleshooting

### Deploy fails with "service not found"

- Verify `RAILWAY_SERVICE_ID` is correct
- Check the service exists in your Railway project

### Deploy fails with "unauthorized"

- Verify `RAILWAY_TOKEN` is valid and not expired
- Regenerate token if needed

### Image not found on GHCR

- Check the GitHub Actions workflow ran successfully
- Verify the image exists: `docker pull ghcr.io/donedgardo/launchpad:latest`
- Check package visibility in GitHub (Settings → Packages)

### App crashes on Railway

- Check Railway logs: `railway logs`
- Verify all environment variables are set
- Check the `/health` endpoint responds

### Health check fails

- Ensure your app has a `/health` endpoint
- Check the PORT environment variable is being used
- View logs to see startup errors

## Useful Commands

```bash
# View logs
railway logs

# View logs (follow mode)
railway logs -f

# Open Railway dashboard
railway open

# Check service status
railway status

# Trigger redeploy
railway redeploy --service <service-id>

# Run command in Railway environment
railway run <command>
```

## Docker Image Details

The production Docker image includes:

- **Base**: `node:20-alpine` (~180MB compressed)
- **User**: Non-root `nodejs` user (UID 1001)
- **Health check**: HTTP GET to `/health` every 30s
- **Exposed port**: 3000 (configurable via PORT env var)

### Security Features

- Multi-stage build (no dev dependencies in production)
- Non-root user execution
- No source code in production image (only compiled JS)
- Minimal Alpine base image

## Deploying to Other Platforms

Since the image is on GHCR, you can deploy anywhere:

### Fly.io

```bash
fly launch --image ghcr.io/donedgardo/launchpad:latest
```

### AWS ECS

Use the image URI `ghcr.io/donedgardo/launchpad:latest` in your task definition.

### DigitalOcean App Platform

Create app from container registry → Enter GHCR image URL.
