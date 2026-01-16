# GitHub App Setup Guide

Quick guide to create the GitHub App for GitLaunch.

## 1. Create the GitHub App

1. Go to **GitHub Settings** → **Developer settings** → **GitHub Apps** → **New GitHub App**
2. Or direct link: https://github.com/settings/apps/new

## 2. Basic Info

| Field               | Value                                                      |
| ------------------- | ---------------------------------------------------------- |
| **GitHub App name** | `GitLaunch-Dev` (or your preferred name)                   |
| **Homepage URL**    | `http://localhost:8080` (or your domain)                   |
| **Callback URL**    | `http://localhost:8080/auth/github/callback`               |
| **Setup URL**       | `http://localhost:8080/github/installation/callback`       |
| **Webhook URL**     | `http://localhost:8080/webhooks/github` (optional for now) |
| **Webhook secret**  | Generate a random string (save it!)                        |

## 3. Permissions

### Repository Permissions

| Permission   | Access | Purpose                    |
| ------------ | ------ | -------------------------- |
| **Actions**  | Write  | Trigger workflow dispatch  |
| **Metadata** | Read   | List repos (auto-selected) |

### Account Permissions

| Permission          | Access | Purpose        |
| ------------------- | ------ | -------------- |
| **Email addresses** | Read   | Get user email |

## 4. Where Can This App Be Installed?

Select: **Any account** (for SaaS) or **Only on this account** (for testing)

## 5. Create App & Get Credentials

After creating:

1. Note the **App ID** (shown at top)
2. Note the **Client ID**
3. Generate a **Client Secret** → Save it immediately
4. Generate a **Private Key** → Downloads a `.pem` file

## 6. Environment Variables

Add to your `.env`:

```bash
# GitHub App credentials
GITHUB_APP_ID=123456
GITHUB_APP_CLIENT_ID=Iv1.abc123...
GITHUB_APP_CLIENT_SECRET=your_client_secret_here
GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----"
GITHUB_APP_WEBHOOK_SECRET=your_webhook_secret_here
```

**Private Key Encoding Options:**

Option A - Inline with `\n` (shown above):

```bash
# Replace newlines with \n in the PEM file
GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\nMIIE...\n-----END RSA PRIVATE KEY-----"
```

Option B - Base64 encoded:

```bash
# Encode the entire PEM file
cat your-app.pem | base64 > private-key.b64
GITHUB_APP_PRIVATE_KEY_BASE64=$(cat private-key.b64)
```

## 7. Test Installation

1. Go to: `https://github.com/apps/YOUR-APP-NAME/installations/new`
2. Select your account/org
3. Select repositories (or all)
4. Click Install

You'll be redirected to your callback URL with `installation_id` query param.

## Quick Reference

| What You Need   | Where to Find It                     |
| --------------- | ------------------------------------ |
| App ID          | App settings page, top section       |
| Client ID       | App settings page, "About" section   |
| Client Secret   | Generate in "Client secrets" section |
| Private Key     | Generate in "Private keys" section   |
| Installation ID | Callback URL param after install     |

## Useful Links

- [GitHub App Docs](https://docs.github.com/en/apps/creating-github-apps)
- [Installation tokens](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app)
- [Workflow dispatch API](https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event)
