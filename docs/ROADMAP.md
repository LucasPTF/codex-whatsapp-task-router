# Roadmap

The repository is an early local-first reference implementation. Priorities are organized around safety and verifiable behavior rather than feature count.

## Near term

- Make team identities and capability routing configurable without source edits.
- Expand end-to-end tests for restart, replay, offline notifications and conflict handling.
- Improve setup diagnostics for Codex CLI and the optional WhatsApp connector.
- Add contributor-friendly sample datasets and screenshots using synthetic content.
- Document backup and recovery with a tested local workflow.

## Before broader production use

- Independent review of privacy, retention and access-control policy.
- TLS and network deployment guide for multi-device operation.
- Negative security tests for cross-project data access and hostile attachments.
- Windows pilot covering sleep, restart, update and prolonged offline operation.
- Release packaging and signed installers.

## Non-goals

- Sending WhatsApp messages automatically.
- Letting a model authorize access or execute unreviewed external actions.
- Operating as a hosted multi-tenant service in the current architecture.
