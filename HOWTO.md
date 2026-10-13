# Cashmere2 How-To

## Get it on your Mac

Cashmere2 is a Mac app that you build once from the code. It takes about five minutes and you only do it once.

1. Install [Node.js](https://nodejs.org) (pick the LTS version) if you don't have it.
2. Open Terminal (Spotlight, type "Terminal").
3. Paste these lines one at a time and press Return after each:

```
git clone https://github.com/marinkaalheli/cashmere2.git
cd cashmere2
npm install
npm run package
cp -R dist/Cashmere2-darwin-arm64/Cashmere2.app ~/Desktop/
```

4. On an older Intel Mac, use `npm run package:intel` instead of `npm run package`, and the folder is `Cashmere2-darwin-x64`.
5. Double-click Cashmere2 on your Desktop. If macOS refuses because it can't verify the developer, right-click the app, choose Open, then Open again. You only need to do this the first time.

Everything you enter is saved in `Documents/Cashmere2/ledger.json` on your own Mac. Nothing is sent anywhere. The app keeps a backup next to it and one dated copy per day in `backups/`, so back up that one folder and you have everything. To start completely over, quit the app and delete that folder.

## The one rule

All the money you have, minus what you owe on credit cards, is split into buckets. Whatever isn't in a bucket is called Unsorted. That's the whole system.

| Word | What it means |
| --- | --- |
| Account | A real place money sits: a bank account, or a credit card (tracked as what you owe). |
| Bucket | A label on some of your cash: "this $400 is rent", "this $60 is fun". The money stays in your bank account. Only the label is new. |
| Unsorted | Cash with no label yet. The app nags you about it because unlabeled money is the money that disappears. |
| Paycheck | Money in. You split it into buckets on the spot, or leave some Unsorted and sort it later. |
| Expense | Money out. It comes out of a bucket. If you paid by card, the card's owed amount goes up at the same time. |
| Pay a card | Moves cash from a bank account to the card. Buckets don't change, because they already dropped when you logged the purchases. |
| Goal | A number you want a bucket (or all your savings, or your net cash) to reach, with the pace to get there. |

Two things people find surprising at first:

- Buckets are not accounts. You don't move money at the bank. You can have one checking account and twelve buckets.
- A card purchase hits your bucket the day you log it, not the day you pay the card. So "Fun" tells the truth before the weekend, not after the statement.

## First launch: the setup wizard

The first time you open the app, four screens set everything up. Each one is a table you can edit: rename anything, delete a row with the × button, add rows with the button under the table. Nothing is locked in. You can re-run the wizard any time from The Vault tab.

1. **Accounts.** List where your money sits. For each row pick Bank account or Credit card, type the balance (for a card, type what you owe right now), and for cards the day of the month the payment is due. Tick the one account your paychecks land in.
2. **Buckets.** Six suggestions appear: Rent & bills, Groceries, Fun, Emergency fund, Savings, Travel. Keep, rename, delete, or add your own. Kinds: Spending (money you'll use up this paycheck), Savings (money that piles up), Bill (a fixed monthly amount with a due date). The Per paycheck column is optional: a dollar amount like `400`, a percent like `10%`, or `rest` for whatever is left over. Leave it blank if you'd rather decide each paycheck.
3. **Loans.** Anything you're paying down: student loans, a car, a phone installment. Balance, interest rate, monthly payment, due day, and what you pay it with. Pick a card if the payment appears on a card statement. Skip if you have none.
4. **Sort money.** The app shows how much cash is Unsorted and asks you to give it a job. Type amounts into buckets until Unsorted is zero, or close to it. Rent for the month first, then an emergency cushion, then the rest wherever you like. This is the one step that takes some thought.

## Your weekly routine

Ten minutes, once a week, is enough. The app rewards it with a streak counter and XP, which is silly and also works.

1. **Log the week's purchases.** Open your card app or bank app, go to Expenses, press `e`, and enter each purchase: amount, date, what you paid with, which bucket it comes out of, and a category. Keep the note short ("groceries", "dinner w/ Sam").
2. **Check Recurring.** Anything due shows up at the top of the Overview. Press Bought it when you bought it, Skip if you didn't need it this time.
3. **When a paycheck lands,** press `p`. Type the net amount. Buckets with a per-paycheck plan fill in automatically; for the rest the app shows what you usually put in and what a goal needs per check. Type numbers or leave them blank. Anything you don't assign stays Unsorted.
4. **Before a card is due,** press Pay a card on the Overview. It defaults to paying in full from your main account.
5. **Once a month,** log rent and loan payments from the Coming up list. Each has a Pay button.
6. **If Unsorted isn't zero,** press `s` and give it a job.

If you skip a week, nothing breaks. Log the missed purchases with their real dates and everything recalculates.

## Tab by tab

| Tab | What it's for | Good to know |
| --- | --- | --- |
| Overview | Cash, card debt, Unsorted and your level at a glance. "Can I go out?" shows your spending buckets. Coming up lists everything due in the next 45 days with a button to pay or log it. | Unsorted turns gold when money has no job and red when buckets promise more than you have. |
| Expenses | The weekly log, grouped by week with totals per category. Filter by category, edit or delete any entry. | Deleting an entry puts the money back in its bucket and off the card. |
| Recurring | Subscriptions and repeat buys: rent, Netflix, moisturizer every 6 weeks, cheese every 5 days. Shows next date, true cost per month, and the yearly total of all of them. | Bought it logs the expense and rolls the date forward. Skip just rolls the date. Items due within 10 days also appear on the Overview. |
| Buckets | Every bucket with its balance, plan, and status. Click a bucket to edit it, Sort to move money in or out, Spend or Pay to log from it. | A bill bucket shows Funded or how much short it is for this month. Deleting a bucket sends its money to Unsorted. |
| Goals | Numbers you want to hit. Each watches one bucket, all savings buckets combined, cash minus card debt, or a loan's payoff. | Shows amount to go, the per-paycheck pace to hit your date, and the date you're on track for at your recent rate. |
| Paychecks | Log a paycheck and see the history with how each one was split. | The split dialog hints what each bucket usually gets and what a goal needs per check. |
| Loans | Balance, rate, monthly payment, payoff estimate, and which bucket funds it. Log payments here. | Interest is an estimate. Once a month, open the loan and type the balance from your statement. |
| Accounts | Bank accounts and cards. Add, rename, delete, set a balance to match the bank, transfer between accounts, pay a card. | A card shows its next due date. Pay in full is one click. |
| The Vault | Where the data file lives, export to CSV, edit categories, re-run setup, progress and badges. | Start over wipes everything (the old file stays in backups). |

## Making it yours

Everything with a name in this app is yours to change.

- **Accounts**: Accounts tab, Add account. Any number of bank accounts and cards. Delete one from its Edit dialog (only if it has no history yet; otherwise rename it).
- **Buckets**: Buckets tab, New bucket. Pick an emoji, a name, a kind, and optionally a per-paycheck plan, a monthly bill amount and due day, and a note to yourself about why it exists.
- **Categories**: The Vault, Edit categories. The defaults are Fun, Necessary, Food, Shopping. Rename them, add Pets or Kids or Car, delete what you don't use. Removed categories hand their expenses to the first one in the list.
- **Goals**: Goals tab, New goal. A goal doesn't need to match a bucket. "Net cash $10,000" or "Savings $5,000 by June" work fine.
- **Recurring**: anything with a rhythm. Rent monthly, gym every 4 weeks, coffee beans every 10 days, dog food every 6 weeks. Each one can come out of a bucket so your buckets stay honest.
- **The whole setup**: The Vault, Re-run setup. It opens the same tables with your current accounts, buckets and loans filled in.

A few ways people set it up:

- **Simple**: one checking account, one card. Buckets: Bills, Food, Fun, Savings. Rent as a recurring item. Done.
- **Envelope style**: a Spending bucket per weakness (Takeout, Clothes, Going out) with a fixed amount per paycheck. When it's empty, it's empty.
- **Goal driven**: one big Savings bucket with `rest` as its plan, and three or four goals watching it with dates.

## Tips, shortcuts and troubleshooting

**Keyboard**: `e` log an expense, `p` log a paycheck, `s` sort money. They work on any tab when no dialog is open.

**Deleting** anything takes two clicks: the button turns into "Click again to confirm" for three seconds.

**The numbers don't match my bank.** Accounts tab, Set balance, type what the bank shows. The difference lands in Unsorted so you can see it. Common causes: interest, a fee, or a purchase you forgot to log.

**Unsorted is negative.** Your buckets promise more than you have, usually because a card purchase came out of an empty bucket. Press `s` and take the money from a bucket that has it.

**I bought something that doesn't fit a bucket.** Log it with "no bucket (Unsorted)". It still goes on the card. Sort it later.

**A paycheck amount is wrong.** Delete it from the Paychecks tab and log it again. That keeps the split consistent.

**I want to see it on another Mac.** Copy the folder `Documents/Cashmere2` over. The app reads whatever is in that folder. Or use Move ledger in The Vault to keep it in a synced folder.

**It won't open.** Right-click the app, Open, Open. If it still refuses, the build is for the wrong chip: rebuild with `npm run package` (Apple Silicon) or `npm run package:intel`.

**Export.** The Vault, Export CSV, for a spreadsheet of every transaction.
