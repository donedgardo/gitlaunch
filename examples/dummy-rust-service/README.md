# dummy-rust-service

A very small HTTP service in Rust, standard library only. It answers `/healthz`
and `/version` and 404s everything else. It exists to be deployed, not to be
useful.

## Getting started

```bash
cargo run            # http://localhost:8080
PORT=9000 cargo run  # somewhere else
```

## Commands

| Command                          | What it does                    |
| -------------------------------- | ------------------------------- |
| `cargo test --locked`            | Run the unit tests              |
| `cargo build --release --locked` | Build the shippable binary      |
| `cargo fmt --all -- --check`     | The formatting gate CI enforces |

## CI

| Workflow     | Runs on               | Does                               |
| ------------ | --------------------- | ---------------------------------- |
| `ci.yml`     | push to `main`        | fmt, test, then package the binary |
| `checks.yml` | pull requests         | fmt and test                       |
| `audit.yml`  | Mondays, or by hand   | `cargo audit`                      |
| `deploy.yml` | `v*` tags, or by hand | build and ship to a host           |

## Releasing

Production releases are tag pushes: `git tag v0.3.2 && git push --tags`.

Staging, rollbacks and re-runs are manual: open **Actions → Deploy → Run
workflow** and fill in the three inputs.

| Input      | Meaning                                      |
| ---------- | -------------------------------------------- |
| `target`   | `staging` or `production`                    |
| `revision` | The tag or commit SHA to deploy              |
| `dry_run`  | Build and validate without touching the host |

On-call runs this by hand during incidents, so the form matters — the input
names are in the runbook.

`scripts/deploy.sh` is the actual deploy: `scp` the release binary to
`$DEPLOY_HOST` and `systemctl restart dummy-rust-service@<target>`. It needs
`DEPLOY_HOST` (a repo variable) and `DEPLOY_SSH_KEY` (a repo secret).
