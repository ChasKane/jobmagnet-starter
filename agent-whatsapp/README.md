# Agent WhatsApp

HTTP MCP bridge so a Cursor cloud agent can text you while a run is still going.

The linked WhatsApp account is the sender. `WHATSAPP_TO` is your phone. Those have to be different numbers. A message sent from your own account does not notify you.

Tools the agent sees:

- `whatsapp_status` — progress note, no reply
- `whatsapp_ask` — one question, then wait
- `whatsapp_wait` — keep waiting on that question id

## Run

```bash
cd agent-whatsapp
cp .env.example .env
# set BRIDGE_TOKEN and WHATSAPP_TO
npm install
npm start
```

Scan the QR with the spare number: WhatsApp → Linked devices. Leave this process running. Session files stay in `auth/`.

Cloud agents call the bridge from Cursor's network, so localhost is not enough. Install [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) and run:

```bash
cloudflared tunnel --url http://127.0.0.1:3872
```

## Cloud agents

On [cursor.com/agents](https://cursor.com/agents), add an HTTP MCP server:

- name: `whatsapp`
- url: `https://<tunnel-host>/mcp`
- header: `Authorization: Bearer <BRIDGE_TOKEN>`

Enable it for cloud agents. The laptop running the bridge has to stay awake for the whole run. `~/.cursor/mcp.json` only reaches agents on this machine. Cloud agents use the dashboard entry.

Each ask blocks for at most 240 seconds. If you have not replied, the tool comes back `pending` and the agent calls `whatsapp_wait`.
