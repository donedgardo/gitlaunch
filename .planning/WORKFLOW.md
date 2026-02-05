# GitLaunch Development Workflow

## Hybrid Approach: GSD + OpenClaw

We use a **hybrid workflow** combining two systems:

| Layer         | Tool                | Purpose                                     |
| ------------- | ------------------- | ------------------------------------------- |
| **Planning**  | GSD (Git Shit Done) | Milestones, roadmaps, phase planning        |
| **Execution** | OpenClaw (Bernard)  | Sub-agent orchestration, TDD cycles         |
| **Tracking**  | Both                | GSD for high-level, git commits for details |

---

## How It Works

### 1. Planning (GSD)

Use Claude Code with `/gsd:*` commands for strategic planning:

- `/gsd:new-milestone` — Define what we're building
- `/gsd:plan-phase` — Break down into phases
- `/gsd:progress` — Check status

### 2. Execution (OpenClaw)

Bernard orchestrates through Discord:

- Receives feature request from you
- Specs out the work (acceptance criteria)
- Spawns sub-agents for TDD implementation
- Monitors progress, pushes commits
- Reports back when complete

### 3. Tracking

- **Commits**: Descriptive messages with TDD phase (red/green/blue)
- **MILESTONES.md**: High-level accomplishments
- **CI**: Automated quality checks

---

## TDD Cycle (Mandatory)

Every feature follows RED → GREEN → BLUE:

```
1. RED    — Write failing test (behavior, not implementation)
2. GREEN  — Minimal code to pass
3. BLUE   — Refactor while tests stay green
```

Commit after each phase:

- `test: [feature] - red`
- `feat: [feature] - green`
- `refactor: [feature] - blue`

---

## Acceptance Tests

For user-facing features, write E2E tests FIRST:

1. **Document WHY** — Why does this matter to users?
2. **Define SUCCESS** — How do we know it works?
3. **Write Given/When/Then** — Acceptance criteria as tests
4. **Build to pass** — Implementation makes tests green

---

## Quick Reference

**Start a feature:**

```
@Bernard [describe what you want built]
```

**Check progress:**

```
@Bernard status on [feature]
```

**Run tests locally:**

```bash
yarn test          # Unit tests
yarn test:e2e      # E2E tests (needs MongoDB)
```

**Push to CI:**
Bernard pushes automatically after each TDD cycle.

---

_Last updated: 2026-02-04_
