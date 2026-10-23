# Pre-launch

Work that should land before JobMagnet is treated as shippable.

- [ ] Remove the control API (`127.0.0.1:3871` in `main.js`, plus `agent-ctl.js`). Drive the app through IPC / the UI only.
- [ ] Use a general-purpose email solution instead of the Gmail API (`lib/mail/gmail.js`, OAuth client, `GMAIL_CLIENT_ID` / `GMAIL_CLIENT_SECRET`).
- [ ] Remove the Ctrl field-debug behavior (hold Control to flag fields: `wireFlaggingKeys` in `main.js`, `FLAG_SCRIPT` in `lib/paint.js`, Review debug flags in chrome).
- [ ] Generalize the LLM selector (`lib/models.js`, chrome compose picker). Right now it is Cursor-catalog + a hardcoded fallback (Grok / Composer / Opus / GPT) and a raw-id “Add Models” field. It should work for whatever models the account actually has, including Extra High and other per-model params, without JobMagnet-specific names.
- [ ] Left-handed model menu / flyout re-layout. The compose bar already swaps Send and the picker; the menu still opens as if the trigger were on the left.
- [ ] Startup YoE check-in. If `skills.as_of` (or a profile `last_edit`) is in a prior calendar year, open a **new chat tab** (not the per-job drawer) and ask — don’t silently bump years. Phrase the gap from last use: a few months / over a year / a few years. Rough copy: “Hey, I notice it’s been [gap] since you used JobMagnet to search for a job — wanna tell me what’s changed? For starters, wanna tell me how much, if any, time you’ve spent working with these technologies…” then list stacks from `applicant-profile.yaml` `skills` (skip `as_of`). Write answers back into `skills.*.years` / `since` and stamp `as_of`. Zero stays asked-and-answered unless they say otherwise. Profile comments on how years are counted stay the source of truth — Magnet asks, it does not invent.
