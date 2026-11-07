# Apache Kvrocks Package Repository Edge Gateway

Cloudflare Worker that serves the Apache Kvrocks APT (`deb`) and RPM (`rpm`) repositories — metadata,
packages, landing page and installer — from one origin with global edge caching.

---

## 🌟 Architecture

```
gateway/
├── wrangler.toml     # routes + the static asset binding
├── src/index.js      # the Worker
├── test/             # node:test unit tests
└── public/           # static assets, uploaded with the Worker
    ├── index.html    # landing page
    └── install.sh    # installer, carries the __REPO_ORIGIN__ placeholder
```

Request routing follows Workers static-asset semantics: **a file in `public/` is served by the edge
without invoking the Worker**, everything else reaches `src/index.js`.

| Request | Served by | Notes |
|---|---|---|
| `/` | static asset | Cached at the edge, revalidated by `ETag` |
| `/index.html` | static asset layer | `307` redirect to `/` (`html_handling` default `auto-trailing-slash`) |
| `/install.sh` | Worker + asset | `run_worker_first` routes it through the Worker, which fills in the origin it was downloaded from |
| `/pool/*.deb`, `/rpm/**/*.rpm` | Worker | Streamed from GitHub Releases, cached one year per asset |
| everything else (`/dists/**`, `kvrocks.{repo,gpg,asc}`) | Worker | Proxied from the metadata origin (GitHub Pages) with per-type TTLs |

1. **Metadata stays on GitHub Pages, bytes live on GitHub Releases**
   - The release workflow merges APT/RPM indexes and pushes only metadata to the `gh-pages` branch
     (`< 100 KB`: `InRelease`, `Packages.gz`, `repomd.xml`, `kvrocks.repo`, keys).
   - Package filenames encode the release tag, so the Worker derives the GitHub Release asset URL
     without calling the GitHub API. Full responses are cached in `caches.default` for one year.

2. **One public origin**
   - The landing page and the installer are static assets of the same Worker, so opening the page and
     starting an install stay on one origin. (The release list rendered on the page still calls
     `api.github.com` directly — see *Forking*.)
   - `install.sh` is served with `__REPO_ORIGIN__` replaced by the request origin: the same file works
     behind a custom domain, a `*.workers.dev` host or a fork, with no build step and no config.

3. **Mainland China accessibility**
   - The Worker runs on Cloudflare's anycast network, where GitHub is reachable, and streams packages to
     the client as `200 OK` over a `ReadableStream` instead of redirecting back to GitHub.
   - Only `GET`/`HEAD` are served, and client headers/query strings are never forwarded upstream, so
     caches cannot be fragmented or busted.

---

## 🚀 Deployment

Pushing to `main` with changes under `gateway/**` deploys automatically:
`.github/workflows/gateway.yaml` runs the shared quality gate and then `wrangler deploy`. Both the
Worker and every file in `public/` ship as one version, so routing and assets can never disagree.

The repository needs two secrets:

| Secret | Used for |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Deploying the Worker (Workers Scripts: Edit) |
| `CLOUDFLARE_ACCOUNT_ID` | Targeting the account |

### Manual deploy

```bash
npx wrangler login   # once
npm test             # unit tests
npx wrangler deploy
```

`npx wrangler deploy --dry-run` validates the configuration and lists the uploaded assets without
touching the account.

### Forking

Routing and the installer need exactly one project-specific value in `wrangler.toml`:

```toml
[vars]
GITHUB_REPO = "owner/repo"
```

Release assets are read from that repository, the metadata origin defaults to its GitHub Pages project
site (`https://<owner>.github.io/<repo>`), and `/install.sh` installs from whatever host serves it. No
hostname is baked into either. Set `METADATA_ORIGIN` only when the metadata lives on a custom domain,
and bind your own custom domain under **Settings → Domains & Routes**.

`public/index.html` is the exception: it links to the upstream repository and reads its release list
directly from `api.github.com` (see the repo slug at the links and in `fetchReleases`/`loadMoreReleases`),
so a fork must edit those before deploying its own page. Serving that slug and the release list from
the Worker is still on the to-do list; until it lands the page is upstream-specific.

---

## 🧪 Testing

```bash
npm test               # node --test test/
npx wrangler dev       # local server: assets, installer injection and the metadata proxy
```
