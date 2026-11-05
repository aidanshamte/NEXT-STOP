# Validation — November 5, 2026, v0.2

Passed in the development environment:

- Lint: zero errors/warnings across application, components, hooks, services and native app configuration.
- TypeScript: passed.
- Tests: 16 passing tests, including real HTTP and WebSocket clients against temporary databases, cross-institution denial, assigned-driver restrictions, approval, parent revocation, capacity/lifecycle rules, GPS timestamp validation, persistence across server recreation, and empty startup.
- Operator bootstrap CLI: creates institutions/admin memberships without fake stops or vehicles; existing accounts retain credentials.
- Native configuration introspection: Android background-location and foreground-service permissions, iOS background-location mode, local HTTP enabled for internal builds, and HTTPS transport protections for production.
- Web, iOS and Android JavaScript/Hermes exports: successful.

No signed APK/IPA was produced here. No physical-device GPS, locked-screen background delivery, battery test, native map-key test, browser interaction test, real operator journey or store submission was performed. JavaScript exports and native configuration inspection are not device tests.

The updated source removes demo mode and operational sample seeds. Synthetic data exists only in tests. No runtime database, credentials, dependency folders, compiled bundles, or Git metadata are included in the source archive. No cloud service or remote GitHub repository was created.

Complete the device acceptance test in PHONE-INSTALL.md before describing phone/background behavior as verified.
