# Railway Deployment Setup

This document describes how to set up Railway deployment for GitLaunch.

## Architecture

```
Push to main
     │
     ├──► Quality Checks (parallel)
     │    (type check, format, unit tests)
     │
     └──► Integration Tests (parallel)
          (E2E with Playwright)
              │
              ▼
         All tests pass?
              │
              ▼
┌─────────────────────────┐
│   Deploy to Prod        │
│   (Railway builds from  │
│    source via Dockerfile)│
└─────────────────────────┘


Manual Deployment (workflow_dispatch):
┌─────────────────┐
│  Select Env     │ → dev / staging / prod
└────────┬────────┘
         ↓
┌─────────────────┐
│    Deploy       │ (triggers Railway redeploy)
└─────────────────┘
```

**Benefits:**

- **Simple** - Railway handles Docker builds
- **Fast CI** - Tests run in parallel, deploy triggers after
- **Environment isolation** - Separate secrets/config per environment
- **Rollback** - Use Railway's deployment history

## Prerequisites

- Railway account at [railway.app](https://railway.app)
- GitHub repository connected to Railway
- MongoDB Atlas account (free tier works)

## Dockerfile

The application uses a multi-stage Docker build:

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

### Local Docker Testing

```bash
# Build the image
docker build -t gitlaunch:local .

# Run locally (with env vars)
docker run -p 3000:3000 \
  -e MONGODB_URI="mongodb://host.docker.internal:27017/gitlaunch" \
  -e COOKIE_SECRET_SIGNATURE="local-secret" \
  -e PUBLIC_URL="http://localhost:3000" \
  -e GH_APP_ID="123456" \
  -e GH_APP_CLIENT_ID="your-client-id" \
  -e GH_APP_CLIENT_SECRET="your-client-secret" \
  -e GH_APP_PRIVATE_KEY="your-private-key" \
  -e GH_APP_NAME="your-app-name" \
  gitlaunch:local
```

## Step 1: Create Railway Project

### Option A: Via CLI

```bash
npm install -g @railway/cli
railway login
cd /path/to/launchpad
railway init
```

### Option B: Via Dashboard

1. Go to [railway.app](https://railway.app)
2. Click "New Project"
3. Select "Deploy from GitHub repo"
4. Connect your GitHub account and select the repository

## Step 2: Configure Railway Service

Railway will automatically detect the `Dockerfile` and use it to build.

### Environment Variables

Configure these in Railway (Service → Variables):

| Variable                  | Description                                                              |
| ------------------------- | ------------------------------------------------------------------------ |
| `MONGODB_URI`             | MongoDB Atlas connection string                                          |
| `PORT`                    | Railway sets this automatically                                          |
| `PUBLIC_URL`              | Your Railway app URL (e.g., `https://gitlaunch-dev.up.railway.app`)      |
| `COOKIE_SECRET_SIGNATURE` | Random secret for signing cookies (generate with `openssl rand -hex 32`) |
| `GH_APP_ID`               | GitHub App ID                                                            |
| `GH_APP_CLIENT_ID`        | GitHub App Client ID                                                     |
| `GH_APP_CLIENT_SECRET`    | GitHub App Client Secret                                                 |
| `GH_APP_PRIVATE_KEY`      | GitHub App Private Key (base64 encoded)                                  |
| `GH_APP_NAME`             | GitHub App name                                                          |

### MongoDB Setup (MongoDB Atlas)

Railway's built-in MongoDB has limited free tier storage. Use MongoDB Atlas instead:

1. Create a free cluster at [MongoDB Atlas](https://cloud.mongodb.com)
2. Create a database user with password
3. Network Access: Add `0.0.0.0/0` to allow connections from anywhere
4. Get connection string: Click "Connect" → "Drivers" → Copy the URI
5. Add to Railway as `MONGODB_URI`:
   ```
   mongodb+srv://username:password@cluster.xxxxx.mongodb.net/gitlaunch?retryWrites=true&w=majority
   ```

## Step 3: Get Railway Credentials for GitHub Actions

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

## Step 4: Set Up GitHub Environments

GitHub Environments allow separate secrets per environment.

### Create Environments

Go to: **Repository Settings → Environments**

1. Create `dev` environment
2. Create `staging` environment (optional)
3. Create `prod` environment. CI deploys here on every merge to `main`, so do not add a required-approval rule unless you want each merge to wait for one.

The environment name is also sent to GitLaunch as the environment the deploy is reported against, so it must match an environment on the GitLaunch service (`prod`, not `production`).

### Add Secrets Per Environment

For each environment, add these secrets:

| Name                 | Value                                   |
| -------------------- | --------------------------------------- |
| `RAILWAY_TOKEN`      | Railway API token                       |
| `RAILWAY_SERVICE_ID` | Railway service ID for this environment |

### Example Setup

```
GitHub Repository
├── Environments
│   ├── dev
│   │   ├── RAILWAY_TOKEN (secret)
│   │   └── RAILWAY_SERVICE_ID (secret)
│   ├── staging
│   │   ├── RAILWAY_TOKEN (secret)
│   │   └── RAILWAY_SERVICE_ID (secret)
│   └── prod
│       ├── RAILWAY_TOKEN (secret)
│       └── RAILWAY_SERVICE_ID (secret)
```

## Step 5: Deploy

### Automatic Deployment (Prod)

The CI workflow (`.github/workflows/ci.yml`) automatically:

1. Runs quality checks and integration tests in parallel
2. After both pass, triggers deploy to `prod`
3. Railway builds from source using the Dockerfile

Just push to `main` and production updates automatically. This is deliberate while there is a single environment; once staging exists, CI should deploy there and production should be promoted from the release board.

### Manual Deployment (Any Environment)

Use the Deploy workflow for manual deployments:

1. Go to **Actions → Deploy → Run workflow**
2. Select environment: `dev`, `staging`, or `prod`
3. Click **Run workflow**

Or use GitHub CLI:

```bash
# Deploy to production
gh workflow run deploy.yml -f environment=prod

# Deploy to staging
gh workflow run deploy.yml -f environment=staging
```

### Deploy via Railway CLI

```bash
# Trigger redeploy (rebuilds from source)
railway redeploy --service <service-id>
```

### Rollback

To rollback to a previous version:

1. Go to Railway dashboard → Your service → Deployments
2. Find the previous successful deployment
3. Click the three dots menu → "Rollback"

## Troubleshooting

### Deploy fails with "service not found"

- Verify `RAILWAY_SERVICE_ID` is correct in GitHub secrets
- Check the service exists in your Railway project

### Deploy fails with "unauthorized"

- Verify `RAILWAY_TOKEN` is valid and not expired
- Regenerate token if needed

### App crashes on Railway

- Check Railway logs: `railway logs` or view in dashboard
- Verify all environment variables are set
- Check the `/health` endpoint responds

### Health check fails

- Ensure your app has a `/health` endpoint
- Check the PORT environment variable is being used
- View logs to see startup errors

### MongoDB connection fails

- Verify `MONGODB_URI` is correct
- Check MongoDB Atlas network access allows `0.0.0.0/0`
- Verify database user credentials

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
