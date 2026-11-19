# Forever Alchemy

What to brew today on the WoW Forever US PvP Horde auction house. Live at
https://zakpruitt.github.io/forever-alchemy/.

Tick the recipes you know and the page ranks what to craft from them, which recipes on the
auction house would pay for themselves, and which profitable ones come from somewhere else.
Ticks and settings stay in your browser's localStorage; there is no backend.

## Update prices

```
python scripts/update.py           # refresh data/data.json and print a summary
python scripts/update.py --push    # also commit and push (or double-click update.cmd)
python scripts/update.py --recipes # force a re-fetch of the recipe list
```

The `Refresh prices` GitHub Action runs the same script hourly and can be triggered by hand
from the Actions tab.

## Use your own auction scan

The page can price everything from your own auction house instead of HordeLedger. The
`addon/AlchProfit` addon scans the auction house and exports a line of text to paste into the
page's "Use my own auction scan" box. The paste also ticks every recipe you know.

1. Open your Alchemy window once, then the auction house.
2. `/alch`, press **Scan all**, wait for it to finish.
3. Press **Export**, Ctrl+C, paste into the page.

```
python scripts/update.py --addon     # rebuild the addon's item list from the recipe data
python scripts/update.py --install   # copy the addon into the game's AddOns folder
```

The pasted scan stays in your browser. Sales per day still come from HordeLedger.

## Data

- Prices: [HordeLedger](https://hordeledger.com/market/) market CSV, scanned hourly.
- Reagent lists: [wow-forever.gg](https://wow-forever.gg/auction-house/crafting/alchemy/), cached in
  `data/recipes.json` and re-fetched at most once a day. Its prices are Alliance from another
  realm and are not used.
- Profit is market price times yield, minus the 5% auction house cut and reagents at market price.

Fan-made; not affiliated with Blizzard Entertainment.
