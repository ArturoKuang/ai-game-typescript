Drop CC0 pixel font TTFs here to enable them:

  m5x7.ttf       — by Daniel Linssen, https://managore.itch.io/m5x7
  m6x11.ttf      — alternate by same author
  alagard.ttf    — by Hewett Tsoi (CC-BY)

The CSS @font-face in client/index.html points at /fonts/m5x7.ttf.
If the file is missing, the browser will fall back through:
  'IBM Plex Mono' → 'Courier Prime' → ui-monospace → system monospace

Phase 1 of the art-redesign-spec.md ships with the fallback stack and retires
Courier New. Drop m5x7.ttf in here to get the full pixel-font fidelity.
