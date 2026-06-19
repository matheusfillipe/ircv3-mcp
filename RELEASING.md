# Releasing

This project publishes to npm from GitHub Actions using npm OIDC trusted
publishing. No long-lived `NPM_TOKEN` secret is stored in the repository.

## Continuous integration

`.github/workflows/ci.yml` runs on every push to `main` and every pull request.
It builds the package across a matrix of {ubuntu, macOS, Windows} x Node {20, 22}:

- `npm ci`
- `npm run typecheck`
- `npm run lint`
- `npm test`
- `npm run build` (tsup -> `dist/`)
- `npm pack --dry-run` (verifies the published tarball contents)

## One-time setup: npm trusted publisher (OIDC)

Trusted publishing lets the registry accept a package version from a specific
GitHub repository and workflow, authenticated by a short-lived OIDC token
instead of a stored secret.

1. Sign in at https://www.npmjs.com.
2. For a brand-new package name, do the very first publish manually so the
   package exists and you own it:
   ```sh
   npm login
   npm publish --access public
   ```
   (After the first publish, all later versions go through CI.)
3. Open the package page -> Settings -> Trusted Publisher (or
   https://www.npmjs.com/package/ircv3-mcp/access).
4. Add a GitHub Actions trusted publisher with:
   - Organization or user: `matheusfillipe`
   - Repository: `ircv3-mcp`
   - Workflow filename: `release.yml`
   - Environment: leave blank (this workflow does not use a GitHub environment)
5. Ensure two-factor settings allow automation/OIDC publishing for the package.

Nothing needs to be added to GitHub repository secrets.

## Cutting a release

1. Update `CHANGELOG.md`.
2. Bump the version (this also creates the matching tag):
   ```sh
   npm version patch   # or minor / major
   git push origin main --follow-tags
   ```
   `npm version` writes the new `package.json` version and creates an annotated
   `vX.Y.Z` tag. The release workflow requires the tag to equal the
   `package.json` version, which `npm version` guarantees.
3. The tag push triggers `.github/workflows/release.yml`, which:
   - verifies the tag matches `package.json`,
   - runs the full CI gate,
   - creates a GitHub release with generated notes,
   - publishes to npm via OIDC with provenance.
4. Confirm the new version at https://www.npmjs.com/package/ircv3-mcp and that
   the release shows a provenance attestation.

To dry-run the workflow without publishing, trigger it via
`workflow_dispatch` from the Actions tab; the publish and release steps are
guarded to run only on tag pushes.

## Using the published package

```sh
# Run directly
npx -y ircv3-mcp --help

# Add to Claude Code over stdio
claude mcp add ircv3-mcp -- npx -y ircv3-mcp
```

Or pin it in a project's `.mcp.json`:

```json
{
  "mcpServers": {
    "ircv3-mcp": {
      "command": "npx",
      "args": ["-y", "ircv3-mcp"]
    }
  }
}
```
