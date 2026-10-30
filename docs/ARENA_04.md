# Arena 04

Adds two independent judges for the Arena 04 package: three-class pet trimap segmentation and conditional text generation. Existing package bindings and judges remain unchanged. Both public task ZIPs include their baseline notebook.

`trimap-iou` accepts `id,pet_rle,border_rle`, using one-based row-major RLE. It rejects overlapping masks and invalid/missing/duplicate IDs. Background is implicit. Intersections and unions are pooled across images, then the three class IoUs are averaged; border IoU is secondary.

`generation-chrf` accepts `id,prediction`. Each prediction has at most 1,000 Unicode code points. Scoring applies NFKC, lowercase and whitespace removal, then effective character n-gram orders 1–6 and beta=2. The best reference score is selected per sample and averaged. This is sentence chrF2 averaging, not corpus chrF. Secondary is normalized exact-reference matching.

`TaskStatement.maxSubmissionBytes` is optional and capped at 4,000,000 by package validation. Missing values retain the previous 3,000,000-byte limit. Arena 04 CV needs 4 MB for its 256x256 masks; NLP uses 3 MB. The same limit is shown to contestants and enforced server-side. Redis fallback decompression supports up to 4 MB.

Data/source/build tools are in `../statements/Arena_04/`. Public release manifest: `../statements/Arena_04/web_ready/release_20261030/handoff/package-config.json`. Truth objects remain private. PDFs and attribution are separate assets.

Checks: `npm test`, `npm run typecheck`, `npm run build`; `scripts/check-arena04-package.ts` compares exact local bytes and Python/web metric results; `scripts/qa-arena04-flow.ts` verifies four submissions and material access in an isolated Redis namespace; `scripts/verify-arena04-remote.ts` verifies every uploaded checksum and ZIP membership, then asserts all existing production rounds remain unchanged after staging. No paid GPU or production round is created for QA.

The repo is connected to Vercel production and Render service `olpai-arena` (`srv-dbi7v2dg1s2s73e8m740`) in the user-confirmed workspace `tea-d6fb6q9drdic739rrnf0`. Both deploy main automatically. Verify the exact release commit is READY/live on both; URLs are `https://olpai-mock-arena.vercel.app` and `https://olpai-arena.onrender.com`.
