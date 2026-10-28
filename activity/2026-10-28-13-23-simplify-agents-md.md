# Simplify project AGENTS.md against system AGENTS.md

Decision: Remove only true duplication with the system chain (`/home/chuck/.dotfiles/agents/AGENTS.md`, imported by `~/.claude/CLAUDE.md`). Keep all project-specific bindings. No version bump: this is a docs-only change, per task instruction and the precedent in `activity/2026-10-28-13-22-close-on-push-rule.md`.

Change: `AGENTS.md` reduced from 61 to 43 lines. The `record-activity` clause is compressed to its local detail only (repo-root `activity/`), because the system file already mandates: "Run `record-activity` after every material change. This is mandatory." The Feature section prose is compressed; all files, functions, settings, behaviour, logging, dependencies, and test steps are kept.

Kept unchanged in substance: beads use, close-when-done-and-pushed rule, version-bump rule with `package.json`/`manifest.json`/`options.html` and `scripts/bump-patch.cjs`, all build/test commands, all code-style rules, and all Dismiss After Offline Auto-Open facts.

Reason: One source of truth per rule. System rules govern shell/RTK, skills, ADR, and language discipline. Project rules govern this extension only.

Flagged for operator: (1) Literal "On any change" in the version-bump rule vs docs-only practice of no bump — project text kept unchanged; operator to decide scope wording. (2) Build/test commands name `npm`/`vitest`; the system Shell section governs execution via native RTK wrappers where supported — commands kept unchanged as canonical definitions.
