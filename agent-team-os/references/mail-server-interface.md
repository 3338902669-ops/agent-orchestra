# Mail Server Interface

**The mailbox server is an external dependency. It is not shipped in
this package.** Everything else in the package — the mailbox semantics
in [comms-mail.md](comms-mail.md), the doorbell in
[doorbell-event-driven.md](doorbell-event-driven.md), and the helper
script in [../templates/scripts/mail-helper.ps1](../templates/scripts/mail-helper.ps1)
— is written against the contract in this document. To use this
package you must run a mail server that implements this contract, or
select an existing one that does. This document is the complete
interface the system assumes; it is precise enough to choose or
implement a compatible server.

## Transport

- Base address: `{{MAIL_SCHEME}}://{{MAIL_HOST}}:{{MAIL_PORT}}` — the
  address the server actually binds. Do not assume loopback; a server
  bound to a private-network address does not listen on loopback.
- Scheme and the bearer token: every call carries the shared bearer
  token in the `Authorization` header (see Authentication), so the
  transport must protect it. Use `https` wherever the server offers
  it. Plaintext `http` is acceptable **only** on a trusted network —
  loopback, or a private overlay restricted to the team (for example
  a tailnet) — and that restriction is a deployment precondition,
  never a silent default.
- Endpoint: `POST /mcp/` on that address.
- Protocol: HTTP POST with a JSON-RPC 2.0 envelope, one call per
  request. Tool invocations use the MCP-style tools/call shape:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "send_message",
    "arguments": { "project_key": "{{PROJECT_KEY}}", "...": "..." }
  }
}
```

- A successful call returns a JSON-RPC `result` whose text content
  carries the tool's return value (including the assigned message id
  where applicable). A failed call returns a JSON-RPC `error` object;
  clients must check for it and treat any error as a failed operation.

## Authentication

- Every call carries the header `Authorization: Bearer <token>`.
- There is one shared bearer token per server (or per project, if the
  server supports that). It is read at runtime from a local token file
  (`{{TOKEN_FILE}}`), readable only by the operator and the seats.
- The token is never printed, never logged, and never committed to a
  repository. Rotate it if it appears in any output.
- The doorbell passes the token to its events reader via the child
  process's environment only: the reader is spawned per read with the
  token in its environment block, the watcher process itself never
  holds the token, wake adapters never inherit it, and it is never a
  command-line argument.
- Identity assurance note: possession of the token is the trust
  boundary. On calls that originate from a CLI or helper script, the
  sender field is self-declared and responses report
  `verified_sender: false`. See the known limitation in
  [comms-mail.md](comms-mail.md).

## Projects

- Mail is partitioned by project. Every tool call carries a
  `project_key` argument identifying the project (a human-chosen key,
  registered with the server when the project is created).
- Identities, messages, threads, receipts, and the delivery-event
  stream are all scoped to one project. Nothing crosses projects.

## Identities

- Every seat has one fixed mail identity inside the project, assigned
  at registration and never reused for another seat.
- The server may assign the identity string itself (for example a
  word-pair name) instead of accepting a chosen one. Either way, the
  assigned identity is stable and is what all calls use; seats keep
  the identity-to-role mapping in the roster.
- Registering an identity must be possible before that identity can
  send or receive. The registration call's name is server-specific;
  the contract only requires that provisioning exists and that an
  unregistered identity cannot act.

## Tools

The contract requires these tools, with these names and argument
shapes (this is the surface the shipped helper script calls):

### `send_message`

Creates a new message in a new thread.

| Argument | Meaning |
|---|---|
| `project_key` | Project identifier |
| `sender_name` | Sender's mail identity |
| `to` | List of recipient mail identities |
| `subject` | Subject line |
| `body_md` | Message body (Markdown) |
| `importance` | Optional: `low`, `normal`, or `high` |
| `ack_required` | Optional boolean: recipients must ack explicitly |

Returns: the server-assigned message id. On return, a delivery
receipt exists for each recipient (see Receipts). A send attempted
while the server is unreachable fails at the client — there is no
offline client queue, and the server is not required to provide one.

### `reply_message`

Adds a message to the thread of an existing message.

| Argument | Meaning |
|---|---|
| `project_key` | Project identifier |
| `sender_name` | Sender's mail identity |
| `message_id` | Id of a message in the thread being answered |
| `body_md` | Message body (Markdown) |

Returns: the new message's id. The reply stays in the original
thread; the server maintains thread membership.

### `acknowledge_message`

Records that a recipient has accepted a specific message.

| Argument | Meaning |
|---|---|
| `project_key` | Project identifier |
| `agent_name` | The acknowledging identity — must be an addressed recipient of the message |
| `message_id` | Id of the message being acknowledged |

Effect: an ack with a timestamp is recorded on the message. Reading a
message does not create an ack; only this call does.

### Inbox reading and search

Seats must be able to read what was delivered to them. The exact tool
names for reading are server-specific, but a compatible server
provides, per identity:

- Fetch of the identity's inbox: messages addressed to it, in thread
  order, each with its id, thread id, sender, subject, body, ack
  state, and delivery timestamp.
- Full-text search over subject and body, restricted by the contact
  policy.

### File reservations

A compatible server provides an exclusive-lease facility:

- Reserve: take a lease on a path pattern with a time-to-live (TTL).
- Check: report the current holder of a pattern.
- Release: drop a lease before its TTL expires.

Reservations are advisory coordination, not filesystem locks; the
contract requires the lease bookkeeping, not enforcement against
processes that ignore it.

## Delivery events (inbox-events)

The doorbell does not poll inboxes. It consumes a per-recipient
delivery-event stream with durable cursors. A compatible server must
expose this stream in one of these two equivalent shapes:

- A CLI shipped with (or provided for) the server:
  `<mail-bin> inbox-events --agent <identity> --after <cursor>`,
  printing one JSON object.
- An equivalent tool call or endpoint returning the same JSON.

Response shape:

```json
{
  "events": [
    {
      "event_id": 124,
      "type": "message_delivered",
      "message_id": 42,
      "recipient": "ExampleName",
      "timestamp": "2026-01-01T09:00:00Z"
    }
  ],
  "next_cursor": 124
}
```

Semantics a compatible server must guarantee:

- **Per-recipient streams.** Each identity has its own event stream.
  An event exists for each message delivered to that identity.
- **Monotonic ids.** `event_id` increases strictly within a stream.
- **Incremental reads.** A read with `--after <cursor>` returns only
  events with `event_id` greater than the cursor, in increasing
  order. With no new events, `events` is empty.
- **Cursor rule.** `next_cursor` is the id of the last returned
  event, or the unchanged input cursor when no events are returned.
  Cursors are opaque to consumers; consumers store them durably and
  present them on the next read.
- **System events.** Contact approvals, contact requests, and other
  server-generated administrative notifications appear in the stream
  with a `type` beginning `contact_` (for example `contact_approved`,
  `contact_request`) and carry no task body. Consumers skip them for
  wake purposes; they must be distinguishable by `type` alone.

## Receipts

- **Delivery receipt:** created by the server when a message lands in
  a recipient's mailbox, carrying a timestamp. It proves storage, not
  reading. One receipt per recipient per message.
- **Acknowledgement:** created only by `acknowledge_message` (above),
  carrying a timestamp. It proves the recipient seat accepted the
  message, not that any task succeeded.
- Both must be retrievable with the message they belong to.

## Contact policy

- The server enforces a contact policy: which identities may deliver
  to which identities.
- Mail from unknown or unapproved identities is not delivered until
  approved. Approval and request notifications are the `contact_`
  system events in the delivery stream (above).

## Store-and-forward guarantees

A compatible server guarantees, once a send returns success:

- The message is in a durable archive and a searchable index.
- A delivery receipt with a timestamp exists.
- The message survives server restarts and seat restarts.
- Recipients can read it later, in thread order.

## Conformance checklist

A mail server is compatible with this package if and only if:

1. It accepts `POST /mcp/` JSON-RPC tools/call requests at the bound
   address, authenticated by a shared bearer token.
2. It scopes all state by `project_key`.
3. It provides `send_message`, `reply_message`, and
   `acknowledge_message` with the argument shapes above, returning
   server-assigned message ids.
4. It provides per-identity inbox reading and full-text search.
5. It provides file reservations with TTL leases.
6. It exposes the per-recipient delivery-event stream with monotonic
   event ids, incremental `--after` reads, and the cursor rule above.
7. It marks administrative notifications with a `contact_` event
   type, distinguishable from task mail by type alone.
8. It creates timestamped delivery receipts on landing and
   timestamped acks only via the ack call.
9. It enforces a contact policy that blocks unapproved senders.
10. Landed mail survives restarts (durable archive plus index).

## Related

- Mailbox semantics and limits: [comms-mail.md](comms-mail.md)
- Doorbell and cursor handling: [doorbell-event-driven.md](doorbell-event-driven.md)
- Helper script calling this contract: [../templates/scripts/mail-helper.ps1](../templates/scripts/mail-helper.ps1)
