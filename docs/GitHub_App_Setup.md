# GitHub App Setup

How to create the GitHub App GitLaunch uses to list repos and dispatch
workflows. Skip this entirely for local work by setting `USE_FAKE_GITHUB=true`.

## 1. Create the app

Go to [github.com/settings/apps/new](https://github.com/settings/apps/new).

| Field          | Value                                                |
| -------------- | ---------------------------------------------------- |
| App name       | `GitLaunch-Dev` (or your own)                        |
| Homepage URL   | `http://localhost:3050`                              |
| Callback URL   | `http://localhost:3050/auth/github/callback`         |
| Setup URL      | `http://localhost:3050/github/installation/callback` |
| Webhook URL    | `http://localhost:3050/webhooks/github`              |
| Webhook secret | A random string — save it                            |

Swap `http://localhost:3050` for your `PUBLIC_URL` when setting up a deployed
environment.

**Installable on:** "Any account" for a real SaaS install, "Only on this
account" for testing.

## 2. Permissions

| Permission                | Access | Why                        |
| ------------------------- | ------ | -------------------------- |
| Repository → Actions      | Write  | Trigger workflow dispatch  |
| Repository → Metadata     | Read   | List repos (auto-selected) |
| Account → Email addresses | Read   | Get the user's email       |

## 3. Collect the credentials

From the app's settings page: the **App ID** and **Client ID** are shown on the
page; generate a **Client Secret** and a **Private Key** (downloads a `.pem`).
Both are shown once.

## 4. Put them in `.env`

```bash
GH_APP_ID=123456
GH_APP_CLIENT_ID=Iv1.abc123...
GH_APP_CLIENT_SECRET=your_client_secret
GH_APP_WEBHOOK_SECRET=your_webhook_secret
GH_APP_NAME=gitlaunch-dev          # the app's URL slug, used to build install links
```

For the private key, run the helper — it reads the `.pem`, escapes the
newlines, and writes `GH_APP_PRIVATE_KEY` into `.env` for you:

```bash
scripts/add-private-key.sh path/to/your-app.private-key.pem
```

The app reads `GH_APP_PRIVATE_KEY` as a PEM string with `\n` escapes. There is
no base64 variant.

## 5. Install it

Visit `https://github.com/apps/<GH_APP_NAME>/installations/new`, pick an
account and repositories, and install. GitHub redirects to your Setup URL with
an `installation_id`, which GitLaunch stores on the account.

## Reference

- [Creating GitHub Apps](https://docs.github.com/en/apps/creating-github-apps)
- [Installation access tokens](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app)
- [Workflow dispatch API](https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event)
