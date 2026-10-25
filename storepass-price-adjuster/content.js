(() => {
  "use strict";

  const PRICE_LABEL = /^(Cash|Credit) price for\s+/i;
  const STORE_KEY = "spa-originals:" + location.pathname;

  // ---------- Reading the page ----------

  const money = (s) => {
    const n = parseFloat(String(s ?? "").replace(/[^0-9.\-]/g, ""));
    return Number.isFinite(n) ? n : NaN;
  };
  const toCents = (n) => Math.round(n * 100);
  const fmt = (cents) =>
    (cents < 0 ? "-$" : "$") + (Math.abs(cents) / 100).toFixed(2);

  function readRows() {
    const inputs = [...document.querySelectorAll("input[aria-label]")].filter(
      (el) => PRICE_LABEL.test(el.getAttribute("aria-label"))
    );
    return inputs
      .map((el) => {
        const label = el.getAttribute("aria-label");
        const name = label.replace(PRICE_LABEL, "").trim();
        const mode = label.match(PRICE_LABEL)[1];
        const row = el.closest("tr");
        const qtyEl = row?.querySelector('input[aria-label^="Quantity for"]');
        const qty = qtyEl ? Math.max(0, parseInt(qtyEl.value, 10) || 0) : 1;
        const cents = toCents(money(el.value));
        return { el, name, mode, qty, cents: Number.isFinite(cents) ? cents : 0 };
      })
      .filter((r) => r.qty > 0);
  }

  // ---------- The math ----------
  // Every unit price is multiplied by the same factor (paid / system total).
  // Prices are floored to the cent, then the leftover pennies go to the rows
  // that lost the most to rounding, so the new total lands exactly on target.
  function plan(rows, targetCents) {
    const current = rows.reduce((s, r) => s + r.cents * r.qty, 0);
    if (current <= 0) return { error: "Every card is at $0.00, so there is nothing to scale." };
    const factor = targetCents / current;

    const items = rows.map((r) => {
      const ideal = r.cents * factor;
      const floor = Math.floor(ideal);
      return { ...r, ideal, next: floor, frac: ideal - floor };
    });

    let left = targetCents - items.reduce((s, r) => s + r.next * r.qty, 0);
    const order = [...items].sort((a, b) => b.frac - a.frac || a.qty - b.qty);
    // Hand out pennies; a row with quantity q absorbs q cents per bump.
    let progress = true;
    while (left > 0 && progress) {
      progress = false;
      for (const it of order) {
        if (left <= 0) break;
        if (it.cents > 0 && it.qty <= left) {
          it.next += 1;
          left -= it.qty;
          progress = true;
        }
      }
    }

    const finalTotal = items.reduce((s, r) => s + r.next * r.qty, 0);
    return { items, current, factor, finalTotal, off: targetCents - finalTotal };
  }

  // ---------- Writing to the page (React-controlled inputs) ----------

  const nativeSetter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value"
  ).set;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function setPrice(el, cents) {
    const value = (cents / 100).toFixed(2);
    el.focus();
    nativeSetter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    el.dispatchEvent(new FocusEvent("blur"));
    el.blur();
    await sleep(80); // give Storepass time to save each line
  }

  // ---------- Remembering original prices for Restore ----------

  async function loadOriginals() {
    try {
      const got = await chrome.storage.local.get(STORE_KEY);
      return got[STORE_KEY] || {};
    } catch {
      return {};
    }
  }
  async function rememberOriginals(rows) {
    const saved = await loadOriginals();
    let changed = false;
    for (const r of rows) {
      if (!(r.name in saved)) {
        saved[r.name] = r.cents;
        changed = true;
      }
    }
    if (changed) {
      try {
        await chrome.storage.local.set({ [STORE_KEY]: saved });
      } catch {}
    }
    return saved;
  }
  async function forgetOriginals() {
    try {
      await chrome.storage.local.remove(STORE_KEY);
    } catch {}
  }

  // ---------- Panel UI ----------

  const host = document.createElement("div");
  host.id = "spa-host";
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `
  <style>
    :host { all: initial; }
    * { box-sizing: border-box; }
    .wrap {
      --ink: #1d2433; --muted: #5b6577; --line: #d9dee7; --bg: #ffffff;
      --soft: #f3f5f9; --accent: #1f5fbf; --accent-ink: #ffffff;
      --good: #1d7a4a; --bad: #b3261e;
      position: fixed; right: 16px; bottom: 16px; z-index: 2147483000;
      font: 13px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif;
      color: var(--ink);
    }
    @media (prefers-color-scheme: dark) {
      .wrap { --ink: #e6e9ef; --muted: #9aa3b2; --line: #343b48; --bg: #1a1e26;
        --soft: #232833; --accent: #6ea2ff; --accent-ink: #0d1320;
        --good: #5fd39a; --bad: #ff8a80; }
    }
    button { font: inherit; cursor: pointer; }
    button:focus-visible, input:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    .tab {
      background: var(--accent); color: var(--accent-ink); border: 0;
      border-radius: 999px; padding: 9px 16px; font-weight: 600;
      box-shadow: 0 4px 14px rgba(0,0,0,.18);
    }
    .panel {
      width: 360px; max-width: calc(100vw - 32px); background: var(--bg);
      border: 1px solid var(--line); border-radius: 10px;
      box-shadow: 0 10px 30px rgba(0,0,0,.2); overflow: hidden;
    }
    .head { display: flex; align-items: center; justify-content: space-between;
      padding: 12px 14px; border-bottom: 1px solid var(--line); }
    .head h2 { margin: 0; font-size: 14px; font-weight: 650; }
    .x { background: none; border: 0; color: var(--muted); font-size: 18px; line-height: 1; padding: 2px 6px; }
    .body { padding: 14px; display: grid; gap: 12px; }
    .sum { display: flex; justify-content: space-between; color: var(--muted); }
    .sum b { color: var(--ink); font-variant-numeric: tabular-nums; }
    label { display: grid; gap: 4px; font-weight: 600; }
    .field { display: flex; align-items: center; border: 1px solid var(--line);
      border-radius: 6px; background: var(--soft); }
    .field span { padding: 0 0 0 10px; color: var(--muted); }
    .field input { flex: 1; border: 0; background: transparent; color: var(--ink);
      font: inherit; font-size: 16px; padding: 8px 10px 8px 4px; text-align: right;
      font-variant-numeric: tabular-nums; min-width: 0; }
    .field input:focus { outline: none; }
    .field:focus-within { border-color: var(--accent); }
    .pct { font-size: 22px; font-weight: 700; font-variant-numeric: tabular-nums; }
    .pct.down { color: var(--bad); } .pct.up { color: var(--good); }
    .note { color: var(--muted); font-size: 12px; }
    .list { max-height: 220px; overflow: auto; border: 1px solid var(--line); border-radius: 6px; }
    table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
    td { padding: 6px 8px; border-top: 1px solid var(--line); white-space: nowrap; }
    tr:first-child td { border-top: 0; }
    td.n { max-width: 170px; overflow: hidden; text-overflow: ellipsis; }
    td.r { text-align: right; } td.old { color: var(--muted); text-decoration: line-through; }
    .q { color: var(--muted); }
    .actions { display: flex; gap: 8px; }
    .primary { flex: 1; background: var(--accent); color: var(--accent-ink); border: 0;
      border-radius: 6px; padding: 9px 12px; font-weight: 650; }
    .primary:disabled { opacity: .45; cursor: not-allowed; }
    .ghost { background: none; border: 1px solid var(--line); color: var(--ink);
      border-radius: 6px; padding: 9px 12px; }
    .msg { font-size: 12px; min-height: 1em; }
    .msg.err { color: var(--bad); } .msg.ok { color: var(--good); }
    @media (prefers-reduced-motion: no-preference) {
      .panel { animation: rise .14s ease-out; }
      @keyframes rise { from { transform: translateY(6px); opacity: 0; } }
    }
  </style>
  <div class="wrap">
    <button class="tab" part="tab">Match amount paid</button>
    <div class="panel" hidden>
      <div class="head">
        <h2>Match amount paid</h2>
        <button class="x" aria-label="Close">×</button>
      </div>
      <div class="body">
        <div class="sum"><span class="count">–</span><span>System total <b class="cur">–</b></span></div>
        <label>Amount actually paid
          <div class="field"><span>$</span><input class="target" inputmode="decimal" autocomplete="off" placeholder="0.00"></div>
        </label>
        <div class="result" hidden>
          <div class="pct"></div>
          <div class="note"></div>
        </div>
        <div class="list" hidden><table><tbody></tbody></table></div>
        <div class="actions">
          <button class="primary apply" disabled>Apply new prices</button>
          <button class="ghost restore" title="Put back the prices from before any adjustment">Restore</button>
        </div>
        <div class="msg" role="status"></div>
      </div>
    </div>
  </div>`;

  const $ = (s) => root.querySelector(s);
  const tab = $(".tab"), panel = $(".panel"), target = $(".target");
  const applyBtn = $(".apply"), restoreBtn = $(".restore"), msg = $(".msg");
  let currentPlan = null;
  let busy = false;

  const say = (text, kind = "") => { msg.textContent = text; msg.className = "msg " + kind; };
  const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  function refresh() {
    if (busy) return;
    const rows = readRows();
    const units = rows.reduce((s, r) => s + r.qty, 0);
    const current = rows.reduce((s, r) => s + r.cents * r.qty, 0);
    $(".count").textContent = `${rows.length} card${rows.length === 1 ? "" : "s"}` +
      (units !== rows.length ? ` (${units} items)` : "");
    $(".cur").textContent = fmt(current);

    const t = money(target.value);
    currentPlan = null;
    $(".result").hidden = true;
    $(".list").hidden = true;
    applyBtn.disabled = true;
    applyBtn.textContent = "Apply new prices";

    if (!rows.length) { say("No price boxes found on this page yet.", "err"); return; }
    if (target.value.trim() === "") { if (!msg.classList.contains("ok")) say(""); return; }
    if (!Number.isFinite(t) || t < 0) { say("Enter the amount paid, like 55 or 55.00.", "err"); return; }

    const p = plan(rows, toCents(t));
    if (p.error) { say(p.error, "err"); return; }
    currentPlan = p;

    const pct = (p.factor - 1) * 100;
    const pctEl = $(".pct");
    pctEl.textContent = (pct > 0 ? "+" : "") + pct.toFixed(2) + "%";
    pctEl.className = "pct " + (pct < 0 ? "down" : pct > 0 ? "up" : "");
    $(".note").textContent =
      `Every card ${pct < 0 ? "drops" : "rises"} by the same percentage: ${fmt(p.current)} → ${fmt(p.finalTotal)}.`;
    $(".result").hidden = false;

    $(".list tbody").innerHTML = p.items.map((it) => `
      <tr>
        <td class="n" title="${esc(it.name)}">${esc(it.name)}${it.qty > 1 ? ` <span class="q">×${it.qty}</span>` : ""}</td>
        <td class="r old">${fmt(it.cents)}</td>
        <td class="r">${fmt(it.next)}</td>
      </tr>`).join("");
    $(".list").hidden = false;

    if (p.off !== 0) {
      say(`Lands ${fmt(Math.abs(p.off))} ${p.off > 0 ? "under" : "over"} target: every card has quantity above 1, so pennies can't split evenly. Adjust one price by hand.`, "err");
    } else say("");
    applyBtn.disabled = false;
    applyBtn.textContent = `Apply to ${p.items.length} card${p.items.length === 1 ? "" : "s"}`;
  }

  async function apply() {
    if (!currentPlan || busy) return;
    const p = currentPlan;
    busy = true;
    applyBtn.disabled = true;
    await rememberOriginals(p.items);
    let done = 0;
    for (const it of p.items) {
      if (!it.el.isConnected) continue;
      if (it.next !== it.cents) await setPrice(it.el, it.next);
      done++;
      say(`Updating ${done} of ${p.items.length}…`);
    }
    busy = false;
    target.value = "";
    refresh();
    say(`Applied. New total ${fmt(p.finalTotal)}. Check that Storepass shows "Saved!".`, "ok");
  }

  async function restore() {
    if (busy) return;
    const saved = await loadOriginals();
    const rows = readRows();
    const toFix = rows.filter((r) => r.name in saved && saved[r.name] !== r.cents);
    if (!Object.keys(saved).length) { say("Nothing to restore: no adjustment has been applied on this submission.", "err"); return; }
    busy = true;
    for (const r of toFix) await setPrice(r.el, saved[r.name]);
    busy = false;
    await forgetOriginals();
    refresh();
    say(toFix.length ? `Restored ${toFix.length} price${toFix.length === 1 ? "" : "s"}.` : "Prices already match the originals.", "ok");
  }

  tab.addEventListener("click", () => { tab.hidden = true; panel.hidden = false; refresh(); target.focus(); });
  $(".x").addEventListener("click", () => { panel.hidden = true; tab.hidden = false; });
  target.addEventListener("input", refresh);
  target.addEventListener("keydown", (e) => { if (e.key === "Enter") apply(); e.stopPropagation(); });
  applyBtn.addEventListener("click", apply);
  restoreBtn.addEventListener("click", restore);

  // Storepass is a single-page app: show the button only when price boxes exist,
  // and keep the preview in sync when quantities or rows change.
  let scheduled = false;
  const sync = () => {
    scheduled = false;
    const has = readRows().length > 0;
    if (has && !host.isConnected) document.body.appendChild(host);
    if (!has && host.isConnected && panel.hidden) host.remove();
    if (host.isConnected && !panel.hidden) refresh();
  };
  new MutationObserver((muts) => {
    if (muts.every((m) => host.contains(m.target))) return;
    if (!scheduled) { scheduled = true; setTimeout(sync, 300); }
  }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["value"] });
  document.addEventListener("input", (e) => {
    if (e.target?.matches?.('input[aria-label^="Quantity for"]') && !scheduled) { scheduled = true; setTimeout(sync, 300); }
  }, true);
  sync();
})();
