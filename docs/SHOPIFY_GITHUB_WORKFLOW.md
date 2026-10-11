# Shopify and GitHub Bidirectional Sync Runbook

This storefront's live Shopify theme is connected to the GitHub `main`
branch. The connection works in both directions:

```text
Local checkout  <---- fetch/rebase/push ---->  GitHub origin/main
                                                    ^             |
                                                    |             v
                                           Shopify reverse sync / deploy
                                                    |             ^
                                                    v             |
                                              Live Shopify theme
```

A theme-editor or API change can therefore create a GitHub commit while local
work is in progress. A push based on stale local files can overwrite current
merchant settings even when the code change itself is correct.

## Source-of-truth rules

There is no permanently authoritative single copy. Before a change, determine
which surface was modified most recently:

- Theme editor, Admin API, or Theme CLI change: wait for Shopify to create its
  GitHub commit, then bring that commit into the local checkout.
- Local code change: start from the latest `origin/main`, test locally, and
  rebase on the remote branch again immediately before pushing.
- Concurrent changes: inspect and integrate them deliberately. Never resolve a
  conflict by taking all of one side without understanding the merchant data.

## 1. Start every task from synchronized state

```powershell
git status --short --branch
git fetch origin
git rev-list --left-right --count HEAD...origin/main
git log --oneline --decorate -5 origin/main
```

The `rev-list` result is `local-only remote-only` commit counts.

If the worktree is clean:

```powershell
git pull --rebase origin main
```

If the worktree is dirty, first identify whether changes belong to the user or
an earlier task. Do not use `git reset --hard`, discard files, or overwrite them
with a theme pull. Preserve and integrate the work explicitly.

## 2. Protect merchant-owned files

The Shopify theme editor writes merchant content into files such as:

- `config/settings_data.json`
- `templates/index.json`
- `templates/product.json`
- other `templates/*.json` files containing section blocks and settings

Before changing any of them, compare the local file with `origin/main` and
inspect recent Shopify-generated commits:

```powershell
git log --oneline --name-status -5 origin/main -- config/settings_data.json templates
git diff HEAD..origin/main -- config/settings_data.json templates
```

Do not restore these files from an older commit merely to fix a code regression.
Preserve current resource IDs, block IDs, block order, and merchant-entered
values unless the requested change specifically targets them.

## 3. Use the Admin API for a narrow theme-file update

Credentials are stored in ignored `.env` keys:

- `SHOPIFY_STORE`
- `SHOPIFY_CLIENT_ID`
- `SHOPIFY_CLIENT_SECRET`
- optional `SHOPIFY_API_VERSION`

Never echo their values or expose the cached token. Refresh and confirm theme
permissions without revealing secrets:

```powershell
$query = 'query { currentAppInstallation { accessScopes { handle } } themes(first: 5, roles: [MAIN]) { nodes { id name role updatedAt } } }'
.\scripts\api.ps1 -NoCache -Query $query
```

Required scopes for theme files are `read_themes` and `write_themes`. Always use
the returned `MAIN` theme ID for the current operation rather than relying on a
saved numeric ID. Shopify can also require separate eligibility for theme-file
mutations. If `themeFilesUpsert` reports that restriction, do not retry with a
broader operation; use the narrow Theme CLI fallback below and report why.

Before overwriting files:

1. Resolve the exact remote filenames.
2. Back up only those files to a timestamped directory below `.shopify/`.
3. Prepare and visually inspect replacement images or validate replacement
   text/JSON.
4. Use a single explicit file list in `themeFilesUpsert`.
5. Check GraphQL top-level errors, mutation `userErrors`, and asynchronous job
   status when a job is returned.
6. Re-read the same files and compare hashes or content.

Do not include templates or settings in an asset-only request.

## 4. Theme CLI fallback

Use Theme CLI only if the Admin API is unavailable or unsuitable. Never upload
the whole live theme for a small change.

Example pattern:

```powershell
shopify theme push `
  --theme <current-main-theme-id> `
  --path <staging-theme-directory> `
  --allow-live `
  --nodelete `
  --only assets/example-one.png `
  --only assets/example-two.png
```

The staging directory should contain only the prepared files in the normal
theme folder structure. Use an explicit `--only` entry for every file. Do not
use a broad wildcard when the authorized file set is known.

To make a recoverable backup before overwriting:

```powershell
shopify theme pull `
  --theme <current-main-theme-id> `
  --path .shopify/<timestamped-backup-name> `
  --nodelete `
  --only assets/example-one.png `
  --only assets/example-two.png
```

## 5. Reconcile Shopify's reverse-sync commit

Record the remote head before the online mutation:

```powershell
git fetch origin
git rev-parse origin/main
```

After the mutation, allow Shopify to create its automatic commit, then:

```powershell
git fetch origin
git log --oneline --decorate -5 origin/main
git diff --name-status <old-origin-head>..origin/main
```

The automatic commit should contain only the expected paths. If unrelated
templates or settings appear, stop and investigate before continuing.

When the local worktree is clean, synchronize:

```powershell
git pull --rebase origin main
git status --short --branch
```

Do not manually commit the same files before reverse synchronization completes;
that creates duplicate or conflicting histories.

## 6. Commit and push local code safely

After local implementation and testing, create the local commit. Immediately
before push:

```powershell
git fetch origin
git log --oneline HEAD..origin/main
git rebase origin/main
git diff --name-status origin/main...HEAD
git diff --check
git status --short --branch
```

Inspect every changed path. Pay special attention to:

- `config/settings_data.json`
- `templates/*.json`
- binary assets that may also have changed through Shopify

Push only when the user has explicitly authorized it:

```powershell
git push origin main
```

Never force-push. If another Shopify commit appears between the final fetch and
push, fetch and rebase again.

## 7. Verification checklist

For any online-theme change, verify all of the following:

- The mutation or CLI operation succeeded with no user errors.
- A remote read/pull matches the intended files byte-for-byte or semantically.
- The live page references the expected assets and fresh CDN version values.
- Shopify's automatic GitHub commit contains only expected paths.
- The local checkout has been rebased or fast-forwarded to `origin/main`.
- `git status --short --branch` is clean unless intentional local work remains.
- The user is told what changed, how it was verified, and where backups live.

## 8. Recovery procedure

If an online change is wrong:

1. Stop further uploads and pushes.
2. Identify the exact affected theme and filenames.
3. Inspect the timestamped backup below `.shopify/`.
4. Restore only the affected files through the Admin API or an explicit Theme
   CLI `--only` upload.
5. Verify the storefront and remote file contents.
6. Wait for the restoration commit from Shopify, inspect it, then fetch and
   rebase the local branch.

Do not recover by replacing all templates or resetting the repository to an old
commit; that can erase newer theme-editor changes.
