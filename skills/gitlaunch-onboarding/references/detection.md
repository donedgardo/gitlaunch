# Detection signals

Detect from evidence in the repo. Never assume a command exists because the
ecosystem usually has one — read the manifest and confirm.

## Package manager

Lockfiles win over manifests. A repo can have a `package.json` and be built by
something else entirely.

| Lockfile                 | Manager | Install                          | Cache key for `actions/setup-node` |
| ------------------------ | ------- | -------------------------------- | ---------------------------------- |
| `yarn.lock`              | yarn    | `yarn install --frozen-lockfile` | `yarn`                             |
| `pnpm-lock.yaml`         | pnpm    | `pnpm install --frozen-lockfile` | `pnpm`                             |
| `package-lock.json`      | npm     | `npm ci`                         | `npm`                              |
| `bun.lockb` / `bun.lock` | bun     | `bun install --frozen-lockfile`  | —                                  |

If several lockfiles are present, the repo is probably a monorepo mid-migration.
Ask which one is authoritative rather than picking the newest.

## Language and stack

| Evidence                          | Stack           | Typical build                         |
| --------------------------------- | --------------- | ------------------------------------- |
| `package.json`                    | Node / JS       | read `scripts.build`; may not exist   |
| `next.config.*`                   | Next.js         | `next build`                          |
| `vite.config.*`                   | Vite            | `vite build`                          |
| `tsconfig.json` without a bundler | TypeScript lib  | `tsc`                                 |
| `pyproject.toml` + `poetry.lock`  | Python / poetry | `poetry install`                      |
| `requirements.txt`                | Python / pip    | `pip install -r requirements.txt`     |
| `go.mod`                          | Go              | `go build ./...`                      |
| `Cargo.toml`                      | Rust            | `cargo build --release`               |
| `pom.xml`                         | Java / Maven    | `mvn -B package`                      |
| `build.gradle*`                   | Java / Gradle   | `./gradlew build`                     |
| `Gemfile`                         | Ruby            | `bundle install`                      |
| `*.csproj` / `*.sln`              | .NET            | `dotnet build`                        |
| `composer.json`                   | PHP             | `composer install`                    |
| `Dockerfile`                      | containerised   | `docker build` — often _is_ the build |

A `Dockerfile` alongside a language manifest usually means the deploy artifact is
an image. That changes what "build" means: the build workflow should build and
push the image, and the `buildId` should still be the commit SHA so GitLaunch can
link it to the commit.

## Build and test commands

Read them; do not guess.

- Node: `package.json` → `scripts`. Check for `build`, `test`, `lint`, `ci`.
- Make: `Makefile` → look for `build:`, `test:`, `all:` targets.
- Python: `pyproject.toml` `[tool.poetry.scripts]`, or a `tox.ini` / `noxfile.py`.
- Rust: `cargo build` / `cargo test` are safe defaults.
- Go: `go build ./...` / `go test ./...` are safe defaults.

If no build command exists, say so. Some services (a Python worker, a static
site) genuinely have none, and the build workflow should just run tests and
report.

## Default branch

GitLaunch dispatches deploys against the default branch, and the build-report
snippet is gated to it.

```bash
git symbolic-ref --short refs/remotes/origin/HEAD   # e.g. origin/main
gh repo view --json defaultBranchRef -q .defaultBranchRef.name
```

If the default branch is not `main`, the snippet's
`if: github.ref == 'refs/heads/main'` guard must be changed to match, or builds
will never report. This is a common silent failure — check it.

## Monorepo

Signals: `packages/`, `apps/`, `pnpm-workspace.yaml`, `turbo.json`, `nx.json`,
`lerna.json`, a `workspaces` key in `package.json`, or multiple `Dockerfile`s.

A GitLaunch service maps to **one deployable unit**. In a monorepo, ask which
directory this service ID corresponds to, then scope the build workflow's
`paths:` trigger and working directory to it. Do not wire the whole repo to one
service unless the user says that is what they want.

## Existing CI/CD

| Path                                       | System          |
| ------------------------------------------ | --------------- |
| `.github/workflows/*.yml`, `*.yaml`        | GitHub Actions  |
| `Jenkinsfile`, `jenkins/`, `*.jenkinsfile` | Jenkins         |
| `.gitlab-ci.yml`                           | GitLab CI       |
| `.circleci/config.yml`                     | CircleCI        |
| `.travis.yml`                              | Travis          |
| `.drone.yml`                               | Drone           |
| `.buildkite/`                              | Buildkite       |
| `azure-pipelines.yml`                      | Azure Pipelines |
| `bitbucket-pipelines.yml`                  | Bitbucket       |
| `.teamcity/`                               | TeamCity        |

Presence of a workflow file does not mean it builds. A repo whose only workflow
is `stale.yml` or `dependabot-auto-merge.yml` has **no build pipeline** — treat
it as Case A. Read what the workflows actually do before classifying.

Likewise, check whether existing workflows are disabled (`if: false`, or
`gh workflow list` showing them inactive).
