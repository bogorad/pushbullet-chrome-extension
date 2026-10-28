# Close-on-push rule for beads issues

Decision: Add one rule to `AGENTS.md` under `## General`. No version bump. The bump rule targets extension changes. This change is docs only and is not shipped in the extension.

Change: `AGENTS.md` now instructs agents to close a beads issue in the same workflow when its work is done and pushed, with the pushed commit as the close-reason evidence, and to not leave completed pushed work open.

Reason: Completed pushed work stayed open. Context: bead `pushbullet-chrome-extension-p4t` was closed in this workflow with commit `4f6c307` as evidence.
