# GitLaunch Roadmap

Forward-looking design proposals: work we have thought through but not yet
committed to. Each document is a **design conclusion** — the shape of a feature,
the decisions already settled, and the risks still open — written before any
code exists.

This folder is deliberately upstream of `.planning/`. A document here is a
proposal; once it is accepted it becomes phases in
[`.planning/ROADMAP.md`](../../.planning/ROADMAP.md) with plans, success
criteria, and TDD cycles. Nothing here is scheduled until that happens.

| Document                              | Status   | What it covers                                                                                                                          |
| ------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| [GitOps support](./GITOPS-SUPPORT.md) | Proposed | Argo CD / Flux customers. A `gitops` deployment variant, promotion-by-pull-request, config-SHA correlation, and rollback via revert PR. |

## How these connect to the positioning

The [one-line thesis](../positioning/README.md) is that GitLaunch is
**deployment control everyone can drive** — it shows what is deployed in every
environment and lets anyone promote or roll back in one click.

Roadmap proposals are judged against that sentence. GitOps support qualifies
because Argo and Flux answer _"what does the cluster think"_ but not _"what is
my team shipping, what is waiting on me, and how do I put it back."_ A proposal
that only adds another deployment mechanism, without advancing promotion,
visibility, or restore, does not belong here.

## Writing a proposal

Keep the structure that [GITOPS-SUPPORT.md](./GITOPS-SUPPORT.md) uses, because
it is what makes a proposal reviewable:

1. **Why this is different** from what already exists in the codebase. If it is
   not different, it is a plan, not a proposal — write it in `.planning/`.
2. **Domain model changes**, named against real files and existing types.
3. **The load-bearing decision** — the one hard problem, what was rejected, and
   why. Every design has exactly one of these; find it and say it plainly.
4. **What it unlocks in the product**, which is the argument for doing the work.
5. **Phasing** with a success criterion per phase, so it can be lifted into
   `.planning/ROADMAP.md` directly.
6. **Risks and open decisions** left explicitly unresolved.

Ground every claim in the code as it is today. A proposal that describes a
domain model we do not have is fiction, and the phasing derived from it will be
wrong.
