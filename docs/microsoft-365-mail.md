# Microsoft 365 Outlook mail integration (delegated Graph API)

Status: OAuth backend + UI implemented and deployed, **not yet connected**.

## Microsoft Entra registration
- App registration: ChargeVisor Mail
- Account type: single organizational tenant.
- Microsoft Graph delegated permissions: `Mail.Send`, `User.Read`.
- Web redirect URI: `https://chargevisor-business-demo.onrender.com/api/microsoft/callback`
- No application-wide `Mail.Send` permission.
- The OAuth authorize request explicitly includes `offline_access` and PKCE S256 so refresh tokens can be used securely.

## ChargeVisor Render service environment

All values belong in **ChargeVisor Business**, not in BLITZ or source code:

| Variable | Purpose |
|---|---|
| `CV_PUBLIC_URL` | `https://chargevisor-business-demo.onrender.com` |
| `CV_MS_TENANT_ID` | Entra directory tenant ID (not secret) |
| `CV_MS_CLIENT_ID` | ChargeVisor Mail application (client) ID (not secret) |
| `CV_MS_CLIENT_SECRET` | **Secret value** created in Entra > Certificates & Secrets. Never post in chats or GitHub |
| `CV_MS_ALLOWED_SENDER` | Exact Outlook business user principal name/mailbox to permit, e.g. owner mailbox |
| `CV_MS_ENCRYPTION_KEY` | A new cryptographically random 32-byte key encoded as base64, stored securely outside GitHub |

Create only with a separate persistent ChargeVisor database configured as `CV_DATABASE_URL`, and its schema provisioned via the explicit one-time setup. Never point ChargeVisor to the BLITZ database.

**Without the dedicated database and secrets the API intentionally returns 503. This is not a Microsoft configuration problem.**

## Authorize mailbox
1. Sign in to ChargeVisor at `/login` as an existing **superadmin**.
2. In Microsoft 365 card click "Outlook-Geschäftskonto verbinden".
3. Microsoft sign-in prompts for delegated consent.
4. Callback verifies the superadmin session, single-use OAuth state, PKCE verifier, Microsoft `/me` identity and the allowlisted mailbox before storing an AES-256-GCM encrypted refresh token.
5. In Microsoft 365 card the connected mailbox can be inspected and disconnected.
6. New invitations first use the connected delegated Microsoft account via Graph `POST /me/sendMail`; if disconnected/failed they fall back to configured SMTP or a manual invitation link.

## Limitations
- Microsoft may revoke/expire consent; when that happens reconnect the mailbox.
- Graph `202 Accepted` means Microsoft accepted the send request, not proof of final email delivery.
- The sender must have an Exchange Online mailbox/license capable of sending.
- This is not an automatic ChargeVisor subscription billing system; monthly email report scheduling and PDF attachment delivery remain to be integrated with generated reports.
- If the encryption key is lost, previously connected refresh tokens cannot be decrypted; reconnect Microsoft and keep backups.
- Microsoft Graph has its own sending and throttling limits; do not send bulk newsletters.
- Password reset, database backups/restore, independent tenant authorization and OCPP integration must be completed before hosting paid customers.
