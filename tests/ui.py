"""
브라우저 실제 플레이 테스트 — 휴대폰 화면(390×844, 터치)으로 index.html 을 열어
조이스틱 드래그 · 버튼 누르기/떼기 · 결과 화면 · 레이아웃 · 콘솔 에러를 확인한다.
게임 시계는 진짜 requestAnimationFrame 으로 돈다.
"""
import time


def ui_tests(browser, url, seeded_random, out_dir):
    R = []
    ok = lambda name, cond, detail='': R.append({'name': name, 'ok': bool(cond), 'detail': str(detail)})
    logs = []

    ctx = browser.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2,
                              is_mobile=True, has_touch=True)
    page = ctx.new_page()
    page.on('pageerror', lambda e: logs.append(f'pageerror: {e}'))
    page.on('console', lambda m: m.type in ('error', 'warning') and logs.append(f'{m.type}: {m.text}'))
    page.on('requestfailed', lambda r: logs.append(f'요청 실패: {r.url[:80]}'))
    page.add_init_script(seeded_random)
    cdp = ctx.new_cdp_session(page)
    ev = page.evaluate

    def touch(kind, x, y, tid=1):
        pts = [] if kind == 'touchEnd' else [{'x': x, 'y': y, 'id': tid}]
        cdp.send('Input.dispatchTouchEvent', {'type': kind, 'touchPoints': pts})

    def center(sel):
        b = page.locator(sel).bounding_box()
        return b['x'] + b['width'] / 2, b['y'] + b['height'] / 2

    def press(sel, hold=0.08):
        x, y = center(sel)
        touch('touchStart', x, y); time.sleep(hold); touch('touchEnd', x, y); time.sleep(0.05)

    def frames(n=4):            # 실제 rAF 가 몇 번 돌 때까지 기다린다
        ev(f"new Promise(r=>{{let k={n};const f=()=>--k?requestAnimationFrame(f):r();requestAnimationFrame(f);}})")

    # ── B1 부팅 ──
    t0 = time.time()
    page.goto(url)
    page.wait_for_function("document.getElementById('startBtn').textContent==='시작'", timeout=20000)
    boot = time.time() - t0
    ok('B1 부팅: 에셋 로드 후 시작 버튼 활성화', 'wait' not in page.locator('#startBtn').get_attribute('class'),
       f'{boot:.1f}초')
    art = ev("getComputedStyle(document.querySelector('#screen .titleArt')).backgroundImage")
    ok('B2 시작 화면에 키아트가 깔림', art.startswith('url('), art[:30])
    page.screenshot(path=str(out_dir / 'ui_1_title.png'))

    # ── B3 시작 ──
    page.tap('#startBtn'); frames(6); time.sleep(0.3)
    ok('B3a 시작 버튼 → 도입 장면이 뜨고 게임은 아직 시작 안 함',
       ev("!document.getElementById('intro').classList.contains('hide')") and ev("phase") == 'title',
       ev("document.getElementById('introLine').textContent"))
    page.screenshot(path=str(out_dir / 'ui_1b_intro.png'))
    page.wait_for_function("introI===0 && !introTyping()", timeout=5000)
    l0 = ev("introI"); page.tap('#introLine'); time.sleep(0.3)
    ok('B3b 화면을 누르면 다음 문장으로 넘어감', ev("introI") == l0 + 1, f'{l0} → {ev("introI")}')
    page.tap('#introSkip'); frames(6)
    ok('B3 건너뛰기를 누르면 게임 시작', ev("phase") == 'bow' and ev("document.getElementById('screen').classList.contains('hide')"))
    lum = ev("""(()=>{const c=document.getElementById('game'),g=c.getContext('2d');
       const d=g.getImageData(0,0,c.width,c.height).data;let s=0,s2=0,n=0;
       for(let i=0;i<d.length;i+=16){const v=(d[i]+d[i+1]+d[i+2])/3;s+=v;s2+=v*v;n++;}
       const m=s/n;return [m,Math.sqrt(s2/n-m*m)];})()""")
    ok('B4 게임 화면이 실제로 그려짐 (빈 화면 아님)', lum[1] > 15, f'평균 밝기 {lum[0]:.0f} · 편차 {lum[1]:.0f}')
    page.screenshot(path=str(out_dir / 'ui_2_play.png'))

    # ── B5 조이스틱 ──
    ev("monster.state='dormant'; monster.x=-1e6; monster.y=-1e6;")
    open_dir = ev("""(()=>{const [tx,ty]=w2t(player.x,player.y);
        for(const [dx,dy,n] of [[1,0,'R'],[-1,0,'L'],[0,1,'D'],[0,-1,'U']])
          if(!isWall(tx+dx,ty+dy)&&!isWall(tx+2*dx,ty+2*dy)) return [dx,dy,n]; return [0,1,'D'];})()""")
    jx, jy = center('#joy')
    x0, y0 = ev("[player.x, player.y]")
    touch('touchStart', jx, jy)
    for i in range(1, 9):                 # 손가락을 끌어 끝까지 민다
        touch('touchMove', jx + open_dir[0] * 7 * i, jy + open_dir[1] * 7 * i); time.sleep(0.02)
    ax = ev("axis()")
    run_ring = 'run' in (page.locator('#joyRing').get_attribute('class') or '')
    time.sleep(0.6)
    x1, y1 = ev("[player.x, player.y]")
    moved = (x1 - x0) * open_dir[0] + (y1 - y0) * open_dir[1]
    touch('touchEnd', 0, 0); frames(3)
    ok('B5 조이스틱을 끌면 그 방향으로 이동', moved > 40 and round(ax[0]) == open_dir[0] and round(ax[1]) == open_dir[1],
       f'{open_dir[2]}쪽으로 {moved:.0f}px · axis={ax}')
    ok('B6 끝까지 밀면 달리기 표시(금색 테두리)', run_ring)
    ok('B7 손을 떼면 조이스틱이 풀림', ev("joy.active") is False and ev("axis()") == [0, 0])
    # 대각선으로 대충 밀어도 축 방향으로 맞춰지는가
    touch('touchStart', jx, jy); touch('touchMove', jx + 40, jy + 12); time.sleep(0.05)
    snap = ev("axis()"); touch('touchEnd', 0, 0)
    ok('B8 비스듬히 밀어도(17°) 정확히 가로 방향으로 보정', snap == [1, 0], snap)

    # ── B9 행동 버튼 ──
    ev("""(()=>{const [tx,ty]=w2t(player.x,player.y); player.fx=0; player.fy=1;
        for(const [dx,dy] of [[0,1],[1,0],[0,-1],[-1,0]]) if(!isWall(tx-dx,ty-dy)){ player.fx=dx; player.fy=dy; break; } })()""")
    p0 = ev("player.planks"); press('.a-plank'); frames(3)
    ok('B9 목재 버튼: 목재 설치 · 개수 표시 갱신', ev("planks.length") == 1 and ev("player.planks") == p0 - 1
       and page.locator('#cPlank').text_content() == str(p0 - 1), f"설치 {ev('planks.length')} · 버튼 숫자 {page.locator('#cPlank').text_content()}")
    frames(3)
    ok('B10 목재 옆에 서면 상황 버튼이 "목재 철거"로 바뀜', page.locator('#useLbl').text_content() == '목재 철거',
       page.locator('#useLbl').text_content())
    press('.a-use'); frames(3)
    ok('B11 상황 버튼으로 목재 철거', ev("planks.length") == 0)
    press('.a-bait'); frames(3)
    ok('B12 미끼 버튼: 미끼 던짐 · 버튼 흐려짐', ev("baits.length") == 1 and ev("player.bait") == 0
       and 'off' in page.locator('.a-bait').get_attribute('class'))
    ok('B13 석궁 없을 때 석궁 버튼이 흐려져 있음', 'off' in page.locator('.a-fire').get_attribute('class'))
    ev("player.bow=true; player.ammo=3;"); frames(3)
    press('.a-fire'); frames(3)
    ok('B14 석궁 버튼: 발사 · 남은 화살 표시', ev("player.ammo") == 2 and page.locator('#cFire').text_content() == '2',
       page.locator('#cFire').text_content())

    # ── B15 구출: 버튼을 꾹 누르고 있기 ──
    ev("baits.length=0; const [x,y]=tw(nest[0],nest[1]); player.x=x+6; player.y=y; monster.state='dormant'; monster.x=-1e6;")
    frames(3)
    lbl = page.locator('#useLbl').text_content()
    ux, uy = center('.a-use')
    touch('touchStart', ux, uy); time.sleep(2.4)
    st_hold = ev("hostage.stage"); cool = ev("hostage.cool")
    time.sleep(1.0)
    st_after = ev("hostage.stage")
    lbl_wait = page.locator('#useLbl').text_content()
    touch('touchEnd', ux, uy); frames(3)
    page.screenshot(path=str(out_dir / 'ui_3_rescue.png'))
    ok('B15 공주 옆에서 상황 버튼이 "구출(꾹)"', lbl == '구출(꾹)', lbl)
    ok('B16 버튼을 2초 넘게 꾹 누르면 1칸 · 계속 눌러도 2칸째 안 참', st_hold == 1 and st_after == 1 and cool > 0,
       f'stage {st_hold}→{st_after} · 대기 {cool:.1f}초 · 버튼 "{lbl_wait}"')
    ok('B17 대기 중 버튼에 남은 초가 표시됨', lbl_wait.startswith('대기'), lbl_wait)

    # ── B18 재시작: 두 번 눌러야 ──
    rt0 = ev("runTime")
    page.tap('#restartBtn'); frames(2)
    first = page.locator('#restartBtn').text_content(); same_game = ev("runTime") >= rt0
    page.tap('#restartBtn'); frames(3)
    ok('B18 재시작은 한 번 누르면 확인, 두 번째에 새 판', first == '한 번 더' and same_game and ev("runTime") < 1.0 and ev("hostage.stage") == 0,
       f'첫 탭 "{first}"')

    # ── B19 레이아웃 (폰 화면) ──
    boxes = ev("""(()=>{const q=s=>{const r=document.querySelector(s).getBoundingClientRect();return [r.left,r.top,r.right,r.bottom];};
       return {game:q('#game'),joy:q('#joy'),use:q('.a-use'),fire:q('.a-fire'),plank:q('.a-plank'),bait:q('.a-bait'),
               restart:q('#restartBtn'),clock:q('#clock'),hint:q('#hint'),
               docH:document.documentElement.scrollHeight,docW:document.documentElement.scrollWidth};})()""")
    def overlap(a, b): return a[0] < b[2] - 1 and b[0] < a[2] - 1 and a[1] < b[3] - 1 and b[1] < a[3] - 1
    def circ_gap(a, b):            # 동그란 버튼: 중심 거리 − 반지름 합
        ca, cb = ((a[0]+a[2])/2, (a[1]+a[3])/2), ((b[0]+b[2])/2, (b[1]+b[3])/2)
        return ((ca[0]-cb[0])**2 + (ca[1]-cb[1])**2) ** 0.5 - (a[2]-a[0])/2 - (b[2]-b[0])/2
    names = ['joy', 'use', 'fire', 'plank', 'bait']
    btns = ['use', 'fire', 'plank', 'bait']
    gaps = {f'{a}×{b}': circ_gap(boxes[a], boxes[b]) for i, a in enumerate(btns) for b in btns[i + 1:]}
    over = [k for k, g in gaps.items() if g < 4] + [f'joy×{n}' for n in btns if overlap(boxes['joy'], boxes[n])]
    ok('B19 조이스틱·버튼끼리 겹치지 않음 (원끼리 4px 이상 간격)', not over,
       ', '.join(f'{k} {gaps.get(k, 0):.0f}px' for k in over) or f'최소 간격 {min(gaps.values()):.0f}px')
    ok('B20 버튼이 게임 화면을 가리지 않음', not any(overlap(boxes['game'], boxes[n]) for n in names + ['restart']))
    small = [n for n in ['use', 'fire', 'plank', 'bait'] if min(boxes[n][2] - boxes[n][0], boxes[n][3] - boxes[n][1]) < 44]
    ok('B21 버튼 크기가 손가락 최소 크기(44px) 이상', not small, ', '.join(small))
    ok('B22 폰 화면(844px)에서 스크롤 없이 다 보임', boxes['docH'] <= 844 and boxes['docW'] <= 390,
       f"문서 {boxes['docW']}×{boxes['docH']}")
    ev("toast('알림 위치 확인용 문구입니다')"); frames(3)
    tb = ev("(()=>{const r=document.getElementById('toast').getBoundingClientRect();return [r.left,r.top,r.right,r.bottom];})()")
    g = boxes['game']
    ok('B22b 알림 문구가 게임 화면 안에 표시됨', tb[0] >= g[0] and tb[2] <= g[2] and tb[1] >= g[1] and tb[3] <= g[3],
       f'알림 {[round(v) for v in tb]} · 게임 {[round(v) for v in g]}')
    used = max(boxes['hint'][3], boxes['use'][3])
    ok('B22c 폰 화면 아래에 큰 빈 공간이 없음 (남는 높이 < 80px)', 844 - used < 80, f'아래 빈 공간 {844 - used:.0f}px')
    page.screenshot(path=str(out_dir / 'ui_4_layout.png'), full_page=True)

    # ── B23 패배 → 결과 화면 → 다시 하기 ──
    ev("player.hp=1; player.inv=0; monster.state='chase'; monster.stagger=0; monster.x=player.x+4; monster.y=player.y; monster.path=[];")
    frames(6)
    txt = page.locator('#screen').inner_text()
    vis = ev("!document.getElementById('screen').classList.contains('hide')")
    page.screenshot(path=str(out_dir / 'ui_5_gameover.png'))
    ok('B23 체력 0 → "잡혔다" 결과 화면', ev("phase") == 'over' and vis and '잡' in txt, txt.replace('\n', ' ')[:40])
    ok('B23b 결과 화면에 개발용 문구가 없음', '유니티' not in txt and '최고기록판' not in txt, txt.replace('\n', ' ')[:60])
    btn = page.locator('#againBtn').bounding_box()
    ok('B24 결과 화면의 "다시 하기" 버튼이 화면 안에 보임', btn and btn['width'] > 40 and 0 <= btn['y'] < 844, btn)
    page.tap('#againBtn'); frames(4)
    ok('B25 "다시 하기"로 새 판 시작', ev("phase") == 'bow' and ev("player.hp") == 5)

    # ── B26 클리어 → 결과 화면 ──
    ev("""monster.state='dormant'; monster.x=-1e6; phase='escape'; exitOpen=true; player.key=true; player.frags=4;
          hostage.rescued=true; hostage.following=true; const [x,y]=tw(exitT[0],exitT[1]); player.x=x; player.y=y;""")
    frames(4)
    txt2 = page.locator('#screen').inner_text()
    page.screenshot(path=str(out_dir / 'ui_6_clear.png'))
    ok('B26 공주와 출구 도착 → "탈출 성공" 결과 화면', ev("phase") == 'cleared' and '탈' in txt2, txt2.replace('\n', ' ')[:40])
    ok('B26b 결과 화면에 판 기록(맞은 횟수·화살·구덩이)이 나옴', '맞은 횟수' in txt2 and '구덩이' in txt2)
    has_in = page.locator('#nameIn').count() == 1
    if has_in:
        page.fill('#nameIn', 'QA1'); page.tap('#nameBtn'); frames(2)
    lb = ev("lbLoad()")
    ok('B26c 클리어하면 이름 3글자로 순위표에 등록 · 제목 화면에 최고 기록 표시',
       has_in and any(e['n'] == 'QA1' for e in lb) and page.locator('.lbR.me').count() == 1, lb[:2])
    page.tap('#againBtn'); frames(4)

    # ── B30 단계 안내 배너 ──
    ev("monster.state='dormant'; monster.x=-1e6; onBow(2);"); frames(3)
    ok('B30 단계가 바뀌면 큰 안내 배너가 뜸', ev("document.getElementById('banner').classList.contains('show')")
       and '공주' in ev("document.getElementById('banner').textContent"), ev("document.getElementById('banner').textContent"))

    # ── B31 연출 입자 수 상한 ──
    n = ev("(()=>{ for(let i=0;i<200;i++){ fxHit(); fxStun(); fxWin(); } for(let i=0;i<30;i++) fxUpdate(1/60);"
           " return [FX.parts.length, FX.floats.length, FX.flyers.length, FX.amb.length]; })()")
    ok('B31 효과 입자가 아무리 많이 터져도 상한 이하 (입자 500 · 글자 41 · 조각 9 · 배경 70)',
       n[0] <= 500 and n[1] <= 41 and n[2] <= 9 and n[3] <= 70, n)
    ev("fxReset()")

    # ── B32 소리 끄기 저장 ──
    m0 = ev("muted"); page.tap('#muteBtn'); frames(1)
    m1 = ev("muted"); saved = ev("localStorage.getItem('maze_mute')")
    page.tap('#muteBtn'); frames(1)
    ok('B32 소리 버튼: 켜고 끄기 · 기기에 저장', m0 is False and m1 is True and saved == '1' and ev("muted") is False
       and ev("localStorage.getItem('maze_mute')") == '0', f'{m0}→{m1} 저장={saved}')
    page.tap('#muteBtn'); frames(1)
    page.reload(); page.wait_for_function("document.getElementById('startBtn').textContent==='시작'", timeout=20000)
    best = ev("document.getElementById('bestLine').textContent")
    ok('B33 새로고침 뒤에도 최고 기록이 제목 화면에 · 소리 꺼짐 상태 유지',
       'QA1' in best and ev("muted") is True and ev("document.getElementById('muteBtn').classList.contains('off')"), best)
    page.tap('#muteBtn'); ev("start()"); frames(2)

    # ── B27 성능: 한 프레임(update+draw) 시간 ──
    ms = ev("""(()=>{ for(let i=0;i<20;i++) fxHit();
        const t=performance.now(); for(let i=0;i<300;i++){ update(1/60); fxUpdate(1/60); musicTick(); draw(); } return (performance.now()-t)/300;})()""")
    ok('B27 한 프레임 처리(규칙+연출+조명+그리기) 시간 < 8ms (60fps 여유)', ms < 8, f'{ms:.2f}ms')

    # ── B28 PC 키보드 ──
    desk = browser.new_context(viewport={'width': 1280, 'height': 900})
    dp = desk.new_page(); dlogs = []
    dp.on('pageerror', lambda e: dlogs.append(str(e)))
    dp.on('console', lambda m: m.type in ('error', 'warning') and dlogs.append(m.text))
    dp.add_init_script(seeded_random)
    dp.goto(url); dp.wait_for_function("document.getElementById('startBtn').textContent==='시작'", timeout=20000)
    dp.click('#startBtn'); time.sleep(0.2); dp.click('#introSkip'); time.sleep(0.2)
    dp.evaluate("monster.state='dormant'; monster.x=-1e6;")
    kd = dp.evaluate("""(()=>{const [tx,ty]=w2t(player.x,player.y);
        for(const [dx,dy,k] of [[1,0,'d'],[-1,0,'a'],[0,1,'s'],[0,-1,'w']]) if(!isWall(tx+dx,ty+dy)) return [dx,dy,k];})()""")
    a0 = dp.evaluate("[player.x,player.y]")
    dp.keyboard.down(kd[2]); time.sleep(0.5); dp.keyboard.up(kd[2])
    a1 = dp.evaluate("[player.x,player.y]")
    mv = (a1[0] - a0[0]) * kd[0] + (a1[1] - a0[1]) * kd[1]
    ok('B28 PC: WASD로 이동', mv > 30, f"'{kd[2]}' {mv:.0f}px")
    dp.screenshot(path=str(out_dir / 'ui_7_desktop.png'))
    desk.close()
    logs.extend(dlogs)

    # ── B29 콘솔 ──
    ok('B29 전체 진행(부팅→플레이→패배→클리어) 동안 콘솔 에러·경고 0', not logs, ' | '.join(logs[:4]))
    ctx.close()
    return R
