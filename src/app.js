"use strict";
// Cashmere — renderer. Everything is derived from the transaction log, so
// editing or deleting a transaction always keeps balances consistent.

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

const DEFAULT_CATS = [{ id: "fun", label: "Fun" }, { id: "necessary", label: "Necessary" }, { id: "food", label: "Food" }, { id: "shopping", label: "Shopping" }];
const cats = () => (S.db.categories || []).map((c) => [c.id, c.label]);
const catLabel = (id) => S.db.categories.find((c) => c.id === id)?.label || id || "";
const catIdx = (id) => Math.max(0, S.db.categories.findIndex((c) => c.id === id)) % 6;
const UNITS = [["days", "days"], ["weeks", "weeks"], ["months", "months"]];
const KINDS = { spending: "Spending", savings: "Savings", bill: "Bill" };
const XP = { expense: 10, paycheck: 50, cardpay: 75, cardfull: 100, loanpay: 40, allocate: 15, transfer: 5, goal: 200, loanfree: 300 };
const LEVELS = ["Coin Counter", "Budget Beginner", "Envelope Enthusiast", "Savings Sorcerer", "Bucket Boss", "Cashmere Comfortable", "Fiscal Fairy", "Vault Keeper", "Money Magnate", "Financially Serene"];
const BADGES = {
  first_paycheck: ["💸", "First paycheck sorted"],
  full: ["🧾", "Paid a card in full"],
  streak4: ["🔥", "4-week logging streak"],
  streak12: ["🌟", "12-week logging streak"],
  goal: ["🏆", "Reached a savings goal"],
  loanfree: ["🕊️", "Paid off a loan"],
  fifty: ["📒", "50 expenses logged"],
};
const DEFAULT_BUCKETS = [
  ["🏠", "Rent & bills", "bill"], ["🛒", "Groceries", "spending"], ["🎉", "Fun", "spending"],
  ["🚨", "Emergency fund", "savings"], ["💰", "Savings", "savings"], ["✈️", "Travel", "savings"],
];

const S = { db: null, dataDir: "", error: null, view: "home", expFilter: { cat: "", q: "", all: false } };

// ---------- small helpers ----------
const pad = (n) => String(n).padStart(2, "0");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const uid = () => Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
function parseDate(s) { const [y, m, d] = String(s).split("-").map(Number); return new Date(y, m - 1, d); }
function toStr(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
function todayStr() { return toStr(new Date()); }
function addDays(s, n) { const d = parseDate(s); d.setDate(d.getDate() + n); return toStr(d); }
function daysBetween(a, b) { return Math.round((parseDate(b) - parseDate(a)) / 864e5); }
function weekStart(s) { const d = parseDate(s); const dow = (d.getDay() + 6) % 7; d.setDate(d.getDate() - dow); return toStr(d); }
function fmtDate(s, year) { if (!s) return ""; return parseDate(s).toLocaleDateString("en-US", { month: "short", day: "numeric", ...(year ? { year: "numeric" } : {}) }); }
function nextDue(dueDay, from) {
  const d = parseDate(from || todayStr());
  let y = d.getFullYear(), m = d.getMonth();
  const clamp = (yy, mm) => Math.min(Number(dueDay) || 1, new Date(yy, mm + 1, 0).getDate());
  let cand = new Date(y, m, clamp(y, m));
  if (cand < d) { m++; if (m > 11) { m = 0; y++; } cand = new Date(y, m, clamp(y, m)); }
  return toStr(cand);
}
function money(n, sign) {
  const v = r2(n);
  const abs = Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (v < 0 ? "−" : sign && v > 0 ? "+" : "") + "$" + abs;
}
function money0(n) { return money(n).replace(/\.00$/, ""); }
function ordinal(n) { n = Number(n); const s = ["th", "st", "nd", "rd"], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }
function inDays(n) { return n === 0 ? "today" : n === 1 ? "tomorrow" : n < 0 ? Math.abs(n) + "d overdue" : "in " + n + "d"; }
function pct(a, b) { return b > 0 ? Math.max(0, Math.min(100, (a / b) * 100)) : 0; }
function loanEstimate(balance, rate, pmt) {
  if (balance <= 0) return { months: 0, interest: 0 };
  if (!pmt || pmt <= 0) return { months: Infinity, interest: 0 };
  const r = (Number(rate) || 0) / 100 / 12;
  if (r === 0) return { months: Math.ceil(balance / pmt), interest: 0 };
  if (pmt <= balance * r) return { months: Infinity, interest: 0 };
  const n = -Math.log(1 - (r * balance) / pmt) / Math.log(1 + r);
  return { months: Math.ceil(n), interest: n * pmt - balance };
}

// ---------- data model ----------
function emptyDb() {
  return {
    version: 1, setup: false, created: todayStr(),
    accounts: [], categories: DEFAULT_CATS.map((c) => ({ ...c })),
    buckets: [], loans: [], goals: [], recurring: [], transactions: [],
  };
}
function acc(id) { return S.db.accounts.find((a) => a.id === id); }
function bucket(id) { return S.db.buckets.find((b) => b.id === id); }
function loan(id) { return S.db.loans.find((l) => l.id === id); }
function goal(id) { return S.db.goals.find((g) => g.id === id); }
function goalsForBucket(bucketId) { return S.db.goals.filter((g) => g.bucketId === bucketId); }
// "Comes out of" options: buckets, with each bucket's goals indented under it (value "goal:<id>").
function outOfOptions(kindsFirst = []) {
  const out = [["", "— no bucket (Unsorted)"]];
  const bs = [...activeBuckets()].sort((a, b) => (kindsFirst.indexOf(b.kind) >= 0) - (kindsFirst.indexOf(a.kind) >= 0));
  for (const b of bs) { out.push([b.id, b.emoji + " " + b.name]); for (const g of goalsForBucket(b.id)) out.push(["goal:" + g.id, "\u00a0\u00a0\u00a0↳ " + g.emoji + " " + g.name]); }
  return out;
}
function parseOutOf(v) { if (v && String(v).startsWith("goal:")) { const g = goal(v.slice(5)); return { bucketId: g?.bucketId || null, goalId: g ? g.id : null }; } return { bucketId: v || null, goalId: null }; }
function cashAccounts() { return S.db.accounts.filter((a) => a.kind === "cash"); }
function cardAccounts() { return S.db.accounts.filter((a) => a.kind === "card"); }
function activeBuckets() { return S.db.buckets.filter((b) => !b.archived); }
function mainAccount() { return S.db.accounts.find((a) => a.main && a.kind === "cash") || cashAccounts()[0]; }
function txSorted(desc) {
  const t = [...S.db.transactions].sort((a, b) => (a.date === b.date ? (a.seq || 0) - (b.seq || 0) : a.date < b.date ? -1 : 1));
  return desc ? t.reverse() : t;
}
let seqCounter = 0;
function addTx(t) { t.id = uid(); t.seq = Date.now() * 10 + (seqCounter++ % 10); S.db.transactions.push(t); return t; }

// Walk the log once and produce every number the UI needs.
function derive() {
  const db = S.db;
  const acct = Object.fromEntries(db.accounts.map((a) => [a.id, 0]));
  const bkt = Object.fromEntries(db.buckets.map((b) => [b.id, 0]));
  const ln = Object.fromEntries(db.loans.map((l) => [l.id, 0]));
  const galloc = Object.fromEntries((db.goals || []).map((g) => [g.id, 0]));
  const gspent = Object.fromEntries((db.goals || []).map((g) => [g.id, 0]));
  const ginflow = {};
  const recentFrom = addDays(todayStr(), -56);
  const gIn = (t, gid, v) => { if (gid && t.date >= recentFrom && v > 0) ginflow[gid] = (ginflow[gid] || 0) + v; };
  const isCard = (id) => acc(id)?.kind === "card";
  const add = (o, k, v) => { if (k in o) o[k] += v; };
  let xp = 0, paychecks = 0, expenses = 0, lastPaycheck = null;
  const weeks = new Set(), badges = new Set();
  for (const t of txSorted()) {
    const a = r2(t.amount);
    switch (t.type) {
      case "opening": case "adjust": add(acct, t.accountId, a); break;
      case "paycheck": add(acct, t.accountId, a); (t.splits || []).forEach((s) => { add(bkt, s.bucketId, r2(s.amount)); if (s.goalId) { add(galloc, s.goalId, r2(s.amount)); gIn(t, s.goalId, r2(s.amount)); } }); xp += XP.paycheck; paychecks++; lastPaycheck = t.date; badges.add("first_paycheck"); break;
      case "expense": add(acct, t.accountId, isCard(t.accountId) ? a : -a); if (t.bucketId) add(bkt, t.bucketId, -a); if (t.goalId) { add(galloc, t.goalId, -a); add(gspent, t.goalId, a); } xp += XP.expense; expenses++; weeks.add(weekStart(t.date)); break;
      case "cardpay": { const before = acct[t.cardId] || 0; add(acct, t.fromId, -a); add(acct, t.cardId, -a); xp += XP.cardpay; if (before > 0 && a >= before - 0.005) { xp += XP.cardfull; badges.add("full"); } break; }
      case "loanpay": add(ln, t.loanId, -a); add(acct, t.accountId, isCard(t.accountId) ? a : -a); if (t.bucketId) add(bkt, t.bucketId, -a); xp += XP.loanpay; if (t.loanId in ln && ln[t.loanId] <= 0.005) { badges.add("loanfree"); xp += XP.loanfree; } break;
      case "loanset": if (t.loanId in ln) ln[t.loanId] = a; break;
      case "transfer": add(acct, t.fromId, -a); add(acct, t.toId, a); xp += XP.transfer; break;
      case "allocate": (t.splits || []).forEach((s) => { add(bkt, s.bucketId, r2(s.amount)); if (s.goalId) { add(galloc, s.goalId, r2(s.amount)); gIn(t, s.goalId, r2(s.amount)); } }); xp += XP.allocate; break;
      case "earmark": add(galloc, t.goalId, a); gIn(t, t.goalId, a); xp += XP.allocate; break;
    }
  }
  for (const k in acct) acct[k] = r2(acct[k]);
  for (const k in bkt) bkt[k] = r2(bkt[k]);
  const cash = r2(cashAccounts().reduce((s, a) => s + acct[a.id], 0));
  const owed = r2(cardAccounts().reduce((s, a) => s + acct[a.id], 0));
  const bucketsTotal = r2(Object.values(bkt).reduce((s, v) => s + v, 0));
  const unsorted = r2(cash - owed - bucketsTotal);
  for (const k in galloc) galloc[k] = r2(galloc[k]);
  for (const k in ginflow) ginflow[k] = ginflow[k] / 4; // last 8 weeks ≈ 4 paychecks
  const earmarked = {}; for (const g of db.goals || []) if (g.bucketId) earmarked[g.bucketId] = r2((earmarked[g.bucketId] || 0) + galloc[g.id]);
  const free = {}; for (const b of db.buckets) free[b.id] = r2(bkt[b.id] - (earmarked[b.id] || 0));
  const partial = { galloc, gspent };
  for (const g of db.goals || []) if (goalProgress(g, partial).reached) { xp += XP.goal; badges.add("goal"); }
  if (expenses >= 50) badges.add("fifty");
  // Streak: consecutive weeks with at least one expense logged, counting back from this week (or last week if this one is still empty).
  let streak = 0, w = weekStart(todayStr());
  if (!weeks.has(w)) w = addDays(w, -7);
  while (weeks.has(w)) { streak++; w = addDays(w, -7); }
  if (streak >= 4) badges.add("streak4");
  if (streak >= 12) badges.add("streak12");
  const level = Math.min(LEVELS.length, 1 + Math.floor(Math.sqrt(xp / 100)));
  const lvlFloor = 100 * (level - 1) ** 2, lvlNext = 100 * level ** 2;
  const nextPayday = lastPaycheck ? addDays(lastPaycheck, 14) : null;
  const recent = txSorted(true).filter((t) => t.type === "paycheck").slice(0, 6);
  const avgPaycheck = recent.length ? recent.reduce((s, t) => s + t.amount, 0) / recent.length : 0;
  const recentInflow = {};
  for (const t of recent) for (const sp of t.splits || []) recentInflow[sp.bucketId] = (recentInflow[sp.bucketId] || 0) + r2(sp.amount);
  for (const k in recentInflow) recentInflow[k] = recentInflow[k] / recent.length;
  return { avgPaycheck, recentInflow, galloc, gspent, ginflow, earmarked, free, acct, bkt, ln, cash, owed, bucketsTotal, unsorted, xp, level, lvlFloor, lvlNext, streak, badges, paychecks, expenses, lastPaycheck, nextPayday, thisWeekLogged: weeks.has(weekStart(todayStr())) };
}

function planSplits(net) {
  const splits = []; let used = 0; let rem = null;
  for (const b of activeBuckets()) {
    const p = b.plan || {};
    if (p.remainder) { rem = b; continue; }
    let amt = 0;
    if (p.mode === "amount") amt = r2(p.value);
    else if (p.mode === "percent") amt = r2((net * (Number(p.value) || 0)) / 100);
    if (amt > 0) { splits.push({ bucketId: b.id, amount: amt }); used += amt; }
  }
  const rest = r2(net - used);
  if (rem && rest > 0) splits.push({ bucketId: rem.id, amount: rest });
  return splits;
}
function planLabel(b) {
  const p = b.plan || {};
  if (p.remainder) return "gets the remainder";
  if (p.mode === "amount" && p.value > 0) return money0(p.value) + " / paycheck";
  if (p.mode === "percent" && p.value > 0) return p.value + "% / paycheck";
  return "no paycheck plan";
}
// Expected inflow per paycheck for a bucket: the plan if there is one, otherwise what recent paychecks actually put in.
function bucketInflow(b, d) {
  const avg = d.avgPaycheck || 0;
  const p = b.plan || {};
  if (!p.mode && !p.remainder) return (d.recentInflow || {})[b.id] || 0;
  if (p.mode === "amount") return Number(p.value) || 0;
  if (p.mode === "percent") return (avg * (Number(p.value) || 0)) / 100;
  if (p.remainder) {
    const fixed = activeBuckets().reduce((s, x) => s + (x.plan?.mode === "amount" ? Number(x.plan.value) || 0 : x.plan?.mode === "percent" ? (avg * (Number(x.plan.value) || 0)) / 100 : 0), 0);
    return Math.max(0, avg - fixed);
  }
  return 0;
}
// Where a goal stands. A goal is a slice of its bucket: only money set aside for it counts.
function goalProgress(g, d) {
  const target = Number(g.target) || 0, alloc = (d.galloc || {})[g.id] || 0, spent = (d.gspent || {})[g.id] || 0;
  const saved = r2(alloc + spent);
  const remaining = Math.max(0, r2(target - saved));
  const reached = target > 0 && saved >= target - 0.005;
  const used = spent > 0 && spent >= target - 0.005;
  let perPaycheck = null, projected = null;
  if (!reached && g.date) { const days = daysBetween(todayStr(), g.date); perPaycheck = days < 0 ? null : remaining / Math.max(1, Math.floor(days / 14)); }
  const inflow = (d.ginflow || {})[g.id] || 0;
  if (!reached && inflow > 0) { const n = Math.ceil(remaining / inflow); projected = addDays(d.nextPayday && d.nextPayday >= todayStr() ? d.nextPayday : todayStr(), 14 * (n - 1)); }
  return { target, alloc, spent, saved, remaining, reached, done: reached, used, pct: pct(saved, target), perPaycheck, projected, inflow };
}
// What a bill bucket needs to hold each month: its own amount, or the loan minimums it funds, whichever is larger.
function billNeed(b) {
  const own = b.bill ? Number(b.bill.amount) || 0 : 0;
  const loans = S.db.loans.filter((l) => l.bucketId === b.id).reduce((s, l) => s + (Number(l.minPayment) || 0), 0);
  return Math.max(own, loans);
}

// ---------- persistence ----------
let lastLevel = null;
async function save(opts = {}) {
  await window.cashmere.saveDb(S.db);
  const d = derive();
  if (lastLevel !== null && d.level > lastLevel) {
    toast("Level " + d.level + ": " + LEVELS[d.level - 1] + "!", true);
    confetti();
  } else if (opts.xp) {
    toast((opts.msg ? opts.msg + " · " : "") + "+" + opts.xp + " XP");
    if (opts.party) confetti();
  } else if (opts.msg) toast(opts.msg);
  lastLevel = d.level;
  render();
}

// ---------- UI primitives ----------
let toastTimer = null;
function toast(msg, big) {
  const t = $("#toast"); t.textContent = msg; t.classList.toggle("big", !!big); t.classList.add("show");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), big ? 3200 : 2000);
}
function confetti() {
  const c = $("#confetti"), ctx = c.getContext("2d");
  c.width = innerWidth; c.height = innerHeight; c.style.display = "block";
  const colors = ["#c9a46a", "#8da58a", "#d9a7a0", "#e8d7b9", "#6b7f69"];
  const ps = Array.from({ length: 140 }, () => ({ x: innerWidth / 2 + (Math.random() - 0.5) * 200, y: innerHeight / 2, vx: (Math.random() - 0.5) * 14, vy: -Math.random() * 14 - 4, r: 4 + Math.random() * 5, c: colors[(Math.random() * colors.length) | 0], a: Math.random() * 6 }));
  const t0 = performance.now();
  (function frame(t) {
    const el = t - t0; ctx.clearRect(0, 0, c.width, c.height);
    for (const p of ps) { p.vy += 0.35; p.x += p.vx; p.y += p.vy; p.a += 0.1; ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a); ctx.fillStyle = p.c; ctx.globalAlpha = Math.max(0, 1 - el / 1800); ctx.fillRect(-p.r / 2, -p.r / 2, p.r, p.r * 0.6); ctx.restore(); }
    if (el < 1800) requestAnimationFrame(frame); else { c.style.display = "none"; ctx.clearRect(0, 0, c.width, c.height); }
  })(t0);
}

// Generic form dialog. Resolves with the values object, {__delete:true}, or null on cancel.
function fieldHtml(f) {
  const v = f.value ?? "";
  const id = "f_" + f.key;
  let input = "";
  switch (f.type) {
    case "money": input = `<div class="money-in"><span>$</span><input id="${id}" name="${f.key}" type="number" step="0.01" min="${f.min ?? 0}" value="${v === "" ? "" : r2(v)}" placeholder="${esc(f.placeholder || "0.00")}" ${f.required ? "required" : ""} inputmode="decimal"></div>`; break;
    case "number": input = `<input id="${id}" name="${f.key}" type="number" step="${f.step || 1}" min="${f.min ?? ""}" max="${f.max ?? ""}" value="${esc(v)}" placeholder="${esc(f.placeholder || "")}" ${f.required ? "required" : ""}>`; break;
    case "date": input = `<input id="${id}" name="${f.key}" type="date" value="${esc(v)}" ${f.required ? "required" : ""}>`; break;
    case "select": input = `<select id="${id}" name="${f.key}">${f.options.map(([ov, ol]) => `<option value="${esc(ov)}" ${String(ov) === String(v) ? "selected" : ""}>${esc(ol)}</option>`).join("")}</select>`; break;
    case "checkbox": return `<label class="check ${f.half ? "half" : ""}"><input id="${id}" name="${f.key}" type="checkbox" ${v ? "checked" : ""}> ${esc(f.label)}</label>`;
    case "textarea": input = `<textarea id="${id}" name="${f.key}" rows="2" maxlength="300" placeholder="${esc(f.placeholder || "")}">${esc(v)}</textarea>`; break;
    case "chips": input = `<div class="chips" data-chips="${f.key}">${f.options.map(([ov, ol]) => `<button type="button" class="chip ${String(ov) === String(v) ? "on" : ""}" data-val="${esc(ov)}">${esc(ol)}</button>`).join("")}<input type="hidden" name="${f.key}" value="${esc(v)}"></div>`; break;
    case "static": return `<div class="static ${f.half ? "half" : ""}"><span class="lbl">${esc(f.label)}</span><div>${f.html}</div></div>`;
    default: input = `<input id="${id}" name="${f.key}" type="text" value="${esc(v)}" placeholder="${esc(f.placeholder || "")}" maxlength="${f.max || 80}" ${f.required ? "required" : ""} ${f.list ? `list="${f.list}"` : ""}>`;
  }
  return `<label class="${f.half ? "half" : ""}"><span class="lbl">${esc(f.label)}</span>${input}${f.help ? `<small>${f.help}</small>` : ""}</label>`;
}
function formDialog({ title, intro, fields, submit = "Save", danger, validate, wide, cancelLabel = "Cancel" }) {
  return new Promise((resolve) => {
    const dlg = $("#dlg");
    dlg.innerHTML = `<form method="dialog" class="form ${wide ? "wide" : ""}" autocomplete="off">
      <h2>${esc(title)}</h2>${intro ? `<p class="intro">${intro}</p>` : ""}
      <div class="fields">${fields.map(fieldHtml).join("")}</div>
      <p class="err" id="formErr"></p>
      <div class="actions">${danger ? `<button type="button" class="btn danger" data-danger>${esc(danger)}</button>` : ""}<span class="spacer"></span><button type="button" class="btn" data-cancel>${esc(cancelLabel)}</button><button type="submit" class="btn primary">${esc(submit)}</button></div>
    </form>`;
    const form = $("form", dlg);
    let done = false;
    const finish = (val) => { if (done) return; done = true; dlg.close(); resolve(val); };
    $$("[data-chips]", form).forEach((g) => g.addEventListener("click", (e) => {
      const b = e.target.closest(".chip"); if (!b) return;
      $$(".chip", g).forEach((c) => c.classList.toggle("on", c === b)); $("input[type=hidden]", g).value = b.dataset.val;
    }));
    $("[data-cancel]", form).onclick = () => finish(null);
    const dz = $("[data-danger]", form);
    if (dz) dz.onclick = () => { if (dz.dataset.armed) finish({ __delete: true }); else { dz.dataset.armed = "1"; dz.textContent = "Click again to confirm"; setTimeout(() => { if (!done) { delete dz.dataset.armed; dz.textContent = danger; } }, 3000); } };
    form.onsubmit = (e) => {
      e.preventDefault();
      const vals = {};
      for (const f of fields) {
        if (f.type === "static") continue;
        const el = form.elements[f.key]; if (!el) continue;
        if (f.type === "checkbox") vals[f.key] = el.checked;
        else if (f.type === "money" || f.type === "number") vals[f.key] = el.value === "" ? null : Number(el.value);
        else vals[f.key] = el.value.trim();
      }
      const err = validate ? validate(vals) : null;
      if (err) { $("#formErr", form).textContent = err; return; }
      finish(vals);
    };
    dlg.oncancel = (e) => { e.preventDefault(); finish(null); };
    dlg.showModal();
    const first = $("input:not([type=hidden]), select, textarea", form); if (first) first.focus();
  });
}
// Custom dialog: caller supplies HTML and a wiring function receiving (dialogEl, finish).
function customDialog(html, wire) {
  return new Promise((resolve) => {
    const dlg = $("#dlg"); dlg.innerHTML = html;
    let done = false;
    const finish = (val) => { if (done) return; done = true; dlg.close(); resolve(val); };
    $$("[data-cancel]", dlg).forEach((b) => (b.onclick = () => finish(null)));
    dlg.oncancel = (e) => { e.preventDefault(); finish(null); };
    wire(dlg, finish);
    dlg.showModal();
  });
}

// Editable table dialog: add/remove rows, resolves with an array of row objects (plus _id when the row came in with one) or null.
function rowsDialog({ title, intro, columns, rows, blank, submit = "Save", cancelLabel = "Cancel", wide = true, validate, addLabel = "+ Add row" }) {
  const cell = (c, r) => {
    const v = r[c.key] ?? "";
    const name = `data-col="${c.key}"`;
    switch (c.type) {
      case "select": return `<select ${name}>${c.options.map(([ov, ol]) => `<option value="${esc(ov)}" ${String(ov) === String(v) ? "selected" : ""}>${esc(ol)}</option>`).join("")}</select>`;
      case "check": return `<input type="checkbox" ${name} ${v ? "checked" : ""}>`;
      case "radio": return `<input type="radio" name="rd_${c.key}" ${name} ${v ? "checked" : ""}>`;
      case "money": return `<div class="money-in sm"><span>$</span><input type="number" step="0.01" ${name} value="${v === "" || v === null ? "" : v}"></div>`;
      case "number": return `<input type="number" step="any" ${name} value="${v === null ? "" : esc(v)}" min="${c.min ?? ""}" max="${c.max ?? ""}" class="num-in" placeholder="${esc(c.placeholder || "")}">`;
      case "emoji": return `<input type="text" ${name} value="${esc(v)}" maxlength="4" class="emoji-in">`;
      default: return `<input type="text" ${name} value="${esc(v)}" placeholder="${esc(c.placeholder || "")}" maxlength="${c.max || 60}" class="${c.cls || ""}">`;
    }
  };
  const rowHtml = (r) => `<tr data-rid="${esc(r._id || "")}">${columns.map((c) => `<td>${cell(c, r)}</td>`).join("")}<td><button type="button" class="btn tiny" data-remove title="Remove">×</button></td></tr>`;
  const html = `<form method="dialog" class="form ${wide ? "wide" : ""}" autocomplete="off"><h2>${esc(title)}</h2>${intro ? `<p class="intro">${intro}</p>` : ""}
    <table class="split rows"><thead><tr>${columns.map((c) => `<th>${esc(c.label)}</th>`).join("")}<th></th></tr></thead><tbody>${rows.map(rowHtml).join("")}</tbody></table>
    <div class="row-add"><button type="button" class="btn small" data-add>${esc(addLabel)}</button></div>
    <p class="err" id="formErr"></p>
    <div class="actions"><span class="spacer"></span><button type="button" class="btn" data-cancel>${esc(cancelLabel)}</button><button type="submit" class="btn primary">${esc(submit)}</button></div></form>`;
  return customDialog(html, (dlg, finish) => {
    const tbody = $("tbody", dlg);
    $("[data-add]", dlg).onclick = () => { tbody.insertAdjacentHTML("beforeend", rowHtml({ ...blank })); const f = $("tr:last-child input[type=text]", tbody); if (f) f.focus(); };
    tbody.addEventListener("click", (e) => { const b = e.target.closest("[data-remove]"); if (b) b.closest("tr").remove(); });
    $("form", dlg).onsubmit = (e) => {
      e.preventDefault();
      const out = $$("tr", tbody).map((tr) => {
        const o = { _id: tr.dataset.rid || null };
        for (const c of columns) { const el = tr.querySelector(`[data-col="${c.key}"]`); o[c.key] = c.type === "check" || c.type === "radio" ? el.checked : c.type === "money" || c.type === "number" ? (el.value === "" ? null : Number(el.value)) : el.value.trim(); }
        return o;
      });
      const err = validate ? validate(out) : null;
      if (err) { $("#formErr", dlg).textContent = err; return; }
      finish(out);
    };
  });
}

// ---------- option builders ----------
const bucketOptions = (kindsFirst = []) => {
  const bs = [...activeBuckets()].sort((a, b) => (kindsFirst.indexOf(b.kind) >= 0) - (kindsFirst.indexOf(a.kind) >= 0));
  return [["", "— no bucket (Unsorted)"], ...bs.map((b) => [b.id, b.emoji + " " + b.name])];
};
const payWithOptions = () => [...cardAccounts(), ...cashAccounts()].map((a) => [a.id, a.name + (a.kind === "card" ? " (card)" : "")]);
const cashOptions = () => cashAccounts().map((a) => [a.id, a.name]);
const cardOptions = () => cardAccounts().map((a) => [a.id, a.name]);

// ---------- actions ----------
const act = {};
act.expense = async (el) => {
  const d = derive();
  const existing = el?.dataset?.id ? S.db.transactions.find((t) => t.id === el.dataset.id) : null;
  const presetBucket = el?.dataset?.goal ? "goal:" + el.dataset.goal : el?.dataset?.bucket || "";
  const v = await formDialog({
    title: existing ? "Edit expense" : "Log an expense",
    fields: [
      { key: "amount", label: "Amount", type: "money", value: existing?.amount ?? "", required: true, half: true },
      { key: "date", label: "Date", type: "date", value: existing?.date || todayStr(), required: true, half: true },
      { key: "accountId", label: "Paid with", type: "select", options: payWithOptions(), value: existing?.accountId || cardAccounts()[0]?.id, half: true },
      { key: "bucketId", label: "Comes out of", type: "select", options: outOfOptions(["spending", "bill"]), value: existing ? (existing.goalId ? "goal:" + existing.goalId : existing.bucketId || "") : presetBucket || activeBuckets().find((b) => b.kind === "spending")?.id || "", half: true },
      { key: "category", label: "Category", type: "chips", options: cats(), value: existing?.category || cats()[0]?.[0] || "" },
      { key: "note", label: "What was it?", type: "text", value: existing?.note || "", placeholder: "groceries, dinner with friends, new shoes…", max: 120 },
    ],
    submit: existing ? "Save" : "Add expense",
    danger: existing ? "Delete" : null,
    validate: (v) => (!v.amount || v.amount <= 0 ? "Enter an amount." : null),
  });
  if (!v) return;
  if (v.__delete) { S.db.transactions = S.db.transactions.filter((t) => t.id !== existing.id); return save({ msg: "Expense deleted" }); }
  const outOf = parseOutOf(v.bucketId);
  if (existing) Object.assign(existing, { amount: r2(v.amount), date: v.date, accountId: v.accountId, bucketId: outOf.bucketId, goalId: outOf.goalId, category: v.category || cats()[0]?.[0] || "", note: v.note });
  else addTx({ type: "expense", amount: r2(v.amount), date: v.date, accountId: v.accountId, bucketId: outOf.bucketId, goalId: outOf.goalId, category: v.category || cats()[0]?.[0] || "", note: v.note });
  const b = outOf.bucketId ? bucket(outOf.bucketId) : null;
  const left = b ? d.bkt[b.id] - r2(v.amount) : null;
  await save({ xp: existing ? 0 : XP.expense, msg: existing ? "Saved" : b ? money0(Math.max(0, left)) + " left in " + b.name : "Logged" });
};

act.paycheck = async () => {
  const main = mainAccount();
  if (!main) return toast("Add a bank account first (Accounts tab).");
  const d = derive();
  const bs = activeBuckets();
  const html = `<form method="dialog" class="form wide" autocomplete="off">
    <h2>Log a paycheck</h2>
    <p class="intro">Enter what actually landed (after benefits and taxes). Buckets with a plan are filled in; the rest are yours to decide this check. Put money straight into a goal on its ↳ row. Anything you leave blank stays in Unsorted and you can sort it later.</p>
    <div class="fields">
      <label class="half"><span class="lbl">Net amount</span><div class="money-in"><span>$</span><input id="pcAmt" type="number" step="0.01" min="0" inputmode="decimal" required></div></label>
      <label class="half"><span class="lbl">Date</span><input id="pcDate" type="date" value="${todayStr()}" required></label>
      <label class="half"><span class="lbl">Deposited to</span><select id="pcAcct">${cashOptions().map(([v, l]) => `<option value="${v}" ${v === main.id ? "selected" : ""}>${esc(l)}</option>`).join("")}</select></label>
      <label class="half"><span class="lbl">Note</span><input id="pcNote" type="text" placeholder="Oct 1–14 · 68 hrs" maxlength="80"></label>
    </div>
    <table class="split"><thead><tr><th>Bucket</th><th>Plan</th><th>Now holds</th><th>Add</th></tr></thead><tbody>
      ${bs.map((b) => { const hint = b.plan ? planLabel(b) : d.recentInflow[b.id] ? "usually ~" + money0(d.recentInflow[b.id]) : "your call"; const row = `<tr><td>${esc(b.emoji)} ${esc(b.name)}</td><td class="muted">${esc(hint)}</td><td class="num muted">${money(d.bkt[b.id])}</td><td><div class="money-in sm"><span>$</span><input type="number" step="0.01" min="0" data-split="${b.id}" value=""></div></td></tr>`; const grows = goalsForBucket(b.id).map((g) => { const gp = goalProgress(g, d); const gh = gp.reached ? "fully funded" : gp.perPaycheck !== null ? "needs ~" + money0(gp.perPaycheck) + " / check" : money0(gp.remaining) + " to go"; return `<tr class="goal-row"><td>&nbsp;&nbsp;&nbsp;↳ ${esc(g.emoji)} ${esc(g.name)}</td><td class="muted">${esc(gh)}</td><td class="num muted">${money(gp.alloc)}</td><td><div class="money-in sm"><span>$</span><input type="number" step="0.01" min="0" data-split="${b.id}" data-goal="${g.id}" value=""></div></td></tr>`; }).join(""); return row + grows; }).join("")}
    </tbody></table>
    <div class="split-foot"><span>Allocated <b id="pcUsed">$0.00</b></span><span>To Unsorted <b id="pcRest">$0.00</b></span></div>
    <p class="err" id="formErr"></p>
    <div class="actions"><span class="spacer"></span><button type="button" class="btn" data-cancel>Cancel</button><button type="submit" class="btn primary">Confirm paycheck</button></div>
  </form>`;
  const v = await customDialog(html, (dlg, finish) => {
    const amt = $("#pcAmt", dlg), used = $("#pcUsed", dlg), rest = $("#pcRest", dlg), err = $("#formErr", dlg);
    const inputs = $$("[data-split]", dlg);
    const recompute = () => {
      const net = Number(amt.value) || 0;
      let u = 0; inputs.forEach((i) => (u += Number(i.value) || 0));
      used.textContent = money(u); rest.textContent = money(net - u); rest.parentElement.classList.toggle("bad", net - u < -0.005);
    };
    amt.addEventListener("input", () => { const net = Number(amt.value) || 0; const splits = planSplits(net); inputs.forEach((i) => { const s = i.dataset.goal ? null : splits.find((x) => x.bucketId === i.dataset.split); i.value = s ? s.amount : ""; }); recompute(); });
    inputs.forEach((i) => i.addEventListener("input", recompute));
    $("form", dlg).onsubmit = (e) => {
      e.preventDefault();
      const net = r2(amt.value);
      if (!(net > 0)) { err.textContent = "Enter the paycheck amount."; return; }
      const splits = inputs.map((i) => ({ bucketId: i.dataset.split, ...(i.dataset.goal ? { goalId: i.dataset.goal } : {}), amount: r2(i.value) })).filter((s) => s.amount > 0);
      const u = splits.reduce((s, x) => s + x.amount, 0);
      if (u > net + 0.005) { err.textContent = "You've allocated " + money(u - net) + " more than the paycheck. Use Sort money if you want to pull from Unsorted."; return; }
      finish({ net, date: $("#pcDate", dlg).value, accountId: $("#pcAcct", dlg).value, note: $("#pcNote", dlg).value.trim(), splits });
    };
    amt.focus();
  });
  if (!v) return;
  addTx({ type: "paycheck", amount: v.net, date: v.date, accountId: v.accountId, note: v.note, splits: v.splits });
  await save({ xp: XP.paycheck, msg: "Paycheck sorted", party: d.paychecks === 0 });
};

act.sort = async (el) => {
  const d = derive();
  const bs = activeBuckets();
  const focus = el?.dataset?.bucket;
  const html = `<form method="dialog" class="form wide" autocomplete="off">
    <h2>Sort money</h2>
    <p class="intro">Move money between buckets, or pull from Unsorted. Positive adds to a bucket, negative takes from it. Unsorted is whatever isn't claimed: <b>${money(d.unsorted)}</b> right now.</p>
    <table class="split"><thead><tr><th>Bucket</th><th>Now holds</th><th>Change by</th><th>After</th></tr></thead><tbody>
      ${bs.map((b) => `<tr><td>${esc(b.emoji)} ${esc(b.name)}</td><td class="num muted">${money(d.bkt[b.id])}</td><td><div class="money-in sm"><span>$</span><input type="number" step="0.01" data-split="${b.id}" ${focus === b.id ? "autofocus" : ""}></div></td><td class="num" data-after="${b.id}">${money(d.bkt[b.id])}</td></tr>`).join("")}
    </tbody></table>
    <div class="split-foot"><span>Unsorted after <b id="srtRest">${money(d.unsorted)}</b></span></div>
    <p class="err" id="formErr"></p>
    <div class="actions"><span class="spacer"></span><button type="button" class="btn" data-cancel>Cancel</button><button type="submit" class="btn primary">Apply</button></div>
  </form>`;
  const v = await customDialog(html, (dlg, finish) => {
    const inputs = $$("[data-split]", dlg), rest = $("#srtRest", dlg), err = $("#formErr", dlg);
    const recompute = () => {
      let delta = 0;
      inputs.forEach((i) => { const dv = Number(i.value) || 0; delta += dv; const after = $(`[data-after="${i.dataset.split}"]`, dlg); after.textContent = money(d.bkt[i.dataset.split] + dv); after.classList.toggle("bad", d.bkt[i.dataset.split] + dv < -0.005); });
      rest.textContent = money(d.unsorted - delta); rest.parentElement.classList.toggle("bad", d.unsorted - delta < -0.005);
    };
    inputs.forEach((i) => i.addEventListener("input", recompute));
    $("form", dlg).onsubmit = (e) => {
      e.preventDefault();
      const splits = inputs.map((i) => ({ bucketId: i.dataset.split, amount: r2(i.value) })).filter((s) => s.amount !== 0);
      if (!splits.length) { err.textContent = "Nothing to move."; return; }
      const delta = splits.reduce((s, x) => s + x.amount, 0);
      if (d.unsorted - delta < -0.005) { err.textContent = "That would make Unsorted negative by " + money(delta - d.unsorted) + ". Take it from another bucket instead."; return; }
      for (const s of splits) if (d.bkt[s.bucketId] + s.amount < -0.005) { err.textContent = bucket(s.bucketId).name + " can't go below zero."; return; }
      for (const s of splits) { const em = d.earmarked[s.bucketId] || 0; if (em > 0 && d.bkt[s.bucketId] + s.amount < em - 0.005) { err.textContent = bucket(s.bucketId).name + " has " + money0(em) + " set aside for goals. Take it back from the goals first."; return; } }
      finish(splits);
    };
  });
  if (!v) return;
  addTx({ type: "allocate", amount: 0, date: todayStr(), splits: v });
  await save({ xp: XP.allocate, msg: "Sorted" });
};

act.paycard = async (el) => {
  const d = derive();
  const cardId = el?.dataset?.card || cardAccounts()[0]?.id;
  const card = acc(cardId);
  if (!card || !mainAccount()) return toast("You need a credit card and a bank account for this (Accounts tab).");
  const v = await formDialog({
    title: "Pay off " + card.name,
    intro: "You owe <b>" + money(d.acct[card.id]) + "</b>. Buckets already dropped when you logged the purchases, so this only moves cash to the card.",
    fields: [
      { key: "amount", label: "Payment", type: "money", value: Math.max(0, d.acct[card.id]), required: true, half: true },
      { key: "date", label: "Date", type: "date", value: todayStr(), required: true, half: true },
      { key: "fromId", label: "Paid from", type: "select", options: cashOptions(), value: mainAccount()?.id, half: true },
      { key: "cardId", label: "Card", type: "select", options: cardOptions(), value: card.id, half: true },
    ],
    submit: "Log payment",
    validate: (v) => (!v.amount || v.amount <= 0 ? "Enter the payment amount." : null),
  });
  if (!v) return;
  const full = v.amount >= d.acct[v.cardId] - 0.005 && d.acct[v.cardId] > 0;
  addTx({ type: "cardpay", amount: r2(v.amount), date: v.date, fromId: v.fromId, cardId: v.cardId });
  await save({ xp: XP.cardpay + (full ? XP.cardfull : 0), msg: full ? "Paid in full 🧾" : "Payment logged", party: full });
};

act.transfer = async () => {
  if (cashAccounts().length < 2) return toast("Transfers need two bank accounts (Accounts tab).");
  const v = await formDialog({
    title: "Transfer between accounts",
    fields: [
      { key: "amount", label: "Amount", type: "money", required: true, half: true },
      { key: "date", label: "Date", type: "date", value: todayStr(), required: true, half: true },
      { key: "fromId", label: "From", type: "select", options: cashOptions(), value: mainAccount()?.id, half: true },
      { key: "toId", label: "To", type: "select", options: cashOptions(), value: cashAccounts().find((a) => a.id !== mainAccount()?.id)?.id, half: true },
    ],
    submit: "Log transfer",
    validate: (v) => (!v.amount || v.amount <= 0 ? "Enter an amount." : v.fromId === v.toId ? "Pick two different accounts." : null),
  });
  if (!v) return;
  addTx({ type: "transfer", amount: r2(v.amount), date: v.date, fromId: v.fromId, toId: v.toId });
  await save({ xp: XP.transfer, msg: "Transferred" });
};

act.adjust = async (el) => {
  const d = derive();
  const a = acc(el.dataset.account);
  const isCard = a.kind === "card";
  const v = await formDialog({
    title: "Set " + a.name + " balance",
    intro: "Cashmere thinks " + (isCard ? "you owe " : "it holds ") + "<b>" + money(d.acct[a.id]) + "</b>. Type what the " + (isCard ? "card app" : "bank") + " shows and the difference goes to " + (isCard ? "Unsorted" : "Unsorted") + ".",
    fields: [
      { key: "balance", label: isCard ? "Actual amount owed" : "Actual balance", type: "money", value: d.acct[a.id], required: true, half: true },
      { key: "date", label: "Date", type: "date", value: todayStr(), required: true, half: true },
      { key: "note", label: "Note", type: "text", value: "", placeholder: "interest, fee, forgot to log…" },
    ],
    submit: "Set balance",
  });
  if (!v) return;
  const delta = r2(v.balance - d.acct[a.id]);
  if (Math.abs(delta) < 0.005) return toast("Already matches");
  addTx({ type: "adjust", amount: delta, date: v.date, accountId: a.id, note: v.note });
  await save({ msg: a.name + " set to " + money(v.balance) });
};

act.addAccount = async () => {
  const v = await formDialog({
    title: "Add an account",
    fields: [
      { key: "name", label: "Name", type: "text", value: "", required: true, max: 40, placeholder: "Savings, Checking, Visa…", half: true },
      { key: "kind", label: "Type", type: "chips", options: [["cash", "Bank account"], ["card", "Credit card"]], value: "cash" },
      { key: "balance", label: "Balance now (or amount owed, for a card)", type: "money", value: "", half: true },
      { key: "dueDay", label: "Card due on the", type: "number", value: 25, min: 1, max: 31, half: true, help: "cards only" },
      { key: "main", label: "Paychecks land here", type: "checkbox", value: !cashAccounts().length },
    ],
    submit: "Add account",
    validate: (v) => (!v.name ? "Give it a name." : null),
  });
  if (!v) return;
  const a = { id: uid(), name: v.name, kind: v.kind || "cash" };
  if (a.kind === "card") a.dueDay = Math.max(1, Math.min(31, v.dueDay || 25));
  else if (v.main || !cashAccounts().length) { S.db.accounts.forEach((x) => (x.main = false)); a.main = true; }
  S.db.accounts.push(a);
  if (v.balance) addTx({ type: "opening", amount: r2(v.balance), date: todayStr(), accountId: a.id, note: "opening balance" });
  await save({ msg: a.name + " added" });
};
act.editAccount = async (el) => {
  const a = acc(el.dataset.account);
  const used = S.db.transactions.some((t) => [t.accountId, t.fromId, t.toId, t.cardId].includes(a.id));
  const v = await formDialog({
    title: "Edit " + a.name,
    fields: [
      { key: "name", label: "Name", type: "text", value: a.name, required: true, max: 40 },
      ...(a.kind === "card" ? [{ key: "dueDay", label: "Payment due on the", type: "number", value: a.dueDay || 25, min: 1, max: 31, half: true, help: "day of the month" }] : [{ key: "main", label: "Paychecks and card payments default to this account", type: "checkbox", value: !!a.main }]),
    ],
    danger: "Delete account",
  });
  if (!v) return;
  if (v.__delete) {
    if (used) return toast("This account has history. Delete those entries first, or just rename it.");
    S.db.accounts = S.db.accounts.filter((x) => x.id !== a.id);
    if (a.main && cashAccounts()[0]) cashAccounts()[0].main = true;
    return save({ msg: "Account deleted" });
  }
  a.name = v.name;
  if (a.kind === "card") a.dueDay = Math.max(1, Math.min(31, v.dueDay || 25));
  else if (v.main) S.db.accounts.forEach((x) => (x.main = x.id === a.id));
  await save({ msg: "Saved" });
};

act.editBucket = async (el) => {
  const b = el?.dataset?.bucket ? bucket(el.dataset.bucket) : null;
  const v = await formDialog({
    title: b ? "Edit bucket" : "New bucket",
    fields: [
      { key: "emoji", label: "Emoji", type: "text", value: b?.emoji || "🪣", max: 4, half: true },
      { key: "name", label: "Name", type: "text", value: b?.name || "", required: true, max: 40, half: true },
      { key: "kind", label: "Kind", type: "chips", options: Object.entries(KINDS), value: b?.kind || "savings" },
      { key: "planMode", label: "Per paycheck", type: "select", options: [["none", "Nothing automatic"], ["amount", "Fixed dollars"], ["percent", "Percent of paycheck"], ["remainder", "Whatever is left"]], value: b?.plan?.remainder ? "remainder" : b?.plan?.mode || "none", half: true },
      { key: "planValue", label: "Amount or %", type: "number", step: 0.01, min: 0, value: b?.plan?.value ?? "", half: true, help: "Dollars for fixed, a number like 10 for percent" },
      { key: "billAmount", label: "Monthly bill amount", type: "money", value: b?.bill?.amount ?? "", half: true, help: "For bills only, e.g. rent" },
      { key: "billDay", label: "Bill due on the", type: "number", value: b?.bill?.dueDay ?? "", min: 1, max: 31, half: true, help: "day of the month" },
      { key: "note", label: "Note to self", type: "textarea", value: b?.note || "", placeholder: "why this bucket exists" },
    ],
    submit: b ? "Save" : "Create bucket",
    danger: b ? "Delete bucket" : null,
    validate: (v) => (!v.name ? "Give it a name." : (v.planMode === "amount" || v.planMode === "percent") && !(v.planValue > 0) ? "Enter the per-paycheck amount or percent." : v.planMode === "percent" && v.planValue > 100 ? "Percent can't exceed 100." : null),
  });
  if (!v) return;
  if (v.__delete) { S.db.buckets = S.db.buckets.filter((x) => x.id !== b.id); S.db.loans.forEach((l) => { if (l.bucketId === b.id) l.bucketId = null; }); S.db.goals = S.db.goals.filter((g) => g.bucketId !== b.id); return save({ msg: "Bucket deleted; its money is now Unsorted" }); }
  const plan = v.planMode === "remainder" ? { remainder: true } : v.planMode === "none" ? null : { mode: v.planMode, value: r2(v.planValue) };
  if (plan?.remainder) S.db.buckets.forEach((x) => { if (x.plan?.remainder && x !== b) x.plan = null; });
  const data = { emoji: v.emoji || "🪣", name: v.name, kind: v.kind || "savings", plan, bill: v.billAmount > 0 || v.billDay ? { amount: r2(v.billAmount || 0), dueDay: v.billDay ? Math.max(1, Math.min(31, v.billDay)) : null } : null, note: v.note };
  if (b) Object.assign(b, data); else S.db.buckets.push({ id: uid(), archived: false, ...data });
  await save({ msg: b ? "Saved" : "Bucket created" });
};

act.editLoan = async (el) => {
  const l = el?.dataset?.loan ? loan(el.dataset.loan) : null;
  const d = derive();
  const v = await formDialog({
    title: l ? "Edit loan" : "Add a loan",
    fields: [
      { key: "name", label: "Name", type: "text", value: l?.name || "", required: true, max: 50, placeholder: "Student loan, car loan, phone installment…" },
      { key: "balance", label: l ? "Current balance" : "Balance today", type: "money", value: l ? d.ln[l.id] : "", required: true, half: true, help: l ? "Change this to match your statement" : "" },
      { key: "original", label: "Original amount", type: "money", value: l?.original ?? "", half: true, help: "for the progress bar" },
      { key: "rate", label: "Interest rate %", type: "number", step: 0.01, min: 0, value: l?.rate ?? 5, half: true },
      { key: "minPayment", label: "Monthly payment", type: "money", value: l?.minPayment ?? "", half: true },
      { key: "dueDay", label: "Due on the", type: "number", value: l?.dueDay ?? 1, min: 1, max: 31, half: true, help: "day of the month" },
      { key: "bucketId", label: "Funded by bucket", type: "select", options: bucketOptions(["bill"]), value: l?.bucketId || activeBuckets().find((b) => b.kind === "bill" && /loan/i.test(b.name))?.id || "", half: true },
      { key: "accountId", label: "Paid with", type: "select", options: payWithOptions().reverse(), value: l?.accountId || mainAccount()?.id, help: "Pick a card if the installment shows up on a card statement." },
    ],
    submit: l ? "Save" : "Add loan",
    danger: l ? "Delete loan" : null,
    validate: (v) => (!v.name ? "Give it a name." : v.balance === null || v.balance < 0 ? "Enter the balance." : null),
  });
  if (!v) return;
  if (v.__delete) { S.db.loans = S.db.loans.filter((x) => x.id !== l.id); return save({ msg: "Loan deleted" }); }
  const data = { name: v.name, original: v.original > 0 ? r2(v.original) : null, rate: Number(v.rate) || 0, minPayment: r2(v.minPayment || 0), dueDay: Math.max(1, Math.min(31, v.dueDay || 1)), bucketId: v.bucketId || null, accountId: v.accountId };
  if (l) {
    Object.assign(l, data);
    if (Math.abs(r2(v.balance) - d.ln[l.id]) > 0.005) addTx({ type: "loanset", amount: r2(v.balance), date: todayStr(), loanId: l.id });
  } else {
    const id = uid();
    S.db.loans.push({ id, ...data });
    addTx({ type: "loanset", amount: r2(v.balance), date: todayStr(), loanId: id });
  }
  await save({ msg: l ? "Saved" : "Loan added" });
};

act.editGoal = async (el) => {
  const g = el?.dataset?.goal ? goal(el.dataset.goal) : null;
  const preset = el?.dataset?.bucket || "";
  const bucketOpts = activeBuckets().map((b) => [b.id, b.emoji + " " + b.name]);
  if (!bucketOpts.length) return toast("Make a bucket first; goals live inside buckets.");
  const v = await formDialog({
    title: g ? "Edit goal" : "New goal",
    intro: g ? "" : "A goal is a slice of a bucket: Flights inside your trip bucket, a new laptop inside Savings. Only money you set aside for it counts, so you decide what goes where.",
    fields: [
      { key: "emoji", label: "Emoji", type: "text", value: g?.emoji || "🎯", max: 4, half: true },
      { key: "name", label: "Name", type: "text", value: g?.name || "", required: true, max: 50, half: true, placeholder: "Flights, Tickets, Laptop…" },
      { key: "bucketId", label: "Inside which bucket", type: "select", options: bucketOpts, value: g?.bucketId || preset || bucketOpts[0][0], half: true },
      { key: "target", label: "Target amount", type: "money", value: g?.target ?? "", required: true, half: true },
      { key: "date", label: "By when", type: "date", value: g?.date || "", half: true, help: "Optional. Sets the per-paycheck pace." },
      { key: "note", label: "Why it matters", type: "textarea", value: g?.note || "", placeholder: "the thing you'll remember when you're tempted" },
    ],
    submit: g ? "Save" : "Create goal",
    danger: g ? "Delete goal" : null,
    validate: (v) => (!v.name ? "Give it a name." : !v.bucketId ? "Pick a bucket." : !(v.target > 0) ? "Enter a target amount." : null),
  });
  if (!v) return;
  if (v.__delete) { S.db.goals = S.db.goals.filter((x) => x.id !== g.id); return save({ msg: "Goal deleted; its money is back in the bucket" }); }
  const data = { emoji: v.emoji || "🎯", name: v.name, bucketId: v.bucketId, target: r2(v.target), date: v.date || null, note: v.note };
  if (g) Object.assign(g, data); else S.db.goals.push({ id: uid(), created: todayStr(), ...data });
  await save({ msg: g ? "Saved" : "Goal set. Now put some money in it." });
};

// Move money into or out of a goal, within its bucket (or pulled in from Unsorted).
act.fundGoal = async (el) => {
  const g = goal(el.dataset.goal);
  const b = bucket(g.bucketId);
  if (!b) return toast("Give this goal a bucket first.");
  const d = derive();
  const gp = goalProgress(g, d);
  const free = d.free[b.id] || 0;
  const v = await formDialog({
    title: "Fund " + g.name,
    intro: `${esc(b.emoji)} ${esc(b.name)} holds <b>${money(d.bkt[b.id])}</b>, of which <b>${money(free)}</b> isn't set aside for anything. Unsorted has <b>${money(d.unsorted)}</b>. ${esc(g.name)} has <b>${money(gp.alloc)}</b> so far${gp.remaining > 0 ? ", " + money0(gp.remaining) + " to go" : ""}.`,
    fields: [
      { key: "amount", label: "Amount", type: "money", value: Math.max(0, Math.min(gp.remaining, Math.max(free, 0))) || "", required: true, half: true },
      { key: "mode", label: "Do what", type: "chips", options: [["free", "Set aside from " + b.name], ["unsorted", "Pull from Unsorted"], ["back", "Take back into " + b.name]], value: free > 0.005 ? "free" : d.unsorted > 0.005 ? "unsorted" : "free" },
    ],
    submit: "Apply",
    validate: (v) => (!(v.amount > 0) ? "Enter an amount." : v.mode === "free" && v.amount > free + 0.005 ? "Only " + money(free) + " in " + b.name + " isn't earmarked. Pull from Unsorted, or take some back from another goal." : v.mode === "unsorted" && v.amount > d.unsorted + 0.005 ? "Unsorted only has " + money(d.unsorted) + "." : v.mode === "back" && v.amount > gp.alloc + 0.005 ? "This goal only has " + money(gp.alloc) + " set aside." : null),
  });
  if (!v) return;
  const amt = r2(v.amount);
  if (v.mode === "free") addTx({ type: "earmark", amount: amt, date: todayStr(), goalId: g.id, note: "from " + b.name });
  else if (v.mode === "unsorted") addTx({ type: "allocate", amount: 0, date: todayStr(), splits: [{ bucketId: b.id, goalId: g.id, amount: amt }], note: "Unsorted → " + g.name });
  else addTx({ type: "earmark", amount: -amt, date: todayStr(), goalId: g.id, note: "back to " + b.name });
  const after = goalProgress(g, derive());
  await save({ xp: XP.allocate, msg: v.mode === "back" ? money0(amt) + " back in " + b.name : after.reached ? g.name + " is fully funded 🏆" : money0(after.remaining) + " to go for " + g.name, party: after.reached && !gp.reached });
};

act.payloan = async (el) => {
  const l = loan(el.dataset.loan);
  const d = derive();
  const v = await formDialog({
    title: "Log payment · " + l.name,
    intro: "Balance <b>" + money(d.ln[l.id]) + "</b>" + (l.bucketId ? " · " + bucket(l.bucketId)?.name + " holds <b>" + money(d.bkt[l.bucketId]) + "</b>" : ""),
    fields: [
      { key: "amount", label: "Payment", type: "money", value: l.minPayment || "", required: true, half: true },
      { key: "date", label: "Date", type: "date", value: todayStr(), required: true, half: true },
      { key: "accountId", label: "Paid with", type: "select", options: payWithOptions().reverse(), value: l.accountId || mainAccount()?.id, half: true },
      { key: "bucketId", label: "Comes out of", type: "select", options: bucketOptions(["bill"]), value: l.bucketId || "", half: true },
    ],
    submit: "Log payment",
    validate: (v) => (!v.amount || v.amount <= 0 ? "Enter the payment." : null),
  });
  if (!v) return;
  addTx({ type: "loanpay", amount: r2(v.amount), date: v.date, accountId: v.accountId, bucketId: v.bucketId || null, loanId: l.id, note: l.name });
  const after = d.ln[l.id] - r2(v.amount);
  await save({ xp: XP.loanpay + (after <= 0.005 ? XP.loanfree : 0), msg: after <= 0.005 ? l.name + " paid off 🕊️" : money(Math.max(0, after)) + " left on " + l.name, party: after <= 0.005 });
};

act.paybill = async (el) => {
  // A bill bucket payment is an expense from a cash account, category necessary.
  const b = bucket(el.dataset.bucket);
  const d = derive();
  const v = await formDialog({
    title: "Pay " + b.name,
    intro: b.name + " holds <b>" + money(d.bkt[b.id]) + "</b>.",
    fields: [
      { key: "amount", label: "Amount", type: "money", value: b.bill?.amount || "", required: true, half: true },
      { key: "date", label: "Date", type: "date", value: todayStr(), required: true, half: true },
      { key: "accountId", label: "Paid with", type: "select", options: payWithOptions().reverse(), value: mainAccount()?.id, half: true },
      { key: "note", label: "Note", type: "text", value: b.name, max: 120, half: true },
    ],
    submit: "Log payment",
    validate: (v) => (!v.amount || v.amount <= 0 ? "Enter the amount." : null),
  });
  if (!v) return;
  addTx({ type: "expense", amount: r2(v.amount), date: v.date, accountId: v.accountId, bucketId: b.id, category: S.db.categories.find((c) => /necess|bill|need/i.test(c.label))?.id || cats()[0]?.[0] || "", note: v.note });
  await save({ xp: XP.expense, msg: "Paid" });
};

function recurDays(r) { const n = Math.max(1, Number(r.every?.n) || 1); return r.every?.unit === "weeks" ? n * 7 : r.every?.unit === "months" ? n * 30.44 : n; }
function recurAdvance(date, r) { const n = Math.max(1, Number(r.every?.n) || 1); if (r.every?.unit === "months") { const d = parseDate(date); d.setMonth(d.getMonth() + n); return toStr(d); } return addDays(date, r.every?.unit === "weeks" ? n * 7 : n); }
function recurMonthly(r) { return (Number(r.amount) || 0) * (30.44 / recurDays(r)); }
function everyLabel(r) { const n = Number(r.every?.n) || 1; const u = r.every?.unit || "days"; return "every " + (n === 1 ? u.slice(0, -1) : n + " " + u); }
function recurring(id) { return S.db.recurring.find((r) => r.id === id); }

act.editRecurring = async (el) => {
  const r = el?.dataset?.recur ? recurring(el.dataset.recur) : null;
  const v = await formDialog({
    title: r ? "Edit recurring" : "New recurring thing",
    intro: r ? "" : "A subscription, or something you buy again and again. Cashmere tells you when it's next due and what it really costs per month.",
    fields: [
      { key: "emoji", label: "Emoji", type: "text", value: r?.emoji || "🔁", max: 4, half: true },
      { key: "name", label: "Name", type: "text", value: r?.name || "", required: true, max: 50, half: true, placeholder: "Spotify, moisturizer, cheese…" },
      { key: "amount", label: "Costs about", type: "money", value: r?.amount ?? "", required: true, half: true },
      { key: "next", label: "Next due / next buy", type: "date", value: r?.next || todayStr(), required: true, half: true },
      { key: "everyN", label: "Every", type: "number", value: r?.every?.n ?? 1, min: 1, half: true },
      { key: "everyUnit", label: "Unit", type: "select", options: UNITS, value: r?.every?.unit || "months", half: true },
      { key: "category", label: "Category", type: "chips", options: cats(), value: r?.category || cats()[0]?.[0] || "" },
      { key: "accountId", label: "Paid with", type: "select", options: payWithOptions(), value: r?.accountId || cardAccounts()[0]?.id || mainAccount()?.id, half: true },
      { key: "bucketId", label: "Comes out of", type: "select", options: bucketOptions(["spending", "bill"]), value: r?.bucketId || "", half: true },
      { key: "note", label: "Note", type: "text", value: r?.note || "", max: 120, placeholder: "which brand, where you buy it, cancel link…" },
    ],
    submit: r ? "Save" : "Add",
    danger: r ? "Delete" : null,
    validate: (v) => (!v.name ? "Give it a name." : !(v.amount > 0) ? "Enter the cost." : !(v.everyN >= 1) ? "How often?" : null),
  });
  if (!v) return;
  if (v.__delete) { S.db.recurring = S.db.recurring.filter((x) => x.id !== r.id); return save({ msg: "Removed" }); }
  const data = { emoji: v.emoji || "🔁", name: v.name, amount: r2(v.amount), next: v.next, every: { n: Math.max(1, Math.round(v.everyN)), unit: v.everyUnit }, category: v.category, accountId: v.accountId, bucketId: v.bucketId || null, note: v.note };
  if (r) Object.assign(r, data); else S.db.recurring.push({ id: uid(), ...data });
  await save({ msg: r ? "Saved" : "Added" });
};
act.buyRecurring = async (el) => {
  const r = recurring(el.dataset.recur);
  const d = derive();
  addTx({ type: "expense", amount: r.amount, date: todayStr(), accountId: r.accountId, bucketId: r.bucketId || null, category: r.category, note: r.name });
  r.last = todayStr();
  r.next = recurAdvance(todayStr(), r);
  const b = r.bucketId ? bucket(r.bucketId) : null;
  await save({ xp: XP.expense, msg: "Logged " + money0(r.amount) + (b ? " · " + money0(Math.max(0, d.bkt[b.id] - r.amount)) + " left in " + b.name : "") + " · next " + fmtDate(r.next) });
};
act.skipRecurring = async (el) => {
  const r = recurring(el.dataset.recur);
  let n = recurAdvance(r.next, r); while (n < todayStr()) n = recurAdvance(n, r);
  r.next = n;
  await save({ msg: "Next " + fmtDate(r.next) });
};
act.editCategories = async () => {
  const rows = await rowsDialog({
    title: "Expense categories",
    intro: "Rename, add or remove. If you remove one, its expenses move to the first category in the list.",
    columns: [{ key: "label", label: "Category", type: "text", placeholder: "Fun, Needs, Food…" }],
    rows: S.db.categories.map((c) => ({ label: c.label, _id: c.id })),
    blank: { label: "" },
    wide: false,
    validate: (rows) => (!rows.some((r) => r.label) ? "Keep at least one category." : null),
  });
  if (!rows) return;
  const next = rows.filter((r) => r.label).map((r) => ({ id: r._id || r.label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || uid(), label: r.label }));
  const seen = new Set(); for (const c of next) { while (seen.has(c.id)) c.id += "2"; seen.add(c.id); }
  const ids = new Set(next.map((c) => c.id));
  for (const t of S.db.transactions) if (t.type === "expense" && !ids.has(t.category)) t.category = next[0].id;
  for (const r of S.db.recurring) if (!ids.has(r.category)) r.category = next[0].id;
  S.db.categories = next;
  await save({ msg: "Categories saved" });
};

act.deleteTx = async (el) => {
  if (!el.dataset.armed) { el.dataset.armed = "1"; el.textContent = "Sure?"; setTimeout(() => { delete el.dataset.armed; el.textContent = "Delete"; }, 3000); return; }
  S.db.transactions = S.db.transactions.filter((t) => t.id !== el.dataset.id);
  await save({ msg: "Deleted" });
};
act.editTx = async (el) => {
  const t = S.db.transactions.find((x) => x.id === el.dataset.id);
  if (t.type === "expense") return act.expense(el);
  // Other types: allow date/amount/note edit only.
  const v = await formDialog({
    title: "Edit " + t.type,
    fields: [
      { key: "amount", label: "Amount", type: "money", value: t.amount, required: true, half: true },
      { key: "date", label: "Date", type: "date", value: t.date, required: true, half: true },
      { key: "note", label: "Note", type: "text", value: t.note || "" },
    ],
    danger: "Delete",
  });
  if (!v) return;
  if (v.__delete) { S.db.transactions = S.db.transactions.filter((x) => x.id !== t.id); return save({ msg: "Deleted" }); }
  if (t.type === "paycheck" && Math.abs(v.amount - t.amount) > 0.005) { toast("To change a paycheck amount, delete it and log it again so the split stays right."); return; }
  Object.assign(t, { amount: r2(v.amount), date: v.date, note: v.note });
  await save({ msg: "Saved" });
};

act.chooseFolder = async () => { const st = await window.cashmere.chooseFolder(); if (st) { S.dataDir = st.dataDir; if (st.db) S.db = st.db; render(); toast("Ledger now lives in " + st.dataDir); } };
act.reveal = () => window.cashmere.revealFolder();
act.exportCsv = async () => {
  const rows = [["date", "type", "amount", "account", "bucket", "category", "note", "splits"]];
  for (const t of txSorted()) rows.push([t.date, t.type, t.amount, acc(t.accountId || t.fromId || t.cardId)?.name || "", bucket(t.bucketId)?.name || "", t.category || "", t.note || "", (t.splits || []).map((s) => (bucket(s.bucketId)?.name || "?") + ":" + s.amount).join("; ")]);
  const csv = rows.map((r) => r.map((c) => '"' + String(c ?? "").replace(/"/g, '""') + '"').join(",")).join("\n");
  const r = await window.cashmere.exportCsv("cashmere-" + todayStr() + ".csv", csv);
  if (r.ok) toast("Exported");
};
act.reset = async (el) => {
  if (!el.dataset.armed) { el.dataset.armed = "1"; el.textContent = "Click again to wipe everything"; setTimeout(() => { delete el.dataset.armed; el.textContent = "Start over"; }, 4000); return; }
  S.db = emptyDb(); await save({ msg: "Fresh ledger. The old one is in backups/." }); runSetup();
};
act.setup = () => runSetup();
act.expFilterCat = (el) => { S.expFilter.cat = S.expFilter.cat === el.dataset.cat ? "" : el.dataset.cat; render(); };
act.expAll = () => { S.expFilter.all = !S.expFilter.all; render(); };
act.nav = (el) => { S.view = el.dataset.view; render(); };

// ---------- views ----------
function bar(p, cls = "") { return `<div class="bar ${cls}"><i style="width:${pct(p, 100).toFixed(1)}%"></i></div>`; }
function catPill(c) { return `<span class="pill cat-i${catIdx(c)}">${esc(catLabel(c))}</span>`; }

function bucketCard(b, d, compact) {
  const bal = d.bkt[b.id];
  let body = "", cls = "";
  if (b.kind === "bill") {
    const need = billNeed(b);
    const ok = need > 0 && bal >= need - 0.005;
    cls = ok ? "ok" : need > 0 ? "warn" : "";
    body = need > 0 ? `${bar(pct(bal, need), ok ? "good" : "warn")}<div class="sub">${ok ? "Funded" : money0(need - bal) + " short"} for this month's ${money0(need)}${b.bill?.dueDay ? " · due the " + ordinal(b.bill.dueDay) : ""}</div>` : `<div class="sub">Set a monthly amount to track funding</div>`;
  } else if (goalsForBucket(b.id).length) {
    const gs = goalsForBucket(b.id), free = d.free[b.id] || 0;
    cls = free < -0.005 ? "warn" : "";
    body = `<div class="mini-goals">${gs.map((g) => { const gp = goalProgress(g, d); return `<div class="mini-goal ${gp.reached ? "ok" : ""}"><span>${esc(g.emoji)} ${esc(g.name)}</span><i><b style="width:${gp.pct.toFixed(0)}%"></b></i><span>${money0(gp.alloc)}/${money0(gp.target)}</span></div>`; }).join("")}</div><div class="sub">${money0(free)} not earmarked${free < -0.005 ? " · goals claim more than the bucket holds" : ""}</div>`;
  } else if (b.kind === "spending") {
    body = `<div class="sub">${bal <= 0 ? "Empty until next paycheck" : "Free to spend"}${d.nextPayday ? " · next paycheck ~" + fmtDate(d.nextPayday) : ""}</div>`;
    cls = bal <= 0 ? "warn" : "";
  } else body = `<div class="sub">${esc(planLabel(b))}</div>`;
  return `<div class="bucket ${cls} ${compact ? "compact" : ""}" data-act="${compact ? "sort" : "editBucket"}" data-bucket="${b.id}" title="${compact ? "Sort money into this bucket" : "Edit bucket"}">
    <div class="b-head"><span class="b-emoji">${esc(b.emoji)}</span><span class="b-name">${esc(b.name)}</span><span class="b-kind">${KINDS[b.kind] || ""}</span></div>
    <div class="b-bal ${bal < 0 ? "bad" : ""}">${money(bal)}</div>
    ${body}
    ${compact ? "" : `<div class="b-plan">${esc(planLabel(b))}${b.note ? ` · <em>${esc(b.note)}</em>` : ""}</div>
    <div class="b-actions"><button type="button" class="btn small" data-act="sort" data-bucket="${b.id}">Sort</button>${b.kind === "bill" ? `<button type="button" class="btn small" data-act="paybill" data-bucket="${b.id}">Pay</button>` : `<button type="button" class="btn small" data-act="expense" data-bucket="${b.id}">Spend</button>`}</div>`}
  </div>`;
}

function goalCard(g, d, compact) {
  const gp = goalProgress(g, d);
  const b = bucket(g.bucketId);
  const status = gp.used ? "Spent 🎉" : gp.reached ? "Fully funded 🏆" : [
    money0(gp.remaining) + " to go",
    g.date ? (gp.perPaycheck !== null ? "set aside " + money0(gp.perPaycheck) + " per paycheck by " + fmtDate(g.date, true) : fmtDate(g.date, true) + " has passed") : null,
    gp.projected ? "on pace for " + fmtDate(gp.projected, true) : null,
  ].filter(Boolean).join(" · ");
  const short = gp.used ? "Spent 🎉" : gp.reached ? "Funded 🏆" : money0(gp.remaining) + " to go" + (g.date ? " · by " + fmtDate(g.date) : "");
  return `<div class="goal ${gp.reached ? "ok" : ""} ${compact ? "compact" : ""}" data-act="editGoal" data-goal="${g.id}" title="Edit goal">
    <div class="b-head"><span class="b-emoji">${esc(g.emoji)}</span><span class="b-name">${esc(g.name)}</span><span class="b-kind">${gp.pct.toFixed(0)}%</span></div>
    ${compact ? "" : `<div class="g-nums"><b>${money(gp.alloc)}</b><span class="muted"> set aside of ${money0(gp.target)}${gp.spent ? " · " + money0(gp.spent) + " spent" : ""}</span></div>`}
    ${bar(gp.pct, gp.reached ? "good" : "gold")}
    <div class="sub">${compact ? short : status}</div>
    ${compact ? "" : `<div class="b-plan">Inside ${b ? esc(b.emoji + " " + b.name) : "<span class='bad'>no bucket yet, click to pick one</span>"}${g.note ? ` · <em>${esc(g.note)}</em>` : ""}</div>
    <div class="b-actions"><button type="button" class="btn small primary" data-act="fundGoal" data-goal="${g.id}">${gp.alloc > 0 ? "Add or take back" : "Add money"}</button><button type="button" class="btn small" data-act="expense" data-goal="${g.id}">Spent on this</button></div>`}
  </div>`;
}

function upcoming(d) {
  const items = [];
  const today = todayStr();
  for (const c of cardAccounts()) {
    const due = nextDue(c.dueDay || 25);
    items.push({ date: due, label: c.name + " payment", amount: d.acct[c.id], status: d.acct[c.id] <= 0.005 ? "ok" : "due", note: d.acct[c.id] <= 0.005 ? "Nothing owed" : "Pay in full from " + (mainAccount()?.name || "cash"), action: `<button type="button" class="btn small" data-act="paycard" data-card="${c.id}">Pay</button>` });
  }
  for (const b of activeBuckets()) {
    if (b.kind !== "bill" || !b.bill?.dueDay) continue;
    const need = billNeed(b);
    const funded = d.bkt[b.id] >= need - 0.005;
    items.push({ date: nextDue(b.bill.dueDay), label: b.emoji + " " + b.name, amount: need, status: funded ? "ok" : "warn", note: funded ? "Funded" : money0(need - d.bkt[b.id]) + " short", action: `<button type="button" class="btn small" data-act="paybill" data-bucket="${b.id}">Pay</button>` });
  }
  for (const l of S.db.loans) {
    if (d.ln[l.id] <= 0.005) continue;
    const funded = l.bucketId ? d.bkt[l.bucketId] >= (l.minPayment || 0) - 0.005 : true;
    items.push({ date: nextDue(l.dueDay || 1), label: "🏦 " + l.name, amount: l.minPayment || 0, status: funded ? "ok" : "warn", note: funded ? (l.bucketId ? "Funded by " + bucket(l.bucketId)?.name : "") : "Bucket is short", action: `<button type="button" class="btn small" data-act="payloan" data-loan="${l.id}">Pay</button>` });
  }
  for (const r of S.db.recurring) {
    const n = daysBetween(today, r.next);
    if (n > 10) continue;
    items.push({ date: r.next, label: r.emoji + " " + r.name, amount: r.amount, status: n < 0 ? "warn" : "due", note: everyLabel(r) + (n < 0 ? " · overdue" : ""), action: `<button type="button" class="btn small" data-act="buyRecurring" data-recur="${r.id}">Bought</button>` });
  }
  items.sort((a, b) => (a.date < b.date ? -1 : 1));
  return items.filter((i) => daysBetween(today, i.date) <= 45).map((i) => `<div class="due ${i.status}"><div class="due-date"><b>${fmtDate(i.date)}</b><span>${inDays(daysBetween(today, i.date))}</span></div><div class="due-main"><div>${esc(i.label)}</div><small>${esc(i.note)}</small></div><div class="due-amt">${money(i.amount)}</div>${i.action}</div>`).join("") || `<p class="muted">Nothing due in the next 45 days. Add due dates to bills, cards and loans to see them here.</p>`;
}

function weekSummary(d) {
  const ws = weekStart(todayStr()), lastWs = addDays(ws, -7);
  const sum = (from, to) => { const o = { total: 0 }; for (const t of S.db.transactions) if (t.type === "expense" && t.date >= from && t.date < to) { o.total += t.amount; o[t.category] = (o[t.category] || 0) + t.amount; } return o; };
  const cur = sum(ws, addDays(ws, 7)), prev = sum(lastWs, ws);
  return `<div class="week" style="grid-template-columns: repeat(${2 + cats().length}, 1fr)"><div><span class="lbl">This week</span><b>${money(cur.total)}</b></div><div><span class="lbl">Last week</span><b class="muted">${money(prev.total)}</b></div>${cats().map(([k, l]) => `<div><span class="lbl">${esc(l)}</span><b class="cat-i${catIdx(k)}-t">${money0(cur[k] || 0)}</b></div>`).join("")}</div>`;
}

const views = {};
views.home = (d) => {
  const spending = activeBuckets().filter((b) => b.kind === "spending");
  const others = activeBuckets().filter((b) => b.kind !== "spending");
  return `<header class="page-head"><div><h1>Overview</h1><p class="muted">${d.thisWeekLogged ? "This week is logged. " : "You haven't logged this week yet. "}${d.streak ? d.streak + "-week streak 🔥" : "Log an expense to start a streak."}</p></div>
    <div class="quick"><button type="button" class="btn primary" data-act="expense">+ Expense</button><button type="button" class="btn" data-act="paycheck">+ Paycheck</button><button type="button" class="btn" data-act="paycard">Pay a card</button><button type="button" class="btn" data-act="sort">Sort money</button></div></header>
  <section class="stats">
    <div class="stat"><span class="lbl">Cash</span><b>${money(d.cash)}</b><small>${cashAccounts().map((a) => a.name + " " + money0(d.acct[a.id])).join(" · ")}</small></div>
    <div class="stat ${d.owed > 0 ? "warn" : ""}"><span class="lbl">Owed on cards</span><b>${money(d.owed)}</b><small>${cardAccounts().map((a) => a.name + " " + money0(d.acct[a.id])).join(" · ")}</small></div>
    <div class="stat ${d.unsorted < -0.005 ? "bad" : d.unsorted > 0.005 ? "hint" : ""}"><span class="lbl">Unsorted</span><b>${money(d.unsorted)}</b><small>${d.unsorted < -0.005 ? "Buckets promise more than you have. Sort money to fix." : d.unsorted > 0.005 ? "Cash nobody has claimed. Sort it or it'll get spent." : "Every dollar has a job."}</small></div>
    <div class="stat level"><span class="lbl">Level ${d.level} · ${LEVELS[d.level - 1]}</span>${bar(pct(d.xp - d.lvlFloor, d.lvlNext - d.lvlFloor), "gold")}<small>${d.xp} XP · ${d.lvlNext - d.xp} to next</small></div>
  </section>
  <div class="cols">
    <section class="panel"><h2>Can I go out?</h2>${spending.length ? `<div class="bucket-grid compact">${spending.map((b) => bucketCard(b, d, true)).join("")}</div>` : `<p class="muted">Make a Spending bucket (Going out, Shopping) and it shows up here.</p>`}
      <h2>Coming up</h2><div class="dues">${upcoming(d)}</div></section>
    <section class="panel"><h2>This week</h2>${weekSummary(d)}${S.db.goals.length ? `<h2>Goals</h2><div class="goal-grid compact">${S.db.goals.map((g) => goalCard(g, d, true)).join("")}</div>` : ""}<h2>Buckets</h2><div class="bucket-grid compact">${others.map((b) => bucketCard(b, d, true)).join("")}</div></section>
  </div>`;
};

views.goals = (d) => {
  const gs = S.db.goals;
  const reached = gs.filter((g) => goalProgress(g, d).reached).length;
  const groups = activeBuckets().filter((b) => goalsForBucket(b.id).length);
  const orphans = gs.filter((g) => !bucket(g.bucketId));
  const group = (b) => { const free = d.free[b.id] || 0; return `<div class="goal-group"><div class="gg-head"><b>${esc(b.emoji)} ${esc(b.name)}</b><span class="muted">holds ${money(d.bkt[b.id])} · ${money0(d.earmarked[b.id] || 0)} set aside for goals · <b class="${free < -0.005 ? "bad" : ""}">${money0(free)}</b> free</span><span class="spacer"></span><button type="button" class="btn small" data-act="editGoal" data-bucket="${b.id}">+ Goal here</button><button type="button" class="btn small" data-act="sort" data-bucket="${b.id}">Sort</button></div><div class="goal-grid">${goalsForBucket(b.id).map((g) => goalCard(g, d)).join("")}</div></div>`; };
  return `<header class="page-head"><div><h1>Goals</h1><p class="muted">Goals live inside buckets. The bucket holds the money; a goal is a slice of it you set aside on purpose, like Flights and Tickets inside a trip bucket. Nothing counts toward a goal until you put it there, from the bucket's free money, from Unsorted, or straight from a paycheck.</p></div><div class="quick"><button type="button" class="btn primary" data-act="editGoal">+ New goal</button></div></header>
  ${gs.length ? `<div class="planline">${reached} of ${gs.length} funded · click a goal to edit it, Add money to set some aside, Spent on this when you actually buy the thing.</div>
  ${groups.map(group).join("")}${orphans.length ? `<div class="goal-group warn"><div class="gg-head"><b>Needs a bucket</b><span class="muted">these goals came from the old setup; click each and pick the bucket it lives in</span></div><div class="goal-grid">${orphans.map((g) => goalCard(g, d)).join("")}</div></div>` : ""}` : `<div class="empty"><p>No goals yet. Try "Flights $450 by March" inside your trip bucket, or "Laptop $1,200" inside Savings.</p><button type="button" class="btn primary" data-act="editGoal">Set the first one</button></div>`}`;
};

views.recurring = (d) => {
  const rs = [...S.db.recurring].sort((a, b) => (a.next < b.next ? -1 : 1));
  const monthly = rs.reduce((s, r) => s + recurMonthly(r), 0);
  const today = todayStr();
  const row = (r) => { const n = daysBetween(today, r.next); const cls = n < 0 ? "warn" : n <= 3 ? "soon" : "ok"; return `<div class="due ${cls} recur" data-act="editRecurring" data-recur="${r.id}" title="Edit"><div class="due-date"><b>${fmtDate(r.next)}</b><span>${inDays(n)}</span></div><div class="due-main"><div>${esc(r.emoji)} ${esc(r.name)}</div><small>${esc(everyLabel(r))} · ~${money0(recurMonthly(r))}/mo · ${esc(catLabel(r.category))}${r.bucketId && bucket(r.bucketId) ? " · from " + esc(bucket(r.bucketId).name) : ""}${r.note ? " · " + esc(r.note) : ""}</small></div><div class="due-amt">${money(r.amount)}</div><div class="b-actions nowrap"><button type="button" class="btn small primary" data-act="buyRecurring" data-recur="${r.id}">Bought it</button><button type="button" class="btn small" data-act="skipRecurring" data-recur="${r.id}">Skip</button></div></div>`; };
  return `<header class="page-head"><div><h1>Recurring</h1><p class="muted">Subscriptions and the things you buy over and over: rent, Spotify, moisturizer every six weeks, cheese every five days. "Bought it" logs the expense and moves the date forward.</p></div><div class="quick"><button type="button" class="btn primary" data-act="editRecurring">+ Add recurring</button></div></header>
  <section class="stats three"><div class="stat"><span class="lbl">Per month</span><b>${money(monthly)}</b><small>all recurring, averaged</small></div><div class="stat"><span class="lbl">Per year</span><b>${money(monthly * 12)}</b><small>that's the real number</small></div><div class="stat"><span class="lbl">Tracked</span><b>${rs.length}</b><small>${rs.filter((r) => daysBetween(today, r.next) < 0).length} overdue</small></div></section>
  <div class="dues">${rs.map(row).join("") || `<div class="empty"><p>Nothing recurring yet.</p><button type="button" class="btn primary" data-act="editRecurring">Add the first one</button></div>`}</div>`;
};

views.expenses = (d) => {
  const f = S.expFilter;
  let txs = txSorted(true).filter((t) => t.type === "expense");
  if (f.cat) txs = txs.filter((t) => t.category === f.cat);
  const cutoff = addDays(weekStart(todayStr()), -7 * 8);
  if (!f.all) txs = txs.filter((t) => t.date >= cutoff);
  const groups = new Map();
  for (const t of txs) { const w = weekStart(t.date); if (!groups.has(w)) groups.set(w, []); groups.get(w).push(t); }
  const rows = [...groups.entries()].map(([w, list]) => {
    const total = list.reduce((s, t) => s + t.amount, 0);
    const byCat = {}; list.forEach((t) => (byCat[t.category] = (byCat[t.category] || 0) + t.amount));
    return `<div class="week-group"><div class="wg-head"><b>Week of ${fmtDate(w)}</b><span class="muted">${cats().filter(([k]) => byCat[k]).map(([k, l]) => esc(l) + " " + money0(byCat[k])).join(" · ")}</span><b>${money(total)}</b></div>
      ${list.map((t) => `<div class="tx"><span class="tx-date">${fmtDate(t.date)}</span><span class="tx-note">${esc(t.note || "(no note)")}<small>${bucket(t.bucketId) ? esc(bucket(t.bucketId).emoji + " " + bucket(t.bucketId).name) : "Unsorted"}${t.goalId && goal(t.goalId) ? " › " + esc(goal(t.goalId).name) : ""} · ${esc(acc(t.accountId)?.name || "?")}</small></span>${catPill(t.category)}<span class="tx-amt">${money(t.amount)}</span><button type="button" class="btn tiny" data-act="editTx" data-id="${t.id}">Edit</button><button type="button" class="btn tiny danger" data-act="deleteTx" data-id="${t.id}">Delete</button></div>`).join("")}</div>`;
  }).join("");
  return `<header class="page-head"><div><h1>Expenses</h1><p class="muted">Your weekly ritual: open the card app, log each purchase, pick the bucket it came out of.</p></div><div class="quick"><button type="button" class="btn primary" data-act="expense">+ Log expense</button></div></header>
  ${weekSummary(d)}
  <div class="filters"><span class="muted">Filter</span>${cats().map(([k, l]) => `<button type="button" class="chip ${f.cat === k ? "on" : ""}" data-act="expFilterCat" data-cat="${esc(k)}">${esc(l)}</button>`).join("")}<span class="spacer"></span><button type="button" class="btn small" data-act="expAll">${f.all ? "Show last 8 weeks" : "Show everything"}</button></div>
  ${rows || `<div class="empty"><p>No expenses ${f.all ? "yet" : "in the last 8 weeks"}.</p><button type="button" class="btn primary" data-act="expense">Log the first one</button></div>`}`;
};

views.buckets = (d) => {
  const bs = activeBuckets();
  const fixed = bs.reduce((s, b) => s + (b.plan?.mode === "amount" ? Number(b.plan.value) || 0 : 0), 0);
  const pctSum = bs.reduce((s, b) => s + (b.plan?.mode === "percent" ? Number(b.plan.value) || 0 : 0), 0);
  const rem = bs.find((b) => b.plan?.remainder);
  const byKind = ["spending", "bill", "savings"].map((k) => [k, bs.filter((b) => b.kind === k)]).filter(([, l]) => l.length);
  return `<header class="page-head"><div><h1>Buckets</h1><p class="muted">All of this money sits in ${mainAccount()?.name || "your bank accounts"}. Buckets are just labels, so you always know what a dollar is for. Buckets hold <b>${money(d.bucketsTotal)}</b>; Unsorted is <b>${money(d.unsorted)}</b>.</p></div>
    <div class="quick"><button type="button" class="btn primary" data-act="editBucket">+ New bucket</button><button type="button" class="btn" data-act="sort">Sort money</button></div></header>
  <div class="planline">Per paycheck plan: <b>${money0(fixed)}</b> fixed${pctSum ? ` + <b>${pctSum}%</b>` : ""}${rem ? ` · remainder → <b>${esc(rem.name)}</b>` : " · remainder → Unsorted"}</div>
  ${byKind.map(([k, list]) => `<h2>${KINDS[k]}</h2><div class="bucket-grid">${list.map((b) => bucketCard(b, d)).join("")}</div>`).join("")}
  ${bs.length ? "" : `<div class="empty"><p>No buckets yet.</p><button type="button" class="btn primary" data-act="setup">Run setup</button></div>`}`;
};

views.paychecks = (d) => {
  const list = txSorted(true).filter((t) => t.type === "paycheck");
  const ytd = list.filter((t) => t.date.startsWith(todayStr().slice(0, 4))).reduce((s, t) => s + t.amount, 0);
  const avg = list.length ? list.slice(0, 6).reduce((s, t) => s + t.amount, 0) / Math.min(6, list.length) : 0;
  return `<header class="page-head"><div><h1>Paychecks</h1><p class="muted">Each one lands in ${mainAccount()?.name || "your main account"} and gets sorted into buckets on the spot.</p></div><div class="quick"><button type="button" class="btn primary" data-act="paycheck">+ Log paycheck</button></div></header>
  <section class="stats three"><div class="stat"><span class="lbl">Logged</span><b>${list.length}</b><small>paychecks</small></div><div class="stat"><span class="lbl">Recent average</span><b>${money(avg)}</b><small>last ${Math.min(6, list.length) || 0}</small></div><div class="stat"><span class="lbl">This year</span><b>${money(ytd)}</b><small>net, year to date</small></div></section>
  <div class="planline">Current plan: ${activeBuckets().filter((b) => b.plan).map((b) => `${esc(b.emoji)} ${esc(b.name)} <b>${esc(planLabel(b).replace(" / paycheck", ""))}</b>`).join(" · ") || "no per-paycheck plan yet. Edit a bucket to set one."}</div>
  ${list.map((t) => `<div class="pc"><div class="pc-head"><b>${fmtDate(t.date, true)}</b><span class="muted">${esc(t.note || "")} → ${esc(acc(t.accountId)?.name || "")}</span><b>${money(t.amount)}</b><button type="button" class="btn tiny danger" data-act="deleteTx" data-id="${t.id}">Delete</button></div>
    <div class="pc-splits">${(t.splits || []).map((s) => `<span class="pill">${esc(bucket(s.bucketId)?.emoji || "")} ${esc(bucket(s.bucketId)?.name || "deleted bucket")}${s.goalId && goal(s.goalId) ? " › " + esc(goal(s.goalId).name) : ""} ${money0(s.amount)}</span>`).join("")}${r2(t.amount - (t.splits || []).reduce((s, x) => s + x.amount, 0)) > 0 ? `<span class="pill ghost">Unsorted ${money0(t.amount - (t.splits || []).reduce((s, x) => s + x.amount, 0))}</span>` : ""}</div></div>`).join("") || `<div class="empty"><p>No paychecks logged yet.</p><button type="button" class="btn primary" data-act="paycheck">Log the first one</button></div>`}`;
};

views.loans = (d) => {
  const total = S.db.loans.reduce((s, l) => s + d.ln[l.id], 0);
  const monthly = S.db.loans.reduce((s, l) => s + (d.ln[l.id] > 0 ? l.minPayment || 0 : 0), 0);
  return `<header class="page-head"><div><h1>Loans</h1><p class="muted">Owe <b>${money(total)}</b> · <b>${money0(monthly)}</b> a month minimum. Update a balance from your statement whenever you like; interest here is an estimate.</p></div><div class="quick"><button type="button" class="btn primary" data-act="editLoan">+ Add loan</button></div></header>
  <div class="loan-grid">${S.db.loans.map((l) => {
    const bal = d.ln[l.id], orig = l.original || null;
    const est = loanEstimate(bal, l.rate, l.minPayment);
    const fund = l.bucketId ? bucket(l.bucketId) : null;
    const funded = fund ? d.bkt[fund.id] >= (l.minPayment || 0) - 0.005 : null;
    const payments = txSorted(true).filter((t) => t.type === "loanpay" && t.loanId === l.id);
    const paid = payments.reduce((s, t) => s + t.amount, 0);
    return `<div class="loan ${bal <= 0.005 ? "ok" : ""}">
      <div class="l-head"><b>${esc(l.name)}</b><span class="muted">${l.rate}% · due the ${ordinal(l.dueDay)}</span></div>
      <div class="l-bal">${money(bal)}<small>${bal <= 0.005 ? "paid off 🕊️" : "left"}</small></div>
      ${orig ? `${bar(pct(orig - bal, orig), "good")}<div class="sub">${pct(orig - bal, orig).toFixed(0)}% of ${money0(orig)} paid down</div>` : `<div class="sub">Add the original amount to see a progress bar</div>`}
      <div class="l-facts">
        <div><span class="lbl">Monthly</span><b>${money0(l.minPayment || 0)}</b></div>
        <div><span class="lbl">Interest / mo</span><b>${money0((bal * (l.rate || 0)) / 100 / 12)}</b></div>
        <div><span class="lbl">Paid off in</span><b>${bal <= 0 ? "done" : est.months === Infinity ? "never at this rate" : est.months >= 24 ? (est.months / 12).toFixed(1) + " yrs" : est.months + " mo"}</b></div>
        <div><span class="lbl">Paid with</span><b>${esc(acc(l.accountId)?.name || "—")}</b></div>
      </div>
      <div class="sub">${fund ? `Funded by ${esc(fund.emoji + " " + fund.name)} (${money0(d.bkt[fund.id])}) · ${funded ? "this month is covered" : "<span class='bad'>short for this month</span>"}` : "Not tied to a bucket"}${paid ? ` · ${money0(paid)} logged in ${payments.length} payment${payments.length === 1 ? "" : "s"}` : ""}</div>
      <div class="b-actions"><button type="button" class="btn small primary" data-act="payloan" data-loan="${l.id}">Log payment</button><button type="button" class="btn small" data-act="editLoan" data-loan="${l.id}">Edit / update balance</button></div>
    </div>`;
  }).join("") || `<div class="empty"><p>No loans yet.</p><button type="button" class="btn primary" data-act="editLoan">Add one</button></div>`}</div>
  <h2>Payment history</h2>
  ${txSorted(true).filter((t) => t.type === "loanpay").slice(0, 30).map((t) => `<div class="tx"><span class="tx-date">${fmtDate(t.date, true)}</span><span class="tx-note">${esc(loan(t.loanId)?.name || t.note || "loan")}<small>${esc(acc(t.accountId)?.name || "")}${t.bucketId ? " · from " + esc(bucket(t.bucketId)?.name || "") : ""}</small></span><span class="tx-amt">${money(t.amount)}</span><button type="button" class="btn tiny" data-act="editTx" data-id="${t.id}">Edit</button><button type="button" class="btn tiny danger" data-act="deleteTx" data-id="${t.id}">Delete</button></div>`).join("") || `<p class="muted">No payments logged yet.</p>`}`;
};

views.accounts = (d) => {
  const hist = txSorted(true).filter((t) => ["cardpay", "transfer", "adjust", "opening"].includes(t.type)).slice(0, 40);
  const label = (t) => t.type === "cardpay" ? `Paid ${esc(acc(t.cardId)?.name)} from ${esc(acc(t.fromId)?.name)}` : t.type === "transfer" ? `${esc(acc(t.fromId)?.name)} → ${esc(acc(t.toId)?.name)}` : t.type === "adjust" ? `Balance fix · ${esc(acc(t.accountId)?.name)}` : `Opening balance · ${esc(acc(t.accountId)?.name)}`;
  return `<header class="page-head"><div><h1>Accounts</h1><p class="muted">Real places money sits. Type in what the bank shows whenever it drifts.</p></div><div class="quick"><button type="button" class="btn primary" data-act="addAccount">+ Add account</button><button type="button" class="btn" data-act="paycard">Pay a card</button><button type="button" class="btn" data-act="transfer">Transfer</button></div></header>
  <h2>Bank accounts</h2><div class="acct-grid">${cashAccounts().length ? "" : `<p class="muted">No bank accounts yet. Add one.</p>`}${cashAccounts().map((a) => `<div class="acct"><div class="a-head"><b>${esc(a.name)}</b>${a.main ? `<span class="pill ghost">paychecks land here</span>` : ""}</div><div class="a-bal">${money(d.acct[a.id])}</div><div class="b-actions"><button type="button" class="btn small" data-act="adjust" data-account="${a.id}">Set balance</button><button type="button" class="btn small" data-act="editAccount" data-account="${a.id}">Edit</button></div></div>`).join("")}</div>
  <h2>Credit cards</h2><div class="acct-grid">${cardAccounts().length ? "" : `<p class="muted">No cards. Add one if you put purchases on a card and pay it off.</p>`}${cardAccounts().map((a) => { const due = nextDue(a.dueDay || 25); const n = daysBetween(todayStr(), due); return `<div class="acct ${d.acct[a.id] > 0 ? "warn" : "ok"}"><div class="a-head"><b>${esc(a.name)}</b><span class="muted">due ${fmtDate(due)} · ${inDays(n)}</span></div><div class="a-bal">${money(d.acct[a.id])}<small>owed</small></div><div class="b-actions"><button type="button" class="btn small primary" data-act="paycard" data-card="${a.id}">Pay in full</button><button type="button" class="btn small" data-act="adjust" data-account="${a.id}">Set balance</button><button type="button" class="btn small" data-act="editAccount" data-account="${a.id}">Edit</button></div></div>`; }).join("")}</div>
  <h2>History</h2>${hist.map((t) => `<div class="tx"><span class="tx-date">${fmtDate(t.date, true)}</span><span class="tx-note">${label(t)}<small>${esc(t.note || "")}</small></span><span class="tx-amt">${money(t.amount, t.type === "adjust")}</span><button type="button" class="btn tiny" data-act="editTx" data-id="${t.id}">Edit</button><button type="button" class="btn tiny danger" data-act="deleteTx" data-id="${t.id}">Delete</button></div>`).join("") || `<p class="muted">Nothing yet.</p>`}`;
};

views.settings = (d) => {
  const earned = [...d.badges];
  return `<header class="page-head"><div><h1>The Vault</h1><p class="muted">Where your data lives and how you're doing.</p></div></header>
  <section class="panel"><h2>Your ledger</h2><p>Everything is one file: <code>${esc(S.dataDir)}/ledger.json</code>. Cashmere keeps the previous version next to it and a dated copy per day in <code>backups/</code> (last 60). Back up that folder and you have everything.</p>
    <div class="b-actions"><button type="button" class="btn" data-act="reveal">Show in Finder</button><button type="button" class="btn" data-act="chooseFolder">Move ledger…</button><button type="button" class="btn" data-act="exportCsv">Export CSV</button></div></section>
  <section class="panel"><h2>Progress</h2>
    <div class="stats three"><div class="stat level"><span class="lbl">Level ${d.level} · ${LEVELS[d.level - 1]}</span>${bar(pct(d.xp - d.lvlFloor, d.lvlNext - d.lvlFloor), "gold")}<small>${d.xp} XP</small></div><div class="stat"><span class="lbl">Streak</span><b>${d.streak} wk</b><small>weeks in a row with expenses logged</small></div><div class="stat"><span class="lbl">Logged</span><b>${d.expenses}</b><small>expenses · ${d.paychecks} paychecks</small></div></div>
    <div class="badges">${Object.entries(BADGES).map(([k, [e, l]]) => `<div class="badge ${earned.includes(k) ? "on" : ""}"><span>${e}</span><small>${l}</small></div>`).join("")}</div>
    <p class="muted">XP: expense ${XP.expense} · paycheck ${XP.paycheck} · card payment ${XP.cardpay} (+${XP.cardfull} in full) · loan payment ${XP.loanpay} · sorting ${XP.allocate} · goal reached ${XP.goal} · loan paid off ${XP.loanfree}. Levels: ${LEVELS.map((l, i) => (i + 1) + " " + l).join(", ")}.</p></section>
  <section class="panel"><h2>Customize</h2><p class="muted">Categories: ${cats().map(([, l]) => esc(l)).join(", ")}</p><div class="b-actions"><button type="button" class="btn" data-act="editCategories">Edit categories</button><button type="button" class="btn" data-act="setup">Re-run setup (accounts, buckets, loans)</button></div></section>
  <section class="panel"><h2>How the math works</h2><p>Cash in your accounts, minus what you owe on cards, equals what your buckets hold plus Unsorted. When you log a card purchase the bucket drops and the card's owed balance rises, so paying the card later changes nothing in the buckets. A paycheck adds cash and fills buckets; anything you don't assign is Unsorted.</p></section>
  <section class="panel danger-zone"><h2>Start over</h2><p class="muted">Wipes the ledger and runs setup again. The old ledger stays in <code>backups/</code>.</p><button type="button" class="btn danger" data-act="reset">Start over</button></section>`;
};

function render() {
  const main = $("#main");
  if (S.error) { main.innerHTML = `<div class="empty"><h1>Hmm.</h1><p>${esc(S.error)}</p></div>`; return; }
  const d = derive();
  $$("#nav button").forEach((b) => b.classList.toggle("active", b.dataset.view === S.view));
  main.innerHTML = (views[S.view] || views.home)(d);
  $("#sideFoot").innerHTML = `<div class="foot-level"><span>Lv ${d.level} · ${LEVELS[d.level - 1]}</span>${bar(pct(d.xp - d.lvlFloor, d.lvlNext - d.lvlFloor), "gold")}</div><div class="foot-row"><span>${d.streak ? "🔥 " + d.streak + " wk" : "no streak yet"}</span><span>${d.xp} XP</span></div>`;
  main.scrollTop = 0;
}

// ---------- first-run setup ----------
async function runSetup() {
  // 1. Accounts
  const d0 = derive();
  const acctRows = S.db.accounts.length
    ? S.db.accounts.map((a) => ({ _id: a.id, name: a.name, kind: a.kind, balance: d0.acct[a.id] || "", dueDay: a.dueDay || "", main: !!a.main }))
    : [{ name: "Savings", kind: "cash", balance: "", dueDay: "", main: true }, { name: "Checking", kind: "cash", balance: "", dueDay: "", main: false }, { name: "Credit card", kind: "card", balance: "", dueDay: 25, main: false }];
  const accts = await rowsDialog({
    title: "Welcome to Cashmere",
    intro: "Start with where your money actually sits. For a credit card, Balance is what you owe right now. Tick the account your paychecks land in. Rename, add or remove rows freely; all of this can change later under Accounts.",
    columns: [
      { key: "name", label: "Name", type: "text", placeholder: "Savings, Checking, Visa…" },
      { key: "kind", label: "Type", type: "select", options: [["cash", "Bank account"], ["card", "Credit card"]] },
      { key: "balance", label: "Balance / owed", type: "money" },
      { key: "dueDay", label: "Card due day", type: "number", min: 1, max: 31, placeholder: "cards" },
      { key: "main", label: "Paychecks", type: "radio" },
    ],
    rows: acctRows, blank: { name: "", kind: "cash", balance: "", dueDay: "", main: false },
    submit: "Next: buckets", cancelLabel: "Skip setup", addLabel: "+ Add account",
    validate: (rows) => (!rows.some((r) => r.name) ? "Add at least one account." : !rows.some((r) => r.name && r.kind === "cash") ? "Add at least one bank account." : null),
  });
  if (!accts) return finishSetup();
  const keep = new Set();
  for (const r of accts) {
    if (!r.name) continue;
    let a = r._id ? acc(r._id) : null;
    if (!a) { a = { id: uid(), name: r.name, kind: r.kind }; S.db.accounts.push(a); }
    a.name = r.name; a.kind = r.kind; a.main = r.kind === "cash" && r.main;
    if (a.kind === "card") a.dueDay = Math.max(1, Math.min(31, r.dueDay || 25)); else delete a.dueDay;
    const cur = derive().acct[a.id] || 0, delta = r2((r.balance || 0) - cur);
    if (Math.abs(delta) > 0.005) addTx({ type: "opening", amount: delta, date: todayStr(), accountId: a.id, note: "setup" });
    keep.add(a.id);
  }
  S.db.accounts = S.db.accounts.filter((a) => keep.has(a.id));
  if (!S.db.accounts.some((a) => a.main)) { const c = cashAccounts()[0]; if (c) c.main = true; }
  await window.cashmere.saveDb(S.db);

  // 2. Buckets
  const bucketRows = S.db.buckets.length
    ? S.db.buckets.map((b) => ({ _id: b.id, emoji: b.emoji, name: b.name, kind: b.kind, plan: b.plan?.remainder ? "rest" : b.plan?.mode === "percent" ? b.plan.value + "%" : b.plan?.mode === "amount" ? String(b.plan.value) : "" }))
    : DEFAULT_BUCKETS.map(([emoji, name, kind]) => ({ emoji, name, kind, plan: "" }));
  const bs = await rowsDialog({
    title: "Your buckets",
    intro: "Buckets are labels on the money in your accounts: what each dollar is for. These are suggestions. Rename, remove, add your own. Per paycheck can be a dollar amount, a percent like <b>10%</b>, or <b>rest</b> for whatever is left. Leave it blank to decide check by check.",
    columns: [
      { key: "emoji", label: "", type: "emoji" },
      { key: "name", label: "Bucket", type: "text", placeholder: "Rent, Fun, Dog, Paris…" },
      { key: "kind", label: "Kind", type: "select", options: Object.entries(KINDS) },
      { key: "plan", label: "Per paycheck", type: "text", placeholder: "$, % or rest", cls: "plan-in" },
    ],
    rows: bucketRows, blank: { emoji: "🪣", name: "", kind: "savings", plan: "" },
    submit: "Next: loans", cancelLabel: "Skip", addLabel: "+ Add bucket",
  });
  if (bs) {
    const keepB = new Set();
    for (const r of bs) {
      if (!r.name) continue;
      const raw = (r.plan || "").trim().toLowerCase();
      let plan = null;
      if (raw === "rest" || raw === "remainder") plan = { remainder: true };
      else if (/%$/.test(raw)) plan = { mode: "percent", value: r2(parseFloat(raw)) };
      else if (raw) plan = { mode: "amount", value: r2(parseFloat(raw.replace(/[$,]/g, ""))) };
      if (plan && !plan.remainder && !(plan.value > 0)) plan = null;
      let b = r._id ? bucket(r._id) : null;
      if (!b) { b = { id: uid(), bill: null, note: "", archived: false }; S.db.buckets.push(b); }
      Object.assign(b, { emoji: r.emoji || "🪣", name: r.name, kind: r.kind, plan });
      if (b.kind === "bill" && !b.bill) b.bill = { amount: 0, dueDay: 1 };
      keepB.add(b.id);
    }
    S.db.buckets = S.db.buckets.filter((b) => keepB.has(b.id));
    S.db.goals = S.db.goals.filter((g) => keepB.has(g.bucketId));
    let seenRest = false; for (const b of S.db.buckets) if (b.plan?.remainder) { if (seenRest) b.plan = null; seenRest = true; }
    await window.cashmere.saveDb(S.db);
  }

  // 3. Loans
  const payOpts = payWithOptions().reverse();
  if (payOpts.length) {
    const dL = derive();
    const loanRows = S.db.loans.length
      ? S.db.loans.map((l) => ({ _id: l.id, name: l.name, balance: dL.ln[l.id], rate: l.rate, minPayment: l.minPayment, dueDay: l.dueDay, accountId: l.accountId }))
      : [{ name: "", balance: "", rate: "", minPayment: "", dueDay: 1, accountId: mainAccount()?.id }];
    const ls = await rowsDialog({
      title: "Loans",
      intro: "Anything you're paying off: student loans, a car, a phone installment. Skip if none. \"Paid with\" is a card when the installment shows up on a card statement.",
      columns: [
        { key: "name", label: "Loan", type: "text", placeholder: "Student loan" },
        { key: "balance", label: "Balance", type: "money" },
        { key: "rate", label: "Rate %", type: "number", min: 0, placeholder: "5" },
        { key: "minPayment", label: "Monthly", type: "money" },
        { key: "dueDay", label: "Due day", type: "number", min: 1, max: 31 },
        { key: "accountId", label: "Paid with", type: "select", options: payOpts },
      ],
      rows: loanRows, blank: { name: "", balance: "", rate: "", minPayment: "", dueDay: 1, accountId: mainAccount()?.id },
      submit: "Next: sort your money", cancelLabel: "No loans, skip", addLabel: "+ Add loan",
    });
    if (ls) {
      const loansBucket = S.db.buckets.find((b) => /loan|debt/i.test(b.name))?.id || null;
      for (const r of ls) {
        if (!r.name || !(r.balance >= 0)) continue;
        let l = r._id ? loan(r._id) : null;
        if (!l) { l = { id: uid(), original: null, bucketId: loansBucket }; S.db.loans.push(l); }
        Object.assign(l, { name: r.name, rate: Number(r.rate) || 0, minPayment: r2(r.minPayment || 0), dueDay: Math.max(1, Math.min(31, r.dueDay || 1)), accountId: r.accountId });
        if (Math.abs(r2(r.balance) - (derive().ln[l.id] || 0)) > 0.005) addTx({ type: "loanset", amount: r2(r.balance), date: todayStr(), loanId: l.id });
      }
      await window.cashmere.saveDb(S.db);
    }
  }

  // 4. The big sort
  render();
  const d = derive();
  if (d.unsorted > 0.005 && activeBuckets().length) {
    toast("Last step: give your " + money0(d.unsorted) + " a job.");
    await act.sort();
  }
  finishSetup();
}
async function finishSetup() { S.db.setup = true; await window.cashmere.saveDb(S.db); render(); }

// ---------- boot ----------
async function boot() {
  const st = await window.cashmere.state();
  S.dataDir = st.dataDir; S.error = st.error; S.db = st.db || emptyDb();
  // Migrate bucket-level goals (v1) into the goals list.
  let migrated = false;
  if (!Array.isArray(S.db.goals)) { S.db.goals = []; migrated = true; }
  // Goals v3: a goal is a slice of one bucket. Old "source" goals become bucket goals (or need a bucket picked).
  for (const g of S.db.goals) if (g.source || !("bucketId" in g)) {
    g.bucketId = g.source?.type === "bucket" ? g.source.id : null; delete g.source; delete g.start; migrated = true;
    // A goal that used to measure its whole bucket keeps its current progress: earmark what the bucket holds (up to the target).
    const b = g.bucketId ? bucket(g.bucketId) : null;
    if (b && b.name === g.name) { const have = derive().bkt[b.id] || 0; const amt = r2(Math.min(have, g.target || 0)); if (amt > 0) addTx({ type: "earmark", amount: amt, date: todayStr(), goalId: g.id, note: "migrated: this goal used to count the whole bucket" }); }
  }
  if (!Array.isArray(S.db.recurring)) { S.db.recurring = []; migrated = true; }
  if (!Array.isArray(S.db.accounts)) { S.db.accounts = []; migrated = true; }
  if (!Array.isArray(S.db.categories) || !S.db.categories.length) { S.db.categories = DEFAULT_CATS.map((c) => ({ ...c })); migrated = true; }
  for (const b of S.db.buckets) if (b.goal && b.goal.amount > 0) { S.db.goals.push({ id: uid(), created: todayStr(), emoji: b.emoji, name: b.name, bucketId: b.id, target: r2(b.goal.amount), date: b.goal.date || null, note: "" }); delete b.goal; migrated = true; }
  if (migrated && !S.error) await window.cashmere.saveDb(S.db);
  const [hash, flag, testAct] = location.hash.replace("#", "").split("!");
  if (views[hash]) S.view = hash;
  $("#nav").addEventListener("click", (e) => { const b = e.target.closest("button[data-view]"); if (b) act.nav(b); });
  $("#main").addEventListener("click", (e) => { const el = e.target.closest("[data-act]"); if (!el || !act[el.dataset.act]) return; e.stopPropagation(); act[el.dataset.act](el, e); });
  document.addEventListener("keydown", (e) => {
    if ($("#dlg").open || e.target.matches("input, textarea, select")) return;
    if (e.key === "e") act.expense(); else if (e.key === "p") act.paycheck(); else if (e.key === "s") act.sort();
  });
  lastLevel = derive().level;
  render();
  if (!S.error && !S.db.setup && flag !== "nosetup") runSetup();
  if (testAct && act[testAct]) setTimeout(() => act[testAct](), 100); // test hook
  window.__cm = { S, act, derive, txSorted, goalProgress, recurMonthly, recurAdvance }; // test hook
}
boot();
