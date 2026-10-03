# nahda-webb

Vanilla-JS SPA (Vite). Backend: `https://srv1990155.hstgr.cloud` (no CORS headers).

## Development

```bash
npm install
npm run dev        # /api/* is proxied to VITE_API_PROXY_TARGET (see vite.config.js)
```

## Production deployment

The backend sends no CORS headers, so the browser must only ever call **its own origin**
(`/api/v1/...`) and the host in front of the app forwards those calls to the backend
server-side. Pick one:

| Target | Config | Notes |
| --- | --- | --- |
| Docker / VPS | `Dockerfile` + `nginx.conf` | `docker build -t nahda-web .` then `docker run -p 80:8080 -e API_UPSTREAM=https://srv1990155.hstgr.cloud nahda-web` |
| Vercel | `vercel.json` | `/api/*` rewrite + headers |
| Netlify | `netlify.toml` + `public/_headers` | `/api/*` proxy redirect + headers |

If the API host changes, update it in the one file for your target (`API_UPSTREAM` env var for Docker).
Keep `VITE_API_BASE_URL=/api/v1` (relative) for all of them.

Health check (Docker): `GET /healthz`.
