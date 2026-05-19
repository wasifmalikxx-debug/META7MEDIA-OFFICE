# Meta WhatsApp template — `daily_report_v2`

Submit this in WhatsApp Manager (the WABA that owns +923407928956) and
wait for Meta approval (24–48 hours typical). Once approved, set
`WHATSAPP_DAILY_REPORT_V2=true` in the Vercel env vars and redeploy —
the daily-report cron will route through the new template on its next
firing.

## Template metadata

| Field | Value |
|---|---|
| Name | `daily_report_v2` |
| Category | **Utility** |
| Language | **English** |
| Header | (none) |
| Footer | (none) |
| Buttons | (none) |

## Body (copy-paste exactly)

```
💰 META7MEDIA DAILY REPORT 💰
🧑‍🤝‍🧑 {{1}}
📅 Date: {{2}}

--------------------

🏢 Monthly Report

📅 Month: {{3}}
📦 Total Orders: {{4}}
💰 Total Sale: {{5}}
💳 Total Cost: {{6}}
📈 Total Profit: {{7}}

--------------------

🗓 Today's Numbers

📦 Orders: {{8}}
💰 Sale: {{9}}
💳 Cost: {{10}}
📈 Profit: {{11}}

--------------------

👥 Per-Employee Breakdown

{{12}}
```

## Sample values to paste in Meta's preview/test panel

(Meta requires sample data for each placeholder when submitting.)

| Var | Sample |
|---|---|
| `{{1}}` | `Izaan's Team` |
| `{{2}}` | `18/5/2026` |
| `{{3}}` | `May 2026` |
| `{{4}}` | `501` |
| `{{5}}` | `$28,595.51` |
| `{{6}}` | `$8,794.48` |
| `{{7}}` | `$19,801.03` |
| `{{8}}` | `33` |
| `{{9}}` | `$1,243.20` |
| `{{10}}` | `$382.14` |
| `{{11}}` | `$861.06` |
| `{{12}}` | `EM-1: 5 ($142.10) \| EM-2: 0 \| EM-3: 12 ($380.40) \| EM-5: 4 ($98.20)` |

## What renders on the recipient's phone

```
💰 META7MEDIA DAILY REPORT 💰
🧑‍🤝‍🧑 Izaan's Team
📅 Date: 18/5/2026

--------------------

🏢 Monthly Report

📅 Month: May 2026
📦 Total Orders: 501
💰 Total Sale: $28,595.51
💳 Total Cost: $8,794.48
📈 Total Profit: $19,801.03

--------------------

🗓 Today's Numbers

📦 Orders: 33
💰 Sale: $1,243.20
💳 Cost: $382.14
📈 Profit: $861.06

--------------------

👥 Per-Employee Breakdown

EM-1: 5 ($142.10) | EM-2: 0 | EM-3: 12 ($380.40) | EM-5: 4 ($98.20)
```

## Rollout checklist

- [ ] Submit `daily_report_v2` to Meta WhatsApp Manager.
- [ ] Wait for **Approved** status (24–48h).
- [ ] In Vercel project settings, add env var
      `WHATSAPP_DAILY_REPORT_V2=true` (Production scope).
- [ ] Redeploy (Vercel auto-deploys on env-var change, but trigger a
      fresh deploy to be sure).
- [ ] Verify next cron firing at `45 15 * * 1-6` UTC (8:45 PM PKT,
      Mon–Sat) — check Vercel logs for `[daily-report]` + check phones.
- [ ] If anything looks wrong, flip `WHATSAPP_DAILY_REPORT_V2=false`
      and the cron reverts to v1 immediately — no code change needed.

## Why a new template (not an edit)

Meta doesn't allow editing approved templates. The only way to change
the body is to create a new template under a different name and switch
the code over. v1 (`daily_report`) stays approved and registered in
case we need to roll back.

## Param-count constraint

v1 had 11 placeholders. v2 has **12** because the team label is now its
own slot. The `sendDailyReportV2Template` helper in
`src/lib/services/whatsapp.service.ts` maps the new payload field
`teamLabel` to `{{1}}` and shifts every other slot by +1. If the body
above is altered without updating the helper, the message will
mis-render — keep them in sync.
