#!/usr/bin/env python3
"""Refresh data/data.json for the What To Brew site.

    python scripts/update.py            refresh prices and print today's summary
    python scripts/update.py --push     also commit and push data/
    python scripts/update.py --recipes  force a re-fetch of the recipe list
    python scripts/update.py --addon    rebuild the addon's item list
    python scripts/update.py --install  copy the addon into the game's AddOns folder
"""
import csv
import datetime as dt
import html
import io
import json
import re
import subprocess
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
RECIPES_FILE = DATA / "recipes.json"
OUT_FILE = DATA / "data.json"

CSV_URL = "https://hordeledger.com/data/market.csv"
RECIPES_URL = "https://wow-forever.gg/auction-house/crafting/alchemy/"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/130.0 Safari/537.36")
AH_CUT = 0.05
RECIPE_MAX_AGE_HOURS = 24

# From the wow.gg Merchant's Favor guide; not verified in game.
NOTES = {
    "Potion of Elemental Purging": "Favor vendor: 180 Merchant's Favor, Honored",
    "Caustic Smog Potion": "Favor vendor: 180 Merchant's Favor, Honored",
    "Elixir of the Whale": "Favor vendor: 180 Merchant's Favor, Honored",
}


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read().decode("utf-8", errors="replace")


def num(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


def copper(text):
    return sum(int(v) * {"g": 10000, "s": 100, "c": 1}[u]
               for v, u in re.findall(r"(\d+)\s*([gsc])", text))


def parse_recipes(page):
    recipes = []
    rows = re.finditer(r'<tr data-n="[^"]*"[^>]*data-k(?:="([^"]*)")?>(.*?)</tr>', page, re.S)
    for m in rows:
        skill, body = m.groups()
        make = re.search(r'ahc-make">(.*?)</td>', body, re.S)
        reag = re.search(r'ahc-reag">(.*?)</td>', body, re.S)
        if not make or not reag:
            continue
        make = make.group(1)
        item = re.search(r'href="/(?:auction-house/item|db/items)/(\d+)-[^"]*"[^>]*>([^<]+)</a>', make)
        if not item:
            continue
        spell = re.search(r'class="ahc-spell"[^>]*>([^<]+)</a>', make)
        yq = re.search(r'class="qty">(\d+)<', make)
        reagents = []
        for a in re.finditer(
                r'<a class="ahc-r( is-vendor)?" href="[^"]*/(\d+)-([^"/]*)/"[^>]*'
                r'aria-label="([^"]*)">(.*?)</a>', reag.group(1), re.S):
            vendor, rid, slug, label, inner = a.groups()
            label = html.unescape(label)
            q = re.search(r'class="qty">(\d+)<', inner)
            vm = re.search(r"vendor (.*) each", label)
            reagents.append({
                "id": int(rid),
                "name": label.split(":")[0].strip() or slug.replace("-", " ").title(),
                "qty": int(q.group(1)) if q else 1,
                "vendor": copper(vm.group(1)) if vendor and vm else None,
            })
        recipes.append({
            "name": html.unescape(item.group(2)).strip(),
            "itemId": int(item.group(1)),
            "spell": html.unescape(spell.group(1)).strip() if spell else None,
            "skill": int(skill) if skill and skill.isdigit() else None,
            "yield": int(yq.group(1)) if yq else 1,
            "reagents": reagents,
        })
    return recipes


def load_recipes(force):
    cached = json.loads(RECIPES_FILE.read_text("utf-8")) if RECIPES_FILE.exists() else None
    if cached and not force:
        age = dt.datetime.now(dt.timezone.utc) - dt.datetime.fromisoformat(cached["fetched"])
        if age < dt.timedelta(hours=RECIPE_MAX_AGE_HOURS):
            return cached
    try:
        recipes = parse_recipes(fetch(RECIPES_URL))
        if len(recipes) < 50:
            raise ValueError(f"only {len(recipes)} recipes parsed; page layout may have changed")
    except Exception as e:
        if cached:
            print(f"! recipe fetch failed ({e}); using cached list from {cached['fetched'][:10]}")
            return cached
        raise
    fresh = {"fetched": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
             "source": RECIPES_URL, "recipes": recipes}
    RECIPES_FILE.write_text(json.dumps(fresh, indent=1), "utf-8")
    return fresh


def norm(name):
    return re.sub(r"[^a-z0-9]", "", name.lower().replace("'s", ""))


def price_entry(row):
    return {"market": num(row["market_copper"]), "lowest": num(row["lowest_copper"]),
            "listed": int(num(row["listed"]) or 0), "sold": num(row["sold_per_day_est"]),
            "chg": num(row["change_24h_pct"])}


def build(force_recipes=False):
    DATA.mkdir(exist_ok=True)
    raw = fetch(CSV_URL)
    lines = raw.splitlines()
    scan = lines[0].lstrip("# ").strip() if lines and lines[0].startswith("#") else ""
    rows = list(csv.DictReader(io.StringIO("\n".join(l for l in lines if not l.startswith("#")))))
    if len(rows) < 500:
        raise SystemExit(f"market CSV looks wrong ({len(rows)} rows); not writing anything")
    by_id = {int(r["id"]): r for r in rows}
    recipe_items = {norm(r["name"].split(":", 1)[1]): r for r in rows
                    if r["category"] == "Recipe" and r["name"].lower().startswith("recipe:")}

    cache = load_recipes(force_recipes)
    out, seen = [], {}
    for rc in cache["recipes"]:
        key = rc["spell"] or rc["name"]
        if key in seen:
            key = f"{key} ({rc['skill']})"
        seen[key] = True
        reagents = []
        for rg in rc["reagents"]:
            row = by_id.get(rg["id"])
            price = rg["vendor"] if rg["vendor"] is not None else (num(row["market_copper"]) if row else None)
            reagents.append({"id": rg["id"], "name": row["name"] if row else rg["name"],
                             "qty": rg["qty"], "price": price, "vendor": rg["vendor"] is not None})
        item = by_id.get(rc["itemId"])
        rrow = recipe_items.get(norm(rc["spell"] or "")) or recipe_items.get(norm(rc["name"]))
        out.append({
            "key": key, "name": rc["name"], "itemId": rc["itemId"], "spell": rc["spell"],
            "skill": rc["skill"], "yield": rc["yield"], "reagents": reagents,
            "sell": price_entry(item) if item else None,
            "recipe": dict(price_entry(rrow), id=int(rrow["id"]), name=rrow["name"]) if rrow else None,
            "note": NOTES.get(rc["name"]),
        })

    data = {
        "generated": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "scan": scan,
        "ahCut": AH_CUT,
        "sources": {"prices": "https://hordeledger.com/market/", "recipes": RECIPES_URL,
                    "recipesFetched": cache["fetched"]},
        "recipes": out,
    }
    OUT_FILE.write_text(json.dumps(data, separators=(",", ":")), "utf-8")
    return data


def economics(r, cut):
    if not r["sell"] or r["sell"]["market"] is None or any(x["price"] is None for x in r["reagents"]):
        return None
    cost = sum(x["qty"] * x["price"] for x in r["reagents"])
    profit = r["sell"]["market"] * r["yield"] * (1 - cut) - cost
    return cost, profit


def gold(c):
    return f"{c / 10000:,.2f}g"


def summary(data):
    rows = []
    for r in data["recipes"]:
        e = economics(r, data["ahCut"])
        if e and e[1] > 0:
            rows.append((e[1] * (r["sell"]["sold"] or 0) / r["yield"], r, *e))
    rows.sort(key=lambda t: -t[0])
    print(f"\n{data['scan']}")
    print(f"{'craft':38}{'mats':>10}{'profit':>10}{'sold/day':>10}{'recipe':>11}")
    for _, r, cost, profit in rows[:15]:
        rec = gold(r["recipe"]["lowest"]) if r["recipe"] and r["recipe"]["lowest"] else "not on AH"
        print(f"{r['key'][:37]:38}{gold(cost):>10}{gold(profit):>10}"
              f"{r['sell']['sold'] or 0:>10.0f}{rec:>11}")
    print(f"\n{len(rows)} of {len(data['recipes'])} recipes profitable after the "
          f"{data['ahCut']:.0%} auction house cut. Sorted by profit x estimated daily sales.")


ADDON_SRC = ROOT / "addon" / "WhatToBrew"
ADDON_DEST = Path(r"C:\Program Files (x86)\World of Warcraft\_forever_\Interface\AddOns\WhatToBrew")


def write_addon(data):
    ids = set()
    for r in data["recipes"]:
        ids.add(r["itemId"])
        ids.update(x["id"] for x in r["reagents"] if not x["vendor"])
        if r["recipe"]:
            ids.add(r["recipe"]["id"])
    ids = sorted(ids)
    body = "\n".join("    " + ", ".join(map(str, ids[i:i + 12])) + "," for i in range(0, len(ids), 12))
    lua = ADDON_SRC / "WhatToBrew.lua"
    block = f"-- SITE_ITEMS_BEGIN\nlocal SITE_ITEMS = {{\n{body}\n}}\n-- SITE_ITEMS_END"
    src, n = re.subn(r"-- SITE_ITEMS_BEGIN.*?-- SITE_ITEMS_END", lambda _: block,
                     lua.read_text("utf-8"), flags=re.S)
    if n != 1:
        raise SystemExit("SITE_ITEMS markers not found in addon/WhatToBrew/WhatToBrew.lua")
    lua.write_text(src, "utf-8", newline="\n")
    print(f"addon item list: {len(ids)} items")


def install_addon():
    if not ADDON_DEST.parent.exists():
        raise SystemExit(f"AddOns folder not found: {ADDON_DEST.parent}")
    ADDON_DEST.mkdir(exist_ok=True)
    for f in ADDON_SRC.iterdir():
        (ADDON_DEST / f.name).write_bytes(f.read_bytes())
    print(f"installed to {ADDON_DEST} (type /reload in game)")


def git(*args):
    return subprocess.run(["git", "-C", str(ROOT), *args], check=True)


def push(data):
    git("add", "data")
    if subprocess.run(["git", "-C", str(ROOT), "diff", "--cached", "--quiet"]).returncode == 0:
        print("no data changes to push")
        return
    stamp = re.search(r"\d{4}-\d{2}-\d{2} \d{1,2}:\d{2}", data["scan"])
    git("commit", "-q", "-m", f"chore: refresh prices ({stamp.group(0) if stamp else 'manual'})")
    git("pull", "-q", "--rebase")
    git("push", "-q")
    print("pushed")


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    d = build(force_recipes="--recipes" in sys.argv)
    summary(d)
    if "--addon" in sys.argv:
        write_addon(d)
    if "--install" in sys.argv:
        install_addon()
    if "--push" in sys.argv:
        push(d)
