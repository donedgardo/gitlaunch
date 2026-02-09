# GitLaunch Roadmap

> Last updated: 2026-02-09

## Current: v1.1 ✅ (Shipped)

Dashboard & Environment Management

---

## Next: v1.2 — Dashboard Polish & Scale

**Goal:** Make the dashboard production-ready for teams with many builds

### Phases

#### Phase 1: Pagination ✅ (2026-02-09)

**Why:** Teams with 100+ builds can't scroll forever. Performance degrades.
**Success:** Build list loads fast with 1000+ builds, paginated 20 per page.
**Plans:** 3 plans — all complete

Plans:

- [x] 01-01-PLAN.md — TDD: BuildRepository.findPaginated method
- [x] 01-02-PLAN.md — TDD: Dashboard route ?page=N query param handling
- [x] 01-03-PLAN.md — Pagination UI controls (prev/next) with HTMX navigation

#### Phase 2: Build Details View

**Why:** Users need to see deployment logs, timing, and history per build.
**Success:** Clicking a build shows detailed deployment timeline.

| Task | Description                                    | Tests |
| ---- | ---------------------------------------------- | ----- |
| 2.1  | `/dashboard/:service/builds/:buildId` route    | Unit  |
| 2.2  | Build detail template with deployment timeline | E2E   |
| 2.3  | Deployment logs display (if available)         | E2E   |
| 2.4  | Link from build table to detail view           | E2E   |

#### Phase 3: Real-time Dashboard

**Why:** Users shouldn't need to refresh to see deployment progress.
**Success:** Dashboard updates live when deployments change status.

| Task | Description                                 | Tests |
| ---- | ------------------------------------------- | ----- |
| 3.1  | SSE connection auto-reconnect on disconnect | Unit  |
| 3.2  | Visual indicator when connection lost       | E2E   |
| 3.3  | Toast notifications for deployment events   | E2E   |

---

## v1.3 — Notifications

**Goal:** Keep users informed without checking the dashboard

### Phases

#### Phase 1: Email Infrastructure

**Why:** Users need alerts for failed deployments and team invitations.
**Success:** Emails sent via SendGrid/Postmark for key events.

| Task | Description                                 | Tests       |
| ---- | ------------------------------------------- | ----------- |
| 1.1  | Email service abstraction (`EmailServiceI`) | Unit        |
| 1.2  | SendGrid implementation                     | Integration |
| 1.3  | Email templates (invitation, deploy failed) | Unit        |

#### Phase 2: Notification Preferences

**Why:** Users want control over what emails they receive.
**Success:** Settings page with notification toggles per event type.

| Task | Description                              | Tests |
| ---- | ---------------------------------------- | ----- |
| 2.1  | User notification preferences in DB      | Unit  |
| 2.2  | Settings UI for notification preferences | E2E   |
| 2.3  | Check preferences before sending         | Unit  |

#### Phase 3: Deployment Alerts

**Why:** Failed deployments need immediate attention.
**Success:** Email sent within 1 minute of deployment failure.

| Task | Description                              | Tests       |
| ---- | ---------------------------------------- | ----------- |
| 3.1  | Hook into deployment status updates      | Unit        |
| 3.2  | Send email on `error` status             | Integration |
| 3.3  | Rate limiting (no spam on flaky deploys) | Unit        |

---

## v1.4 — Admin & Analytics

**Goal:** Visibility into platform usage and health

### Phases

#### Phase 1: Usage Metrics

**Why:** Need to understand how the platform is being used.
**Success:** Dashboard showing builds/day, active users, deployment success rate.

#### Phase 2: Admin Dashboard

**Why:** Platform operators need oversight of all accounts.
**Success:** Admin-only view of all accounts, usage, and billing status.

---

## v2.0 — Production & Scale

**Goal:** Ready for real production traffic

### Phases

- Database indexes optimization
- Redis caching for hot paths
- Horizontal scaling documentation
- Monitoring & alerting (Sentry, Datadog)
- Load testing results

---

## Backlog (Unprioritized)

- [ ] Slack/Discord notifications (webhook integrations)
- [ ] Deployment rollback triggers
- [ ] Branch filtering (only track main/release branches)
- [ ] Custom deployment workflow templates
- [ ] Team activity audit log
- [ ] Dark mode toggle (currently auto)
- [ ] Mobile-responsive improvements

---

_To start a milestone, tell Bernard which version to work on._
