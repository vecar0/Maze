"""
UI 모양 검사 (design/ui.md — U1~U5)
휴대폰·노트북 화면의 제목 → 도입 → 플레이 → 결과 각 상태에서 '보이는 요소 전체'를 훑어
도트 글꼴 · 둥근 모서리/흐린 그림자/이모지 없음 · 글자 크기 정수배 · 타자기 동작을 확인한다.
"""
import time

# 보이는 요소 전체 검사 (브라우저 안에서 실행)
SCAN = r"""(()=>{
  const BASE={Galmuri11:12, Galmuri14:15, Galmuri9:10};
  const bad={font:[], radius:[], blur:[], emoji:[], size:[]};
  const effZoom=el=>{ let z=1; for(let e=el;e&&e.nodeType===1;e=e.parentElement){ const v=parseFloat(getComputedStyle(e).zoom); if(v&&isFinite(v)) z*=v; } return z; };
  const blurOf=v=>{ if(!v||v==='none') return 0; let m=0;
    for(const part of v.split(/,(?![^(]*\))/)){ const n=part.replace(/rgba?\([^)]*\)/g,'').trim().split(/\s+/).filter(x=>x && x!=='inset').map(parseFloat).filter(x=>!isNaN(x));
      if(n.length>=3) m=Math.max(m,Math.abs(n[2])); } return m; };
  const vis=el=>{ const r=el.getBoundingClientRect(); if(r.width<1||r.height<1) return false;
    for(let e=el;e&&e.nodeType===1;e=e.parentElement){ const cs=getComputedStyle(e); if(cs.display==='none'||cs.visibility==='hidden'||+cs.opacity===0) return false; } return true; };
  const label=el=>el.id?'#'+el.id:(el.className&&typeof el.className==='string'?'.'+el.className.split(' ')[0]:el.tagName.toLowerCase());
  let n=0;
  for(const el of document.querySelectorAll('body *')){
    if(['SCRIPT','STYLE','CANVAS','IMG','BR'].includes(el.tagName) || !vis(el)) continue;
    n++;
    const cs=getComputedStyle(el);
    if(parseFloat(cs.borderTopLeftRadius)>0||parseFloat(cs.borderBottomRightRadius)>0) bad.radius.push(label(el));
    if(blurOf(cs.boxShadow)>0||blurOf(cs.textShadow)>0) bad.blur.push(label(el));
    const own=[...el.childNodes].filter(c=>c.nodeType===3).map(c=>c.textContent).join('').trim();
    if(!own) continue;
    // ▶▼◀■□ 는 도트 글꼴에 들어 있어 도트로 그려진다 (U1b 가 확인) — 그 밖의 그림 문자만 이모지로 본다
    if(/\p{Extended_Pictographic}/u.test(own.replace(/[▶▼◀■□▌]/g,''))) bad.emoji.push(label(el)+':'+own.slice(0,6));
    const fam=cs.fontFamily.split(',')[0].replace(/["']/g,'').trim();
    if(!(fam in BASE)){ bad.font.push(label(el)+':'+fam); continue; }
    const px=parseFloat(cs.fontSize)*effZoom(el)/ (parseFloat(getComputedStyle(document.documentElement).zoom)||1);
    if(Math.abs(px/BASE[fam]-Math.round(px/BASE[fam]))>0.01) bad.size.push(label(el)+':'+fam+' '+px.toFixed(1)+'px');
  }
  return {n, bad, fonts:['12px Galmuri11','bold 12px Galmuri11','15px Galmuri14','10px Galmuri9'].map(f=>document.fonts.check(f))};
})()"""


def look_tests(browser, url, seeded_random, out_dir):
    R = []
    ok = lambda name, cond, detail='': R.append({'name': name, 'ok': bool(cond), 'detail': str(detail)})
    logs = []
    agg = {k: set() for k in ('font', 'radius', 'blur', 'emoji', 'size')}
    scanned, fonts_ok = 0, True

    def page_at(w, h, touch=False, reduce=False):
        ctx = browser.new_context(viewport={'width': w, 'height': h}, is_mobile=touch, has_touch=touch,
                                  device_scale_factor=2 if touch else 1, reduced_motion='reduce' if reduce else 'no-preference')
        pg = ctx.new_page()
        pg.on('pageerror', lambda e: logs.append(f'{w}x{h} pageerror: {e}'))
        pg.on('console', lambda m: m.type in ('error', 'warning') and logs.append(f'{w}x{h} {m.type}: {m.text}'))
        pg.add_init_script(seeded_random)
        pg.goto(url)
        pg.wait_for_function("document.getElementById('startBtn').textContent==='시작'", timeout=20000)
        pg.evaluate("document.fonts.ready")
        return ctx, pg

    def scan(pg, tag):
        nonlocal scanned, fonts_ok
        r = pg.evaluate(SCAN); scanned += r['n']; fonts_ok &= all(r['fonts'])
        for k, v in r['bad'].items():
            for x in v: agg[k].add(f'{tag} {x}')

    for (w, h, touch) in [(390, 844, True), (1366, 768, False)]:
        ctx, pg = page_at(w, h, touch)
        tag = '폰' if touch else '노트북'
        scan(pg, tag + '/제목')
        pg.evaluate("playIntro()"); time.sleep(1.2); scan(pg, tag + '/도입')
        pg.evaluate("introEnd()"); time.sleep(0.3)
        pg.evaluate("monster.state='dormant'; monster.x=-1e6; toast('괴물의 미궁에 들어왔다'); showBanner('공주를 구출하라','한 칸 채울 때마다 괴물이 달려온다');")
        time.sleep(0.5); scan(pg, tag + '/플레이')
        pg.evaluate("tipReset(); tipSeen.move=true; toastLeft=0; document.getElementById('banner').classList.remove('show'); player.bow=true; player.ammo=2;")
        time.sleep(0.4); scan(pg, tag + '/힌트')
        pg.evaluate("""localStorage.setItem('maze_lb_v1', JSON.stringify([{n:'AAA',t:99,d:1},{n:'BBB',t:120,d:2}]));
            monster.state='dormant'; phase='escape'; exitOpen=true; player.key=true; player.frags=4; runTime=50;
            hostage.rescued=true; hostage.following=true; const [x,y]=tw(exitT[0],exitT[1]); player.x=x; player.y=y;""")
        time.sleep(0.5); scan(pg, tag + '/결과')
        pg.screenshot(path=str(out_dir / f'look_{tag}_result.png'))
        ctx.close()

    fmt = lambda k: ', '.join(sorted(agg[k])[:4]) or '0'
    ok('U1 모든 UI 글자가 갈무리 도트 글꼴 (대체 글꼴로 떨어진 요소 0 · 4종 로드됨)', not agg['font'] and fonts_ok,
       f'검사한 요소 {scanned}개 · 다른 글꼴 {fmt("font")} · 로드 {fonts_ok}')
    ok('U2 둥근 모서리 0 · 흐린 그림자 0 · 이모지 0 (휴대폰·노트북 × 제목/도입/플레이/힌트/결과)',
       not agg['radius'] and not agg['blur'] and not agg['emoji'],
       f'둥근 {fmt("radius")} · 흐림 {fmt("blur")} · 이모지 {fmt("emoji")}')
    ok('U3 글자 크기가 글꼴 기준 크기(12·15·10px)의 정수배 (노트북 확대 포함)', not agg['size'], fmt('size'))

    # U5 도입 대사 타자기
    ctx, pg = page_at(390, 844, True)
    pg.evaluate("playIntro()")
    pg.wait_for_function("document.getElementById('introLine').classList.contains('typing')", timeout=3000)
    part = pg.evaluate("document.getElementById('introLine').textContent")
    full = pg.evaluate("INTRO[0].t")
    pg.evaluate("introNext()")
    after1 = pg.evaluate("[document.getElementById('introLine').textContent, introI, introTyping()]")
    pg.evaluate("introNext()"); time.sleep(0.25)
    after2 = pg.evaluate("introI")
    ctx.close()
    ctx, pg = page_at(390, 844, True, reduce=True)
    pg.evaluate("playIntro()"); time.sleep(0.4)
    red = pg.evaluate("[document.getElementById('introLine').textContent, introTyping()]")
    ctx.close()
    ok('U5 도입 대사: 한 글자씩 → 누르면 전체 표시 → 한 번 더 누르면 다음 문장 · 움직임 줄이기 설정이면 바로 전체',
       len(part) < len(full) and after1[0] == full and after1[1] == 0 and after1[2] is False and after2 == 1
       and red[0] == full and red[1] is False,
       f'치는 중 "{part}" → "{after1[0]}" (문장 {after1[1]}) → 문장 {after2} · 줄이기 "{red[0]}"')
    ok('U0 모양 검사 동안 콘솔 에러·경고 0', not logs, ' | '.join(logs[:3]))
    return R
