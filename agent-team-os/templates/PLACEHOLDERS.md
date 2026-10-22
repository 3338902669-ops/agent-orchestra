# Placeholders

Every deployment-specific value in `templates/` is written as a placeholder:
two opening braces, an UPPER_SNAKE name, and two closing braces. Replace all
of them with your own values in your deployment copy — never commit filled
values (and never the token itself) back into this package.

The checker (`../scripts/check.py`) verifies that every placeholder used in
the templates is documented here, and that instantiation with sample values
leaves no placeholder behind. There are 21 placeholders in total.

## Locations

| Placeholder | Meaning | Sample value |
|---|---|---|
| `{{USER_HOME}}` | Home directory of the account that runs the team | `/home/example` |
| `{{WORK_DIR}}` | Root of the team's working files; wake adapters run with this as their working directory | `/home/example/team` |
| `{{BRIDGE_DIR}}` | Directory holding doorbell state, logs, and per-event output | `/home/example/team/bridge` |
| `{{STORAGE_DIR}}` | Mailbox storage directory — the directory the doorbell watches for write events | `/home/example/team/mail-storage` |

## Mailbox

| Placeholder | Meaning | Sample value |
|---|---|---|
| `{{MAIL_SCHEME}}` | Transport scheme of the mailbox endpoint. `https` wherever the server offers it; `http` only on a trusted network (loopback or a private overlay restricted to the team), because the bearer token travels in the Authorization header | `https` |
| `{{MAIL_HOST}}` | Address the mailbox server actually binds (do not assume loopback) | `192.0.2.10` |
| `{{MAIL_PORT}}` | Mailbox server port | `8765` |
| `{{MAIL_BIN}}` | Mailbox CLI binary used by the doorbell to read delivery events | `/usr/local/bin/mail-cli` |
| `{{TOKEN_FILE}}` | File containing the mailbox bearer token; read at runtime, never printed or committed | `/home/example/team/bridge/mail-token.txt` |
| `{{PROJECT_KEY}}` | Mailbox project key / slug | `example-team-mail` |
| `{{PROJECT_PATH}}` | Mailbox project path as registered with the server | `/home/example/team/mail` |

## Seat identities

The fixed mail identity of each seat, as assigned by your mailbox server.
Keep the identity ↔ role mapping in the roster (`roster.md`).

| Placeholder | Role |
|---|---|
| `{{COORDINATOR_NAME}}` | Coordinator — hub, human-facing, owns assignment and final decisions |
| `{{BUILDER_NAME}}` | Builder — implements assigned work |
| `{{VERIFIER_NAME}}` | Verifier — independently checks work; never the implementer |
| `{{OPERATOR_NAME}}` | Operator — runs deployments and live operations |
| `{{DISPATCHER_NAME}}` | Dispatcher — routes inbound work and monitors queues |

## Wake commands

One wake specification per role, used by `scripts/doorbell.ps1`. A wake
specification is **not a command string**: it is a JSON array of arguments
whose first element is the executable. The doorbell invokes the array
directly — no shell, no string evaluation — so nothing in it is ever
interpreted as code. Only two runtime tokens may appear inside the array:

- `{prompt_file}` — path of the file the doorbell writes for this event,
  holding a short instruction for the woken seat (its wording is
  deployment-specific and intentionally not prescribed here). Event data —
  the message id, sender, and subject — is written into that file's text,
  and only there.
- `{id}` — the delivery event's id. The doorbell validates it is numeric
  before substituting it, and skips events whose id is not.

No other token is allowed in a wake specification; in particular the
sender and subject are never substituted into a command, in any form.
Adapt the mechanism to each seat type — see
`../references/doorbell-event-driven.md` for the adapter patterns (CLI round,
bridge task, task card, GUI paste, marker file).

| Placeholder | Meaning | Sample value |
|---|---|---|
| `{{WAKE_COORDINATOR_CMD}}` | How the coordinator is notified of new mail (argv array) | `["team-bridge", "notify-coordinator", "{id}"]` |
| `{{WAKE_BUILDER_CMD}}` | How the builder seat is woken (argv array) | `["agent-cli", "run", "--session", "builder", "--prompt-file", "{prompt_file}"]` |
| `{{WAKE_VERIFIER_CMD}}` | How the verifier seat is woken (argv array) | `["verifier-cli", "run", "--card", "{prompt_file}"]` |
| `{{WAKE_OPERATOR_CMD}}` | How the operator seat is woken (argv array) | `["bridge-task", "run", "operator-wake"]` |
| `{{WAKE_DISPATCHER_CMD}}` | How the dispatcher seat is woken (argv array) | `["gui-wake", "--seat", "dispatcher", "--file", "{prompt_file}"]` |
