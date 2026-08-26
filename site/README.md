# Website card contract

This folder contains the assets used to present Scratchpad on a host website.

- `card.html` contains one self-contained tool card.
- `card.css` contains the card's scoped visual design and responsive rules.
- The card root uses `data-module-card="scratchpad"` so its styles do not leak into the host page or other modules.

Future website modules can duplicate this folder, replace the module name and content, and keep the same two-file contract. The host loads both files from `modules/<module-name>/site/`.
