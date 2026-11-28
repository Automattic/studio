# Remote mode

`studio remote` lets a phone that has been paired with this computer drive Studio Code over the network. The desktop app runs it from Settings > Phone. It is a proof of concept.

It is off unless `STUDIO_ENABLE_REMOTE_MODE` is set in the environment of the CLI or of the Studio app (`packages/common/lib/remote-mode-flag.ts`). Without it, the CLI has no `remote` command, the desktop app shows no Settings > Phone (the preload script passes the flag to the UI as `ipcApi.remoteModeEnabled`), and it does not start remote mode at launch, even if Settings > Phone was on before.

## What it is

Remote mode is the `studio ui` server (`apps/local`) started with a `remote` option. `studio ui` still listens on loopback only and has no authentication. One thing changes for it: the server now refuses a host that is not a loopback address unless remote mode is on.

In remote mode the server:

- listens on one address, which the connection picks (see Connections); a wildcard such as `0.0.0.0` or `::` is refused. The port is 8082 by default, set with `--port` or `STUDIO_REMOTE_SERVER_PORT`;
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

## Connections

`--connection` picks how phones reach remote mode. Settings > Phone in the desktop app passes the same choice, saved as `desktop.phoneConnection` in the config.

| Connection | Listens on | Phones use |
|---|---|---|
| `local`: the local network | `--host`, or the first private IPv4 address (10.x, 172.16-31.x, 192.168.x), which leaves out link-local, Tailscale's and public addresses | `http://<address>:<port>` |
| `tailnet` | this computer's Tailscale address | `http://<100.x address>:<port>` |
| `https`: Tailscale HTTPS | `127.0.0.1` | `https://<machine>.<tailnet>.ts.net:<port>`, through `tailscale serve` |

`auto`, the default, tries the ready ones in the order `https`, `tailnet`, `local` (`packages/common/lib/remote-connection.ts`): if Tailscale HTTPS does not start (no right to change Tailscale's serve settings, as on Linux without `tailscale set --operator`, or no answer at its own address), it says why and takes the next one. A connection asked for by name that is not ready, or does not start, is refused with the reason. `--host` works only with `local`. The server record in `remote.json` holds the address phones use and the connection.

Tailscale's state comes from `tailscale status --json --peers=false` (`packages/common/lib/tailscale.ts`): without the peers, a large tailnet's status stays small. The Tailscale CLI is looked for on `PATH`, then in the macOS app (`/Applications/Tailscale.app/Contents/MacOS/Tailscale`, run with `TAILSCALE_BE_CLI=1`), then in `%ProgramFiles%\Tailscale` on Windows.

For `https`, `studio remote` runs `tailscale serve --https=<port> http://127.0.0.1:<port>` in the foreground (`apps/cli/lib/tailscale-serve.ts`). Tailscale removes a foreground entry when the serving process's connection to it closes. A child outlives a killed parent, so `tailscale serve` runs under a small Node watchdog that holds an IPC channel to `studio remote` and ends `tailscale serve` when the channel closes: the HTTPS address ends with remote mode, even after `kill -9`. The `tailscale` on `PATH` can be a shell script that runs the real binary as its child (Tailscale's macOS installer adds one), so outside Windows the watchdog starts `tailscale serve` in its own process group and ends the whole group. Before it shows a code, `studio remote` asks its own HTTPS address for the descriptor, for up to 60 seconds: the first certificate for a machine can take a while. A failure gives the last request's reason. HTTPS certificates need MagicDNS and HTTPS turned on in the tailnet's admin console, and they put the machine's name and the tailnet's name in public Certificate Transparency logs.

On `tailnet` and `https`, `studio remote` reads Tailscale's state every 30 seconds. It stops, with the reason, when two reads in a row find Tailscale stopped, signed out or with another address for this computer, or at once when `tailscale serve` ends.

## Pairing

1. `studio remote` prints a QR code that holds `studio-remote://pair?url=<address>&code=<code>&id=<instance id>`. The code has 12 characters, works once, lasts 5 minutes, and is dropped after 5 wrong attempts. `studio remote pair` prints a new one. Several codes can be open at once, and a wrong attempt counts against every open code. Open codes are cleared when remote mode starts and stops.
2. The phone reads the descriptor and checks the instance id and protocol version.
3. The phone sends the code to `POST /api/remote/pair` and gets a device token that lasts 30 days.

Codes and tokens are stored as SHA-256 hashes in `~/.studio/remote.json`, through `@studio/common/lib/remote-access.ts`. The server reads the file on each request, so `studio remote devices revoke <id>` applies at once, from any process. An open event stream of a device revoked that way closes within a few seconds.

## Limits

- A device token lets its holder send prompts, and the agent can run commands. Treat a paired device like a shell on this computer.
- Over `local` the connection is HTTP and not encrypted: the pairing code and the token can be read by anyone on that network. `tailnet` is HTTP inside Tailscale's encryption, and `https` adds TLS.
- The Studio phone app on iPhone cannot use `tailnet`: iOS's App Transport Security allows its plain HTTP only to local addresses (`NSAllowsLocalNetworking`), and a 100.x address is not one. On iPhone it uses `https`; Settings > Phone says so in Tailnet's description.
- Behind `tailscale serve` every request comes from 127.0.0.1, so the pairing limit of 10 requests a minute per address is one limit for all callers. Programs on this computer can reach that loopback port; they still need a device token.
- Changing the connection changes the address, so phones paired before pair again.
- The run manager lives in the server process. A run started in the Desktop app does not stream to a phone, and the reverse. The chat appears on both after a reload.
- Each run manager refuses a second run of a chat only among its own runs, so the Desktop app and remote mode can run two agents on one chat at once, as the Desktop app and `studio ui` already can. Both write the same session files and may edit the same site. A per-session lock taken by `studio code sessions resume` would close it for every surface; it is not part of remote mode.
- A site's `url` is its `localhost` address, which a phone cannot open.
- Revoking a device does not stop a run it started.
- Only one `studio remote` can run at a time.
- Chat transcripts and agent output are sent as they are. They can contain secrets the agent's tools returned, for example the admin password of a site the agent just created. Session summaries include the site's local path.
- Runs started from a phone use the same agent surface as `studio ui`, so tools meant for the browser UI are offered to them.
- Remote mode records no Tracks events of its own, and runs it starts are counted as plain CLI usage.
- A request for a chat that does not exist answers 500, not 404.
