"""
UI 글꼴·아이콘을 index.html 안에 넣는다 (design/ui.md).
- 갈무리 글꼴(OFL, art/fonts)에서 index.html 에 실제로 쓰인 글자만 남겨 woff2 로 내장 → 오프라인에서도 동작.
- 상태줄 도트 아이콘(8×8)을 SVG 마스크로 만든다.
문구를 바꾸면 다시 실행: python3 tools/build_ui_assets.py
"""
import re, io, base64, pathlib, urllib.parse
from fontTools import subset
from fontTools.ttLib import TTFont

ROOT = pathlib.Path(__file__).resolve().parent.parent
HTML = ROOT / 'index.html'
FONTS = [('Galmuri11', 400, 'Galmuri11.ttf'), ('Galmuri11', 700, 'Galmuri11-Bold.ttf'),
         ('Galmuri14', 400, 'Galmuri14.ttf'), ('Galmuri9', 400, 'Galmuri9.ttf')]
EXTRA = ''.join(chr(i) for i in range(32, 127)) + '▶▼◀●○▌!?'

ICONS = {
    'sound':   ['...#....', '..##..#.', '####...#', '####.#.#', '####.#.#', '####...#', '..##..#.', '...#....'],
    'mute':    ['...#....', '..##....', '####.#.#', '####..#.', '####.#.#', '####....', '..##....', '...#....'],
    'full':    ['###..###', '#......#', '#......#', '........', '........', '#......#', '#......#', '###..###'],
    'unfull':  ['..#..#..', '..#..#..', '###..###', '........', '........', '###..###', '..#..#..', '..#..#..'],
    'restart': ['..####..', '.#....##', '#....###', '#.......', '#.......', '#......#', '.#....#.', '..####..'],
}


def used_chars(html):
    body = re.sub(r'const IMG_SRC = \{.*?\};', '', html, flags=re.S)
    body = re.sub(r'/\*FONTS\*/.*?/\*/FONTS\*/', '', body, flags=re.S)
    body = re.sub(r'/\*.*?\*/', '', body, flags=re.S)              # CSS·JS 블록 주석 (화면에 안 나옴)
    body = re.sub(r'<!--.*?-->', '', body, flags=re.S)
    body = re.sub(r'(?<![:\'"\w\\])//[^\n]*', '', body)             # JS 줄 주석 (http:// 같은 문자열은 남김)
    return ''.join(sorted(set(c for c in body if ord(c) > 126) | set(EXTRA)))


def woff2(path, text):
    opts = subset.Options(); opts.flavor = 'woff2'; opts.layout_features = ['*']
    f = TTFont(path); s = subset.Subsetter(opts); s.populate(text=text); s.subset(f)
    buf = io.BytesIO(); f.flavor = 'woff2'; f.save(buf); return buf.getvalue()


def icon(rows):
    d = ''.join(f'M{x} {y}h1v1h-1z' for y, r in enumerate(rows) for x, c in enumerate(r) if c == '#')
    svg = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8" shape-rendering="crispEdges"><path d="{d}"/></svg>'
    return 'url("data:image/svg+xml,' + urllib.parse.quote(svg) + '")'


def build():
    html = HTML.read_text(encoding='utf-8')
    text = used_chars(html)
    css, total = [], 0
    for fam, wt, fn in FONTS:
        data = woff2(ROOT / 'art/fonts' / fn, text); total += len(data)
        css.append(f"@font-face{{font-family:'{fam}';font-weight:{wt};font-display:block;"
                   f"src:url(data:font/woff2;base64,{base64.b64encode(data).decode()}) format('woff2');}}")
    css.append(':root{' + ''.join(f'--ico-{k}:{icon(v)};' for k, v in ICONS.items()) + '}')
    block = '/*FONTS*/\n  /* 갈무리 글꼴 (OFL, art/fonts) — tools/build_ui_assets.py 가 쓰인 글자만 남겨 넣음 */\n  ' + '\n  '.join(css) + '\n  /*/FONTS*/'
    html2 = re.sub(r'/\*FONTS\*/.*?/\*/FONTS\*/', lambda m: block, html, count=1, flags=re.S)
    assert html2 != html or block in html, 'FONTS 표시를 찾지 못함'
    HTML.write_text(html2, encoding='utf-8')
    print(f'글자 {len(text)}자 · 글꼴 {total/1024:.0f}KB 내장')
    return text


if __name__ == '__main__':
    build()
