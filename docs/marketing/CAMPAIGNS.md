# Campaign Register

The live tracker of every alpha-promotion campaign and its UTM codes — every outbound link must be tagged per the convention in [README.md](./README.md).

| Campaign (`utm_campaign`) | Channel (`utm_source`) | Medium (`utm_medium`) | Variant (`utm_content`) | Hypothesis                                                                                                                                                                                                                                         | Tagged URL                                                                                                                                     | Status  | Signups |
| ------------------------- | ---------------------- | --------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ------- |
| `alpha-launch`            | `whatsapp`             | `dm`                  | `warm-dm`               | Hand-sent DMs to lean-team devs in the founder's network are the warmest, highest-signal traffic; primary goal is booking discovery calls, with signups as the referral ceiling to beat.                                                           | `https://gitlaunch.dev/?utm_source=whatsapp&utm_medium=dm&utm_campaign=alpha-launch&utm_content=warm-dm`                                       | Running | 1       |
| `alpha-launch`            | `hn`                   | `post`                | `fear-angle`            | The "3 a.m. deploy, can't say what's live, only one person can roll it back" fear hooks HN's on-call crowd.                                                                                                                                        | `https://gitlaunch.dev/?utm_source=hn&utm_medium=post&utm_campaign=alpha-launch&utm_content=fear-angle`                                        | Planned | 0       |
| `alpha-launch`            | `devto`                | `post`                | `anyone-can-ship`       | Framing GitLaunch as removing the bus-factor ("anyone on the team can ship, not just the one who knows the pipeline") resonates with dev.to readers on small teams.                                                                                | `https://gitlaunch.dev/?utm_source=devto&utm_medium=post&utm_campaign=alpha-launch&utm_content=anyone-can-ship`                                | Planned | 0       |
| `alpha-launch`            | `twitter`              | `social`              | `rollback-angle`        | A short "one-click rollback in any environment" demo clip drives clicks from the dev X/Twitter audience.                                                                                                                                           | `https://gitlaunch.dev/?utm_source=twitter&utm_medium=social&utm_campaign=alpha-launch&utm_content=rollback-angle&utm_term=one-click-rollback` | Planned | 0       |
| `alpha-launch`            | `reddit`               | `community`           | `lean-teams`            | r/devops teams with no platform team want deployment control they can all drive without standing one up.                                                                                                                                           | `https://gitlaunch.dev/?utm_source=reddit&utm_medium=community&utm_campaign=alpha-launch&utm_content=lean-teams&utm_term=no-platform-team`     | Planned | 0       |
| `alpha-launch`            | `newsletter`           | `referral`            | `founder-network`       | Warm intros through the founder network convert far higher than cold channels; measure this as our referral baseline.                                                                                                                              | `https://gitlaunch.dev/?utm_source=newsletter&utm_medium=referral&utm_campaign=alpha-launch&utm_content=founder-network`                       | Planned | 0       |
| `alpha-launch`            | `newsletter`           | `email`               | `daily-alpha-invite`    | The daily agile list already speaks DORA. Readers told for years to "restore service in five minutes with one button" should convert when handed the button. Separate from `founder-network` so this practitioner audience is measured on its own. | `https://gitlaunch.dev/?utm_source=newsletter&utm_medium=email&utm_campaign=alpha-launch&utm_content=daily-alpha-invite`                       | Planned | 0       |

> **Two `newsletter` rows, on purpose.** `founder-network` is the one-off warm blast to the founder network (`referral`). `daily-alpha-invite` is the recurring daily agile newsletter (`email`), a different audience with a different hypothesis. Keeping them apart is what lets the referral baseline stay clean — it is not the fragmentation [OUTREACH-COPY.md](./OUTREACH-COPY.md) warns about, which is about splitting a _single_ send across several tags.

## Known attribution drift

The first warm-DM send did **not** use the tagged URL above. It went out as
`utm_campaign=alpha_launch` (underscore) with `utm_source=dm&utm_medium=whatsapp`
— campaign slug, source and medium all different from what this register
declared, which split one channel across two rows in reporting.

Its single signup is counted on the `whatsapp` row above. Reporting groups by the
raw UTM values, so **that event still sits under `alpha_launch` in the warehouse**
and will not merge with correctly-tagged sends. Nothing rewrites it; the row here
is the reconciled view.

Going forward: the register row is the source of truth. Mint links with
`/campaign-url` rather than hand-writing them, and the slug stays hyphenated
(`alpha-launch`) as the convention in [README.md](./README.md) requires.

## Angles from the canvas

Every campaign above tests one of these positioning angles. Keep copy anchored to them — don't invent new claims.

- **Visibility** — "See exactly what's deployed in every environment." Kills the fear: _we can't say what's live right now._
- **Anyone can ship** — deployment control everyone can drive; removes the bus-factor where only one person knows the pipeline.
- **One-click rollback** — promote or roll back in one click, from anywhere, not just from the one person's laptop.
- **No platform team** — deployment control for lean teams that don't have (and don't want to build) a platform team.
