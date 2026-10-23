"""
그림 검사 (기획서 v2 — D1)
걷기 그림 정리본(art/sprites)이 원본(art/sprites_raw)보다 윗몸 지글거림이 40% 이상 줄었고,
다리 부분은 원본 그대로(좌우 위치 보정만)이며, 게임(index.html)에 실제로 들어간 그림이 정리본과 같은지 본다.
"""
import sys, re, io, base64, pathlib
import numpy as np
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'tools'))
from steady_frames import SETS, load, upper_jitter, legs_same  # noqa: E402


def art_tests():
    R = []
    ok = lambda name, cond, detail='': R.append({'name': name, 'ok': bool(cond), 'detail': str(detail)})
    raw, cur = ROOT / 'art/sprites_raw', ROOT / 'art/sprites'
    html = (ROOT / 'index.html').read_text(encoding='utf-8')
    rows, legs_bad, embed_bad = [], [], []
    for name, (n, cuts) in SETS.items():
        for d in 'dsu':
            fr0 = [load(raw / f'{name}_{d}{i}.png') for i in range(n)]
            fr1 = [load(cur / f'{name}_{d}{i}.png') for i in range(n)]
            cut = int(fr0[0].shape[0] * cuts[d])
            j0, j1 = upper_jitter(fr0, cut), upper_jitter(fr1, cut)
            rows.append((f'{name}_{d}', j0, j1))
            if not legs_same(fr0, fr1, cut): legs_bad.append(f'{name}_{d}')
            for i in range(n):
                k = f'{name}_{d}{i}'
                m = re.search('"' + re.escape(k) + '":"data:image/png;base64,([^"]+)"', html)
                emb = np.array(Image.open(io.BytesIO(base64.b64decode(m.group(1)))).convert('RGBA')).astype(np.int32) if m else None
                if emb is None or emb.shape != fr1[i].shape or not (emb == fr1[i]).all(): embed_bad.append(k)
    worst = min(1 - j1 / max(1e-9, j0) for _, j0, j1 in rows)
    ok('D1 걷기 그림 윗몸 지글거림 40% 이상 감소 (사냥꾼·공주·괴물 × 3방향)', worst >= 0.40,
       ' · '.join(f'{k} {j0*100:.0f}→{j1*100:.0f}%' for k, j0, j1 in rows[:3]) + f' … 최소 감소 {worst*100:.0f}%')
    ok('D1b 다리 부분은 원본 그대로 (좌우 위치 보정만)', not legs_bad, ', '.join(legs_bad))
    ok('D1c 게임에 들어간 그림 = 정리본', not embed_bad, ', '.join(embed_bad[:4]))
    return R
