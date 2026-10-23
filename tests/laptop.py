"""
노트북 부스 운영 테스트 (기획서 v2 — C2 · E · F · H)
가로 화면(1366×768 · 1920×1080 · 1280×720)에서 화면 맞춤 · 전체화면 · 키보드만으로 전체 진행 ·
처음 화면 복귀 · 힌트와 알림/배너 겹침 · 진동을 확인한다. 게임 시계는 진짜 requestAnimationFrame.
"""
import time

SIZES = [(1366, 768), (1920, 1080), (1280, 720)]


def laptop_tests(browser, url, seeded_random, out_dir):
    R = []
    ok = lambda name, cond, detail='': R.append({'name': name, 'ok': bool(cond), 'detail': str(detail)})
    logs = []

    def page_at(w, h):
        ctx = browser.new_context(viewport={'width': w, 'height': h})
        pg = ctx.new_page()
        pg.on('pageerror', lambda e: logs.append(f'{w}x{h} pageerror: {e}'))
        pg.on('console', lambda m: m.type in ('error', 'warning') and logs.append(f'{w}x{h} {m.type}: {m.text}'))
        pg.add_init_script(seeded_random)
        pg.goto(url)
        pg.wait_for_function("document.getElementById('startBtn').textContent==='시작'", timeout=20000)
        return ctx, pg

    def frames(pg, n=4):
        pg.evaluate(f"new Promise(r=>{{let k={n};const f=()=>--k?requestAnimationFrame(f):r();requestAnimationFrame(f);}})")

    # ── H1 · H2 · H5 화면 맞춤 · 배치 · 성능 ──
    h1, h2, h5 = [], [], []
    for (w, h) in SIZES:
        ctx, pg = page_at(w, h)
        pg.keyboard.press('Enter'); time.sleep(0.2); pg.keyboard.press('Escape'); frames(pg, 3)
        m = pg.evaluate("""(()=>{ const r=cv.getBoundingClientRect(), d=document.documentElement;
            const vis=e=>{const el=document.querySelector(e); return !!el && getComputedStyle(el).display!=='none' && el.getBoundingClientRect().width>0;};
            return {wide:WIDE, sc:PXSCALE, VW, VH, cw:r.width, ch:r.height, x:r.left, y:r.top, sw:d.scrollWidth, sh:d.scrollHeight,
                    pads:vis('#pads'), key:vis('#keyHint'), phase}; })()""")
        border_ok = (w - m['cw']) < m['sc'] and (h - m['ch']) < m['sc'] and m['x'] >= 0 and m['y'] >= 0
        h1.append((w, h, m['wide'] and float(m['sc']).is_integer() and border_ok and m['sw'] <= w and m['sh'] <= h,
                   f"{w}x{h}: {m['VW']}×{m['VH']} ×{m['sc']} → {m['cw']:.0f}×{m['ch']:.0f}"))
        h2.append((w, h, (not m['pads']) and m['key'], f"{w}x{h}: 터치버튼 {'보임' if m['pads'] else '숨김'} · 키안내 {'보임' if m['key'] else '숨김'}"))
        pg.screenshot(path=str(out_dir / f'lap_{w}x{h}_play.png'))
        ms = pg.evaluate("""(()=>{ monster.state='chase'; monster.x=player.x+T*3; monster.y=player.y; monster.path=[];
            for(let i=0;i<30;i++){ fxHit(); fxStun(); }
            const t=performance.now(); for(let i=0;i<200;i++){ player.inv=1; update(1/60); fxUpdate(1/60); musicTick(); tipUpdate(); draw(); }
            return (performance.now()-t)/200; })()""")
        h5.append((w, h, ms < 8, f'{w}x{h}: {ms:.2f}ms'))
        ctx.close()
    ok('H1 노트북 화면 3종에서 게임이 창을 꽉 채움 (테두리 < 1배율 픽셀 · 정수 배율 · 스크롤 없음)', all(x[2] for x in h1), ' | '.join(x[3] for x in h1))
    ok('H2 노트북 배치: 터치 버튼 숨김 · 키 안내 표시', all(x[2] for x in h2), ' | '.join(x[3] for x in h2))
    ok('H5 노트북 배치(보이는 범위 최대)에서도 한 프레임 ≤ 8ms', all(x[2] for x in h5), ' | '.join(x[3] for x in h5))

    # ── H3 전체화면 버튼 · 창 크기 변경 ──
    ctx, pg = page_at(1366, 768)
    pg.evaluate("""window.__fsCalls=0; const el=document.documentElement, o=el.requestFullscreen;
        el.requestFullscreen=function(){ window.__fsCalls++; return o ? o.call(el) : Promise.resolve(); };""")
    pg.click('#fsBtn'); time.sleep(0.6)
    fs = pg.evaluate("[window.__fsCalls, !!document.fullscreenElement]")
    pg.keyboard.press('Enter'); time.sleep(0.1); pg.keyboard.press('Escape'); frames(pg, 3)
    before = pg.evaluate("[VW,VH,PXSCALE]")
    pg.set_viewport_size({'width': 1280, 'height': 720}); time.sleep(0.3); frames(pg, 10)
    after = pg.evaluate("[VW,VH,PXSCALE, cv.getBoundingClientRect().width, cv.getBoundingClientRect().height, lightCv.width, lightCv.height]")
    pg.set_viewport_size({'width': 390, 'height': 844}); time.sleep(0.3); frames(pg, 10)
    phone = pg.evaluate("[WIDE, VW, getComputedStyle(document.getElementById('pads')).display]")
    ok('H3 전체화면 버튼 → 전체화면 요청 · 창 크기가 바뀌면 바로 다시 맞춤 (조명층 포함) · 세로로 바꾸면 휴대폰 배치',
       fs[0] == 1 and before != after[:3] and after[0] == 640 and after[1] == 360 and abs(after[3] - 1280) < 2
       and after[5] == 640 and after[6] == 360 and phone[0] is False and phone[1] == 352 and phone[2] != 'none',
       f'요청 {fs[0]}회 · 전체화면 {fs[1]} · {before} → {after[:3]} 표시 {after[3]:.0f}×{after[4]:.0f} · 세로 {phone}')
    ctx.close()

    # ── H4 키보드만으로 전체 진행 (+ 이름 칸에서 게임 키가 새지 않음) · E1 · E2 ──
    ctx, pg = page_at(1366, 768)
    ev = pg.evaluate
    steps = []
    pg.keyboard.press('Enter'); time.sleep(0.3)
    steps.append(('Enter→도입', ev("!document.getElementById('intro').classList.contains('hide') && phase==='title'")))
    pg.wait_for_function("introI===0 && !introTyping()", timeout=5000)
    i0 = ev("introI"); pg.keyboard.press('Enter'); time.sleep(0.3)
    steps.append(('Enter→다음 문장', ev("introI") == i0 + 1))
    pg.keyboard.press('Escape'); frames(pg, 3)
    steps.append(('Esc→게임 시작', ev("phase") == 'bow' and ev("player.planks") == 1))   # 메뉴 키가 목재 설치로 새지 않음
    ev("monster.state='dormant'; monster.x=-1e6;")
    kd = ev("""(()=>{const [tx,ty]=w2t(player.x,player.y);
        for(const [dx,dy,k] of [[1,0,'d'],[-1,0,'a'],[0,1,'s'],[0,-1,'w']]) if(!isWall(tx+dx,ty+dy)) return [dx,dy,k];})()""")
    a0 = ev("[player.x,player.y]"); pg.keyboard.down(kd[2]); time.sleep(0.4); pg.keyboard.up(kd[2]); a1 = ev("[player.x,player.y]")
    steps.append(('WASD 이동', (a1[0] - a0[0]) * kd[0] + (a1[1] - a0[1]) * kd[1] > 20))
    ev("player.hp=1; player.inv=0; monster.state='chase'; monster.stagger=0; monster.x=player.x+4; monster.y=player.y; monster.path=[];")
    frames(pg, 6)
    steps.append(('패배→결과', ev("phase") == 'over'))
    pg.keyboard.press('Enter'); frames(pg, 3)
    steps.append(('Enter→다시 하기', ev("phase") == 'bow' and ev("runTime") < 1))
    ev("""localStorage.removeItem('maze_lb_v1'); monster.state='dormant'; monster.x=-1e6; phase='escape'; exitOpen=true; player.key=true; player.frags=4;
          hostage.rescued=true; hostage.following=true; const [x,y]=tw(exitT[0],exitT[1]); player.x=x; player.y=y;""")
    frames(pg, 6); time.sleep(0.2)
    steps.append(('클리어→이름 칸에 바로 입력 가능', ev("phase") == 'cleared' and ev("document.activeElement && document.activeElement.id") == 'nameIn'))
    pg.keyboard.type('rfq'); pg.keyboard.press('Enter'); frames(pg, 3)
    lb = ev("lbLoad()")
    steps.append(('이름에 r·f·q 를 쳐도 재시작·발사 안 됨 + Enter 등록', ev("phase") == 'cleared' and any(e['n'] == 'rfq' for e in lb)))
    pg.screenshot(path=str(out_dir / 'lap_result.png'))
    # E2: 결과 화면 60초 무입력 → 처음 화면 (시간을 앞당겨 확인)
    ev("resultAt=lastInput=performance.now()-61000;"); frames(pg, 3)
    e2a = ev("phase") == 'title' and ev("!document.getElementById('screen').classList.contains('hide') && !!document.getElementById('startBtn')")
    pg.keyboard.press('Enter'); time.sleep(0.2); pg.keyboard.press('Escape'); frames(pg, 3)
    steps.append(('처음 화면→Enter→Esc 새 판', ev("phase") == 'bow'))
    # E2 반대: 이름 입력 중이면 기다린다
    ev("""monster.state='dormant'; monster.x=-1e6; phase='escape'; exitOpen=true; player.key=true; player.frags=4;
          hostage.rescued=true; hostage.following=true; runTime=0.05; const [x,y]=tw(exitT[0],exitT[1]); player.x=x; player.y=y;""")
    frames(pg, 6); time.sleep(0.2)
    has_name = ev("!!document.getElementById('nameIn')")
    ev("resultAt=lastInput=performance.now()-61000;"); frames(pg, 3)
    e2b = has_name and ev("phase") == 'cleared'
    # H 키 → 처음 화면 (이름 칸 밖에서)
    ev("document.activeElement && document.activeElement.blur && document.activeElement.blur()")
    pg.keyboard.press('h'); frames(pg, 2)
    steps.append(('H→처음 화면', ev("phase") == 'title'))
    ok('H4 키보드만으로 시작→도입→플레이→결과→이름 등록→다시 하기→처음 화면',
       all(s[1] for s in steps), ' · '.join(f"{'✓' if s[1] else '✗'}{s[0]}" for s in steps))
    ok('E2 결과 화면 60초 무입력 → 처음 화면 · 이름 입력 중이면 기다림', e2a and e2b, f'복귀 {e2a} · 이름 입력 중 대기 {e2b}')

    # E1: "처음 화면" 버튼 (마우스)
    pg.keyboard.press('Enter'); time.sleep(0.2); pg.keyboard.press('Escape'); frames(pg, 3)
    ev("player.hp=1; player.inv=0; monster.state='chase'; monster.stagger=0; monster.x=player.x+4; monster.y=player.y; monster.path=[];")
    frames(pg, 6)
    pg.click('#homeBtn'); frames(pg, 2)
    art = ev("(()=>{const a=document.querySelector('#screen .titleArt'); return a? getComputedStyle(a).backgroundImage.slice(0,4):''})()")
    t1 = ev("phase") == 'title' and art == 'url(' and pg.locator('#startBtn').is_visible()
    t1d = f'단계 {ev("phase")} · 배경 {art!r} · 시작버튼 {pg.locator("#startBtn").is_visible()}'
    pg.click('#startBtn'); time.sleep(0.3)
    t2 = ev("!document.getElementById('intro').classList.contains('hide')")
    ok('E1 결과 화면 "처음 화면" → 키아트·시작 버튼이 있는 제목 화면 → 다시 시작하면 도입부터', t1 and t2, f'{t1d} · 도입 {t2}')
    pg.keyboard.press('Escape'); frames(pg, 3)

    # C2: 힌트는 알림·배너와 같은 시각에 겹치지 않는다 (석궁 획득 순간: 알림 + 배너 + 석궁 힌트가 몰림)
    ev("monster.state='dormant'; monster.x=-1e6; tipReset(); tipSeen.move=true;")
    ev("onBow(3)")
    clash, saw_tip, saw_banner = 0, False, False
    for _ in range(140):
        st = ev("""(()=>{ const t=document.getElementById('toast'), b=document.getElementById('banner');
            return [t.classList.contains('tip') && +getComputedStyle(t).opacity>0.5, b.classList.contains('show') && +getComputedStyle(b).opacity>0.05, toastT]; })()""")
        if st[0]: saw_tip = True
        if st[1]: saw_banner = True
        if st[0] and st[1]: clash += 1
        time.sleep(0.05)
    ok('C2 힌트가 알림·배너와 겹치지 않음 (석궁 획득 순간 7초 관찰)', clash == 0 and saw_tip and saw_banner,
       f'겹친 순간 {clash} · 힌트 {saw_tip} · 배너 {saw_banner}')

    # F1: 진동 — 지원 기기에선 호출, 미지원(속성 없음)에서도 오류 없음
    calls = ev("""(()=>{ const out=[]; try{ Object.defineProperty(navigator,'vibrate',{value:(p)=>{out.push(p);return true;},configurable:true}); }catch(e){}
        fxHit(); fxFall(player.x,player.y); fxChest(chests[0]);
        try{ Object.defineProperty(navigator,'vibrate',{value:undefined,configurable:true}); }catch(e){}
        fxHit(); fxFall(player.x,player.y); return out.length; })()""")
    ok('F1 진동: 맞을 때·구덩이·상자에서 진동 요청 · 진동 없는 기기에서도 오류 0', calls == 3, f'진동 요청 {calls}회')
    ctx.close()

    # X4 실제 키보드로 대각선 시도 (D 를 누른 채 W 까지) → 매 순간 한 축으로만 움직인다
    ctx, pg = page_at(1366, 768)
    pg.keyboard.press('Enter'); time.sleep(0.2); pg.keyboard.press('Escape'); frames(pg, 3)
    pg.evaluate("monster.state='dormant'; monster.x=-1e6; window.__dg=0; window.__mv=0; (function f(){ if(Math.abs(player.vx)>8&&Math.abs(player.vy)>8) __dg++; if(Math.hypot(player.vx,player.vy)>8) __mv++; requestAnimationFrame(f); })();")
    for combo in (('d', 'w'), ('a', 's'), ('ArrowRight', 'ArrowDown')):
        pg.keyboard.down(combo[0]); time.sleep(0.3); pg.keyboard.down(combo[1]); time.sleep(0.5)
        pg.keyboard.up(combo[1]); pg.keyboard.up(combo[0]); time.sleep(0.2)
    dg, mv = pg.evaluate("[__dg, __mv]")
    ok('X4 실제 키보드로 두 방향키를 같이 눌러도 대각선으로 안 움직임', mv > 20 and dg == 0, f'움직인 프레임 {mv} · 대각선 {dg}')
    ctx.close()

    ok('L0 노트북 테스트 전체 동안 콘솔 에러·경고 0', not logs, ' | '.join(logs[:3]))
    return R
