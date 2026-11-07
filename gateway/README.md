# Apache Kvrocks Package Repository Edge Gateway

Cloudflare Worker that serves the Apache Kvrocks APT (`deb`) and RPM (`rpm`) repositories — metadata,
packages, landing page and installer — from one origin with global edge caching.

Nothing in this directory names the GitHub account it is deployed under: the repository slug is
supplied at build and deploy time, so a fork works without editing a single file.

---

## 🌟 Architecture

```
gateway/
├── wrangler.toml        # routes + the static asset directory
├── src/index.js         # the Worker
├── test/                # node:test unit tests
├── scripts/render.mjs   # public/ -> dist/, resolving both placeholders
├── scripts/deploy.mjs   # render + wrangler deploy, passing the slug as --var
├── public/              # asset *sources*, committed
│   ├── index.html       # landing page, carries __GITHUB_REPO__
│   ├── install.sh       # installer, carries __REPO_ORIGIN__
│   ├── favicon.svg      # tab icon, referenced as /favicon.svg
│   └── _headers         # per-asset caching rules, consumed by the edge
├── dist/                # rendered assets, uploaded with the Worker (generated)
└── .dev.vars            # local GITHUB_REPO for `wrangler dev` (generated)
```

`public/` holds two placeholders, both resolved at build time by `scripts/render.mjs` — the Worker never
rewrites a file:

| Placeholder | Comes from | Meaning |
|---|---|---|
| `__GITHUB_REPO__` | `GITHUB_REPOSITORY`, else the `origin` remote | `owner/repo` used by the page's links and release list |
| `__REPO_ORIGIN__` | `KVROCKS_GATEWAY_URL` | Public origin the installer writes into APT/DNF sources |

Request routing follows Workers static-asset semantics: **a rendered asset is served by the edge
without invoking the Worker**, everything else reaches `src/index.js`.

| Request | Served by | Notes |
|---|---|---|
| `/` | static asset | Cached at the edge, revalidated by `ETag` |
| `/index.html` | static asset layer | `307` redirect to `/` (`html_handling` default `auto-trailing-slash`) |
| `/install.sh` | static asset | The whole script is fixed at build time; no Worker code runs |
| `/favicon.svg` | static asset | `_headers` gives it `max-age=86400`; the page itself stays revalidated by `ETag` |
| `/pool/*.deb`, `/rpm/**/*.rpm` | Worker | Streamed from GitHub Releases, cached one year per asset |
| everything else (`/dists/**`, `kvrocks.{repo,gpg,asc}`) | Worker | Proxied from the metadata origin (GitHub Pages) with per-type TTLs |

1. **Metadata stays on GitHub Pages, bytes live on GitHub Releases**
   - The release workflow merges APT/RPM indexes and pushes only metadata to the `gh-pages` branch
     (`< 100 KB`: `InRelease`, `Packages.gz`, `repomd.xml`, `kvrocks.repo`, keys).
   - Package filenames encode the release tag, so the Worker derives the GitHub Release asset URL
     without calling the GitHub API. Full responses are cached in `caches.default` for one year.

2. **One public origin**
   - The landing page, the installer and the tab icon are static assets of the same Worker, so opening
     the page and starting an install stay on one origin. (The release list rendered on the page still
     calls `api.github.com` directly.)
   - No asset is touched at runtime: whatever the build rendered is what the edge serves.
   - The icon is a real file rather than an inline `data:` URI, so browsers cache it once instead of
     re-downloading it inside every page load. `_headers` keeps it cached for a day while the page and
     the installer stay revalidated, because those must reflect a deploy immediately.

3. **Global edge delivery**
   - The Worker runs on Cloudflare's anycast network and streams packages to the client as `200 OK` over
     a `ReadableStream` instead of redirecting to GitHub, so a download never waits on a second origin.
   - Only `GET`/`HEAD` are served, and client headers/query strings are never forwarded upstream, so
     caches cannot be fragmented or busted.

---

## 🚀 Deployment

### From GitHub Actions

Pushing to `main` with changes under `gateway/**` renders the assets and deploys:
`.github/workflows/gateway.yaml` runs the shared quality gate, then `npm run deploy` with
`KVROCKS_GATEWAY_URL` from repository variables. That one command renders both placeholders and passes
the resolved slug to wrangler as `--var GITHUB_REPO:...` — the same path a workstation takes, so there
is a single implementation to trust. The Worker script and every rendered file ship as one version.

Configure once, as repository secrets:

| Secret | Used for |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Deploying the Worker (Workers Scripts: Edit) |
| `CLOUDFLARE_ACCOUNT_ID` | Targeting the account |

### From your workstation

The slug comes from the `origin` remote, so only the gateway origin needs supplying:

```bash
KVROCKS_GATEWAY_URL=https://repo.example.com npm run deploy   # render + wrangler deploy
KVROCKS_GATEWAY_URL=https://repo.example.com npm run dev      # render + wrangler dev
npm test                                                     # unit tests
```

Neither command needs `--var`: `scripts/deploy.mjs` renders first and hands the resolved slug to
wrangler, because `wrangler deploy` — unlike `wrangler dev` — does not read `.dev.vars`.

Without `KVROCKS_GATEWAY_URL` the page still builds; the installer keeps its placeholder and refuses
to run until it is given `KVROCKS_REPO_URL`.

`npm run deploy -- --dry-run` validates the configuration and lists the uploaded assets without
touching the account.

### Repository variables

| Variable | Required | Meaning |
|---|---|---|
| `KVROCKS_GATEWAY_URL` | yes | Public origin of this Worker: baked into `install.sh` and `kvrocks.repo` |
| `KVROCKS_PACKAGE_VENDOR` | no | `--vendor` for the packages; defaults to the repository owner |
| `KVROCKS_PACKAGE_MAINTAINER` | no | `--maintainer`; defaults to `<owner> <<owner>@users.noreply.github.com>` |

### Forking

No file names the account or host it is deployed under. A fork sets its variables and deploys:

1. `KVROCKS_GATEWAY_URL` → the origin bound to its Worker.
2. Optionally `KVROCKS_PACKAGE_VENDOR` / `KVROCKS_PACKAGE_MAINTAINER`.
3. The Cloudflare secrets above.

The page then links to the fork's own repository, the installer installs from the fork's own origin,
and package metadata names the fork's owner. `METADATA_ORIGIN` only needs setting when the metadata
lives somewhere other than the derived GitHub Pages project site
(`https://<owner>.github.io/<repo>`).

---

## 🧪 Testing

```bash
npm test                                                     # node --test test/
KVROCKS_GATEWAY_URL=https://repo.example.com npm run dev      # local server: assets, packages, metadata proxy
```
