# Security policy

## Supported version

Security fixes currently target the latest commit on `main`.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting for this repository. Do not open a public issue containing credentials, conversation data, phone numbers, session material or an exploit that could expose them.

Include the affected commit, reproduction steps, impact and any suggested mitigation. A maintainer will acknowledge a complete report as soon as practical.

## Operational boundaries

- Demo mode is for local evaluation only. Its credentials are public.
- The WhatsApp connector is optional, unofficial and read-only.
- The application is not a sandbox for arbitrary untrusted code.
- AI results require backend validation and human review.
- Real deployments need an independent privacy, retention, backup, TLS and access-control review.
- Never run the active SQLite database or WhatsApp authentication directory from a cloud-synchronized folder.
