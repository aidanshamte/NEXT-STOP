# Physical-device acceptance: first milestone

**Milestone:** a verified student and an approved driver, using installed apps on separate networks, exchange a real pickup request and genuine shuttle location through the Azure-hosted backend with persistent accounts.

Run this with two physical phones and installed `preview` builds (PHONE-INSTALL.md, "Hosted pilot build"), **not** Expo Go, a QR code, a simulator or the web build. Mark an item passed only after you observe it. Record the date, phone models, OS versions, app build id and the API `/health` `release` value in VALIDATION.md.

Safety: never operate the app while driving. Use a passenger tester or a parked vehicle for driver actions.

## Before you start

- [ ] `curl https://<host>/health` returns `"ok":true` with the expected `release`.
- [ ] An administrator account exists (DEPLOY-AZURE.md step 7). Stops are added with real coordinates.
- [ ] Phone A (driver) is on **cellular data only** (Wi-Fi off). Phone B (student) is on a **different** Wi-Fi network, or on a different carrier.

## Checks

| #   | Check                                   | How to verify                                                                                                                                                                                                                                         | Result |
| --- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 1   | Separate phones, separate networks      | Confirm A has Wi-Fi off and B is not on the same network as A                                                                                                                                                                                         |        |
| 2   | Both reach the public backend           | Both apps sign in and show **LIVE CONNECTION**                                                                                                                                                                                                        |        |
| 3   | Real email verification                 | Create both accounts in the apps; the six-digit code arrives in the real inbox (check spam) and verifies                                                                                                                                              |        |
| 4   | Driver is approved and assigned         | Driver requests the Driver role; the admin approves and creates or assigns a shuttle to them. Before approval, the driver sees only the "reviewing" screen                                                                                            |        |
| 5   | Genuine driver GPS reaches the student  | Driver starts service and GPS (grant "Allow all the time"/"Always"). Outdoors, the student sees **GPS LIVE**, a recent timestamp and the marker at the driver's real position. Walk about 100 m and confirm the marker follows. Note the observed lag |        |
| 6   | Pickup request reaches the driver       | Student requests pickup at an approved stop; it appears on the driver's phone without a manual refresh                                                                                                                                                |        |
| 7   | Driver status changes reach the student | Driver accepts, then marks boarded, then arrived. Each change appears on the student's phone. With a parent account linked by the student, it appears there too, and disappears after the student revokes sharing                                     |        |
| 8   | Data survives restart and relaunch      | Run `sudo systemctl restart next-stop` on the VM, and force-close and reopen both apps. Accounts, approval and request history remain. Both apps reconnect on their own                                                                               |        |
| 9   | Network interruption recovers           | Put the driver phone in airplane mode for 60 s. The student sees the location turn **stale** after about 30 s, with no invented movement. Turn airplane mode off: a fresh fix replaces it and the student's status returns to live                    |        |
| 10  | Background GPS (supported behavior)     | With service active, lock the driver phone for 5 minutes while moving safely. Record whether updates continue on the student phone, the update spacing, and the battery change. Repeat on both Android and iPhone if available                        |        |
| 11  | Google sign-in with real provider       | On an installed build with Google configured, sign in with a real Google account. Confirm a Gmail/Workspace account signs straight in, and that an existing email/password account is **not** silently merged                                         |        |
| 12  | Sign-out and end of service stop GPS    | Driver ends service (after resolving riders), and separately signs out: the Android location notification / iOS location indicator disappears, and the student sees the location go offline                                                           |        |

## Record failures precisely

For any failure, note the phone model, OS version, permission state (Precise / Always), battery-saver setting, network, the time, and the last `GPS` timestamp the student saw. Server-side, run `sudo journalctl -u next-stop --since "<time>"` (the logs contain no personal data).

Passing this checklist shows the pilot path works on these devices. It does not prove behavior on every device, under heavy load, or after the OS stops the app in the background.
