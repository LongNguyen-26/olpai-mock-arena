"""Convert existing organizer labels into compact, private judge objects. No training."""
import gzip
import json
import sys
from pathlib import Path
root, out = Path(sys.argv[1]), Path(sys.argv[2])
sys.path.insert(0, str(root / '_runtime'))
import numpy as np
from PIL import Image
out.mkdir(parents=True, exist_ok=True)
for split in ['public', 'private']:
    manifest_path = (root/'contestant/Tac_vu_1/data/public/manifest.json' if split=='public'
                     else root/'organizer/private_inputs/Tac_vu_1/manifest.json')
    manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    rows = []
    for item in manifest:
        truth = np.array(Image.open(root/'organizer/labels/Tac_vu_1'/split/(item['id']+'.png')))
        masks = []
        for label in np.unique(truth):
            if label == 0:
                continue
            flat = (truth == label).ravel(order='F').astype(np.int8)
            transitions = np.flatnonzero(np.diff(np.concatenate(([0], flat, [0]))))
            masks.append(transitions.tolist())
        rows.append({**item, 'masks': masks})
    with gzip.open(out/f'cv-{split}.json.gz', 'wt', encoding='utf-8') as f:
        json.dump(rows, f, separators=(',', ':'))
    qa = json.loads((root/f'organizer/labels/Tac_vu_2/{split}.json').read_text(encoding='utf-8'))
    rows = [{k:r[k] for k in ['id','context','answers','is_impossible']} for r in qa]
    with gzip.open(out/f'qa-{split}.json.gz', 'wt', encoding='utf-8') as f:
        json.dump(rows, f, separators=(',', ':'), ensure_ascii=False)
    print(f'Prepared {split} judge data; no labels emitted.')
