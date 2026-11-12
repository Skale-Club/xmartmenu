# Menu image framing

Owner decision, 2026-11-12: give every Aurora dish more surrounding scene, especially on the left and right, so the complete serving is understandable in menu thumbnails without clipping. Keep the existing evening bar identity: charcoal stone, warm side light, copper and petroleum teal.

## Image authoring

- Use a square master with the entire plate, bowl, board, glass or bottle visible.
- Aim for roughly 15–18% scene margin on each side of a plate or board. Keep serving vessels within approximately the central two thirds of the width and the central half of the height.
- Drinks need vertical clearance as well: include the garnish and base, with subject height around 58% of the master.
- Extend the natural scene instead of adding borders, flat padding or stretching food. Preserve ingredients and serving identity.
- Check actual thumbnail crops before publishing: 120×120, a taller 120×160 mobile card, and 156×117 featured imagery with the current 18% vertical object position. These are reference cases, not a guarantee for arbitrarily tall cards or full-screen feed crops.

## Aurora draft batch

The 20 wider-framed masters are in `output/imagegen/aurora-roomy/`; `review.html` compares previous and new thumbnails. `prompt.txt` records the exact built-in image_gen prompt; `manifest.json` records the assets. The sandwich starts from the new bar-style preview; the other 19 start from their existing branded menu image.

Published on 2026-11-12 after owner approval. The 20 images were converted with the shared photo profile (1200px, 100KiB maximum), uploaded under immutable R2 keys, and assigned to existing products and primary image media in one production PostgreSQL transaction. The final set totals 1,844,912 bytes, down from the initial 5,333,552-byte WebP set. Other product fields and AR models were checked unchanged.

The public menu returned all 20 new lightweight URLs. Measured 256px mobile thumbnails range from 7,084 to 12,070 bytes. Initial publication was also checked on the actual sandwich card at mobile (375px) and desktop (1280px) viewports. Evidence and exact URLs are in `live-verification-lightweight.json`, `publication-plan-lightweight.json` and `publication-result-lightweight.json` under the draft directory. Old local source files and R2 objects are retained; `production-before.json` and `production-before-lightweight.json` keep previous image/media references for rollback. No application deploy was needed for this restaurant data change.
