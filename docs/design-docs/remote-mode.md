# Remote mode

`studio remote` lets a phone that has been paired with this computer drive Studio Code over the network. It is a proof of concept.

## What it is

Remote mode is the `studio ui` server (`apps/local`) started with a `remote` option. `studio ui` still listens on loopback only and has no authentication. One thing changes for it: the server now refuses a host that is not a loopback address unless remote mode is on.

In remote mode the server:

- listens on a single network address (`--host`; a wildcard such as `0.0.0.0` or `::` is refused). By default it is the first IPv4 address that is not internal, skipping link-local addresses (169.254.x.x). The port is 8082 by default, set with `--port` or `STUDIO_REMOTE_SERVER_PORT`;
- answers only the routes listed in `apps/local/src/remote-mode.ts`, and 403 for every other route under `/api`;
- asks for a device token on each of them, except pairing;
- rejects any request that has an `Origin` header, since a phone app sends none;
- accepts request bodies up to 256 KB;
- accepts a text prompt only when a phone sends a message: no images, files or annotations;
- sends only `id`, `name`, `running` and `url` for each site;
- sends only the `agent` and `site-event` channels on the event stream, and closes a device's stream when the device is revoked or its token expires;
- answers errors without details;
- does not serve the browser UI or the sign-in callback page;
- does not check the `Host` header: a device token is required instead;
- limits pairing to 10 requests a minute per address;
- listens for CLI events on a socket of its own (`_events --listener remote`).

`GET /.well-known/studio/remote` needs no token. It returns the instance id, the computer's name, the protocol version and the Studio version, so a phone can check which computer answers before it pairs.

## Pairing

1. `studio remote` prints a QR code that holds `studio-remote://pair?url=<address>&code=<code>&id=<instance id>`. The code has 12 characters, works once, lasts 5 minutes, and is dropped after 5 wrong attempts. `studio remote pair` prints a new one. Several codes can be open at once, and a wrong attempt counts against every open code. Open codes are cleared when remote mode starts and stops.
2. The phone reads the descriptor and checks the instance id and protocol version.
3. The phone sends the code to `POST /api/remote/pair` and gets a device token that lasts 30 days.

Codes and tokens are stored as SHA-256 hashes in `~/.studio/remote.json`, through `@studio/common/lib/remote-access.ts`. The server reads the file on each request, so `studio remote devices revoke <id>` applies at once, from any process. An open event stream of a device revoked that way closes within a few seconds.

## Limits

- A device token lets its holder send prompts, and the agent can run commands. Treat a paired device like a shell on this computer.
- On a plain network the connection is HTTP and not encrypted: the pairing code and the token can be read by anyone on that network. Use Tailscale or another VPN.
- The run manager lives in the server process. A run started in the Desktop app does not stream to a phone, and the reverse. The chat appears on both after a reload.
- A site's `url` is its `localhost` address, which a phone cannot open.
- Revoking a device does not stop a run it started.
- Only one `studio remote` can run at a time.
- Chat transcripts and agent output are sent as they are. They can contain secrets the agent's tools returned, for example the admin password of a site the agent just created. Session summaries include the site's local path.
- Runs started from a phone use the same agent surface as `studio ui`, so tools meant for the browser UI are offered to them.
- Remote mode records no Tracks events of its own, and runs it starts are counted as plain CLI usage.
- A request for a chat that does not exist answers 500, not 404.
