"use strict";

const $ = (id) => document.getElementById(id);

const store = {
  get(key, fallback) {
    try {
      const value = localStorage.getItem("fa." + key);
      return value === null ? fallback : JSON.parse(value);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem("fa." + key, JSON.stringify(value));
    } catch {}
  },
};

const known = new Set(store.get("known", []));
const state = {
  skill: store.get("skill", 300),
  share: store.get("share", 10),
  onlyProfit: store.get("onlyProfit", true),
  onlyKnown: false,
  query: "",
  sort: store.get("sort", "daily"),
  dir: store.get("dir", -1),
};
let data = null;
let rows = [];
let scan = null;

const HTML_ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
const esc = (text) => String(text).replace(/[&<>"]/g, (c) => HTML_ESCAPES[c]);
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const dash = (value, format) => (value === null ? "–" : format(value));

function money(copper) {
  if (copper === null || copper === undefined || Number.isNaN(copper)) return "–";
  const sign = copper < 0 ? "-" : "";
  const c = Math.round(Math.abs(copper));
  const g = Math.floor(c / 10000);
  const s = Math.floor((c % 10000) / 100);
  if (g >= 100) return `${sign}${g.toLocaleString()}g`;
  if (g > 0) return `${sign}${g}g ${s}s`;
  if (s > 0) return `${sign}${s}s ${c % 100}c`;
  return `${sign}${c}c`;
}

function coin(copper, signed = false) {
  const tone = signed && copper > 0 ? " pos" : signed && copper < 0 ? " neg" : "";
  return `<span class="g${tone}">${money(copper)}</span>`;
}

// Addon export: AP1^t=<unix>^r=<name>~<itemID>;...^p=<id>:<copper>,...^a=...^v=...
// p = the addon's own scan, a = Auctionator's last seen price, v = vendor prices.
function parseScan(text) {
  const [magic, ...sections] = String(text || "").trim().split("^");
  if (magic !== "AP1" && magic !== "FA1") {
    throw new Error("That does not look like an AlchProfit export (it should start with AP1).");
  }
  const result = { t: 0, recipes: [], p: {}, a: {}, v: {} };
  for (const section of sections) {
    const eq = section.indexOf("=");
    const key = section.slice(0, eq);
    const value = section.slice(eq + 1);
    if (key === "t") {
      result.t = Number(value) || 0;
    } else if (key === "r") {
      for (const entry of value.split(";")) {
        const tilde = entry.lastIndexOf("~");
        if (tilde > 0) {
          result.recipes.push({ name: entry.slice(0, tilde).trim(), out: Number(entry.slice(tilde + 1)) });
        }
      }
    } else if (key === "p" || key === "a" || key === "v") {
      for (const pair of value.split(",")) {
        const [id, price] = pair.split(":").map(Number);
        if (price > 0) result[key][id] = price;
      }
    }
  }
  result.count = Object.keys(result.p).length + Object.keys(result.a).length;
  if (!result.count && !result.recipes.length) {
    throw new Error("The export has no prices or recipes in it. Run Scan all first.");
  }
  return result;
}

function scannedPrice(id) {
  return scan ? scan.p[id] ?? scan.a[id] : undefined;
}

function tickKnownFromScan(exported) {
  let matched = 0;
  for (const entry of exported.recipes) {
    let found = data.recipes.filter((r) => (r.spell || r.name) === entry.name);
    if (found.length > 1) found = found.filter((r) => r.itemId === entry.out);
    if (!found.length) {
      found = data.recipes.filter((r) => r.itemId === entry.out);
      if (found.length !== 1) found = [];
    }
    for (const recipe of found) {
      known.add(recipe.key);
      matched++;
    }
  }
  store.set("known", [...known]);
  return matched;
}

function buildRow(recipe) {
  const row = {
    recipe,
    key: recipe.key,
    name: recipe.key,
    skill: recipe.skill,
    known: known.has(recipe.key),
    transmute: (recipe.spell || "").startsWith("Transmute"),
    cost: null,
    sell: null,
    profit: null,
    margin: null,
    sold: recipe.sell ? recipe.sell.sold : null,
    listed: recipe.sell ? recipe.sell.listed : null,
    crafts: null,
    daily: null,
    recipeCost: recipe.recipe ? scannedPrice(recipe.recipe.id) ?? recipe.recipe.lowest : null,
    breakeven: null,
    payback: null,
  };

  const reagentPrice = (reagent) =>
    (reagent.vendor ? scan?.v[reagent.id] : scannedPrice(reagent.id)) ?? reagent.price;
  if (recipe.reagents.length && recipe.reagents.every((x) => reagentPrice(x) !== null)) {
    row.cost = recipe.reagents.reduce((sum, x) => sum + x.qty * reagentPrice(x), 0);
  }

  const unitPrice = scannedPrice(recipe.itemId) ?? recipe.sell?.market ?? null;
  if (unitPrice !== null) row.sell = unitPrice * recipe.yield;

  if (row.cost !== null && row.sell !== null) {
    row.profit = row.sell * (1 - data.ahCut) - row.cost;
    row.margin = row.cost > 0 ? row.profit / row.cost : null;
    const craftsPerDay = ((row.sold || 0) * state.share) / 100 / recipe.yield;
    row.crafts = row.transmute ? Math.min(1, Math.ceil(craftsPerDay)) : craftsPerDay;
    row.daily = row.profit * row.crafts;
    if (row.recipeCost !== null && row.profit > 0) {
      row.breakeven = Math.ceil(row.recipeCost / row.profit);
      row.payback = row.daily > 0 ? row.recipeCost / row.daily : null;
    }
  }
  return row;
}

const craftable = (row) => row.profit > 0 && (row.skill === null || row.skill <= state.skill);
const reagentList = (recipe) =>
  recipe.reagents.map((x) => (x.qty > 1 ? `${x.qty}× ` : "") + esc(x.name)).join(", ");

function tags(row) {
  const sell = row.recipe.sell;
  let html = "";
  if (row.transmute) html += '<span class="tag info">cooldown</span>';
  if (!sell) return html;
  if (sell.sold && sell.listed > 3 * sell.sold) {
    html += '<span class="tag warn" title="More than 3 days of stock listed">oversupplied</span>';
  }
  if (sell.chg === null) {
    html += '<span class="tag warn" title="Less than a day of price history">new data</span>';
  } else if (sell.chg >= 50) {
    html += `<span class="tag warn" title="Price up ${Math.round(sell.chg)}% in 24h">price spike</span>`;
  }
  return html;
}

function planItem(title, amount, detail) {
  return `<li><div class="row1"><span>${title}</span>${amount}</div><div class="row2">${detail}</div></li>`;
}

function renderPlan(id, list, toItem, emptyText) {
  $(id).innerHTML = list.length ? list.map(toItem).join("") : `<li class="empty">${emptyText}</li>`;
}

function renderPlans() {
  const byDaily = (a, b) => b.daily - a.daily;
  const candidates = rows.filter((row) => craftable(row) && row.daily > 0);

  renderPlan(
    "planMake",
    candidates.filter((row) => row.known).sort(byDaily).slice(0, 8),
    (row) => {
      const n = Math.max(1, Math.round(row.crafts));
      return planItem(
        `${n}× ${esc(row.name)}`,
        coin(row.profit * n, true),
        `${money(row.cost * n)} in mats · ${money(row.profit)} each · ${reagentList(row.recipe)}`
      );
    },
    known.size
      ? "Nothing you know is profitable right now."
      : "Tick the recipes you know in the table below and your best crafts show up here."
  );

  renderPlan(
    "planBuy",
    candidates
      .filter((row) => !row.known && row.recipeCost !== null && row.payback <= 14)
      .sort(byDaily)
      .slice(0, 6),
    (row) => {
      const days = row.payback < 1 ? "under a day" : `about ${plural(Math.ceil(row.payback), "day")}`;
      return planItem(
        esc(row.name),
        coin(row.recipeCost),
        `${money(row.profit)} per craft · pays off after ${plural(row.breakeven, "craft")}, ${days}` +
          ` · ${row.recipe.recipe.listed} listed`
      );
    },
    "No unowned recipe on the auction house pays for itself right now."
  );

  renderPlan(
    "planOther",
    candidates.filter((row) => !row.known && row.recipeCost === null).sort(byDaily).slice(0, 6),
    (row) =>
      planItem(
        esc(row.name),
        coin(row.profit, true),
        `${esc(row.recipe.note || "Check your trainer or the favor vendor")}` +
          ` · about ${Math.round(row.sold || 0)} sold/day`
      ),
    "Nothing here."
  );
}

function compareRows(a, b) {
  const key = state.sort;
  if (key === "name") return state.dir * a.name.localeCompare(b.name);
  const x = key === "known" ? Number(a.known) : a[key];
  const y = key === "known" ? Number(b.known) : b[key];
  if (x === null || y === null) {
    if (x === y) return a.name.localeCompare(b.name);
    return x === null ? 1 : -1;
  }
  return state.dir * (x - y) || a.name.localeCompare(b.name);
}

function tableRow(row) {
  const { recipe } = row;
  const makes = [recipe.spell ? `→ ${esc(recipe.name)}` : "", recipe.yield > 1 ? `×${recipe.yield}` : ""]
    .filter(Boolean)
    .join(" ");
  const recipeCell =
    row.recipeCost !== null
      ? coin(row.recipeCost)
      : `<span class="mats" title="${esc(recipe.note || "Not listed on the auction house")}">${
          recipe.note ? "favor" : "–"
        }</span>`;
  const cells = [
    `<input type="checkbox" data-key="${esc(row.key)}"${row.known ? " checked" : ""} aria-label="I know ${esc(row.name)}">`,
    `<div>${esc(row.name)}${makes ? ` <span class="mats">${makes}</span>` : ""}${tags(row)}</div>` +
      `<div class="mats">${reagentList(recipe)}</div>`,
    dash(row.skill, String),
    coin(row.cost),
    coin(row.sell),
    coin(row.profit, true),
    dash(row.margin, (m) => `${Math.round(m * 100)}%`),
    dash(row.sold, (n) => Math.round(n).toLocaleString()),
    dash(row.listed, (n) => n.toLocaleString()),
    coin(row.daily, true),
    recipeCell,
    dash(row.breakeven, (n) => n.toLocaleString()),
  ];
  return `<tr class="${row.known ? "known" : ""}">${cells.map((c) => `<td>${c}</td>`).join("")}</tr>`;
}

function renderTable() {
  const query = state.query.trim().toLowerCase();
  const visible = rows
    .filter((row) => {
      if (state.onlyProfit && !(row.profit > 0) && !row.known) return false;
      if (state.onlyKnown && !row.known) return false;
      if (row.skill !== null && row.skill > state.skill) return false;
      const haystack = `${row.name} ${row.recipe.name} ${reagentList(row.recipe)}`.toLowerCase();
      return !query || haystack.includes(query);
    })
    .sort(compareRows);

  $("rows").innerHTML = visible.map(tableRow).join("");
  $("count").textContent = `${visible.length} of ${rows.length} recipes · ${known.size} known`;
  for (const th of document.querySelectorAll("th")) {
    th.classList.toggle("sorted", th.dataset.k === state.sort);
  }
}

function render() {
  rows = data.recipes.map(buildRow);
  renderPlans();
  renderTable();
}

function renderHeader() {
  const scanTime = /(\d{4}-\d{2}-\d{2} \d{1,2}:\d{2}) US Central/.exec(data.scan);
  const hours = (Date.now() - new Date(data.generated).getTime()) / 36e5;
  const age = hours < 1 ? "under an hour ago" : `${plural(Math.round(hours), "hour")} ago`;
  $("scan").innerHTML =
    `WoW Forever · US PvP · Horde · auction scan ${esc(scanTime ? `${scanTime[1]} Central` : "time unknown")}` +
    ` · pulled ${hours > 6 ? `<span class="stale">${age} (stale: run the update)</span>` : age}`;
}

function renderScanStatus() {
  if (!scan) {
    $("scanStatus").textContent = "· off, using HordeLedger prices";
    return;
  }
  const hours = (Date.now() / 1000 - scan.t) / 3600;
  let age = "at an unknown time";
  if (scan.t) {
    if (hours < 1) age = `${Math.max(1, Math.round(hours * 60))} min ago`;
    else if (hours < 48) age = `${Math.round(hours)} h ago`;
    else age = `${Math.round(hours / 24)} days ago`;
  }
  $("scanStatus").innerHTML =
    `· on: ${scan.count} of your prices, scanned ` +
    (hours > 3 ? `<span class="stale">${age} (rescan)</span>` : age);
}

function applyScan() {
  const text = $("scanText").value.trim();
  try {
    scan = parseScan(text);
  } catch (error) {
    $("scanMsg").innerHTML = `<span class="stale">${esc(error.message)}</span>`;
    return;
  }
  store.set("scan", text);
  const matched = tickKnownFromScan(scan);
  $("scanMsg").textContent =
    `Loaded ${scan.count} prices and ticked ${matched} of ${scan.recipes.length} known recipes.`;
  renderScanStatus();
  render();
}

function clearScan() {
  scan = null;
  store.set("scan", "");
  $("scanText").value = "";
  $("scanMsg").textContent = "Back to HordeLedger prices. Your ticked recipes are kept.";
  renderScanStatus();
  render();
}

function bindControls() {
  $("skill").value = state.skill;
  $("share").value = state.share;
  $("onlyProfit").checked = state.onlyProfit;

  $("skill").addEventListener("input", (e) => {
    state.skill = Number(e.target.value) || 300;
    store.set("skill", state.skill);
    render();
  });
  $("share").addEventListener("input", (e) => {
    state.share = Math.min(100, Math.max(1, Number(e.target.value) || 10));
    store.set("share", state.share);
    render();
  });
  $("onlyProfit").addEventListener("change", (e) => {
    state.onlyProfit = e.target.checked;
    store.set("onlyProfit", state.onlyProfit);
    renderTable();
  });
  $("onlyKnown").addEventListener("change", (e) => {
    state.onlyKnown = e.target.checked;
    renderTable();
  });
  $("q").addEventListener("input", (e) => {
    state.query = e.target.value;
    renderTable();
  });
  $("rows").addEventListener("change", (e) => {
    const { key } = e.target.dataset;
    if (!key) return;
    if (e.target.checked) known.add(key);
    else known.delete(key);
    store.set("known", [...known]);
    render();
  });
  document.querySelector("thead").addEventListener("click", (e) => {
    const th = e.target.closest("th");
    if (!th) return;
    const key = th.dataset.k;
    if (state.sort === key) {
      state.dir = -state.dir;
    } else {
      state.sort = key;
      state.dir = key === "name" || key === "breakeven" ? 1 : -1;
    }
    store.set("sort", state.sort);
    store.set("dir", state.dir);
    renderTable();
  });
  $("scanApply").addEventListener("click", applyScan);
  $("scanClear").addEventListener("click", clearScan);
}

async function start() {
  bindControls();
  try {
    const response = await fetch(`data/data.json?t=${Date.now()}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    data = await response.json();
  } catch (error) {
    $("scan").innerHTML =
      `<span class="stale">Could not load data/data.json (${esc(error.message)}). Run scripts/update.py.</span>`;
    return;
  }
  const saved = store.get("scan", "");
  if (saved) {
    try {
      scan = parseScan(saved);
      $("scanText").value = saved;
    } catch {
      scan = null;
    }
  }
  renderHeader();
  renderScanStatus();
  render();
}

start();
