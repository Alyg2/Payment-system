# Discord Subscription Payment Bot

A Discord.js bot that creates NOWPayments invoices, verifies payments, assigns tiered subscription roles, manages trials and expirations, and exposes an administrator-only subscription status command.

## Features

- Silver, Gold, Platinum, and Elite subscription tiers
- Monthly, multi-month, upgrade, and lifetime payment flows
- NOWPayments invoice creation and payment verification
- Automatic Discord role assignment and expiration
- Two-week trial tracking
- Direct-message payment instructions and renewal reminders
- Administrator-only `/sb-show-status` command
- Local JSON persistence for subscriptions, trials, and used payment IDs

## Requirements

- Node.js 18 or newer
- A Discord application and bot token
- A Discord server with the required subscription roles
- A NOWPayments API key

## Setup

1. Install dependencies:

   ```bash
   npm ci
   ```

2. Copy the environment template:

   ```bash
   cp .env.example .env
   ```

   On PowerShell, use `Copy-Item .env.example .env`.

3. Fill in every value in the local `.env` file:

   | Variable | Purpose |
   | --- | --- |
   | `TOKEN` | Discord bot token |
   | `NOWPAYMENTS_API_KEY` | NOWPayments API key |
   | `GUILD_ID` | Discord server ID |
   | `SUBSCRIPTIONS_CHANNEL_ID` | Channel where the subscription button is posted |
   | `SILVER_ROLE_ID` | Silver subscription role |
   | `GOLD_ROLE_ID` | Gold subscription role |
   | `PLATINUM_ROLE_ID` | Platinum subscription role |
   | `ELITE_ROLE_ID` | Elite subscription role |

4. In the Discord developer portal, enable the Server Members, Message Content, and Invite intents used by the bot.

5. Give the bot permission to view the subscription channel, send messages, use application commands, read message history, manage roles, and create direct-message flows. Its highest role must be above every subscription role it manages.

6. Start the bot:

   ```bash
   npm start
   ```

## Usage

- The bot posts a button in the configured subscription channel at startup.
- Members select a tier and duration, receive a payment link by direct message, and run `!verify <paymentId>` after payment.
- Administrators can run `/sb-show-status username:<name>` to inspect a member's invite and subscription information.

Prices, tier benefits, and payment text are currently defined in `bot.js`. Review them before deployment.

## Commands

| Command | Access | Purpose |
| --- | --- | --- |
| `!verify <paymentId>` | Members | Verify a NOWPayments payment and assign or upgrade a role |
| `/sb-show-status` | Administrators | Show subscription and invite information for a member |
| `npm run check` | Local shell | Check `bot.js` JavaScript syntax |

## Runtime data

The bot creates these local files while it runs:

- `role_expirations.json`
- `free_trials.json`
- `used_payments.json`

They are intentionally ignored by Git because they can contain Discord user IDs, role IDs, expiration dates, and payment identifiers. Back them up securely if they are used in production.

## Security and production notes

- Never commit `.env`, bot tokens, payment API keys, or runtime JSON.
- Rotate a credential immediately if it appears in a commit, log, screenshot, or support message.
- Review the accepted NOWPayments statuses before handling real money; the current implementation also accepts `partially_paid`.
- File-based storage is best suited to one bot process. Use a transactional database before running multiple instances or handling higher payment volume.
- Add request idempotency, structured audit logs, monitoring, backups, and an operator reconciliation process before production use.
- Test role hierarchy, expiry behavior, upgrades, lifetime purchases, and duplicate payment rejection in a private Discord server first.

## License

No license is included. Add one before distributing or accepting outside contributions.
