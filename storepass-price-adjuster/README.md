# Storepass Buylist Price Adjuster

Scales every card's buy price on a Storepass buylist submission by the same
percentage so the submission total matches what you actually paid.

## Install
1. Unzip this folder.
2. Open chrome://extensions and turn on Developer mode (top right).
3. Click "Load unpacked" and pick the storepass-price-adjuster folder.

## Use
1. Open a buylist submission on storepass.co.
2. Click "Match amount paid" (bottom right).
3. Type what you paid. The panel previews each card's old and new price and
   the percentage change.
4. Click "Apply". Wait for Storepass to show "Saved!".
5. "Restore" puts back the prices from before your first adjustment.

## How the math works
factor = amount paid / (sum of price x quantity)
Each unit price is multiplied by the factor, rounded down to the cent, and the
leftover pennies go to the cards that lost the most to rounding, so the total
lands exactly on the amount paid. Cash and credit price boxes both work.
