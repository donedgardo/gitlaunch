# LaunchPad Marketing Research & Strategy

_Research conducted: January 17, 2026_

---

## Executive Summary

LaunchPad fills a gap in the deployment tooling market: **a simple deployment dashboard for GitHub Actions with manual triggers**. While competitors focus on either full CI/CD pipelines (Octopus, Harness) or pure analytics (Sleuth, Faros), LaunchPad provides the missing piece—a clean UI to promote builds between environments.

---

## Competitive Landscape

### Direct Competitors

#### 1. Sleuth ([sleuth.io](https://www.sleuth.io/))

- **What it does**: Real-time deployment tracking with DORA metrics
- **Pricing**: Free tier available, paid starts at $30/month
- **Strengths**: Engineering efficiency metrics, deployment impact tracking
- **Weakness**: Analytics-focused, doesn't trigger deployments
- **Integrations**: GitHub, Jira, CircleCI, Datadog, LaunchDarkly

#### 2. Faros AI ([faros.ai](https://www.faros.ai))

- **What it does**: Engineering analytics and release tracking
- **Pricing**: Free tier, paid starts at $15/month
- **Strengths**: DORA metrics, AI coding tool ROI measurement
- **Weakness**: Enterprise-focused, complex setup
- **Target**: Mid-size to Enterprise

#### 3. GitHub Native Deployment Views

- **What it does**: Built-in deployment dashboard (GA April 2024)
- **Pricing**: Free with GitHub
- **Strengths**: Native integration, pin up to 10 environments
- **Weakness**: No manual deploy triggers, no cross-repo unified view
- **Source**: [GitHub Changelog](https://github.blog/changelog/2024-04-25-github-actions-deployment-views-across-environments-ga/)

### Adjacent Competitors (Full CI/CD Platforms)

| Tool               | Pricing                           | Positioning                      | Why LaunchPad is Different        |
| ------------------ | --------------------------------- | -------------------------------- | --------------------------------- |
| **Octopus Deploy** | Free (10 projects), Pro ~$100+/mo | Enterprise deployment automation | Too complex for small teams       |
| **Harness**        | Free tier, Enterprise pricing     | ML-based deployment verification | Overkill for GitHub Actions users |
| **Vercel/Netlify** | Free, Pro $19-20/user/mo          | Frontend auto-deploy             | No manual environment promotion   |
| **ArgoCD/Flux**    | Open source                       | GitOps for Kubernetes            | Requires K8s expertise            |
| **Jenkins**        | Open source                       | General CI/CD                    | Complex to maintain               |

### Market Gap Analysis

```
                    Simple ◄─────────────────────► Complex
                        │                              │
         Triggers       │   ★ LaunchPad               │
         Deployments    │                              │  Octopus
                        │                              │  Harness
                        │                              │
        ────────────────┼──────────────────────────────┼────────────
                        │                              │
         Tracks Only    │   Sleuth                     │  Faros AI
                        │   GitHub Native              │
                        │                              │
```

**LaunchPad's unique position**: Simple + Triggers Deployments

---

## Pricing Strategy

### Research Insights

Based on [developer tools pricing research](https://www.getmonetizely.com/articles/developer-tool-pricing-strategy-how-to-gate-technical-features-and-structure-code-quality-tool-tiers):

- **15-25% conversion rates** achievable with strong product-market fit
- **80% of developer tools** offer some form of free tier
- **38% of developers** abandon tool evaluations due to confusing pricing
- **45% of dev tools** now use usage-based pricing (up from 34% in 2020)
- **Datadog's S-1**: 40% of paying customers started on free tier

### Pricing Principles

1. **Free tier must demonstrate core value** - Don't over-gate essential features
2. **Natural upgrade triggers** - Align with team growth (3rd user, private repos)
3. **Transparent pricing** - No "contact sales" for standard tiers
4. **Usage-based where sensible** - Repos/users, not arbitrary limits

### Recommended Pricing Tiers

| Tier           | Price  | Target Audience         | Features                                                           |
| -------------- | ------ | ----------------------- | ------------------------------------------------------------------ |
| **Free**       | $0/mo  | Solo devs, OSS projects | 1 public repo, 1 user, basic dashboard, community support          |
| **Pro**        | $19/mo | Small teams, startups   | 5 repos, 5 users, private repos, monorepo support, email support   |
| **Team**       | $49/mo | Growing teams           | 20 repos, 20 users, SSO/SAML, audit logs, priority support         |
| **Enterprise** | Custom | Large organizations     | Unlimited repos/users, SLA, dedicated support, custom integrations |

### Pricing Rationale

**Why $19/mo for Pro:**

- Aligns with Vercel Pro ($20/user/mo), Netlify Pro ($19/user/mo)
- Below Sleuth's $30/mo entry point
- Psychological "under $20" threshold
- Accessible for individual developers expensing tools

**Why $49/mo for Team:**

- Sweet spot for 5-20 person teams
- SSO requirement is natural enterprise trigger
- Below Octopus Pro pricing

### Feature Gating Strategy

| Feature              | Free      | Pro   | Team     | Enterprise |
| -------------------- | --------- | ----- | -------- | ---------- |
| Public repositories  | 1         | 5     | 20       | Unlimited  |
| Private repositories | ❌        | ✅    | ✅       | ✅         |
| Team members         | 1         | 5     | 20       | Unlimited  |
| Monorepo support     | ❌        | ✅    | ✅       | ✅         |
| API access           | ✅        | ✅    | ✅       | ✅         |
| SSO/SAML             | ❌        | ❌    | ✅       | ✅         |
| Audit logs           | ❌        | ❌    | ✅       | ✅         |
| SLA                  | ❌        | ❌    | ❌       | ✅         |
| Support              | Community | Email | Priority | Dedicated  |

---

## Branding & Messaging

### Brand Positioning

**One-liner**: "The deployment dashboard for GitHub Actions"

**Elevator pitch**: "LaunchPad gives you a simple dashboard to see what's deployed where and promote builds between environments with one click. It works with your existing GitHub Actions workflows—no migration needed."

### Tagline Options

1. **"Deploy with confidence"** ← Recommended (outcome-focused)
2. "Your GitHub Actions control center"
3. "See what's deployed. Deploy what's ready."
4. "Deployments, simplified."

### Key Differentiators

| Differentiator             | Why It Matters                                        |
| -------------------------- | ----------------------------------------------------- |
| **Manual deploy triggers** | Promote specific builds to staging/prod on demand     |
| **Real-time status**       | SSE-powered live updates, no refresh needed           |
| **GitHub-native**          | Works with existing Actions workflows, zero migration |
| **Simple**                 | Not another complex DevOps platform to learn          |

### Competitive Messaging

| Competitor        | Our Message                                                                    |
| ----------------- | ------------------------------------------------------------------------------ |
| vs GitHub Native  | "GitHub shows deployment history. LaunchPad lets you **trigger** deployments." |
| vs Sleuth         | "Less metrics, more action. **Deploy**, don't just track."                     |
| vs Octopus Deploy | "Enterprise power, **startup simplicity**."                                    |
| vs Vercel/Netlify | "For **any** stack, not just frontend. **You** decide when to deploy."         |

### Tone & Voice

- **Developer-friendly**: Technical but not jargon-heavy
- **Confident**: We solve a real problem
- **Honest**: Clear about what we do and don't do
- **Concise**: Respect developers' time

---

## Landing Page Strategy

### Page Structure

```
┌─────────────────────────────────────────────────────────────┐
│ Nav: Logo | Features | Pricing | Docs | Login | Get Started │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  HERO SECTION                                               │
│  "Deploy with confidence"                                   │
│  A simple dashboard to manage GitHub Actions deployments    │
│                                                             │
│  [Start Free]  [Watch Demo]                                 │
│                                                             │
│  ┌─────────────────────────────────────────┐               │
│  │  Dashboard Screenshot/Animation         │               │
│  └─────────────────────────────────────────┘               │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  PROBLEM SECTION                                            │
│  "GitHub Actions is powerful, but..."                       │
│                                                             │
│  ❌ No easy way to promote builds between environments      │
│  ❌ No unified view across multiple repos                   │
│  ❌ No simple UI for non-technical stakeholders             │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  FEATURES SECTION (3-4 key features)                        │
│                                                             │
│  🚀 One-Click Deploys    📊 Real-Time Status               │
│  Deploy any build to     See deployment progress            │
│  any environment         as it happens                      │
│                                                             │
│  📁 Multi-Repo Dashboard  👥 Team Collaboration            │
│  All your services in    Role-based access for              │
│  one place               your whole team                    │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  HOW IT WORKS                                               │
│  1. Connect GitHub App                                      │
│  2. Select repositories                                     │
│  3. Deploy with one click                                   │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  PRICING SECTION                                            │
│                                                             │
│  ┌────────┐  ┌────────┐  ┌────────┐  ┌────────┐           │
│  │ Free   │  │ Pro    │  │ Team   │  │Enterprise│          │
│  │ $0     │  │ $19/mo │  │ $49/mo │  │ Custom  │           │
│  └────────┘  └────────┘  └────────┘  └────────┘           │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  SOCIAL PROOF (future)                                      │
│  Logos | Testimonials | GitHub stars                        │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  FINAL CTA                                                  │
│  "Ready to simplify your deployments?"                      │
│  [Get Started Free]                                         │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│  FOOTER                                                     │
│  Links | Social | Legal                                     │
└─────────────────────────────────────────────────────────────┘
```

### Design Principles

1. **Clean and minimal** - Developer tools should feel professional
2. **Show the product** - Dashboard screenshot/demo above the fold
3. **Fast loading** - Static HTML, minimal JS
4. **Mobile responsive** - Developers browse on phones too
5. **Dark mode friendly** - Match developer preferences

### Color Palette Suggestion

- **Primary**: Blue (#3B82F6) - Trust, technology
- **Accent**: Green (#10B981) - Success, deployment
- **Background**: White/Dark options
- **Text**: Gray scale for readability

---

## Success Metrics

### Landing Page KPIs

| Metric            | Target           |
| ----------------- | ---------------- |
| Bounce rate       | < 50%            |
| Time on page      | > 60 seconds     |
| CTA click rate    | > 5%             |
| Signup conversion | > 2% of visitors |

### Business KPIs

| Metric                    | Target (Year 1) |
| ------------------------- | --------------- |
| Free signups              | 1,000           |
| Free → Pro conversion     | 10-15%          |
| Monthly recurring revenue | $2,000          |
| Churn rate                | < 5% monthly    |

---

## Sources

- [Octopus Deploy Alternatives - Northflank](https://northflank.com/blog/octopus-deploy-alternatives)
- [Octopus Deploy Pricing](https://octopus.com/pricing/overview)
- [Sleuth Pricing - Capterra](https://www.capterra.com/p/206196/Sleuth/)
- [Faros AI - Capterra](https://www.capterra.com/p/250528/Faros-AI/)
- [Developer Tools Pricing Strategy - Monetizely](https://www.getmonetizely.com/articles/developer-tool-pricing-strategy-how-to-gate-technical-features-and-structure-code-quality-tool-tiers)
- [Vercel vs Netlify - Northflank](https://northflank.com/blog/vercel-vs-netlify-choosing-the-deployment-platform-in-2025)
- [GitHub Deployment Views GA](https://github.blog/changelog/2024-04-25-github-actions-deployment-views-across-environments-ga/)
- [G2 Octopus Deploy Alternatives](https://www.g2.com/products/octopus-deploy/competitors/alternatives)
- [SaaS Pricing Strategy - Lizard Global](https://www.lizard.global/blog/saas-pricing-strategy-for-your-application-in-2025)
