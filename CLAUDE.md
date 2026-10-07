# Claude Code Instructions — CageLab

Before meaningful work, read:
1. README.md
2. docs/ENGINEERING_WORKFLOW.md
3. docs/ARCHITECTURE.md
4. the relevant section of CAGELAB_ROADMAP.md
5. the GitHub issue or PR defining the current scope

## Working rules

- Do not push feature work directly to main.
- Implement the requested scope; do not silently widen it.
- Unexpected bugs or architecture concerns should be reported separately unless they block the task.
- Do not mix broad refactors with gameplay changes.
- Preserve seeded determinism deliberately. RNG call order is behavior.
- Preserve existing save data unless a versioned migration is part of the task.
- Do not change GOAT Score, Build Value, combat formulas, rankings, title rules, or Daily fairness semantics as incidental cleanup.
- Prefer pure logic in src/lib or src/data to additional orchestration in App.jsx.
- Keep presentation randomness separate from gameplay randomness.
- Add or update reproducible tests for behavior-changing work.
- Run npm run lint, npm test, and npm run build before reporting a task complete.
- Do not claim ad-hoc test counts as repository coverage unless the checks are committed or the exact reproducible command/harness is provided.
- Do not mark roadmap work merged/shipped before the relevant PR actually merges.
- Keep comments focused on non-obvious invariants and reasons, not narration of every line.

## Handoff report

At the end of an implementation task, report:
- branch;
- commits;
- files changed;
- behavior changed;
- explicit non-goals preserved;
- validation commands and results;
- unexpected findings;
- known follow-ups;
- whether the branch is clean and pushed.

The report should be specific enough for another engineer to review without reconstructing the whole session.
