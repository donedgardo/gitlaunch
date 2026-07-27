# Platform Delivery: Control Plane + Pull Agents

**Status:** direction set 2026-07-27. Release + promotion model implemented; delivery adapters not started.

## The shift

Everything GitLaunch ships today is **push**: `planDispatch()` computes a plan and a
`ProviderDispatcher` triggers someone else's pipeline (GitHub Actions, Jenkins, or a raw
webhook). GitLaunch never executes a deploy and holds no state about what is actually
running.

Enterprise delivery to **any cloud provider or edge device** cannot work that way. An edge
box behind NAT has no inbound path, and "what should this fleet be running?" is a question
about desired state, not about a pipeline run.

So delivery inverts: GitLaunch becomes a **control plane** that records desired state, and a
**GitLaunch agent** in each cluster / edge device / cloud runner polls and reconciles.

```
GitLaunch control plane   (desired state: "prod wants 1.4.2")
        ▲ poll (agent-initiated — works behind NAT)
        │
  [agent in cluster]   ──helm upgrade──────▶  workload
  [agent on edge box]  ──helm / k3s───────▶  workload
  [agent in runner]    ──terraform apply──▶  cloud account
```

The CI-dispatch path is **not** replaced. Cutting a release stays a CI concern — CI builds
the artifacts and calls GitLaunch to cut the release. Only the _delivery_ half inverts.

### Cost of this choice (accepted)

- GitLaunch takes custody of Terraform state and cloud credentials — a materially larger
  security surface than the current model, where the customer's CI holds everything.
- A new artifact to build, sign, version, and support: the agent binary.
- Agent↔control-plane needs its own authn (per-environment enrollment tokens), which does
  not exist yet.

## Domain model

**Release** — immutable, versioned, provider-agnostic. Artifacts are _references_, never
rendered manifests, so one release can land on a managed cluster, a bare-metal k3s box, or
a cloud account:

| Artifact kind      | Carries                    | Read by          |
| ------------------ | -------------------------- | ---------------- |
| `container-image`  | repository + **digest**    | every target     |
| `helm-chart`       | repository, chart, version | Helm/K8s targets |
| `terraform-module` | source, version            | cloud targets    |

Images are pinned by digest, not tag. An edge fleet reconciling a week-late release must
resolve the same bytes the release was cut from; tags are mutable, digests are not.

Immutability is enforced by a unique index on `(accountId, serviceId, version)`. Re-cutting
a version is refused, never silently overwritten — an agent that asks "what is 1.4.2?" days
after promotion must always get the same answer.

**Promotion** — how a release becomes an environment's desired state. There is no dispatch:
**the write is the deploy.** `planPromotion()` is a pure function gating it on the service's
existing ordered `environments` — a release reaches an environment only after every
lower-`order` environment already desires it. `order` is treated as relative, so sparse or
renumbered orders behave identically.

**DesiredRelease** — one row per `(service, environment)`: the release its agent should be
running, plus a monotonic `generation`. The generation makes a poll an integer comparison
rather than a manifest diff, and makes a rollback to a previously-deployed version read as
a change (same version, higher generation).

Rollback is not a special case: promoting an older release is an ordinary promotion.

## Built so far

| Piece                       | Location                                       |
| --------------------------- | ---------------------------------------------- |
| Artifact + release types    | `src/services/release/release.ts`              |
| Promotion gate (pure core)  | `src/services/release/planPromotion.ts`        |
| Immutable release store     | `src/repositories/releaseRepository.ts`        |
| Desired state for agents    | `src/repositories/desiredReleaseRepository.ts` |
| Cut + promote orchestration | `src/services/release/releaseService.ts`       |

This layer is deliberately transport-agnostic: it holds under push _or_ pull, so none of it
is throwaway if the agent rollout is staged.

## Not built yet

Roughly in dependency order:

1. **DeploymentTarget** — where an environment actually runs (cluster ref + namespace, cloud
   account + region, edge fleet selector). Today `Environment` is just a name and an order.
2. **Agent enrollment + authn** — per-environment tokens, agent identity, revocation.
3. **Agent poll API** — `GET` desired state by generation; the pull half of the contract.
4. **Reconcile status reporting** — agents report applied/failed back. The existing
   `DeploymentStatus` state machine and reporter contract are the natural seam.
5. **Delivery adapters** — Helm renderer and Terraform runner, per target kind.
6. **Enterprise tier** — `Plan` is currently Free/Pro/Team; Enterprise is listed as out of
   scope in `.planning/REQUIREMENTS.md` and needs adding before any of this can be gated.

## Deferred decisions

- **Promotion override / hotfix** — the ordered gate has no break-glass path. Enterprise
  customers will want one, with an audit trail.
- **Terraform state custody** — where state lives, how it is locked, who can read it.
- **Promotion history** — `desiredReleases` holds only current state; audit needs an append
  log.
- **Approval gates** — promotion is currently immediate for anyone with access.
