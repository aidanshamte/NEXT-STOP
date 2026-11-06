# Validation — November 5, 2026, v0.3

## Passed here

- Lint and TypeScript for the app, authentication screens, services and native configuration.
- 26 tests: real HTTP/database signup and membership separation, delivered-code gate, send failures, expiry/replay/attempt limits, reset/session revocation, explicit Google account linking, web nonce consumption, legacy data migration, institution isolation, transport lifecycle, realtime WebSocket delivery/persistence and local/production transport policy.
- Native configuration introspection for background-location permissions and the configured Google iOS URL scheme.
- Web, Android and iOS JavaScript/Hermes exports.

Authentication tests inject the mail-delivery boundary and Google's verified-token result. The real adapters use SMTP with TLS and Google's ID-token verification library, but this environment has no team SMTP sender or OAuth project configured. These tests do not prove live email delivery or a successful real Google account login.

## Still requires your configuration and devices

- Real SMTP credential/sender configuration and actual mailbox delivery.
- Google OAuth clients, authorized web origins, Android signing fingerprint and iOS client scheme; real provider sign-in.
- A team-hosted HTTPS API origin for installed/release builds.
- Signed APK/IPA creation, physical-device and locked-screen GPS acceptance.
- Browser interaction/visual QA; no browser executable was available in this workspace.
- Cloud deployment, production operating review and store submission.

No fake verification codes, automatic migrated-email verification, simulated accounts, database deletion or provider-success bypass is included in normal runtime. Synthetic identities and delivery captures exist only in tests. No credentials or runtime database are included in the source archive.

The GitHub remote required authentication here, so source changes have not been pushed to the user's remote repository. Apply/review the included patch or updated source in your own checkout, preserving local configuration and data.
