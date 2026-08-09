# Security Policy

## Scope and security objective

PhotoDesk handles private photos, Immich API credentials, local review decisions, rendered edits, and mutations to an Immich library. The primary objective is to keep credentials and media private while ensuring that remote changes are explicit, bounded, recoverable, and retry-safe.

## Security model

- Immich remains the source of truth. PhotoDesk reads authenticated originals and writes ratings, trash decisions, stacks, and edited variants only through the explicit Commit flow.
- The Immich API key is held server-side and must never be returned to the browser, logs, error payloads, or AI/tool context.
- Profile passphrases and session cookies gate the application API. Use HTTPS so credentials and cookies are not exposed in transit.
- Parent-only operations are an authorization boundary and must remain enforced server-side; hiding browser controls is not sufficient.
- Local SQLite state, rendered edits, temporary decode files, and backups contain or derive from private media.

## Required deployment practices

1. Keep PhotoDesk and Immich on a trusted private network such as Tailscale. Do not expose PhotoDesk directly to the public internet without a fresh review, hardened proxy, rate limiting, and monitored authentication.
2. The bootstrap `IMMICH_API_KEY` may come from a protected environment or gitignored `.env`; per-profile Immich API keys are intentionally stored as plaintext in SQLite. Treat the database and every backup as credential material, protect them with host/disk encryption and strict permissions, and prefer dedicated least-privilege Immich keys.
3. Use unique profile passphrases. Terminate HTTPS at the reverse proxy and preserve secure proxy/cookie configuration.
4. Run the service and decoder as unprivileged accounts. Treat Docker group membership as root-equivalent.
5. Keep the SQLite database and `PHOTODESK_EDIT_DIR` on durable storage outside the checkout with permissions restricted to the service account.
6. Back up local state and edits consistently with Immich. Encrypt off-host backups and test restoration before relying on them.
7. Preserve the implemented HEIC byte limits, serialized decode, output limit, timeout, and structured subprocess argument handling. The current render/API path does not provide a general pixel-dimension cap or explicit global JSON-body limit; compensate with private-network access and reverse-proxy request limits until those controls are added. Never interpolate file names or request values into a shell command.
8. Keep Immich writes idempotent and explicit. A partial commit must remain visible and retryable; it must not be reported as complete.

## Media and logging rules

- Do not log API keys, passphrases, session tokens, original image bytes, or private metadata.
- Avoid persistent browser caching of originals where practical.
- Temporary originals and decode artifacts must be private, bounded, and removed after success, failure, or cancellation.
- Treat generated edits and thumbnails with the same confidentiality as originals.

## Dependency and change review

Run `npm test`, migrations, and the configured HEIC preflight before deployment. Review changes to authentication, secret DTOs, proxy routes, file handling, image decoders, commit actions, or Immich API scopes as security-sensitive. Recheck native image dependencies and container images when upgrading.

Current session cookies are HTTP-only and SameSite-protected but are not marked `Secure`. Keep PhotoDesk on localhost/Tailscale behind an HTTPS-only proxy, redirect plain HTTP at the edge, and treat proxy-aware `Secure` cookie support plus HSTS as unresolved production hardening rather than an implemented control.

## Incident response

- Immich key or SQLite/backup exposure: revoke every affected key in Immich, issue narrower replacements, restart PhotoDesk, review Immich activity, and replace/protect affected database and backup copies.
- Session/passphrase exposure: rotate the passphrase/session secret and invalidate sessions.
- Media exposure: restrict access, preserve evidence, identify affected originals/derivatives/backups, and rotate any credentials exposed with them.
- Suspected unintended mutation: stop the service, preserve its SQLite state and logs, and use Immich's recoverable trash/history before retrying.

Rotation and containment come before git-history cleanup.

## Reporting a vulnerability

Report issues privately through a GitHub Security Advisory when available, or contact the repository owner privately. Do not attach real photos, API keys, or unredacted metadata. Include affected routes/files, reproduction steps, impact, and the smallest safe proof of concept.

There is no bug bounty program or guaranteed response SLA.
