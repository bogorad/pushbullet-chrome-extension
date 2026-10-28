# Version-bump rule: docs-only changes do not warrant a bump

Decision: Operator decision (this session): docs-only changes do NOT warrant a version bump.

Change: `AGENTS.md` version-bump rule amended. Old text: "On any change, bump the patch version (`zz` in `xx.yy.zz`) in all relevant version files: `package.json`, `manifest.json`, and `options.html`." New text: "On any extension change (code or shipped files), bump the patch version (`zz` in `xx.yy.zz`) in all relevant version files: `package.json`, `manifest.json`, and `options.html`. Docs-only changes do not warrant a bump." File list and `node ./scripts/bump-patch.cjs` command kept intact. No version files touched.

Reason: Resolves the conflict flagged in `activity/2026-10-28-13-23-simplify-agents-md.md` (flag 1): the literal "On any change" wording contradicted docs-only practice of no bump. The rule now scopes the bump to extension (code/shipped) changes.
