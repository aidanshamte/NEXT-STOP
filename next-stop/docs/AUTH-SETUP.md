# Real authentication setup

NEXT STOP v0.3 implements persistent accounts, email verification, password recovery and Google identity sign-in. These use real external providers. No OTP is returned in API responses, printed as a “verification” shortcut, or fabricated in the app.

## User experience

Create account (name/email/password/confirmation) → enter emailed verification code → choose Student/Parent/Driver → search for institution → request membership → institution approval → appropriate workspace.

Google users go through Google's own sign-in, server token validation and then institution onboarding. Google-authoritative Gmail/Workspace emails can proceed without a second code; other Google-account email domains must verify mailbox ownership by email code. Existing email/password accounts explicitly link Google in Account after signing in. Google never silently merges into an existing email account.

Returning users sign in normally. Password recovery sends a separate single-use email code; successful reset revokes all existing NEXT STOP sessions. Google-only accounts use Google rather than password recovery.

## Configure actual email delivery

Copy .env.example to .env only if you do not already have .env. Preserve your existing values. Configure these server-only variables with your provider's details:

```dotenv
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASSWORD=
SMTP_FROM=
```

SMTP_FROM must be a sender accepted by your mail service, such as your verified project-domain address. Port 587 uses mandatory STARTTLS; port 465 uses implicit TLS. Certificate verification is enabled. NEXT STOP does not use a test mailbox/outbox as a substitute for delivery.

`npm run api` loads .env with Node's env-file support. Restart the API after changing server credentials. Do not prefix SMTP secrets with EXPO_PUBLIC_, commit .env, or paste credentials into chats/issues.

An email is reported sent only after SMTP accepts it. Acceptance is not proof it arrived in the inbox; check provider delivery logs and spam handling. A failed send leaves the account unverified and returns an error, not a success screen. SMTP is required for email signup and password reset, including a local computer server. Local transport can work without cloud hosting, but real email/Google authentication needs access to those providers.

Codes are six digits, stored as salted scrypt hashes, expire after ten minutes, allow at most five attempts, and are consumed once. Resend waits sixty seconds; delivery requests are capped per email/hour and endpoint/IP. No production bypass marks pending accounts verified.

## Configure Google sign-in

Use your team's Google Cloud project and OAuth consent configuration. Register clients for the actual platforms:

| Platform | Required Google configuration                                                                                                                |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Web      | Web OAuth client; register exact authorized JavaScript origins for your app (localhost for local web development or HTTPS production origin) |
| Android  | Android OAuth client matching your package name and signing certificate SHA fingerprint; configure the web client ID as the token audience   |
| iPhone   | iOS OAuth client matching your bundle ID; configure the reversed client ID URL scheme                                                        |

Set GOOGLE_WEB_CLIENT_ID on the server and EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID for the app to your Web OAuth client ID. These IDs are public identifiers; do not supply a client secret in public app variables. Set EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID for iOS builds. The iOS URL scheme is derived by app.config.ts, or you can set GOOGLE_IOS_URL_SCHEME explicitly. Native build configuration changes require rebuilding the installed app.

The backend uses google-auth-library.verifyIdToken to validate signature, issuer, expiry and approved audience. Google `sub`, not email alone, identifies the provider account. Web GIS obtains a short-lived, single-use server nonce and returns it in the signed token. The API validates that nonce. Only email/profile identity is requested; no contacts, Drive or refresh-token permission is requested.

The free Original Google Sign-In SDK integration is used on native platforms; its Android underlying SDK is deprecated but documented as functional. Revisit migration before a broad production release. Web uses current Google Identity Services. No paid Universal SDK is assumed.

**Expo Go cannot load this custom native Google SDK.** Email signup/sign-in and real backend operations work in Expo Go; Google sign-in and background GPS must be tested using an installed development/internal build. In Expo Go, Google attempts explain the native-build requirement rather than faking success. Web Google sign-in can be tested from an authorized localhost/HTTPS origin.

## Server selection is team configuration

Normal users never enter a server URL. In Expo development, the app derives the API origin from the Expo host on port 4000. If using a tunnel or separate API host, set EXPO_PUBLIC_API_URL explicitly. Installed/release apps must receive your real HTTPS backend URL in their build environment. No domain or hosted backend has been invented or provisioned by this source change.

Production keeps HTTPS enforcement. Expo Go development allows private-LAN HTTP; internal local-network builds still require native HTTP transport configuration. These are development network choices, not a replacement for provider credentials.

## Existing installations

SQLite upgrades add email_verified, google_sub, password_enabled and code/challenge tables without deleting accounts, memberships, trips or requests. Existing email accounts must actually verify their email at the next login. Old sessions for unverified users cannot read transport data. The initial administrator created by npm run setup must also verify email; provide working SMTP before using that login. Institution approval remains separate from email verification.

## Validation still required with your services

1. Send a code to a real mailbox and verify spam/delivery behavior.
2. Verify correct, incorrect, expired and replayed codes on physical devices.
3. Complete Google sign-in on your registered web, Android and iOS clients.
4. Test linking an existing verified email account without account duplication.
5. Complete the journey and permission tests in PHONE-INSTALL.md.

Automated tests inject provider boundaries and exercise the real HTTP/database lifecycle. They do not prove your Google credentials, SMTP sender, signed app or device network works.

## Official references

- Google ID token verification: https://developers.google.com/identity/gsi/web/guides/verify-google-id-token
- Google GIS JavaScript API: https://developers.google.com/identity/gsi/web/reference/js-reference
- Native SDK configuration: https://react-native-google-signin.github.io/docs/original
- Nodemailer SMTP: https://nodemailer.com/smtp
- Expo environment configuration: https://docs.expo.dev/guides/environment-variables/
