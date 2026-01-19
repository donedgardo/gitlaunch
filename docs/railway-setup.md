# Railway Deployment Setup

This document describes how to set up Railway deployment for GitDeploy.

## Prerequisites

- Railway account at [railway.app](https://railway.app)
- GitHub repository access (to add secrets)

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

Option A - Create new project:

```bash
cd /path/to/launchpad
railway init
```

Option B - Link to existing project:

```bash
railway link
```

## Step 4: Configure Railway Service

In the Railway dashboard:

1. Go to your project
2. Add a new service (or use existing)
3. Connect to your GitHub repo OR deploy via CLI
4. Configure environment variables in Railway:

| Variable                  | Description                                                        |
| ------------------------- | ------------------------------------------------------------------ |
| `MONGODB_URI`             | MongoDB connection string (use Railway's MongoDB or MongoDB Atlas) |
| `PORT`                    | Set to `3000` (Railway sets this automatically)                    |
| `PUBLIC_URL`              | Your Railway app URL (e.g., `https://your-app.up.railway.app`)     |
| `COOKIE_SECRET_SIGNATURE` | Random secret for signing cookies                                  |
| `GH_APP_ID`               | GitHub App ID                                                      |
| `GH_APP_CLIENT_ID`        | GitHub App Client ID                                               |
| `GH_APP_CLIENT_SECRET`    | GitHub App Client Secret                                           |
| `GH_APP_PRIVATE_KEY`      | GitHub App Private Key (base64 encoded)                            |
| `GH_APP_NAME`             | GitHub App name                                                    |

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

The GitHub Actions workflow (`.github/workflows/ci.yml`) will automatically deploy on every push to `main` after tests pass.

### Manual Deploy (optional)

You can also deploy manually via CLI:

```bash
railway up
```

## Workflow Overview

```
Push to main
    ↓
┌─────────────────┐
│ Quality Checks  │ (type check, format, unit tests)
└────────┬────────┘
         ↓
┌─────────────────┐
│Integration Tests│ (E2E with Playwright)
└────────┬────────┘
         ↓
┌─────────────────┐
│ Deploy Railway  │ (only on main, after tests pass)
└─────────────────┘
```

## Troubleshooting

### Deploy fails with "service not found"

- Verify `RAILWAY_SERVICE_ID` is correct
- Check the service exists in your Railway project

### Deploy fails with "unauthorized"

- Verify `RAILWAY_TOKEN` is valid and not expired
- Regenerate token if needed

### App crashes on Railway

- Check Railway logs: `railway logs`
- Verify all environment variables are set
- Ensure `PORT` is not hardcoded (Railway assigns it)

## Useful Commands

```bash
# View logs
railway logs

# Open Railway dashboard
railway open

# Check service status
railway status

# Run command in Railway environment
railway run <command>
```
