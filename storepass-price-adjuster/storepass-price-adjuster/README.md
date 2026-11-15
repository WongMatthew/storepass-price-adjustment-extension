# Storepass Buylist Price Adjuster (v2)

Scales every card's cash or credit price on a Storepass buylist by the same
percentage so the total matches what you actually paid.

## Install / update
1. Unzip this folder.
2. Open chrome://extensions and turn on Developer mode.
3. If v1 is installed, remove it. Click "Load unpacked" and pick this folder.

## Use
1. Open a buylist on storepass.co. Make sure "Rows per page" shows every item.
2. Click "Match amount paid" (bottom right).
3. Choose Cash or Credit, then type what you paid.
4. Optional: tick "Also change credit/cash prices by the same %".
5. Check the preview and click Apply. The extension clicks each price cell,
   types the new value and presses Enter. Rows turn green as they save.
6. Stop halts mid-run. Restore puts back the prices from before your first
   adjustment.

## Math
factor = amount paid / sum(price x qty) for the chosen column.
Each price is multiplied by the factor, rounded down to the cent, and the
leftover pennies go to the cards that lost the most to rounding, so the total
lands exactly on the amount paid. $0.00 cards stay at $0.00.
