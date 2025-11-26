# Quick Contributor Guide — Media Standards Registry (MSR)

Before you open a pull request (PR), please review this quick checklist.  

For the full contributor guide, see [CONTRIBUTING.md](../CONTRIBUTING.md).

## Branch & Workflow
- **Branch name:** use `feature/<topic>`, `issue/<topic>`, or `fix/<topic>`.
- **Base branch:** always `main`.
- Keep branches focused; avoid mixing unrelated changes.
- PRs should not be bloated, too many changes at one time require extra review.

## Local Checks
Run the following before opening a PR:

```bash
npm run validate
npm run canonicalize
npm run build
npm run build-msi
npm run build-mri
npm run validate-urls
npm run build
npx http-server build --no-cache
```


> These commands ensure your changes don’t break MSR’s automated workflows or data chain. The last command builds the site locally.

---

## Do Not Edit Generated Files
The following are built automatically:
- `src/main/data/documents.json`
- All reports under `src/main/reports/`

Changes to these files must come from running the proper workflows or scripts, not manual edits.

## Schema Compliance
If you modify metadata or structure, validate against the appropriate schema:
- such as `src/main/schemas/document.schema.json`

Each field must include correct `$meta` provenance tracking where applicable:
- `source`
- `confidence`
- `updated`
- `overridden`

> The `npm run canonicalize` will auto fill this info for you as a "manual" edit. 

## Pull Request Checklist
- [ ] Clear, descriptive title.
- [ ] Summary of what changed and why.
- [ ] References the relevant workflow(s) or scripts.
- [ ] Includes test data or validation steps if relevant.
- [ ] Avoids triggering unnecessary workflow runs (keep commits lean).

## Best Practices
- Use small, targeted PRs for reviewability.
- Prefer descriptive commit messages (e.g., *“Fix URL normalizer mismatch for SMPTE”*).
- Reference related issues with `Closes #<issue>` in PR body.
- Use `npm run extract` for data auto refreshes instead of editing JSON manually, when appropriate.

## CI Behavior
All automation workflows (Extract, MSI, MRI, MSR, URL Validate) run on:
- Weekly cron schedules
- Push to `main`
- Manual dispatch

Only automation workflows should modify report files — human PRs should focus on logic, schema, or documentation changes.

## Need Help?
If you’re unsure where a change belongs, open a [discussion or issue](https://github.com/SteveLLamb/mediastandards-registry/issues) before submitting a PR.

Thanks for helping keep the registry consistent, accurate, and automated!