# Apache Kvrocks Package Repository Edge Gateway

Cloudflare Worker edge gateway that powers the official Apache Kvrocks APT (`deb`) and RPM (`rpm`) package repositories with global edge caching and anti-throttling streaming.

---

## 🌟 Architecture & Features

1. **Zero GitHub Pages Storage Quota**:
   - Heavy binary `.deb` and `.rpm` files are permanently hosted on **GitHub Releases** (unlimited storage).
   - GitHub Pages hosts **only lightweight repository metadata** (`< 100 KB`: `InRelease`, `Packages.gz`, `repomd.xml`, `install.sh`, `kvrocks.repo`, `kvrocks.asc`).
   - The Gateway intercepts package requests (`*.deb`, `*.rpm`), extracts the release tag from the filename deterministically, and streams the package from GitHub Releases.

2. **Mainland China Accessibility & GFW Bypass**:
   - The Gateway Worker runs on Cloudflare's Anycast edge network where GitHub is 100% accessible.
   - The Worker streams packages directly to the client as `HTTP 200 OK` via `ReadableStream` (Zero-Buffer Streaming) without redirecting back to GitHub.
   - Packages are cached in Cloudflare Edge Cache for 1 year (`Cache-Control: public, max-age=31536000, immutable`). After the first download, subsequent requests in that region are served directly from the nearest Cloudflare CDN edge.

3. **Client Compatibility**:
   - Native `apt-get` and `dnf` work seamlessly.
   - Client machines connect directly to the edge gateway.

---

## 🚀 Deployment

### Option A: Deploy via Wrangler CLI (Recommended)

1. Authenticate with Cloudflare:
   ```bash
   npx wrangler login
   ```

2. Run automated tests:
   ```bash
   npm test
   ```

3. Deploy to Cloudflare Workers:
   ```bash
   npx wrangler deploy
   ```

### Option B: Deploy via Cloudflare Web Dashboard

1. Log into your [Cloudflare Dashboard](https://dash.cloudflare.com/).
2. Navigate to **Compute (Workers) > Workers & Pages > Create application > Create Worker**.
3. Name your worker (e.g. `kvrocks-repo-gateway`).
4. Click **Deploy**, then click **Edit code**.
5. Replace editor contents with `worker.js`.
6. Click **Deploy**.
7. Go to **Settings > Domains & Routes > Add > Custom Domain** and bind your custom gateway domain.

---

## 🧪 Testing

Run built-in unit tests (Node.js >= 18):
```bash
npm test
```
