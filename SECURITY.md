# Security Policy

This project connects to a real alarm monitoring system. We take any vulnerability report seriously.

## How to Report

Do **not** open a public issue. Email [mateogariboglio.job@gmail.com](mailto:mateogariboglio.job@gmail.com) with a description, reproduction steps and impact. We will confirm receipt and coordinate disclosure once fixed. Backend (Gavriel) vulnerabilities can be reported through the same channel.

## Threat Model

The server runs locally over stdio and acts with the credentials of one Gavriel user. The main risks are:

* **Prompt injection**: ticket notes, activities and conversation messages are untrusted free text that may try to steer the agent into writes. Tool descriptions tell the model to treat them as data; writes still require `confirm: true` and, for destructive ones, human approval.
* **Overreach by the agent**: limited by roles, the read-only `get` whitelist and the approval gate below.
* **Secret leakage**: via logs, config files or URLs.

## Roles

`GAVRIEL_MCP_ROLE`: `readonly` (reads only), `lite` (reads + core writes), `full` (everything, default). Pick the lowest role that works.

## Secret Handling

* Resolution order: system store, then `GAVRIEL_PASSWORD` / `GAVRIEL_TRUSTED_DEVICE_TOKEN` env, then (opt-in only) plaintext files.
* Windows: DPAPI-encrypted blobs under `%APPDATA%\gavriel-mcp\secrets` (bound to the Windows user; secrets go through stdin, never argv). Linux: `secret-tool` (libsecret). No macOS backend yet.
* Plaintext files (`~/.secrets/gavriel-password`, `trusted-device.json`) are ignored unless `GAVRIEL_ALLOW_PLAINTEXT=1`.
* `GAVRIEL_API_BASE` must be `https` (plain `http` only for localhost/127.0.0.1).
* Audit logs (`writes.log`, `perf.log`, rotated at 5 MB) redact any key matching `pass|token|secret|auth|2fa|code`. Never commit `.env`.
* `get` rejects `..`, `%`, `?`, `#` in paths, only allows whitelisted read prefixes (`/auth/me` only under auth) and drops sensitive query keys.

## CLI and TOTP seed

`gavriel totp set` is opt-in and stores the seed only in the OS secret store (DPAPI / libsecret) under `totp_seed:<email>`, never in a file. Anyone with access to your OS user can then generate 2FA codes, so the second factor no longer protects that machine. The seed is never printed (only 6-digit codes) and is redacted from logs; `gavriel logout --purge` or `gavriel totp clear` removes it. Per-account passwords are stored as `password:<email>`; in profile mode the MCP never falls back to another account's environment password.

## Destructive Approval

Every write needs `confirm: true` (otherwise it only previews). Additionally every `delete_*`, every `bulk_*` and `send_conversation_message` ask the human through MCP elicitation before running. If the client does not support elicitation, the operation is **rejected** (fail closed). Opt out explicitly with `GAVRIEL_MCP_DESTRUCTIVE_APPROVAL=off`. Batch tools accept at most 50 validated ids.
