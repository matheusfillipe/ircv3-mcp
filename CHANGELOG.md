# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.6] - 2026-06-19

### Fixed

- `irc_send_message` returns a consistent `{ ok: true, msgid? }` on every path (single,
  multiline, fallback) instead of a bare `{}` that was indistinguishable from failure
- Multiline sends wait for the server echo to confirm receipt and capture the message's
  msgid (read from the multiline BATCH tags), so replies and reactions can target a
  multiline message; an unconfirmed send now returns an explicit error rather than silent
  success

## [0.1.5] - 2026-06-19

### Fixed

- `configure` no longer appears to hang after the password prompt. The masked-input helper
  was permanently replacing `process.stdout.write`; it now restores the original and prints
  progress ("Saving account...", "Storing password in the system keychain...")
- Replies and reactions send and ingest both `+reply` and `+draft/reply` so threading and
  reactions are recognized by clients that key on either tag

## [0.1.4] - 2026-06-19

### Fixed

- One-shot CLI commands (`configure`, `add-account`, `list`, `remove`, `test`) now exit
  cleanly instead of hanging after completion
- `test` no longer leaks its connection-timeout timer on success
- `--version` and the MCP server now report the real package version (was pinned to 0.1.0)

### Changed

- `test` prints a "Connecting..." line so it is not silent while connecting

## [0.1.3] - 2026-06-19

### Changed

- `configure` wizard now presents SASL mechanisms as a numbered menu (choose 1-4 or
  type a name) instead of requiring the full mechanism string

## [0.1.2] - 2026-06-19

### Fixed

- `configure` wizard validates the SASL mechanism and re-prompts on invalid input
  instead of crashing with an unhandled error
- `configure` no longer prompts for a password when the mechanism is EXTERNAL
- Windows CI: enforce LF line endings via `.gitattributes` so `prettier --check` passes
- Skip the Unix-only key-file permission test on Windows

## [0.1.1] - 2026-06-19

### Changed

- Release pipeline verification (OIDC trusted publishing); no functional changes

## [0.1.0] - 2026-06-19

### Added

- IRCv3 engine with TLS, capability negotiation, and labeled-response
- SASL authentication: PLAIN, EXTERNAL, and SCRAM-SHA-256
- Multiline message batches (`draft/multiline`)
- Emoji reactions via `+draft/react`
- Threaded replies via `+reply` message tag
- Message redaction support
- `draft/chathistory` read with `before`, `after`, `around`, and `latest` selectors
- Server-time and echo-message support for accurate transcript rendering
- 13 MCP tools: `irc_list_networks`, `irc_status`, `irc_read_history`,
  `irc_list_conversations`, `irc_list_members`, `irc_whois`, `irc_send_message`,
  `irc_react`, `irc_join`, `irc_part`, `irc_mark_read`, `irc_redact`, `irc_send_raw`
- CLI account management: `add-account`, `configure`, `list`, `remove`, `test`
- OS keychain secret storage via `@napi-rs/keyring`
- AES-256-GCM encrypted-file secret fallback
- TOML config with XDG directory support
