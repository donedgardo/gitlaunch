# GitLaunch Positioning

Working artifacts for how we position, market, and sell GitLaunch. Each HTML file is a self-contained design artifact — open it in a browser, or use the shared link.

| Artifact                                                    | Shareable link                                                       | What it's for                                                                                                                                                         |
| ----------------------------------------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Positioning Canvas](./positioning-canvas.html)             | https://claude.ai/code/artifact/e6b2813f-e905-4def-b84d-df5e96af49dd | The shelf we sit on, the six positioning components, the fear that drives the buy, and the 10-second hook.                                                            |
| [Customer Interview Guide](./customer-interview-guide.html) | https://claude.ai/code/artifact/060720b1-f52e-4a16-8902-c7592302ccc8 | Field guide for validating the canvas in customers' own words — the four bets, the questions, and how to synthesize.                                                  |
| [Homepage Hero](./homepage-hero.html)                       | https://claude.ai/code/artifact/b5d1309c-443e-4735-b97b-9d8953f8e2b4 | The landing page built on this positioning — live promote-to-prod board, value trio, the fear, DORA metrics. Shipped as the app homepage (`src/templates/index.hbs`). |
| [Interview Journal](./INTERVIEW-JOURNAL.md)                 | —                                                                    | Running log of every discovery conversation, scored against the guide. Append-only; one entry per call.                                                               |
| [Canvas Review 001](./CANVAS-REVIEW-001.md)                 | —                                                                    | Positioning re-evaluation after interview 001. Verdict: no canvas changes; adds two new bets (branching model as alternative, roll-forward vs. rollback).             |
| [Flags Positioning 001](./FLAGS-POSITIONING-001.md)         | —                                                                    | Where the feature-flag product fits. Verdict: no second shelf; flags are the progressive-delivery leg of the same position. Adds bets 7 and 8.                        |
| [Restore Frame 001](./RESTORE-FRAME-001.md)                 | —                                                                    | Rollback vs. fix-forward is a mechanism split, not a buyer split. Position on time to restore; demotes bet 6, adds bets 9 and 10.                                     |

## The one-line thesis

For **lean teams with no platform team**, GitLaunch is **deployment control everyone can drive** — not another CI/CD tool. It shows exactly what's deployed in every environment and lets anyone promote or roll back in one click.

## Status

Draft v1. The canvas is a set of **bets**, not conclusions — the interview guide exists to test them. Update the canvas after ~8 customer conversations, especially the segment definition, the hook copy, and the lead fear.

**Interviews logged:** 1 (bucket D — practitioner, no buying context). Counting toward the 8: **0**. The canvas is unchanged.

**Open bets:** 10. Bets 1–4 are in the interview guide; 5–6 came from [Canvas Review 001](./CANVAS-REVIEW-001.md); 7–8 from [Flags Positioning 001](./FLAGS-POSITIONING-001.md); 9–10 from [Restore Frame 001](./RESTORE-FRAME-001.md), which also demotes bet 6 from existential to editorial. Bets 5–10 still live only in the review docs — landing them all in `customer-interview-guide.html` is an outstanding action.

> The shared links are private by default. Open the artifact and use the share menu to grant access before sending them around.
