# GitOps support (Argo CD / Flux)

**Status:** Proposed — not yet planned into `.planning/ROADMAP.md`
**Date:** 2026-08-02
**Depends on:** the Phase 10b deployment domain model (provider connection vs
deployment config)

Support customers who deploy with Argo CD or Flux, where nothing GitLaunch does
touches the cluster directly. GitLaunch becomes the promotion, approval, and
rollback layer on top of a reconciler it does not control.

## Why this is different from every provider we have

Every provider today — `github`, `jenkins`, `raw` — is **push**. GitLaunch
triggers a runner; the runner deploys and reports its status back to
`PATCH /api/v1/services/:serviceId/builds/:buildId/deploy/:env`. One actor does
both halves, so correlation is free.

GitOps is **pull**. A controller inside the customer's cluster watches a config
repo and reconciles continuously.

```
today:   GitLaunch --dispatch--> GH Actions / Jenkins --deploys--> cluster
                   <--report---- (same runner)

gitops:  GitLaunch --commit/PR--> config repo
                                       |
                                       v  (pulled by the cluster)
                                  Argo / Flux ---------> cluster
         GitLaunch <--notify----- Argo / Flux
```

Two consequences drive the whole design:

1. **What we dispatch is a proposal.** A promotion pull request can sit unmerged
   for days. "Dispatching" no longer means seconds.
2. **The reconciler reports a different SHA than we sent.** Argo reports the
   **config repo** commit. Our `buildId` is the **app source** commit. Nothing
   in the cluster knows GitLaunch exists.

Correlation is the hard problem here. The git write is the easy part.

## 1. Domain model — one new deployment variant

`src/repositories/serviceRepository.ts`

```ts
export type GitOpsDeployment = {
  provider: "gitops";
  // Desired state lives here. GitHub App-connected, so no new credential store.
  configRepositoryId: ObjectId;
  // Promotion targets, keyed by Service.environments[].name
  environmentPaths: Record<string, string>; // "prod" -> "envs/prod/values.yaml"
  imagePath: string; // dotted YAML path: "image.tag"
  mergeStrategy: "pull-request" | "direct-commit";
  reconciler: "argocd" | "flux"; // selects the status vocabulary
  appName: string; // Argo Application / Flux Kustomization
};

export type Deployment =
  | GithubDeployment
  | JenkinsDeployment
  | RawDeployment
  | GitOpsDeployment;
```

`"gitops"` joins the `CIProvider` union. That name is now wrong — it describes a
deployment mechanism, not a CI system. Rename `CIProvider` →
`DeploymentProvider` as the refactor step; it is mechanical, with the compiler
as the test.

`configRepositoryId` follows the precedent set by `GithubDeployment.repositoryId`:
the dispatch target lives inside the variant, while `Service.repoUrl` still
points at the app source for commit links. GitOps is the case that decision was
made for — here the two really are different repositories.

## 2. Dispatch — a new dispatcher, no change to the selector

`BuildDispatchService` resolves a dispatcher by `provider` from a `Map`, so
adding GitOps means adding a class and registering it. No switch to edit.

```ts
export class GitOpsProviderDispatcher implements ProviderDispatcher {
  readonly provider = "gitops" as const;

  async dispatch({ account, service, buildId, environment }: DispatchContext) {
    // 1. plan (pure) -> GitOpsDispatchPlan | ValidationError
    // 2. read envs/<environment>/values.yaml at HEAD via installation token
    // 3. set imagePath -> buildId, preserving comments and formatting
    // 4. branch + commit, open a PR (or commit to the default branch)
    // 5. record the Promotion
  }
}
```

Keep a pure `planGitOpsDispatch(...): GitOpsDispatchPlan | ValidationError`
alongside `planDispatch` and `planJenkinsDispatch`. It is where "config repo not
connected", "no path configured for environment `prod`", and "imagePath not
found in file" become typed values instead of thrown strings.

**Use a comment-preserving YAML editor.** Values files are human-maintained; a
promotion that reformats the whole file makes the diff unreviewable, which
defeats the point of the PR. We have no YAML library today — this phase adds
one. Choose the `yaml` package and edit through its Document API rather than
`js-yaml`, whose load/dump round trip discards comments and normalizes
formatting.

Credentials: the config repo is GitHub App-connected, so `installationTokenService`
covers writes. No `secretBox` usage and no new secret surface. GitLab and
Bitbucket config repos are a later variant — out of scope for v1.

## 3. Correlation — the design's load-bearing decision

Argo reports _"Application `checkout` synced to revision `abc123`"_, where
`abc123` is a config repo commit. Our `buildId` is the app source SHA.

**Rejected:** annotating rendered manifests with the build id and reading it
back. It requires the customer to edit their chart, and reconciler notification
templates only reliably expose the Application/Kustomization object.

**Chosen: GitLaunch owns the mapping.** A new `PromotionRepository`:

```ts
export type Promotion = {
  _id: ObjectId;
  accountId: ObjectId;
  serviceId: ObjectId;
  buildId: string; // app SHA — what is being promoted
  environment: string;
  configRepositoryId: ObjectId;
  configCommitSha: string | null; // null until the PR merges, then the merge commit
  pullRequestNumber: number | null;
  pullRequestUrl: string | null;
  status: DeploymentStatus;
  createdAt: Date;
  updatedAt: Date;
};
```

Unique index on `(accountId, configRepositoryId, configCommitSha)`. When Argo
reports a sync at `abc123`, we look up the promotion and recover service, build,
and environment. The reconciler needs to know nothing about us.

`Build.deployments: Record<string, DeploymentStatus>` is unchanged — promotions
update it through the existing `BuildService` path, so the dashboard and the SSE
stream need no schema change. A separate collection also matches the domain: a
promotion has its own lifecycle (proposed → approved → merged → reconciled), and
a build has many.

## 4. Status ingress

Argo CD's notifications controller and Flux's notification-controller both POST
arbitrary JSON to a generic webhook with custom headers. The MVP therefore needs
**no new authentication code** — a new route behind `requireScope`, using the
existing `deployments:write` scope that CI reporters already carry:

```
POST /api/v1/gitops/events
{
  "reconciler":   "argocd",
  "appName":      "checkout",
  "revision":     "abc123",
  "syncStatus":   "Synced",
  "healthStatus": "Healthy"
}
```

The customer pastes a notification template into their Argo or Flux config. That
is documentation, not code — the same shape as the existing
`rawBuildReportingGuide.hbs`.

### Status mapping

| Reconciler signal                                          | GitLaunch status            |
| ---------------------------------------------------------- | --------------------------- |
| PR opened, unmerged                                        | `AWAITING_APPROVAL` _(new)_ |
| Merged / direct commit; Argo `OutOfSync`, Flux reconciling | `DEPLOYING`                 |
| Argo `Synced` + `Healthy`; Flux `Ready=True`               | `DEPLOYED`                  |
| Argo `Degraded` or sync failed; Flux `Ready=False`         | `ERROR`                     |
| PR closed unmerged                                         | `CANCELLED`                 |

Additive change to `LEGAL_TRANSITIONS` in `src/services/dispatch/deployStatus.ts`:

```ts
[DeploymentStatus.DISPATCHING]: new Set([
  DeploymentStatus.AWAITING_APPROVAL,
  DeploymentStatus.DEPLOYING,
  DeploymentStatus.CANCELLED,
  DeploymentStatus.ERROR,
]),
[DeploymentStatus.AWAITING_APPROVAL]: new Set([
  DeploymentStatus.DEPLOYING,
  DeploymentStatus.CANCELLED,
  DeploymentStatus.ERROR,
]),
```

`AWAITING_APPROVAL` earns its place rather than reusing `DISPATCHING`.
"Dispatching" means seconds; "awaiting approval" means days, and it is the state
the dashboard exists to surface.

**Timeouts.** If a customer runs Argo without auto-sync, `DEPLOYING` never
resolves. A sweeper marks promotions past a threshold as stale — a derived flag
on age, not a new status — so the dashboard stays honest.

## 5. What this unlocks in the product

This is the argument for doing the work at all.

- **"Waiting on you" lane** — every open promotion PR across all services in one
  list. Argo's UI cannot show this; it only knows what git already says.
- **Promote button** — `Service.environments[].order` is already the ladder.
  Promoting to `prod` copies `staging`'s current digest forward. The data model
  exists today and is unused for this.
- **Approve from GitLaunch** — merge via the installation token, with our own
  role check layered on top of GitHub's.
- **Rollback** — because `Promotion.configCommitSha` records what was live per
  environment, "roll prod back to build X" is a revert PR restoring that file
  content. This is strictly better than a bare `helm rollback`, which does not
  restore externally-managed secrets; here the values and the reference are
  versioned in the same commit.
- **Drift badge** — Argo reporting `OutOfSync` with no open promotion means
  somebody edited the cluster by hand. Surface it.

## Phasing

| Phase | Deliverable                                                    | Success criterion                                                                              |
| ----- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| A     | `GitOpsDeployment` variant + `GitOpsProviderDispatcher`        | Deploying a gitops service opens a PR bumping the image in the right env file, comments intact |
| B     | `PromotionRepository` + `/api/v1/gitops/events` + setup guide  | An Argo sync webhook flips the build to `deployed` on the dashboard                            |
| C     | `AWAITING_APPROVAL` + approvals lane + promote/approve actions | Open promotions are visible and mergeable from GitLaunch                                       |
| D     | Rollback via revert PR                                         | One click restores prod to a prior build's exact config                                        |
| E     | In-cluster agent (enterprise)                                  | Clusters that cannot egress webhooks still report status                                       |

Spec A and B together. The correlation model in B constrains what A's dispatcher
must record; getting that order wrong means reworking the dispatcher.

Phase E is the self-hosted enterprise story — an agent shipped as a Helm chart
that watches Argo `Application` resources and reports outward, for customers
whose clusters cannot POST to the public internet.

## Risks and open decisions

1. **Manifest format.** Helm `values.yaml` vs Kustomize `images:` blocks vs raw
   manifests. A dotted `imagePath` covers Helm and most Kustomize cases; make
   the editor a `ManifestEditor` interface so Kustomize becomes an
   implementation rather than a conditional. Ship Helm only in v1.
2. **Concurrent promotions to one config repo.** Two services promoting at once
   will conflict. Retry-with-rebase on the write, capped, then `ERROR` with a
   readable reason.
3. **Mutable image tags.** If a customer's values use `:latest`, rollback
   silently does not roll back. Validate at setup time and warn.
4. **Auto-sync disabled.** Only detectable from inside the cluster. Mitigation
   is the staleness timeout plus a callout in the setup guide.
5. **API key living in the customer's cluster config.** Scope it to
   `deployments:write` only and make it independently revocable, so a compromised
   cluster cannot read services or write flags.

## Background: why revert-PR beats `helm rollback`

Two facts about the ecosystem that the rollback design leans on.

**Helm already remembers.** Each release revision is stored as a Secret in the
cluster (`sh.helm.release.v1.<release>.v<n>`) holding the chart, the supplied
values, and the rendered manifests. `helm rollback <release> <n>` re-applies
that stored revision, so config and manifests move together.

**But it only remembers what the chart rendered.** A `helm rollback` does not
restore anything living outside the release:

| Secret source                                      | Restored by `helm rollback`?               |
| -------------------------------------------------- | ------------------------------------------ |
| Secret templated in the chart from values          | Yes                                        |
| `existingSecret:` reference                        | Reference only — current contents are used |
| External Secrets Operator / Vault / Sealed Secrets | No — the value is whatever the store holds |
| Mutable image tag (`:latest`)                      | Tag string only — resolves to a new image  |

Reverting a promotion commit closes the first three gaps, because in a GitOps
repo the values and the secret references are versioned in the same commit. It
does not close the mutable-tag gap, which is why risk 3 above matters. Revert
also does not undo schema migrations or consumed events — no rollback mechanism
does.
