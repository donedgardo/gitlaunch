# GitLaunch

[![CI](https://github.com/donedgardo/launchpad/actions/workflows/ci.yml/badge.svg)](https://github.com/donedgardo/launchpad/actions/workflows/ci.yml)

Stress-free deployment management for your organization.

GitLaunch is a deployment tracking and management tool that streamlines your deployment process across multiple services and environments.

## Features

- **Deployment Tracking**: Track all deployments with a clear history of what was deployed and when
- **Environment Management**: Manage deployments across environments (staging, production)
- **GitHub Actions Integration**: Trigger deployments via GitHub Actions dispatch
- **Real-time Updates**: Live dashboard updates via Server-Sent Events
- **Multi-Service Support**: Manage multiple services from a single dashboard

## Tech Stack

- **Fastify** - Fast, low overhead web framework
- **HTMX** - Dynamic interfaces without a SPA
- **Handlebars** - Server-side templating
- **MongoDB** - Data persistence
- **TypeScript** - Type-safe development
- **Tailwind CSS** - Utility-first styling

## Getting Started

### Prerequisites

- Node.js 18+
- Yarn
- MongoDB

### Installation

1. Clone the repository:

   ```bash
   git clone https://github.com/your-org/gitlaunch.git
   cd gitlaunch
   ```

2. Install dependencies:

   ```bash
   yarn install
   ```

3. Configure environment:
   ```bash
   cp sample.env .env
   ```
   Fill in the required environment variables.

### Development

```bash
yarn dev
```

### Build & Run

```bash
yarn build
yarn start
```

### Testing

```bash
# Unit tests
yarn test

# E2E tests (requires running server)
yarn test:e2e
```

## Configuration

See `sample.env` for required environment variables:

- `MONGODB_URI` - MongoDB connection string
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` - OAuth credentials
- `GH_ORG` - Your GitHub organization name
- `GH_PAT` - GitHub Personal Access Token for dispatch
- `SERVICES` - Comma-separated list of service names to manage

## License

MIT
