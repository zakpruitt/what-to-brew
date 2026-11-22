# What To Brew

What to brew today on the WoW Forever auction house. Two parts, one name:

- **The site**, https://zakpruitt.github.io/what-to-brew/, ranks every Alchemy recipe by profit and
  tells you what to craft, which recipes are worth buying, and how many crafts pay them off.
- **The addon**, `addon/WhatToBrew`, is its in-game companion. It scans the auction house, reads
  the recipes you know, and exports both as a line of text you paste into the site.

Without the addon the site uses hourly US PvP Horde prices from HordeLedger and you tick your
recipes by hand. With it, prices are the ones on your own auction house and your recipes tick
themselves. Everything you paste or tick stays in your browser's localStorage; there is no backend.

## Use it

1. Install the addon with WoWUp (**Get Addons -> Install from URL** ->
   `https://github.com/zakpruitt/what-to-brew`), or unzip the
   [latest release](https://github.com/zakpruitt/what-to-brew/releases/latest) into
   `World of Warcraft/_forever_/Interface/AddOns/`.
2. In game, open your Alchemy window once, then the auction house.
3. Type `/brew`, press **Scan all** and wait for it to finish.
4. Press **Export**, Ctrl+C, and paste into "Use my own auction scan" on the site.

`/brew` on its own also works as a standalone profit window for the recipes you know.

Press **My herbs** in that window to judge what is in your bags: it lists what to brew because it
sells for more than the herbs it uses, and which herbs to just list raw. It needs a fresh **Scan**.

## Develop

```
python scripts/update.py            # refresh data/data.json and print a summary
python scripts/update.py --push     # also commit and push (or double-click update.cmd)
python scripts/update.py --recipes  # force a re-fetch of the recipe list
python scripts/update.py --addon    # rebuild the addon's item list from the recipe data
python scripts/update.py --install  # copy the addon into the game's AddOns folder
```

The `Refresh prices` GitHub Action runs the script hourly and can be triggered by hand from the
Actions tab. A push that touches `addon/` builds a new addon release; the version is the
`.toc` major.minor plus the run number. The site is plain HTML served by GitHub Pages from the repository root.

## Data

- Prices: [HordeLedger](https://hordeledger.com/market/) market CSV, scanned hourly. Sales per day
  always come from here, even with your own scan loaded.
- Reagent lists: [wow-forever.gg](https://wow-forever.gg/auction-house/crafting/alchemy/), cached in
  `data/recipes.json` and re-fetched at most once a day. Its prices are Alliance from another
  realm and are not used.
- Profit is price times yield, minus the 5% auction house cut and reagents at market price.

Fan-made; not affiliated with Blizzard Entertainment.
