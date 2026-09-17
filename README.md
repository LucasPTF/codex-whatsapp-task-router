# Codex WhatsApp Task Router

[![Base checks](https://github.com/LucasPTF/codex-whatsapp-task-router/actions/workflows/check.yml/badge.svg)](https://github.com/LucasPTF/codex-whatsapp-task-router/actions/workflows/check.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Local-first reference application that turns WhatsApp conversation evidence into structured, human-reviewed work proposals. It combines a read-only WhatsApp connector, a local SQLite workflow, React/Electron clients and optional analysis through an authenticated Codex CLI session.

> Português: aplicação de referência, local-first, para organizar conversas do WhatsApp em propostas de tarefas revisadas por uma pessoa antes de virarem trabalho atribuído.

## Why this exists

Teams often receive requests in long client group conversations. Important decisions become hard to trace, ownership is unclear and an AI summary can easily mistake a promise for a completed delivery. This project keeps the original evidence, proposes structured work, validates authorization in the backend and requires human review for uncertain cases.

The project intentionally does **not** send WhatsApp messages. External communication remains human.

## Current capabilities

- Read-only WhatsApp ingestion through an optional Baileys connector.
- Import of exported WhatsApp text conversations.
- Persistent local SQLite storage with deduplication and audit events.
- Participant classification and configurable routing by capability.
- Structured Codex analysis with JSON Schema validation and explicit review.
- Task lifecycle, evidence, notifications and role-aware access.
- React web interface and an Electron desktop shell.
- Word briefing generation.
- Safe demo mode with fictitious identities and no external account required.
- Cross-platform CI on Windows and Linux.

## Safety model

- AI output is a proposal, never an authorization decision.
- The backend validates project membership, evidence and state transitions.
- The connector is read-only; message sending is outside the product scope.
- Production mode binds to loopback by default.
- Database files, WhatsApp sessions, exports, logs and generated artifacts are ignored by Git.
- Demo identities, group IDs and phone numbers are fictitious.
- `prefers-reduced-motion`, keyboard access and visible error states are part of the UI contract.

Read [SECURITY.md](SECURITY.md) and [docs/SEGURANCA.md](docs/SEGURANCA.md) before using real data.

## Requirements

- Node.js 24
- npm 11+
- A recent Codex CLI installation only if you enable AI analysis
- A WhatsApp account only if you explicitly enable the optional connector

## Quick start

```bash
git clone https://github.com/LucasPTF/codex-whatsapp-task-router.git
cd codex-whatsapp-task-router
npm ci
copy .env.example .env
npm start
```

On macOS or Linux, replace the `copy` command with `cp`.

Open `http://127.0.0.1:4318`. Demo mode pre-fills the local-only account. The demo password is public by design and must never be used for production.

For frontend-only development:

```bash
npm run dev
```

For the Electron shell:

```bash
npm run desktop
```

## Optional integrations

Both integrations are disabled by default.

### Codex analysis

Use an existing, authorized Codex CLI login and enable the analyzer in your local environment. The adapter uses structured output, an ephemeral run and a restricted working directory. It does not silently fall back to a paid API.

### WhatsApp read-only connector

Enable the connector locally to display a protected QR flow and persist the session under `var/`. Baileys is an unofficial WhatsApp Web client library. Meta or WhatsApp may change or restrict compatibility at any time. This repository is not affiliated with or endorsed by Meta, WhatsApp or OpenAI.

## Production bootstrap

Set `APP_MODE=production` and provide the three one-time bootstrap variables documented in [.env.example](.env.example). Remove those variables from the process environment immediately after the first administrator is created.

Production use still requires your own privacy review, retention policy, access controls, backups, TLS/network design and acceptance tests. Do not place the active SQLite database in a synchronized or shared folder.

## Verification

```bash
npm run check
npm audit --omit=dev
```

`npm run check` runs TypeScript checks, validates the project skills, executes the automated test suite and builds the UI. Automated tests use synthetic data and do not connect to WhatsApp or invoke a model.

## Architecture

```text
WhatsApp/import -> durable inbox -> SQLite backend -> review queue
                                             |           |
                                             v           v
                                      Codex proposals   tasks
                                             |           |
                                             +----> React/Electron
```

Start with [docs/ARQUITETURA.md](docs/ARQUITETURA.md), [docs/FLUXOS.md](docs/FLUXOS.md), [docs/WHATSAPP.md](docs/WHATSAPP.md) and [docs/CODEX_E_SKILLS.md](docs/CODEX_E_SKILLS.md).

## Roadmap

See [docs/ROADMAP.md](docs/ROADMAP.md). The current version is a local reference implementation, not a hosted multi-tenant service.

## Contributing

Issues and pull requests are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) and keep fixtures synthetic. Never attach real conversations, phone numbers, authentication state or database files.

## License

MIT © 2026 Lucas Sousa. See [LICENSE](LICENSE).
