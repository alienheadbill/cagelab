# CageLab Engineering Workflow

This document defines how product ideas become shipped CageLab changes.

The goal is not bureaucracy. The goal is to let the owner move quickly without turning every new idea into an architectural side effect.

## Roles

### Product Owner

The owner controls product taste, priorities, and final acceptance.

The owner is expected to bring rough ideas, incomplete concepts, references to other games, visual instincts, and sudden changes of direction. Ideas do not need to arrive as technical specifications.

The owner decides:
- what fantasy or player experience matters;
- what feels right or wrong in the product;
- which tradeoffs are acceptable;
- what ships after engineering explains the consequences.

### Engineering Lead — ChatGPT

The engineering lead translates product intent into executable work.

Responsibilities:
- inspect the current code and roadmap before proposing implementation;
- challenge ideas that are contradictory, disproportionately expensive, misleading, legally risky, or incompatible with existing systems;
- distinguish a good idea from a good idea at the wrong time;
- define scope, dependencies, acceptance criteria, and non-goals;
- decide whether work should be a feature, bug fix, experiment, research task, or backlog item;
- review implementation for architecture, compatibility, determinism, persistence, and product consistency;
- keep GitHub issues, PRs, and documentation aligned with the actual code.

The engineering lead should not agree with an idea merely because the owner likes it. A useful response can be: yes, yes but later, prototype first, or no and here is why.

### Implementation Engineer — Claude

Claude Code is treated as an implementation engineer when used on this repository.

Responsibilities:
- implement the scoped issue, not an expanded interpretation of it;
- preserve existing behavior outside the stated scope;
- add or update reproducible tests when behavior changes;
- report unexpected findings separately rather than silently fixing unrelated systems;
- keep the working tree clean and provide a precise implementation/validation report.

Claude's repository-specific rules live in CLAUDE.md.

### Cross-review rule

Whenever practical, the engineer that did not implement the change should review it.

Typical flow:
- ChatGPT scopes → Claude implements → ChatGPT reviews.
- ChatGPT implements → Claude reviews.
- For tiny fixes, one engineer may implement and the other can review the diff after the fact.

AI review does not replace the owner's product judgment. The owner still decides whether the result feels right.

## 1. Idea intake

A raw idea starts as a product idea, not a coding task.

Before implementation, engineering answers seven questions:

1. Player value — what becomes more fun, clear, strategic, expressive, or believable?
2. Product fit — does it reinforce CageLab's core identity?
3. Technical feasibility — can it be built with the current architecture and data?
4. Dependency order — does another system need to exist first?
5. Complexity — is the implementation cost proportional to the payoff?
6. Compatibility — could it break saves, seeded modes, scoring, or existing careers?
7. Evidence/risk — does it rely on unverified data, legal assumptions, or fake simulation logic?

The result is one of four dispositions:

- ACCEPT NOW — valuable, feasible, and correctly ordered.
- BACKLOG — good idea, wrong dependency order or priority.
- EXPERIMENT — promising but needs a prototype or measurement before becoming a rule.
- REJECT — conflicts with the product, creates misleading mechanics, or costs more than it is worth.

Rejected ideas are not treated as failures. The reason should be recorded so the same dead end does not need to be rediscovered later.

## 2. Ready-for-development issue

Meaningful work should have a GitHub issue or an equivalently explicit PR scope before implementation.

A ready issue contains:
- problem or player fantasy;
- current behavior;
- desired behavior;
- acceptance criteria;
- explicit non-goals;
- compatibility constraints;
- validation plan;
- roadmap relationship when relevant.

Large ideas should be decomposed into independently reviewable phases. A phase should produce a coherent result, not merely move code around.

## 3. Branches

Do not develop directly on main.

Preferred branch prefixes:
- feature/ for player-facing additions;
- fix/ for bugs;
- chore/ for maintenance and tooling;
- docs/ for documentation-only work;
- experiment/ for intentionally disposable or exploratory work.

Existing historical branch names do not need to be renamed. This is the convention for new work.

One branch should have one primary purpose.

## 4. Implementation rules

During implementation:

- Do not expand scope just because nearby code is imperfect.
- Unexpected bugs become a separate issue unless they block the current work.
- Avoid broad refactors inside product PRs.
- Preserve seeded RNG consumption deliberately. Changing draw order is a gameplay change.
- Preserve old saves unless the issue includes a migration strategy.
- Do not silently change GOAT Score, Build Value, combat formulas, ranking rules, or title rules as cleanup.
- New domain logic should prefer pure modules under src/lib or src/data over more orchestration inside App.jsx.
- UI components should not become hidden sources of gameplay truth.
- Client presentation randomness must not affect deterministic gameplay outcomes.
- Database/security assumptions must be verifiable from checked-in migrations/policies or clearly documented as unverified.

## 5. Validation

The baseline verification gate is:

    npm ci
    npm run lint
    npm test
    npm run build

A behavior-changing PR also needs targeted validation appropriate to the feature.

Examples:
- seeded feature: same seed produces identical gameplay output;
- persistence change: old save shape still loads;
- career engine change: deterministic simulation regression cases;
- responsive UI change: mobile and desktop checks;
- Daily change: fairness and date/assignment semantics;
- scoring change: fixture cases around every threshold.

A PR must not claim a suite of checks that cannot be reproduced from the repository unless the PR clearly labels them as manual/ad-hoc evidence.

## 6. Pull request contract

Every PR should explain:
- why the change exists;
- what changed;
- what intentionally did not change;
- how it was validated;
- compatibility/risk;
- follow-up work discovered but not included.

A giant PR body is not a substitute for tests or architecture.

Prefer multiple focused PRs over a single branch that mixes feature work, cleanup, unrelated bugs, and roadmap rewriting.

## 7. Review

Review is adversarial in the healthy engineering sense: try to prove the change wrong before trusting it.

The reviewer checks:
- acceptance criteria;
- hidden scope expansion;
- edge cases and null/empty paths;
- deterministic RNG ordering;
- stale state and reload behavior;
- save compatibility;
- duplicated sources of truth;
- scoring/combat behavior changes;
- mobile/responsive behavior when UI changed;
- claims in comments and PR text against actual code;
- whether tests would fail if the new behavior regressed.

Review findings are classified:
- BLOCKER — correctness, data loss, security, deterministic fairness, or major product mismatch.
- REQUIRED — should be fixed before merge.
- FOLLOW-UP — real problem, separate scope.
- NIT — optional clarity/style improvement.

## 8. Merge

A change is ready to merge when:
- the scope is understood;
- acceptance criteria are satisfied;
- CI is green;
- required review findings are resolved;
- no known blocker is hidden in a follow-up note;
- the owner has approved meaningful player-facing changes.

Use squash merge for small/focused PRs when the intermediate commits have no lasting value. Preserve separate commits when they document meaningful independent steps.

## 9. After merge

After merging:
- update roadmap status only if the merge actually changes a roadmap milestone;
- close or update linked issues;
- create follow-up issues for real deferred findings;
- delete stale branches when practical;
- do not describe unmerged work as shipped.

## 10. Architectural guardrails

The following systems deserve extra caution:

### Seeded modes
Daily and Challenge depend on reproducibility. RNG consumption order is part of behavior, not an implementation detail.

### Persistence
Saved builds, active careers, career history, Daily stats, and settings exist across versions. Additive schema changes are preferred; migrations must be explicit.

### Career simulation
career.js is a large domain engine. New simulation behavior should be isolated behind pure functions where possible and covered by deterministic regression tests.

### Scoring
GOAT Score, Build Value, and combat effectiveness answer different questions. Do not collapse them into one number or modify one while pretending to change another.

### Daily Challenge
Daily requires a shared authoritative definition of the day's challenge if competitive comparison matters. Local-client coincidence is not enough for a production fairness guarantee.

### Historical data
Development fixtures are not historical claims. Real event/card data requires provenance and legal/product review before being presented as fact.

## 11. Owner idea rule

The owner is allowed to propose anything.

Engineering is required to explain which of these is true:

- It is feasible and worth doing.
- It is feasible but should wait.
- It is feasible only as an experiment because the design assumption is unproven.
- It is technically possible but a bad product or maintenance tradeoff.
- It is not currently possible because required data, infrastructure, rights, or dependencies do not exist.

The point is to protect the product without killing creative exploration.
