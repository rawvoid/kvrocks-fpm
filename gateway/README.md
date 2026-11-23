# Apache Kvrocks Package Repository Edge Gateway

Cloudflare Worker that serves the Apache Kvrocks APT (`deb`) and RPM (`rpm`) repositories — metadata,
packages, landing page, installer and DNF repo config — from one origin with global edge caching.

Nothing in this directory names the GitHub account it is deployed under: the repository slug is
supplied at build and deploy time, so a fork works without editing a single file.

---

## 🌟 Architecture

```
gateway/
├── wrangler.toml        # worker config, static assets, Cron trigger & observability
├── src/
│   ├── index.js         # Worker entrypoint ({ fetch, scheduled })
│   ├── packages.js      # /pool/*.deb & /rpm/**.rpm release proxy + edge cache
│   ├── metadata.js      # GitHub Pages metadata proxy + TTL/304 handling
│   ├── watcher.js       # Cron upstream tag watcher & workflow_dispatch
│   └── shared.js        # shared HTTP response & fetch helpers
├── test/                # node:test unit tests
├── scripts/render.mjs   # public/ -> dist/, resolving __GITHUB_REPO__
├── scripts/deploy.mjs   # render + wrangler deploy, passing the slug as --var
├── public/              # asset *sources*, committed
│   ├── index.html       # landing page, carries __GITHUB_REPO__
│   ├── install.sh       # installer template, carries __REPO_ORIGIN__
│   ├── kvrocks.repo     # DNF repo config template, carries __REPO_ORIGIN__
│   ├── favicon.svg      # tab icon, referenced as /favicon.svg
│   ├── styles.css       # precompiled Tailwind stylesheet, referenced as /styles.css
│   └── _headers         # per-asset headers & caching rules, consumed by the edge
├── dist/                # rendered assets, uploaded with the Worker (generated)
└── .dev.vars            # local GITHUB_REPO for `wrangler dev` (generated)
```

`public/` holds two placeholders with zero hardcoded account or domain configuration:

| Placeholder | Resolved by | Meaning |
|---|---|---|
| `__GITHUB_REPO__` | `scripts/render.mjs` from `GITHUB_REPOSITORY` or `origin` remote | `owner/repo` used by the page's links and release list |
| `__REPO_ORIGIN__` | Worker (`src/index.js`) from `new URL(request.url).origin` | Gateway origin filled into `install.sh` and `kvrocks.repo` per request (`index.html` reads `window.location.origin`) |

Pure static assets are served by Cloudflare's edge without invoking the Worker; `/install.sh`,
`/kvrocks.repo`, packages and metadata reach `src/index.js`:

| Request | Served by | Notes |
|---|---|---|
| `/` | static asset | Cached at the edge, revalidated by `ETag` |
| `/index.html` | static asset layer | `307` redirect to `/` (`html_handling` default `auto-trailing-slash`) |
| `/favicon.svg` | static asset | `_headers` gives it `max-age=86400`; the page itself stays revalidated by `ETag` |
| `/styles.css` | static asset | Precompiled stylesheet, revalidated by `ETag` |
| `/install.sh`, `/kvrocks.repo` | Worker (`run_worker_first`) | Reads template from `env.ASSETS` and fills `__REPO_ORIGIN__` from `request.url` |
| `/pool/*.deb`, `/rpm/**/*.rpm` | Worker | Streamed from GitHub Releases, cached one year per asset |
| everything else (`/dists/**`, `/rpm/**/repodata/**`, `kvrocks.{gpg,asc}`) | Worker | Proxied from the metadata origin (GitHub Pages) with per-type TTLs |

1. **Metadata stays on GitHub Pages, bytes live on GitHub Releases**
   - The release workflow merges APT/RPM indexes and pushes only domain-independent metadata to the
     `gh-pages` branch (`< 100 KB`: `InRelease`, `Packages.gz`, `repomd.xml`, keys).
   - Package filenames encode the release tag, so the Worker derives the GitHub Release asset URL
     without calling the GitHub API. Full responses are cached in `caches.default` for one year.

2. **One public origin (domain-agnostic)**
   - The landing page, stylesheet, installer, DNF repo config and tab icon are served from the same
     Worker origin, so opening the page and starting an install stay on one host. (The release list
     rendered on the page still calls `api.github.com` directly.)
   - Because `index.html` reads `window.location.origin` and `/install.sh` / `/kvrocks.repo` fill
     `__REPO_ORIGIN__` from `new URL(request.url).origin`, binding or changing custom domains in
     Cloudflare takes effect immediately with zero configuration changes or redeploys.
   - The icon is a real file rather than an inline `data:` URI, so browsers cache it once instead of
     re-downloading it inside every page load. `_headers` keeps `/favicon.svg` cached for a day while
     `/` and `/styles.css` stay revalidated by `ETag` so updates reflect immediately.

3. **Global edge delivery**
   - The Worker runs on Cloudflare's anycast network and streams packages to the client as `200 OK` over
     a `ReadableStream` instead of redirecting to GitHub, so a download never waits on a second origin.
   - Only `GET`/`HEAD` are served, and client headers/query strings are never forwarded upstream, so
     caches cannot be fragmented or busted.

4. **Automated upstream release watcher**
   - `wrangler.toml` configures an hourly Cron Trigger (`[triggers] crons = ["0 * * * *"]`) invoking
     the Worker's `scheduled` handler.
   - On each tick, it fetches full `refs/tags/` lists via Git Wire Protocol v2 (`ls-refs`) from both
     `apache/kvrocks` (unauthenticated) and `GITHUB_REPO` (with `GITHUB_TOKEN`), inspects recent
     `release.yaml` `workflow_dispatch` runs, and evaluates all upstream versions `>= MIN_VERSION`
     (default `2.13.0`), skipping superseded `-rc` pre-releases while keeping active ones.
   - To preserve strict release ordering, it waits whenever a non-dry-run release workflow is active
     and dispatches at most one oldest missing version per tick, retrying the head-of-line version
     up to `MAX_ATTEMPTS` (default `3`) completed attempts before halting for manual intervention.

---

## 🚀 Deployment

### From GitHub Actions

Pushing to `main` with changes under `gateway/**` renders the assets and deploys:
`.github/workflows/gateway.yaml` runs the shared quality gate, then `npm run deploy`. That one command
renders `__GITHUB_REPO__` and passes the resolved slug to wrangler as `--var GITHUB_REPO:...` — the
same path a workstation takes, so there is a single implementation to trust. The Worker script and
every rendered asset ship as one version.

Configure once, as repository secrets:

| Secret | Used for |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Deploying the Worker (Workers Scripts: Edit) |
| `CLOUDFLARE_ACCOUNT_ID` | Targeting the account |

Configure `GITHUB_TOKEN` as a Worker secret (required by the Cron Trigger; missing `GITHUB_TOKEN` or
`GITHUB_REPO` fails the Cron execution explicitly in Cloudflare logs). Use a Fine-grained PAT scoped
to this repository only, with `Actions: Read and write` and `Contents: Read` (`wrangler deploy`
preserves existing Worker secrets across deploys):

```bash
npx --yes wrangler@4 secret put GITHUB_TOKEN
```

### From your workstation

The slug comes from the `origin` remote, so no environment variables need supplying:

```bash
npm run deploy   # render + wrangler deploy
npm run dev      # render + wrangler dev
npm test         # unit tests
```

Neither command needs `--var`: `scripts/deploy.mjs` renders first and hands the resolved slug to
wrangler, because `wrangler deploy` — unlike `wrangler dev` — does not read `.dev.vars`.

`npm run deploy -- --dry-run` validates the configuration and lists the uploaded assets without
touching the account.

### Repository variables

No repository variables are required. Optional overrides for package builds:

| Variable | Required | Meaning |
|---|---|---|
| `KVROCKS_PACKAGE_VENDOR` | no | `--vendor` for the packages; defaults to the repository owner |
| `KVROCKS_PACKAGE_MAINTAINER` | no | `--maintainer`; defaults to `<owner> <<owner>@users.noreply.github.com>` |

### Forking

No file names the account or host it is deployed under, and no repository variables are required. A
fork only needs the Cloudflare secrets above (plus `GITHUB_TOKEN` Worker secret for the Cron watcher)
and deploys directly.

The page links to the fork's own repository, the installer and DNF config automatically adopt
whatever domain or `workers.dev` host serves them, and package metadata names the fork's owner.
`METADATA_ORIGIN` only needs setting when the metadata lives somewhere other than the derived GitHub
Pages project site (`https://<owner>.github.io/<repo>`).

---

## 🧪 Testing

```bash
npm test      # node --test test/
npm run dev   # local server: assets, dynamic templates, packages, metadata proxy
```
