# Cashmere2

A cozy, bucketed budget for anyone. Your own accounts, your own buckets, your own goals, your own categories. It runs as a Mac app and everything stays on your computer: no bank sync, no login, no cloud.

## Install (Mac)

You need [Node.js](https://nodejs.org) (the LTS version is fine). Then, in Terminal:

```
git clone https://github.com/marinkaalheli/cashmere2.git
cd cashmere2
npm install
npm run package          # Apple Silicon (M1/M2/M3/M4)
# npm run package:intel  # older Intel Macs
cp -R dist/Cashmere2-darwin-arm64/Cashmere2.app ~/Desktop/
```

Open `Cashmere2.app` from the Desktop. If macOS says it can't check the developer, right-click the app and choose Open the first time.

See [HOWTO.md](HOWTO.md) for a full walkthrough.

Your data lives in `~/Documents/Cashmere2/ledger.json`, with a backup next to it and a dated copy per day in `backups/`. Delete that folder for a fresh start.

## How it works

- **Accounts** are the real places money sits: bank accounts and credit cards. You type balances in and fix them whenever they drift.
- **Buckets** are labels on the cash in your accounts: what each dollar is for. Spending buckets (fun, groceries), savings buckets (emergency fund, a trip), and bill buckets with a monthly amount and due day (rent).
- **The rule the app enforces:** cash in accounts minus what you owe on cards equals what the buckets hold plus **Unsorted**. Unsorted is money with no job yet.
- **Expenses**: log purchases weekly with a category and the bucket they came out of. A card purchase drops the bucket and raises the card's owed balance right away.
- **Recurring**: subscriptions and the things you buy over and over, each with a cost and a rhythm (every 5 days, every 6 weeks, every month). You see the next date, the true per-month cost, and "Bought it" logs the expense and rolls the date forward.
- **Paychecks**: enter what landed, fill buckets from your per-paycheck plan or decide on the spot, and the rest goes to Unsorted.
- **Goals**: a number you want to hit, watching one bucket, all savings, cash minus debt, or a loan payoff. Shows how much to go and the pace needed.
- **Loans**: balance, rate, monthly payment, due day, payoff estimate, and which bucket funds it.
- **Gamified lightly**: a weekly logging streak, XP, levels, and a few badges.

Everything is derived from the transaction log, so editing or deleting any entry keeps every balance consistent.

## Customize

- First launch runs a wizard: your accounts, your buckets, your loans, then one "big sort" of your current money into buckets. Re-run it any time from The Vault.
- Expense categories are editable under The Vault.
- Add, rename or delete accounts under Accounts, buckets under Buckets, goals under Goals.

## Keyboard

`e` log an expense, `p` log a paycheck, `s` sort money.

## Development

```
npm start   # run from source
```

Test hooks (environment variables): `CM_DATA` overrides the data folder, `CM_VIEW=expenses!nosetup` opens a view and skips the wizard, `CM_SHOT=out.png` captures a screenshot and quits, `CM_TEST=script.js` runs a script in the page and writes its result to `CM_TEST_OUT`.
