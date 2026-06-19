# ircv3-mcp

An IRCv3 MCP server: a mini IRC client that agents drive over the Model Context Protocol. The
agent reads channels as rendered chat transcripts, sends messages, replies to threads, adds
reactions, fetches history, and manages channel membership — all through a standard set of MCP
tools backed by a full IRCv3 connection with SASL authentication.

## Install

Requires Node >= 20. Nothing to install — everything runs through `npx` and always pulls the
latest published version.

Register with Claude Code (this is all most users need):

```sh
claude mcp add ircv3-mcp -- npx -y ircv3-mcp@latest
```

## Quickstart

Configure an account with the interactive wizard — run through npx, nothing to install:

```sh
npx -y ircv3-mcp@latest configure
```

It prompts for host, nick, SASL mechanism (one of PLAIN, EXTERNAL, or SCRAM-SHA-256), and a
hidden password, and stores the password in your OS keychain.

Prefer a one-liner? `add-account` reads the password from stdin so it never hits shell history:

```sh
echo 'hunter2' | npx -y ircv3-mcp@latest add-account libera \
  --host irc.libera.chat \
  --nick mybot \
  --sasl PLAIN \
  --account mybot \
  --channels '#test' \
  --default \
  --password-stdin
```

Verify connectivity:

```sh
npx -y ircv3-mcp@latest test libera
```

Then register the server with your agent and the tools listed below become available
immediately:

```sh
claude mcp add ircv3-mcp -- npx -y ircv3-mcp@latest
```

## Tools

**Read-only**

- `irc_list_networks` — list all configured accounts and their connection status
- `irc_status` — show connection status, nick, and active capabilities for an account
- `irc_read_history` — fetch messages from a channel or DM as a rendered transcript
- `irc_list_conversations` — list channels and DMs that had activity in a time window
- `irc_list_members` — list current members of a channel with mode prefixes
- `irc_whois` — look up information about a nick

**Writes**

- `irc_send_message` — send a message or multiline batch; supports threading via `in_reply_to`
- `irc_react` — add or remove an emoji reaction on a message
- `irc_join` — join a channel, optionally with a key
- `irc_part` — leave a channel
- `irc_mark_read` — advance the read marker for a conversation

**Destructive**

- `irc_redact` — delete a message by msgid (cannot be undone)
- `irc_send_raw` — send a raw IRC protocol line (unrestricted)

## Configuration

Accounts are stored in TOML at `~/.config/ircv3-mcp/config.toml`. The XDG
`XDG_CONFIG_HOME` variable is respected; the path can also be overridden with
`IRCV3_MCP_CONFIG_DIR`.

Passwords are **never** stored in the config file, in tool output, or in logs. The server
stores them in the OS keychain (`@napi-rs/keyring`) and falls back to an AES-256-GCM
encrypted file (`secrets.enc`) when the keychain is unavailable. The encryption key comes from
a 0600 keyfile (`secrets.key`) or the `IRCV3_MCP_SECRET_KEY` environment variable.

See [`docs/config.example.toml`](docs/config.example.toml) for an annotated example.

## Persistence

The server is stateless per session: it opens one IRC connection per configured account when
the agent session starts and uses `draft/chathistory` to catch up on messages since the last
read marker.

For gap-free 24/7 presence — keeping the connection alive between agent sessions and
accumulating full history — point ircv3-mcp at a bouncer such as
[soju](https://soju.im) or [ZNC](https://znc.in), or an always-on server such as
[Ergo](https://ergo.chat) or [ObbyIRCd](https://github.com/obbyworld/ObbyIRCd).

## Development

```sh
npm run ci       # typecheck + lint + test + build (mirrors CI)
npm test         # vitest unit tests only
npm run build    # compile to dist/
```

Integration tests against a live Ergo instance are gated by `IRC_IT=1` and are not yet wired
into the default test run. Set that variable to opt in when running locally against a
test server.

## License

MIT
