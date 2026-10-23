"""
걷기 그림 떨림 정리 (기획서 D)

문제: AI로 만든 걷기 그림은 장마다 따로 그려져서, 몸 위치를 맞춰도 머리·몸통 픽셀이 장마다 달라
      걸을 때 몸 전체가 지글거린다 (윗몸 픽셀의 22~52%가 장마다 다른 색).
방법: 손으로 그린 도트 걷기 그림처럼 만든다.
      - 윗몸(머리·몸통): 기준 장 1장을 쓰고, 장마다 위아래 흔들림(0 또는 1px)만 준다.
      - 아랫몸(다리): 각 장의 원래 그림을 그대로 쓴다 → 발 움직임은 원본과 같다.
        (원본이 장마다 좌우로 어긋나 있으면 다리를 몸 밑으로 옮겨 붙인다)
      경계 2줄은 원래 그림을 우선해 이음매가 튀지 않게 한다.

사용: python3 tools/steady_frames.py 원본폴더 결과폴더 [--report]
"""
import sys
from pathlib import Path
import numpy as np
from PIL import Image

# 이름: (장 수, {방향: 다리 시작 줄 비율})
SETS = {'hunter6': (6, {'d': 0.74, 's': 0.74, 'u': 0.74}),
        'maiden':  (4, {'d': 0.70, 's': 0.70, 'u': 0.70}),
        'beast':   (4, {'d': 0.62, 's': 0.62, 'u': 0.62})}


def load(p):
    return np.array(Image.open(p).convert('RGBA')).astype(np.int32)


def shift(a, dx, dy):
    H, W = a.shape[:2]; o = np.zeros_like(a)
    ys, yd = (slice(0, H - dy), slice(dy, H)) if dy >= 0 else (slice(-dy, H), slice(0, H + dy))
    xs, xd = (slice(0, W - dx), slice(dx, W)) if dx >= 0 else (slice(-dx, W), slice(0, W + dx))
    o[yd, xd] = a[ys, xs]; return o


def best_offset(ref, f, rows=0.55):
    H = ref.shape[0]; top = slice(0, int(H * rows)); best = None
    for dy in range(-2, 3):
        for dx in range(-2, 3):
            r = shift(ref, dx, dy)[top]; b = f[top]
            both = (r[..., 3] > 20) & (b[..., 3] > 20)
            if both.sum() < 30: continue
            sc = (np.abs(r[..., :3] - b[..., :3]).sum(-1)[both] > 60).mean() + 0.02 * (abs(dx) + abs(dy))
            if best is None or sc < best[0]: best = (sc, dx, dy)
    return best[1], best[2]


def upper_jitter(frames, cut):
    """윗몸 지글거림 = 이웃한 장끼리 위치를 맞춘 뒤 윗몸에서 눈에 띄게 색/모양이 다른 픽셀 비율"""
    tot = bad = 0
    for a, b in zip(frames, frames[1:] + frames[:1]):
        dx, dy = best_offset(a, b); r = shift(a, dx, dy)[:cut]; bb = b[:cut]
        anyo = (r[..., 3] > 20) | (bb[..., 3] > 20)
        diff = ((r[..., 3] > 20) != (bb[..., 3] > 20)) | (np.abs(r[..., :3] - bb[..., :3]).sum(-1) > 60)
        tot += anyo.sum(); bad += (diff & anyo).sum()
    return bad / max(1, tot)


def legs_same(orig, new, cut):
    """다리 부분이 원본과 같은가 (좌우 위치 보정만 허용)"""
    ref = orig[0]
    for a, b in zip(orig, new):
        dx, _ = best_offset(ref, a)
        if not (shift(a, -dx, 0)[cut + 2:] == b[cut + 2:]).all(): return False
    return True


def steady(frames, cut_ratio):
    H = frames[0].shape[0]; cut = int(H * cut_ratio); ref = frames[0]
    out = []
    for i, f in enumerate(frames):
        dx, dy = best_offset(ref, f)
        dy = 1 if dy > 0 else 0                 # 흔들림은 0 또는 1px 아래로만 (튀지 않게)
        r = shift(ref, 0, dy)
        f = shift(f, -dx, 0)                    # 원본이 좌우로 어긋나 있으면 다리를 몸 밑으로 옮긴다
        o = f.copy()
        o[:cut] = r[:cut]
        # 경계 2줄: 원래 그림이 있으면 원래 그림, 비어 있으면 기준 장
        for y in range(cut, min(H, cut + 2)):
            m = (f[y, :, 3] <= 20) & (r[y, :, 3] > 20)
            o[y][m] = r[y][m]
        out.append(o)
    return out, cut


def main(src, dst, report_only=False):
    src, dst = Path(src), Path(dst); dst.mkdir(parents=True, exist_ok=True)
    rows = []
    for name, (n, cuts) in SETS.items():
        for d in 'dsu':
            files = [src / f'{name}_{d}{i}.png' for i in range(n)]
            fr = [load(f) for f in files]
            st, cut = steady(fr, cuts[d])
            j0, j1 = upper_jitter(fr, cut), upper_jitter(st, cut)
            ls = legs_same(fr, st, cut)
            rows.append(dict(name=name, d=d, before=j0, after=j1, legs_same=ls))
            print(f'{name}_{d}: 윗몸 지글거림 {j0*100:.0f}% → {j1*100:.0f}% · 다리 원본 그대로 {ls}')
            if not report_only:
                for f, a in zip(files, st):
                    Image.fromarray(a.astype(np.uint8), 'RGBA').save(dst / f.name)
    return rows


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2], '--report' in sys.argv)
