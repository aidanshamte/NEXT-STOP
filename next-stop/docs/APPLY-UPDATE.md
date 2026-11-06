# Apply the onboarding/authentication update

This source is based on the v0.2 package supplied in this conversation. The private GitHub repository could not be authenticated here, so any newer changes in your own checkout have not been inspected or overwritten.

The ZIP includes the complete updated `next-stop/` source tree and a patch at `NEXT-STOP-onboarding.patch`. To apply in your existing checkout:

1. Commit or otherwise back up your existing source changes. Keep `.env` and the `data/` directory private and intact.
2. Copy the patch out of the ZIP and run `git apply --check PATH-TO/NEXT-STOP-onboarding.patch` from the repository root.
3. If the check passes, run `git apply PATH-TO/NEXT-STOP-onboarding.patch`, then `npm ci` and the checks in README.md.
4. If the check reports conflicts, have Codex review and merge those changes against your current checkout. Do not force the patch or replace your whole working directory blindly.
5. Add the new provider variables to your existing .env following AUTH-SETUP.md; do not copy .env.example over an existing .env.
6. Restart the API and Expo. Run `npm run start:go` for email/backend testing or an installed native build for Google/background GPS testing.

The update adds columns/tables to the existing SQLite database without deleting accounts or institution data. Existing users need actual email verification before using their old accounts; configure SMTP first. Registration and membership joining are separate protocol-3 operations, so update the client and API together.

After testing, commit and push the reviewed source to https://github.com/aidanshamte/NEXT-STOP.git using your own authenticated GitHub setup.
