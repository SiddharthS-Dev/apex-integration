# SlidesVault API — Dropbox integration layer

The backend that owns the Dropbox connection. The browser never talks to
Dropbox: it talks to this, and this talks to Dropbox.

An administrator connects an account once. After that the server manages token
renewal, synchronization, file discovery, content extraction, title resolution,
preview generation and connection health by itself — across restarts,
redeployments, token expiry, rate limits and outages, with no manual token
regeneration ever.

## Quick start

```bash
cd apps/api
npm install
cp .env.example .env
npm run keygen                 # paste the printed line into .env
#   … add DROPBOX_APP_KEY, DROPBOX_APP_SECRET, BOOTSTRAP_ADMIN_* …
npm start                      # http://localhost:4000
npm test                       # 143 tests, no network required
```

Then in the app: sign in as the admin → **Dropbox Settings** → **Connect
Dropbox** → pick a folder → **Run sync now**. The scheduler takes over.

Full walk-through, including the Dropbox App Console setup:
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Layout

```
src/
  config/          one place that reads process.env; validated at startup
  crypto/          AES-256-GCM for the refresh token
  db/              driver abstraction (sqlite | postgres), migrations, repositories
  domain/storage/  StorageProvider — the provider-neutral interface
  integrations/dropbox/
    DropboxAuthService        OAuth, token lifecycle, refresh coalescing
    DropboxRequestExecutor    retries, backoff, 401 recovery, timeouts, metrics
    DropboxClient             the only file that names a Dropbox endpoint
    DropboxStorageProvider    Dropbox → provider-neutral shapes
    DropboxSyncService        discovery, revision detection, archiving, sync logs
    DropboxContentService     previews and the content proxy
    DropboxThumbnailService   Dropbox renders, we cache
    DropboxRenameService      dry run, validation, collision handling
    DropboxFolderService      browsing and root selection
    DropboxHealthService      health and the connection test
    errors.js paths.js genericNames.js routes/
  services/
    content-extraction/  pptx, pdf, html → NormalizedDocument
    title-resolution/    metadata → text → AI → vision → filename
    document-analysis/   classification, behind an AiProvider interface
    audit/ scheduler/ metrics/ storage/
  http/            auth and RBAC, security headers, CORS, rate limits, validation
  routes/          auth, catalog, system
  container.js     the composition root — every dependency is wired here
  app.js index.js
tests/             unit, integration, e2e — all against a fake Dropbox
docs/              architecture, security, API, schema, deployment, troubleshooting
```

## What it guarantees

- **Only the refresh token is persisted**, encrypted with AES-256-GCM. Access
  tokens live in memory, are minted on demand, and are never written to the
  database, an API response or a log.
- **Sync is idempotent.** Identity is the Dropbox file id and writes are
  upserts, so running it three times produces one record per file.
- **Sync is incremental.** An unchanged revision skips the download, the
  thumbnail and the AI calls entirely — except when the title is still a generic
  filename, which is the one condition that justifies reprocessing.
- **Failures are partial.** One unreadable file fails alone; the run reports
  `197 processed, 3 failed` and names them.
- **Deletions archive.** A file removed from Dropbox becomes
  `status = archived`, never a deleted row.
- **Retries are bounded.** 401 refreshes once and replays; 429 honours
  `Retry-After`; 5xx and network errors back off exponentially with jitter.
  Nothing loops forever.
- **Nothing is hardcoded.** The account comes from OAuth, the folder from an
  admin's choice, the credentials from the environment.

## Tests

```bash
npm test               # everything
npm run test:unit      # paths, titles, crypto, retries, extraction
npm run test:integration
npm run test:e2e       # the full lifecycle over HTTP, plus security invariants
```

The suite runs against an in-memory database and an in-memory Dropbox that can
be told to expire tokens, rate limit, return 500s and drop connections — so the
failure paths are covered by behaviour, not by reading the code.

## Documentation

| | |
|---|---|
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | The layers, why each exists, and how to add a storage provider |
| [SECURITY.md](docs/SECURITY.md) | Credential model, encryption, key rotation, RBAC, content sandboxing |
| [API.md](docs/API.md) | Every endpoint, with request and response shapes |
| [SCHEMA.md](docs/SCHEMA.md) | Tables, columns, indexes and why they are shaped that way |
| [DEPLOYMENT.md](docs/DEPLOYMENT.md) | Dropbox App Console, configuration, Docker, multi-instance, operating it |
| [TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) | Symptom → cause → fix |
