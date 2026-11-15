(() => {
  "use strict";
  if (window.__spaLoaded) return;
  window.__spaLoaded = true;

  // Storepass buylist page (Nov 2026 layout):
  //   <section aria-label="Items"> … <tr data-row-id="ln_…">
  //     <td data-column-id="quantity"><button aria-label="Change quantity of NAME"><span>1</span></button>
  //     <td data-column-id="unitCash"><button aria-label="Change cash each for NAME">…$1.00…</button>
  //     <td data-column-id="unitCredit"><button aria-label="Change credit each for NAME">…$1.15…</button>
  // Clicking a price button swaps in an editor; we type the value and press Enter.

  const COLS = {
    cash: { id: "unitCash", label: "Change cash each for ", word: "Cash" },
    credit: { id: "unitCredit", label: "Change credit each for ", word: "Credit" },
  };
  const STORE_KEY = "spa-originals-v2:" + location.pathname;

  const money = (s) => {
    const n = parseFloat(String(s ?? "").replace(/[^0-9.\-]/g, ""));
    return Number.isFinite(n) ? n : NaN;
  };
  const toCents = (n) => Math.round(n * 100);
  const fmt = (c) => (c < 0 ? "-$" : "$") + (Math.abs(c) / 100).toFixed(2);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const cssEsc = (s) => (window.CSS && CSS.escape ? CSS.escape(s) : s.replace(/["\\]/g, "\\$&"));

  // ---------- Reading the page ----------

  function itemsRoot() {
    return document.querySelector('section[aria-label="Items"]') || document;
  }

  function cellCents(row, col) {
    const td = row.querySelector(`td[data-column-id="${COLS[col].id}"]`);
    if (!td) return NaN;
    const m = td.querySelector('[data-slot="money"]');
    const c = toCents(money(m ? m.textContent : td.textContent));
    return Number.isFinite(c) ? c : NaN;
  }

  function readRows() {
    const out = [];
    for (const tr of itemsRoot().querySelectorAll("tr[data-row-id]")) {
      const cashBtn = tr.querySelector(`button[aria-label^="${COLS.cash.label}"]`);
      const creditBtn = tr.querySelector(`button[aria-label^="${COLS.credit.label}"]`);
      if (!cashBtn && !creditBtn) continue;
      const name = (cashBtn || creditBtn).getAttribute("aria-label")
        .replace(COLS.cash.label, "").replace(COLS.credit.label, "").trim();
      const qtyTd = tr.querySelector('td[data-column-id="quantity"]');
      const qty = qtyTd ? Math.max(0, parseInt(qtyTd.textContent.replace(/[^0-9]/g, ""), 10) || 0) : 1;
      out.push({
        id: tr.getAttribute("data-row-id"),
        name, qty,
        cash: cellCents(tr, "cash"),
        credit: cellCents(tr, "credit"),
      });
    }
    return out.filter((r) => r.qty > 0);
  }

  function expectedItemCount() {
    const h = itemsRoot().querySelector("h2");
    const m = h && h.textContent.match(/\((\d+)\)/);
    return m ? parseInt(m[1], 10) : null;
  }

  // ---------- The math ----------
  // Every unit price is multiplied by the same factor. Prices are floored to the
  // cent, then leftover pennies go to the rows that lost most to rounding, so the
  // new total lands exactly on target.
  function scale(rows, col, targetCents) {
    const current = rows.reduce((s, r) => s + (r[col] || 0) * r.qty, 0);
    if (current <= 0) return null;
    const factor = targetCents / current;
    const items = rows.map((r) => {
      const base = r[col] || 0;
      const ideal = base * factor;
      const next = Math.floor(ideal + 1e-9);
      return { id: r.id, base, qty: r.qty, next, frac: ideal - next };
    });
    let left = targetCents - items.reduce((s, it) => s + it.next * it.qty, 0);
    const order = [...items].sort((a, b) => b.frac - a.frac || a.qty - b.qty);
    let moved = true;
    while (left > 0 && moved) {
      moved = false;
      for (const it of order) {
        if (left <= 0) break;
        if (it.base > 0 && it.qty <= left) { it.next++; left -= it.qty; moved = true; }
      }
    }
    const total = items.reduce((s, it) => s + it.next * it.qty, 0);
    return { factor, current, total, off: targetCents - total, byId: Object.fromEntries(items.map((i) => [i.id, i.next])) };
  }

  function plan(rows, primary, targetCents, alsoOther) {
    const other = primary === "cash" ? "credit" : "cash";
    const p = scale(rows, primary, targetCents);
    if (!p) return { error: `Every card's ${primary} price is $0.00, so there is nothing to scale.` };
    let o = null;
    if (alsoOther) {
      const cur = rows.reduce((s, r) => s + (r[other] || 0) * r.qty, 0);
      if (cur > 0) o = scale(rows, other, Math.round(cur * p.factor));
    }
    const changes = [];
    for (const r of rows) {
      const n = { [primary]: p.byId[r.id] };
      if (o) n[other] = o.byId[r.id];
      changes.push({ ...r, next: n });
    }
    return { primary, other, p, o, changes };
  }

  // ---------- Editing a cell ----------

  const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;

  function findRow(id) {
    return itemsRoot().querySelector(`tr[data-row-id="${cssEsc(id)}"]`);
  }

  function findEditor(row, col) {
    const td = row && row.querySelector(`td[data-column-id="${COLS[col].id}"]`);
    const inCell = td && td.querySelector('input:not([type="checkbox"]):not([type="hidden"]):not([aria-hidden="true"])');
    if (inCell) return inCell;
    const a = document.activeElement;
    if (a && a.tagName === "INPUT" && !host.contains(a) && a.type !== "checkbox" && a.type !== "search") return a;
    return null;
  }

  async function waitFor(fn, ms = 2000, step = 40) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const v = fn();
      if (v) return v;
      await sleep(step);
    }
    return fn();
  }

  function key(el, k) {
    const opts = { key: k, code: k, keyCode: k === "Enter" ? 13 : 27, which: k === "Enter" ? 13 : 27, bubbles: true, cancelable: true };
    el.dispatchEvent(new KeyboardEvent("keydown", opts));
    el.dispatchEvent(new KeyboardEvent("keypress", opts));
    el.dispatchEvent(new KeyboardEvent("keyup", opts));
  }

  async function setCell(rowId, col, cents) {
    const row = findRow(rowId);
    if (!row) throw new Error("row no longer on the page");
    if (cellCents(row, col) === cents) return true;
    const btn = row.querySelector(`button[aria-label^="${COLS[col].label}"]`);
    if (!btn) throw new Error(`no ${col} price button`);
    btn.scrollIntoView({ block: "center" });
    btn.click();

    const input = await waitFor(() => findEditor(findRow(rowId), col), 2000);
    if (!input) throw new Error("price box didn't open");

    const value = (cents / 100).toFixed(2);
    input.focus();
    if (input.select) input.select();
    nativeSetter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await sleep(30);
    key(input, "Enter");

    // Wait for the editor to close; if Enter didn't commit, try blurring.
    let closed = await waitFor(() => !input.isConnected || document.activeElement !== input && !findEditor(findRow(rowId), col), 1200);
    if (!closed && input.isConnected) {
      input.blur();
      input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
      closed = await waitFor(() => !findEditor(findRow(rowId), col), 1200);
    }
    const ok = await waitFor(() => cellCents(findRow(rowId), col) === cents, 2500);
    if (!ok) throw new Error(`still shows ${fmt(cellCents(findRow(rowId), col))}`);
    return true;
  }

  // ---------- Originals for Restore ----------

  async function loadOriginals() {
    try { return (await chrome.storage.local.get(STORE_KEY))[STORE_KEY] || {}; } catch { return {}; }
  }
  async function rememberOriginals(changes) {
    const saved = await loadOriginals();
    for (const c of changes) for (const col of Object.keys(c.next)) {
      const k = col + ":" + c.id;
      if (!(k in saved) && Number.isFinite(c[col])) saved[k] = c[col];
    }
    try { await chrome.storage.local.set({ [STORE_KEY]: saved }); } catch {}
  }
  async function forgetOriginals() {
    try { await chrome.storage.local.remove(STORE_KEY); } catch {}
  }

  // ---------- Panel ----------

  const host = document.createElement("div");
  host.id = "spa-host";
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `
  <style>
    :host { all: initial; }
    * { box-sizing: border-box; }
    .wrap {
      --ink:#1d2433; --muted:#5b6577; --line:#d9dee7; --bg:#fff; --soft:#f3f5f9;
      --accent:#1f5fbf; --accent-ink:#fff; --good:#1d7a4a; --bad:#b3261e;
      position: fixed; right: 16px; bottom: 16px; z-index: 2147483000;
      font: 13px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; color: var(--ink);
    }
    @media (prefers-color-scheme: dark) {
      .wrap { --ink:#e6e9ef; --muted:#9aa3b2; --line:#343b48; --bg:#1a1e26; --soft:#232833;
        --accent:#6ea2ff; --accent-ink:#0d1320; --good:#5fd39a; --bad:#ff8a80; }
    }
    button { font: inherit; cursor: pointer; }
    button:focus-visible, input:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    .tab { background: var(--accent); color: var(--accent-ink); border: 0; border-radius: 999px;
      padding: 9px 16px; font-weight: 600; box-shadow: 0 4px 14px rgba(0,0,0,.18); }
    .panel { width: 380px; max-width: calc(100vw - 32px); background: var(--bg); border: 1px solid var(--line);
      border-radius: 10px; box-shadow: 0 10px 30px rgba(0,0,0,.2); overflow: hidden; }
    .head { display: flex; align-items: center; justify-content: space-between; padding: 12px 14px; border-bottom: 1px solid var(--line); }
    .head h2 { margin: 0; font-size: 14px; font-weight: 650; }
    .x { background: none; border: 0; color: var(--muted); font-size: 18px; line-height: 1; padding: 2px 6px; }
    .body { padding: 14px; display: grid; gap: 12px; }
    .seg { display: grid; grid-template-columns: 1fr 1fr; border: 1px solid var(--line); border-radius: 6px; overflow: hidden; }
    .seg button { border: 0; background: var(--soft); color: var(--ink); padding: 7px; }
    .seg button[aria-pressed="true"] { background: var(--accent); color: var(--accent-ink); font-weight: 650; }
    .sum { display: flex; justify-content: space-between; color: var(--muted); }
    .sum b { color: var(--ink); font-variant-numeric: tabular-nums; }
    label.f { display: grid; gap: 4px; font-weight: 600; }
    .field { display: flex; align-items: center; border: 1px solid var(--line); border-radius: 6px; background: var(--soft); }
    .field span { padding-left: 10px; color: var(--muted); }
    .field input { flex: 1; border: 0; background: transparent; color: var(--ink); font: inherit; font-size: 16px;
      padding: 8px 10px 8px 4px; text-align: right; font-variant-numeric: tabular-nums; min-width: 0; }
    .field input:focus { outline: none; } .field:focus-within { border-color: var(--accent); }
    .chk { display: flex; gap: 8px; align-items: flex-start; color: var(--ink); }
    .chk input { margin-top: 2px; }
    .pct { font-size: 22px; font-weight: 700; font-variant-numeric: tabular-nums; }
    .pct.down { color: var(--bad); } .pct.up { color: var(--good); }
    .note { color: var(--muted); font-size: 12px; }
    .list { max-height: 240px; overflow: auto; border: 1px solid var(--line); border-radius: 6px; }
    table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
    th { position: sticky; top: 0; background: var(--soft); color: var(--muted); font-weight: 600; font-size: 11px; text-align: right; padding: 5px 8px; }
    th:first-child { text-align: left; }
    td { padding: 6px 8px; border-top: 1px solid var(--line); white-space: nowrap; text-align: right; }
    td.n { text-align: left; max-width: 150px; overflow: hidden; text-overflow: ellipsis; }
    .old { color: var(--muted); text-decoration: line-through; margin-right: 4px; }
    .q { color: var(--muted); }
    tr.done td { background: color-mix(in srgb, var(--good) 10%, transparent); }
    tr.fail td { background: color-mix(in srgb, var(--bad) 12%, transparent); }
    .actions { display: flex; gap: 8px; }
    .primary { flex: 1; background: var(--accent); color: var(--accent-ink); border: 0; border-radius: 6px; padding: 9px 12px; font-weight: 650; }
    .primary:disabled { opacity: .45; cursor: not-allowed; }
    .ghost { background: none; border: 1px solid var(--line); color: var(--ink); border-radius: 6px; padding: 9px 12px; }
    .ghost:disabled { opacity: .45; cursor: not-allowed; }
    .msg { font-size: 12px; min-height: 1em; white-space: pre-line; }
    .msg.err { color: var(--bad); } .msg.ok { color: var(--good); }
  </style>
  <div class="wrap">
    <button class="tab">Match amount paid</button>
    <div class="panel" hidden>
      <div class="head"><h2>Match amount paid</h2><button class="x" aria-label="Close">×</button></div>
      <div class="body">
        <div class="seg" role="group" aria-label="Which price to adjust">
          <button data-col="cash" aria-pressed="true">Cash</button>
          <button data-col="credit" aria-pressed="false">Credit</button>
        </div>
        <div class="sum"><span class="count">–</span><span><span class="word">Cash</span> total <b class="cur">–</b></span></div>
        <label class="f">Amount actually paid
          <div class="field"><span>$</span><input class="target" inputmode="decimal" autocomplete="off" placeholder="0.00"></div>
        </label>
        <label class="chk"><input type="checkbox" class="both"><span>Also change <span class="otherword">credit</span> prices by the same %</span></label>
        <div class="result" hidden><div class="pct"></div><div class="note"></div></div>
        <div class="list" hidden><table><thead></thead><tbody></tbody></table></div>
        <div class="actions">
          <button class="primary apply" disabled>Apply new prices</button>
          <button class="ghost stop" hidden>Stop</button>
          <button class="ghost restore" title="Put back the prices from before any adjustment">Restore</button>
        </div>
        <div class="msg" role="status"></div>
      </div>
    </div>
  </div>`;

  const $ = (s) => root.querySelector(s);
  const tab = $(".tab"), panel = $(".panel"), target = $(".target"), both = $(".both");
  const applyBtn = $(".apply"), restoreBtn = $(".restore"), stopBtn = $(".stop"), msg = $(".msg");
  let col = "cash";
  try { col = localStorage.getItem("spa-col") === "credit" ? "credit" : "cash"; } catch {}
  let current = null, busy = false, stopRequested = false;

  const say = (t, k = "") => { msg.textContent = t; msg.className = "msg " + k; };
  const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  function setCol(c) {
    col = c;
    try { localStorage.setItem("spa-col", c); } catch {}
    root.querySelectorAll(".seg button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.col === c)));
    $(".word").textContent = COLS[c].word;
    $(".otherword").textContent = c === "cash" ? "credit" : "cash";
    refresh();
  }

  function refresh() {
    if (busy) return;
    const rows = readRows();
    const units = rows.reduce((s, r) => s + r.qty, 0);
    const total = rows.reduce((s, r) => s + (r[col] || 0) * r.qty, 0);
    $(".count").textContent = `${rows.length} card${rows.length === 1 ? "" : "s"}` + (units !== rows.length ? ` (${units} items)` : "");
    $(".cur").textContent = fmt(total);
    current = null;
    $(".result").hidden = $(".list").hidden = true;
    applyBtn.disabled = true;
    applyBtn.textContent = "Apply new prices";

    if (!rows.length) return say("No cards with editable prices found on this page.", "err");
    const exp = expectedItemCount();
    const shown = itemsRoot().querySelectorAll("tr[data-row-id]").length;
    const partial = exp && exp > shown
      ? `Only ${shown} of ${exp} items are on this page. Set "Rows per page" high enough to show them all first.` : "";
    if (target.value.trim() === "") { if (!msg.classList.contains("ok")) say(partial, partial ? "err" : ""); return; }
    const t = money(target.value);
    if (!Number.isFinite(t) || t < 0) return say("Enter the amount paid, like 55 or 55.00.", "err");

    const p = plan(rows, col, toCents(t), both.checked);
    if (p.error) return say(p.error, "err");
    current = p;

    const pct = (p.p.factor - 1) * 100;
    const pe = $(".pct");
    pe.textContent = (pct > 0 ? "+" : "") + pct.toFixed(2) + "%";
    pe.className = "pct " + (pct < 0 ? "down" : pct > 0 ? "up" : "");
    let note = `Every card's ${col} price ${pct < 0 ? "drops" : "rises"} by the same %: ${fmt(p.p.current)} → ${fmt(p.p.total)}.`;
    if (p.o) note += ` ${COLS[p.other].word}: ${fmt(p.o.current)} → ${fmt(p.o.total)}.`;
    $(".note").textContent = note;
    $(".result").hidden = false;

    const cols = p.o ? [col, p.other] : [col];
    $(".list thead").innerHTML = `<tr><th>Card</th>${cols.map((c) => `<th>${COLS[c].word}</th>`).join("")}</tr>`;
    $(".list tbody").innerHTML = p.changes.map((c) => `
      <tr data-id="${esc(c.id)}">
        <td class="n" title="${esc(c.name)}">${esc(c.name)}${c.qty > 1 ? ` <span class="q">×${c.qty}</span>` : ""}</td>
        ${cols.map((k) => `<td>${c[k] !== c.next[k] ? `<span class="old">${fmt(c[k])}</span>` : ""}${fmt(c.next[k])}</td>`).join("")}
      </tr>`).join("");
    $(".list").hidden = false;

    const n = p.changes.reduce((s, c) => s + Object.keys(c.next).filter((k) => c.next[k] !== c[k]).length, 0);
    let warn = partial;
    if (p.p.off) warn += (warn ? "\n" : "") + `Lands ${fmt(Math.abs(p.p.off))} ${p.p.off > 0 ? "under" : "over"}: pennies can't split evenly across quantities. Adjust one price by hand.`;
    say(warn, warn ? "err" : "");
    applyBtn.disabled = n === 0;
    applyBtn.textContent = n ? `Apply ${n} price change${n === 1 ? "" : "s"}` : "Prices already match";
  }

  async function runEdits(edits, label) {
    busy = true; stopRequested = false;
    applyBtn.disabled = restoreBtn.disabled = true;
    stopBtn.hidden = false;
    const failed = [];
    let done = 0;
    for (const e of edits) {
      if (stopRequested) break;
      say(`${label} ${done + 1} of ${edits.length}…`);
      const tr = $(`.list tr[data-id="${cssEsc(e.id)}"]`);
      try { await setCell(e.id, e.col, e.cents); tr && tr.classList.add("done"); }
      catch (err) { failed.push(`${e.name} (${e.col}): ${err.message}`); tr && tr.classList.add("fail"); }
      done++;
      await sleep(60);
    }
    busy = false;
    stopBtn.hidden = true;
    restoreBtn.disabled = false;
    return { done, failed, stopped: stopRequested };
  }

  async function apply() {
    if (!current || busy) return;
    const p = current;
    await rememberOriginals(p.changes);
    const edits = [];
    for (const c of p.changes) for (const k of Object.keys(c.next))
      if (c.next[k] !== c[k]) edits.push({ id: c.id, name: c.name, col: k, cents: c.next[k] });
    const r = await runEdits(edits, "Updating");
    const total = readRows().reduce((s, x) => s + (x[p.primary] || 0) * x.qty, 0);
    target.value = "";
    refresh();
    if (r.failed.length) say(`${r.failed.length} price${r.failed.length === 1 ? "" : "s"} didn't change:\n` + r.failed.slice(0, 5).join("\n") + (r.failed.length > 5 ? `\n…and ${r.failed.length - 5} more` : ""), "err");
    else if (r.stopped) say(`Stopped after ${r.done} change${r.done === 1 ? "" : "s"}. ${COLS[p.primary].word} total is now ${fmt(total)}.`, "err");
    else say(`Done. ${COLS[p.primary].word} total is now ${fmt(total)}.`, "ok");
  }

  async function restore() {
    if (busy) return;
    const saved = await loadOriginals();
    if (!Object.keys(saved).length) return say("Nothing to restore: no adjustment has been applied on this buylist.", "err");
    const rows = Object.fromEntries(readRows().map((r) => [r.id, r]));
    const edits = [];
    for (const [k, cents] of Object.entries(saved)) {
      const [c, ...rest] = k.split(":"); const id = rest.join(":");
      const r = rows[id];
      if (r && r[c] !== cents) edits.push({ id, name: r.name, col: c, cents });
    }
    const r = await runEdits(edits, "Restoring");
    if (!r.failed.length && !r.stopped) await forgetOriginals();
    refresh();
    if (r.failed.length) say(`${r.failed.length} price${r.failed.length === 1 ? "" : "s"} didn't restore:\n` + r.failed.slice(0, 5).join("\n"), "err");
    else say(edits.length ? `Restored ${edits.length} price${edits.length === 1 ? "" : "s"}.` : "Prices already match the originals.", "ok");
  }

  tab.addEventListener("click", () => { tab.hidden = true; panel.hidden = false; refresh(); target.focus(); });
  $(".x").addEventListener("click", () => { panel.hidden = true; tab.hidden = false; });
  root.querySelectorAll(".seg button").forEach((b) => b.addEventListener("click", () => setCol(b.dataset.col)));
  target.addEventListener("input", refresh);
  both.addEventListener("change", refresh);
  target.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter") apply(); });
  root.addEventListener("keydown", (e) => e.stopPropagation()); // keep the grid's shortcuts out of our panel
  applyBtn.addEventListener("click", apply);
  restoreBtn.addEventListener("click", restore);
  stopBtn.addEventListener("click", () => { stopRequested = true; });
  setCol(col);

  // Storepass is a single-page app: show the button only where price cells exist.
  let scheduled = false;
  const sync = () => {
    scheduled = false;
    const has = !!itemsRoot().querySelector(`button[aria-label^="${COLS.cash.label}"], button[aria-label^="${COLS.credit.label}"]`);
    if (has && !host.isConnected) document.body.appendChild(host);
    if (!has && host.isConnected && panel.hidden) host.remove();
    if (host.isConnected && !panel.hidden && !busy) refresh();
  };
  new MutationObserver((muts) => {
    if (busy || muts.every((m) => host.contains(m.target))) return;
    if (!scheduled) { scheduled = true; setTimeout(sync, 400); }
  }).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  sync();
})();
