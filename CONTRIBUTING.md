# Contributing

Thank you for helping improve the project.

1. Open an issue for behavior changes or security-sensitive design work.
2. Create a focused branch and keep each pull request limited to one concern.
3. Use only synthetic fixtures. Never commit real customer conversations, identities, phone numbers, databases or WhatsApp sessions.
4. Add or update tests for behavior changes.
5. Run `npm run check` before submitting the pull request.

Please preserve these product boundaries: no automated WhatsApp sending, no authorization delegated to a model, no silent paid-API fallback and no direct credential/SQL/shell access from the browser UI.

By contributing, you agree that your contribution is licensed under the MIT License.
