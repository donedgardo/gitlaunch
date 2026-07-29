# Market & Pricing Research

_Snapshot: January 2026. Competitor pricing and features drift — re-check before
quoting any of it. Messaging is owned by the [positioning canvas](./positioning/README.md),
not this file._

GitLaunch sits in a gap in the deployment tooling market: competitors are either
full CI/CD platforms (Octopus, Harness) or pure analytics (Sleuth, Faros).
Neither gives a small team a clean way to see what's deployed and promote a
build between environments.

## Competitive landscape

### Direct

| Tool                             | What it does                                | Pricing (Jan 2026)          | Why we're different                        |
| -------------------------------- | ------------------------------------------- | --------------------------- | ------------------------------------------ |
| [Sleuth](https://www.sleuth.io/) | Deployment tracking with DORA metrics       | Free tier, paid from $30/mo | Analytics-focused; doesn't trigger deploys |
| [Faros AI](https://www.faros.ai) | Engineering analytics and release tracking  | Free tier, paid from $15/mo | Enterprise-focused, complex setup          |
| GitHub deployment views          | Built-in deployment dashboard (GA Apr 2024) | Free with GitHub            | No manual triggers, no cross-repo view     |

### Adjacent (full CI/CD platforms)

| Tool               | Pricing                           | Positioning                      | Why we're different               |
| ------------------ | --------------------------------- | -------------------------------- | --------------------------------- |
| **Octopus Deploy** | Free (10 projects), Pro ~$100+/mo | Enterprise deployment automation | Too complex for small teams       |
| **Harness**        | Free tier, Enterprise pricing     | ML-based deployment verification | Overkill for GitHub Actions users |
| **Vercel/Netlify** | Free, Pro $19-20/user/mo          | Frontend auto-deploy             | No manual environment promotion   |
| **ArgoCD/Flux**    | Open source                       | GitOps for Kubernetes            | Requires K8s expertise            |
| **Jenkins**        | Open source                       | General CI/CD                    | Complex to maintain               |

The gap we occupy: **simple _and_ triggers deployments**. Sleuth and GitHub's
native views are simple but read-only; Octopus and Harness trigger deploys but
are platform-team tools.

## Pricing

### What shipped

| Tier | Price  | Repos | Services | Users | Environments | Private repos |
| ---- | ------ | ----- | -------- | ----- | ------------ | ------------- |
| Free | $0/mo  | 3     | 3        | 1     | 2            | ✗             |
| Pro  | $19/mo | 10    | 10       | 5     | 10           | ✓             |
| Team | $49/mo | 999   | 999      | 999   | 999          | ✓             |

Plus a 14-day trial, claimable once per subject. **Enterprise means self-hosted**
— GitLaunch licensed to run in the customer's own infrastructure, not a hosted
tier. See [SELF-HOSTING.md](./SELF-HOSTING.md) and
[ENTERPRISE-ROADMAP.md](./ENTERPRISE-ROADMAP.md).

Limits live in `src/repositories/accountRepository.ts`; that file wins over this
table.

### Why those numbers

- **$19 Pro** — matches Vercel Pro ($20/user/mo) and Netlify Pro ($19/user/mo),
  undercuts Sleuth's $30 entry, and stays under the $20 threshold an individual
  developer will expense without asking.
- **$49 Team** — the sweet spot for 5–20 person teams, below Octopus Pro.
- **Free must demonstrate the core value.** Gating the dashboard itself would
  defeat the point; the free tier gates scale (repos, users, private repos).

### Research that informed it

From [developer tool pricing research](https://www.getmonetizely.com/articles/developer-tool-pricing-strategy-how-to-gate-technical-features-and-structure-code-quality-tool-tiers):

- 80% of developer tools offer a free tier; Datadog's S-1 showed 40% of paying customers started on one
- 38% of developers abandon an evaluation over confusing pricing — so no "contact sales" for standard tiers
- 45% of dev tools now use usage-based pricing (up from 34% in 2020)
- 15–25% conversion is achievable with strong product-market fit

Natural upgrade triggers should align with team growth: the second user, the
first private repo.

## Success metrics

| Metric                 | Target           |
| ---------------------- | ---------------- |
| Signup conversion      | > 2% of visitors |
| CTA click rate         | > 5%             |
| Free signups (year 1)  | 1,000            |
| Free → paid conversion | 10–15%           |
| MRR (year 1)           | $2,000           |
| Monthly churn          | < 5%             |

> These were set before launch and are untested. Actual alpha traffic is a
> fraction of what they assume — see [marketing/README.md](./marketing/README.md)
> for what the numbers actually look like.

## Sources

- [Octopus Deploy alternatives — Northflank](https://northflank.com/blog/octopus-deploy-alternatives)
- [Octopus Deploy pricing](https://octopus.com/pricing/overview)
- [Sleuth pricing — Capterra](https://www.capterra.com/p/206196/Sleuth/)
- [Faros AI — Capterra](https://www.capterra.com/p/250528/Faros-AI/)
- [Developer tools pricing strategy — Monetizely](https://www.getmonetizely.com/articles/developer-tool-pricing-strategy-how-to-gate-technical-features-and-structure-code-quality-tool-tiers)
- [Vercel vs Netlify — Northflank](https://northflank.com/blog/vercel-vs-netlify-choosing-the-deployment-platform-in-2025)
- [GitHub deployment views GA](https://github.blog/changelog/2024-04-25-github-actions-deployment-views-across-environments-ga/)
- [SaaS pricing strategy — Lizard Global](https://www.lizard.global/blog/saas-pricing-strategy-for-your-application-in-2025)
