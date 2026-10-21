// ════════════════════════════════════════════════════════════
//  미궁의 사냥꾼 — 로직 시뮬레이션 테스트
//  qa.py 가 index.html 을 Chromium 에 올린 뒤 이 파일을 주입해 실행한다.
//  화면 갱신(requestAnimationFrame)은 꺼두고 update()를 직접 돌린다.
// ════════════════════════════════════════════════════════════
(function(){
const R = [];
const ok = (name, cond, detail) => R.push({name, ok: !!cond, detail: detail === undefined ? '' : String(detail)});
const DT = 1/60;
const step = (n) => { for (let i = 0; i < n; i++) update(DT); };
const secs = (s) => step(Math.round(s * 60));
const key = (t) => t[0] + ',' + t[1];
const release = () => { for (const k of ['up','down','left','right','run']) held[k] = 0;
  usePressed = false; joy.active = false; joy.mag = 0; };

function newGame(seed){
  __reseed(seed); release(); start();
  // 시작 직후 지역 안내 토스트 등은 무시
}
function sleepMonster(){ monster.state = 'dormant'; monster.x = -1e6; monster.y = -1e6; }
function place(t){ const [x,y] = tw(t[0], t[1]); player.x = x; player.y = y; player.vx = player.vy = 0; }

// ── 봇: 구덩이를 피해 목표로 걸어간다 ──
function routeAvoidPits(goal){
  const saved = [];
  for (const q of pits) if (!wall[q.tx][q.ty]) { wall[q.tx][q.ty] = true; saved.push(q); }
  const p = astar(w2t(player.x, player.y), goal);
  for (const q of saved) wall[q.tx][q.ty] = false;
  return p;
}
function steerTo(goal){
  const path = routeAvoidPits(goal);
  const n = path.length ? path[0] : goal;
  const [tx, ty] = tw(n[0], n[1]);
  held.up = held.down = held.left = held.right = 0;
  if (tx - player.x > 2) held.right = 1; else if (player.x - tx > 2) held.left = 1;
  if (ty - player.y > 2) held.down = 1; else if (player.y - ty > 2) held.up = 1;
}
function botGoal(){
  if (phase === 'bow') { const b = pickups.find(p => p.s === 'crossbow'); if (b) return w2t(b.x, b.y); }
  if (!hostage.rescued || !hostage.following) return w2t(hostage.x, hostage.y);
  const c = nextChestTarget();          // 게임의 미니맵 목표와 같은 함수
  return c ? [c.tx, c.ty] : exitT.slice();
}
// 한 판을 끝까지 돌린다. 결과: 'cleared' | 'over' | 'timeout'
function botPlay(maxSec, opts){
  opts = opts || {};
  let rel = 0, lastErr = null, phases = [phase];
  for (let f = 0; f < maxSec * 60; f++){
    if (opts.immortal){ player.hp = player.hpMax; player.inv = 1; }   // 구조 검사용: 괴물에게 맞지 않음
    if (f % 6 === 0){
      const g = botGoal(); if (g) steerTo(g);
      held.run = 1;
      const M = monster, md = Math.hypot(M.x - player.x, M.y - player.y);
      if (!opts.passive){
        if (player.bow && player.ammo > 0 && md < 140 && M.state !== 'stun' && M.state !== 'eat'){
          player.fx = M.x - player.x; player.fy = M.y - player.y; tapped.fire = 1; }
        if (player.bait > 0 && md < 100 && M.state === 'chase') tapped.bait = 1;
      }
    }
    if (hostage.locked) rel = 4;
    if (rel > 0) { usePressed = false; rel--; } else usePressed = true;
    update(DT);
    if (phases[phases.length-1] !== phase) phases.push(phase);
    if (phase === 'cleared' || phase === 'over') return {res: phase, t: runTime, phases};
  }
  return {res: 'timeout', t: runTime, phases};
}

// ════════════════ G. 미로 생성 (함정 A: 배치 교착) ════════════════
{
  const N = 200; let deadEnds = 0, badChests = 0, badChestRegion = 0, badResp = 0, unreachable = [], respStuck = 0,
      pitOnItem = 0, pitUnavoidable = 0, exitBad = 0, monsterWall = 0, crossbowMissing = 0;
  for (let s = 1; s <= N; s++){
    newGame(1000 + s);
    for (let cy = 0; cy < CELLS; cy++) for (let cx = 0; cx < CELLS; cx++){
      const p = ct(cx, cy); let o = 0;
      for (const [dx,dy] of D4) if (!isWall(p[0]+dx, p[1]+dy)) o++;
      if (o <= 1) deadEnds++;
    }
    if (chests.length !== 4) badChests++;
    if (new Set(chests.map(c => c.reg)).size !== 4) badChestRegion++;
    if (respawns.length !== 4 || respawns.some(r => isWall(r[0], r[1]))) badResp++;
    const P = new Set(pits.map(q => q.tx + ',' + q.ty));
    const d = bfsAvoid(startT, P);
    const bow = pickups.find(p => p.s === 'crossbow');
    if (!bow) crossbowMissing++;
    const targets = [['출구', exitT], ['둥지', nest], ...chests.map(c => ['상자', [c.tx, c.ty]]),
                     ...pickups.map(p => ['아이템:' + p.s, w2t(p.x, p.y)])];
    for (const [nm, t] of targets) if (d[t[0]][t[1]] < 0) unreachable.push('seed' + (1000+s) + ' ' + nm);
    for (const r of respawns){ const dr = bfsAvoid(r, P);
      for (const [, t] of targets) if (dr[t[0]][t[1]] < 0) { respStuck++; break; } }
    for (const p of pickups) if (P.has(key(w2t(p.x, p.y)))) pitOnItem++;
    // 구덩이 옆으로 돌아갈 수 있는가: 이웃 열린 칸끼리 7x7 안에서 구덩이 없이 연결
    for (const q of pits){
      const nb = D4.map(([dx,dy]) => [q.tx+dx, q.ty+dy]).filter(n => !isWall(n[0], n[1]));
      const seen = new Set([key(nb[0])]); const Q = [nb[0]];
      for (let i = 0; i < Q.length; i++){ const [x,y] = Q[i];
        for (const [dx,dy] of D4){ const nx = x+dx, ny = y+dy;
          if (Math.abs(nx-q.tx) > 3 || Math.abs(ny-q.ty) > 3 || isWall(nx,ny) || P.has(nx+','+ny) || seen.has(nx+','+ny)) continue;
          seen.add(nx+','+ny); Q.push([nx,ny]); } }
      if (!nb.every(n => seen.has(key(n)))) pitUnavoidable++;
    }
    const onBorder = exitT[0] === 0 || exitT[1] === 0 || exitT[0] === GW-1 || exitT[1] === GH-1;
    const inner = D4.map(([dx,dy]) => [exitT[0]+dx, exitT[1]+dy]).filter(n => inB(n[0], n[1]) && !isWall(n[0], n[1]));
    if (!onBorder || inner.length < 1) exitBad++;
    if (isWall(...w2t(monster.x, monster.y))) monsterWall++;
  }
  ok('G1 막다른 길 0개 (200판)', deadEnds === 0, deadEnds + '개');
  ok('G2 상자가 정확히 4개 (200판)', badChests === 0, badChests + '판에서 4개 아님');
  ok('G3 상자가 네 구역에 하나씩', badChestRegion === 0, badChestRegion + '판');
  ok('G4 리스폰 지점 4곳, 모두 바닥', badResp === 0, badResp + '판');
  ok('G5 석궁이 항상 생성됨', crossbowMissing === 0, crossbowMissing + '판');
  ok('G6 구덩이를 피해 출구·둥지·상자·모든 아이템 도달 가능', unreachable.length === 0,
     unreachable.length + '건 ' + unreachable.slice(0, 6).join(' / '));
  ok('G7 모든 리스폰 지점에서도 전부 도달 가능', respStuck === 0, respStuck + '건');
  ok('G8 아이템이 구덩이 위에 없음', pitOnItem === 0, pitOnItem + '건');
  ok('G9 모든 구덩이는 옆으로 돌아갈 수 있음', pitUnavoidable === 0, pitUnavoidable + '개');
  ok('G10 출구가 바깥벽에 있고 안쪽과 이어짐', exitBad === 0, exitBad + '판');
  ok('G11 괴물 시작 위치가 바닥', monsterWall === 0, monsterWall + '판');
}

// ════════════════ P. 진행 단계 ════════════════
{
  newGame(7); sleepMonster();
  ok('P1 시작 시 단계 bow · 체력 4 · 목재 1 · 미끼 1', phase === 'bow' && player.hp === 4 && player.planks === 1 && player.bait === 1,
     [phase, player.hp, player.planks, player.bait].join(','));
  const bow = pickups.find(p => p.s === 'crossbow');
  player.x = bow.x; player.y = bow.y; step(1);
  ok('P2 석궁을 주우면 rescue 단계 · 화살 3', phase === 'rescue' && player.bow && player.ammo === 3, phase + ' ammo=' + player.ammo);

  // 구출 3칸
  sleepMonster(); place(nest); player.x += 6;
  usePressed = true; secs(1.0);
  const half = hostage.stage === 0 && hostage.prog > 0.4 && hostage.prog < 0.6;
  secs(1.1);
  ok('P3 2초 누르면 1칸 채움', hostage.stage === 1, 'stage=' + hostage.stage + ' (1초 시점 반쯤: ' + half + ')');
  ok('P4 1칸 채우면 괴물 호출 (chase)', monster.state === 'chase', monster.state);
  ok('P5 다음 칸까지 대기 5초', hostage.cool > 4.7 && hostage.cool <= 5.0, 'cool=' + hostage.cool.toFixed(2));
  sleepMonster();
  secs(1.0);
  ok('P6 손을 떼기 전에는 잠김 (진행 0)', hostage.prog === 0 && hostage.locked, 'prog=' + hostage.prog.toFixed(2));
  usePressed = false; step(2); usePressed = true; secs(1.5);
  ok('P7 손을 떼도 대기 시간 중엔 진행 0', hostage.prog === 0 && hostage.stage === 1, 'prog=' + hostage.prog.toFixed(2) + ' cool=' + hostage.cool.toFixed(2));
  usePressed = false; secs(2.6); // 대기 종료 (손 뗀 채로)
  usePressed = true; secs(2.1);
  ok('P8 대기 후 다시 2초 누르면 2칸', hostage.stage === 2, 'stage=' + hostage.stage);
  sleepMonster(); usePressed = false; secs(5.2); usePressed = true; secs(2.1);
  ok('P9 3칸 채우면 구출 완료 · 동행 · key 단계', hostage.rescued && hostage.following && phase === 'key',
     [hostage.rescued, hostage.following, phase].join(','));
  usePressed = false;

  // 상자 4개
  sleepMonster();
  for (const c of chests){ place([c.tx, c.ty]); usePressed = true; step(1); usePressed = false; step(1); }
  ok('P10 상자 4개를 열면 조각 4 · 열쇠 · escape 단계', player.frags === 4 && player.key && exitOpen && phase === 'escape',
     [player.frags, player.key, exitOpen, phase].join(','));
  // 공주 없이 출구
  hostage.following = false;
  place(exitT); step(1);
  ok('P11 공주를 데려오지 않으면 탈출 불가', phase === 'escape', phase);
  hostage.following = true; place(exitT); step(1);
  ok('P12 공주와 함께 출구에 닿으면 클리어', phase === 'cleared', phase);
}
{
  // 순서 바꾸기 ①: 구출 먼저 → 석궁 나중
  newGame(11); sleepMonster();
  hostage.stage = 2; hostage.prog = 0.99; place(nest); usePressed = true; step(2); usePressed = false;
  const after = phase;
  const bow = pickups.find(p => p.s === 'crossbow'); player.x = bow.x; player.y = bow.y; step(1);
  ok('P13 구출 먼저 → 석궁 나중: 목표가 되돌아가지 않음', after === 'key' && phase === 'key', after + ' → ' + phase);

  // 순서 바꾸기 ②: 조각 4개 먼저 → 구출 나중
  newGame(12); sleepMonster();
  for (const c of chests){ place([c.tx, c.ty]); usePressed = true; step(1); usePressed = false; step(1); }
  const keyBefore = player.key;
  hostage.stage = 2; hostage.prog = 0.99; place(nest); usePressed = true; step(2); usePressed = false;
  const objText = document.getElementById('obj').textContent;
  ok('P14 조각 4개 먼저 → 구출 나중: 바로 탈출 단계로', keyBefore && phase === 'escape' && /탈출/.test(objText),
     'phase=' + phase + ' 목표="' + objText + '"');
}

// ════════════════ R. 구덩이 ════════════════
{
  newGame(21); sleepMonster();
  Object.assign(player, {planks: 3, ammo: 3, bait: 2, bow: true, frags: 2});
  hostage.rescued = true; hostage.following = true; hostage.x = 100; hostage.y = 100; phase = 'key';
  const q = pits[0]; place([q.tx, q.ty]); step(1);
  const respKeys = respawns.map(key);
  const at = key(w2t(player.x, player.y));
  ok('R1 구덩이: 소모품 0 · 석궁·조각 유지', player.planks === 0 && player.ammo === 0 && player.bait === 0 && player.bow && player.frags === 2,
     [player.planks, player.ammo, player.bait, player.bow, player.frags].join(','));
  ok('R2 구덩이: 리스폰 지점 중 하나로 이동', respKeys.includes(at), at);
  const [nx, ny] = tw(nest[0], nest[1]);
  ok('R3 구덩이: 공주는 둥지 중앙으로 · 동행 해제 · 구출 유지', hostage.x === nx && hostage.y === ny && !hostage.following && hostage.rescued);
  const x0 = player.x; held.right = 1; secs(0.9);
  ok('R4 떨어진 뒤 1초간 움직이지 못함', player.x === x0, (player.x - x0).toFixed(1));
  secs(0.3); release();
  // 다시 데려가기
  place(nest); player.x += 6; usePressed = true; step(1); usePressed = false;
  ok('R5 둥지로 가서 버튼을 누르면 다시 동행', hostage.following, hostage.following);
  // 구덩이 가장자리 스침은 안 빠짐
  newGame(22); sleepMonster();
  const q2 = pits[0]; const [cx, cy] = tw(q2.tx, q2.ty);
  player.x = cx + 12; player.y = cy; const before = player.fall; checkPit();
  ok('R6 구덩이 가장자리를 스치면 안 빠짐 (중앙 10px 안만)', player.fall === 0 && before === 0);
}

// ════════════════ M. 괴물 · 도구 (함정 B: 도착 판정) ════════════════
{
  // 괴물이 멈춘 플레이어를 실제로 잡는가
  let caught = 0, caughtT = [];
  for (let s = 0; s < 20; s++){
    newGame(300 + s); sleepMonster();
    const open = []; for (let x = 0; x < GW; x++) for (let y = 0; y < GH; y++) if (!wall[x][y]) open.push([x,y]);
    const d = bfs(w2t(player.x, player.y));
    const far = open.filter(t => d[t[0]][t[1]] > 8 && d[t[0]][t[1]] < 14)[0];
    const [mx, my] = tw(far[0], far[1]); monster.x = mx; monster.y = my; monster.state = 'chase'; monster.path = []; monster.repath = 0;
    monster.lk = w2t(player.x, player.y); monster.summoned = 30;
    const hp0 = player.hp;
    for (let f = 0; f < 60 * 20; f++){ update(DT); if (player.hp < hp0){ caught++; caughtT.push(runTime); break; } }
  }
  ok('M1 괴물이 가만히 있는 플레이어를 잡음 (20판)', caught === 20, caught + '/20');

  // 피격 4번이면 패배, 피격 뒤 무적·괴물 경직
  newGame(31); sleepMonster();
  monster.state = 'chase'; monster.x = player.x + 4; monster.y = player.y; monster.path = [];
  step(1);
  ok('M2 피격: 체력 -1 · 무적 2.2초 · 괴물 1.1초 경직', player.hp === 3 && player.inv > 2 && monster.stagger > 1,
     [player.hp, player.inv.toFixed(2), monster.stagger.toFixed(2)].join(','));
  for (let i = 0; i < 3; i++){ player.inv = 0; monster.stagger = 0; monster.x = player.x + 4; monster.y = player.y; step(1); }
  ok('M3 4번 맞으면 패배', phase === 'over', phase + ' hp=' + player.hp);

  // 석궁 명중 → 8초 기절
  newGame(32); sleepMonster(); player.bow = true; player.ammo = 3;
  const row = (() => { for (let y = 1; y < GH-1; y++){ let run = 0;
      for (let x = 1; x < GW-1; x++){ if (!wall[x][y]) { if (++run >= 6) return [x-5, y]; } else run = 0; } } })();
  place(row); const [mx, my] = tw(row[0] + 4, row[1]);
  monster.x = mx; monster.y = my; monster.state = 'eat'; monster.eat = 99; monster.path = [];
  player.fx = 1; player.fy = 0; tapped.fire = 1;
  let hitF = -1; for (let f = 0; f < 60; f++){ update(DT); if (monster.state === 'stun'){ hitF = f; break; } }
  ok('M4 석궁 명중 → 기절', hitF >= 0 && player.ammo === 2, 'state=' + monster.state + ' ammo=' + player.ammo);
  let stunF = 0; while (monster.state === 'stun' && stunF < 60 * 20){ player.inv = 99; update(DT); stunF++; }
  ok('M5 기절 지속 8초', Math.abs(stunF / 60 - 8) < 0.1, (stunF / 60).toFixed(2) + '초');

  // 조준선과 실제 화살이 같은 곳에서 멈추는가 (목재)
  newGame(33); sleepMonster(); player.bow = true; player.ammo = 3;
  place(row); player.fx = 1; player.fy = 0;
  planks.push({tx: row[0] + 2, ty: row[1], hp: 2, ghost: false});
  const [mx2, my2] = tw(row[0] + 4, row[1]);
  monster.x = mx2; monster.y = my2; monster.state = 'eat'; monster.eat = 99; monster.path = [];
  tapped.fire = 1; secs(0.6);
  ok('M6 조준선이 목재에서 끊기면 화살도 목재에서 멈춤', monster.state !== 'stun', '괴물 상태=' + monster.state);

  // 목재: 등 뒤 설치 · 괴물 2번에 파괴 · 철거
  newGame(34); sleepMonster(); place([row[0] + 2, row[1]]); player.fx = 1; player.fy = 0; player.planks = 2;
  tapped.plank = 1; step(1);
  const pl = planks[0];
  ok('M7 목재는 바라보는 반대쪽(등 뒤)에 설치', pl && pl.tx === row[0] + 1 && pl.ty === row[1], pl ? pl.tx + ',' + pl.ty : '없음');
  // 괴물이 목재에 막혀 부숨 — 목재 바로 앞에서 목재 칸으로 가는 경로를 준다
  newGame(35); sleepMonster(); place([row[0] + 5, row[1]]); player.inv = 999;
  const plk = {tx: row[0] + 2, ty: row[1], hp: 2, ghost: false}; planks.push(plk);
  { const [bx, by] = tw(row[0] + 1, row[1]); monster.x = bx; monster.y = by; }
  monster.state = 'patrol'; monster.path = [[row[0] + 2, row[1]]]; monster.pi = 0;
  let hits = 0, prev = 2, t8 = 0;
  for (let f = 0; f < 60 * 6; f++){ update(DT); t8++;
    const now = planks.includes(plk) ? plk.hp : 0; if (now < prev){ hits += prev - now; prev = now; } if (!now) break; }
  ok('M8 괴물은 목재를 정확히 2번 들이받아 부숨', hits === 2 && !planks.includes(plk), hits + '번 · ' + (t8/60).toFixed(2) + '초');
  newGame(36); sleepMonster(); place(row); player.planks = 3;
  planks.push({tx: row[0] + 1, ty: row[1], hp: 2, ghost: false});
  usePressed = true; step(1); usePressed = false;
  ok('M9 칸이 꽉 차도 목재 철거 가능 (부숴짐)', planks.length === 0 && player.planks === 3, planks.length + '개 남음');

  // 미끼: 괴물이 실제로 도착해 4초 먹고, 그동안 무시
  let arrived = 0, ignored = 0;
  for (let s = 0; s < 15; s++){
    newGame(400 + s); sleepMonster(); place(row); player.fx = 1; player.fy = 0; player.bait = 1;
    const d = bfs(w2t(player.x, player.y)); const open = [];
    for (let x = 0; x < GW; x++) for (let y = 0; y < GH; y++) if (!wall[x][y] && d[x][y] > 6 && d[x][y] < 12) open.push([x,y]);
    const [mx3, my3] = tw(open[0][0], open[0][1]); monster.x = mx3; monster.y = my3; monster.state = 'chase'; monster.path = [];
    tapped.bait = 1; step(1);
    let ate = false;
    for (let f = 0; f < 60 * 12; f++){ update(DT); if (monster.state === 'eat'){ ate = true; break; } }
    if (ate){ arrived++;
      const hp0 = player.hp; player.x = monster.x + 8; player.y = monster.y; player.inv = 0; secs(3.5);
      if (player.hp === hp0 && monster.state === 'eat') ignored++;
    }
  }
  ok('M10 미끼를 던지면 괴물이 도착해 먹기 시작 (15판)', arrived === 15, arrived + '/15');
  ok('M11 먹는 동안 바로 옆에 있어도 공격 안 함', ignored === arrived, ignored + '/' + arrived);

  // 호출 가속이 끝나는가 (괴물이 계속 플레이어를 보고 있을 때)
  newGame(37); sleepMonster(); place(row);
  const [mx4, my4] = tw(row[0] + 5, row[1]); monster.x = mx4; monster.y = my4; monster.path = [];
  summonMonster(); player.inv = 999;
  for (let f = 0; f < 60 * 10; f++){ update(DT); player.x = tw(row[0], row[1])[0]; player.y = tw(row[0], row[1])[1]; }
  ok('M12 호출 가속(×1.15)은 6초 뒤 끝남 (계속 보고 있어도)', !(monster.summoned > 0), 'summoned=' + monster.summoned);
}

// ════════════════ S. 재보급 ════════════════
{
  let bad = 0, total = 0;
  for (let s = 0; s < 40; s++){
    newGame(500 + s); sleepMonster();
    hostage.stage = 2; hostage.prog = 0.99; place(nest); usePressed = true; step(2); usePressed = false;
    const P = new Set(pits.map(q => q.tx + ',' + q.ty));
    const d = bfsAvoid(w2t(player.x, player.y), P);
    for (const p of pickups){ total++; const t = w2t(p.x, p.y);
      if (d[t[0]][t[1]] < 0 || chests.some(c => c.tx === t[0] && c.ty === t[1]) || (t[0] === exitT[0] && t[1] === exitT[1])) bad++; }
  }
  ok('S1 구출 뒤 재보급 아이템이 도달 가능하고 상자·출구 칸에 겹치지 않음', bad === 0, bad + '/' + total);
}

// ════════════════ F. 전체 플레이 (함정 A: 진행 불가 판이 있는가) ════════════════
{
  let cleared = 0, timeouts = [], errors = [];
  for (let s = 0; s < 120; s++){
    try { newGame(2000 + s); const r = botPlay(420, {immortal: true});
      if (r.res === 'cleared') cleared++; else timeouts.push('seed' + (2000+s) + ':' + r.phases.join('>') + ' frags=' + player.frags); }
    catch(e){ errors.push('seed' + (2000+s) + ': ' + e.message); }
  }
  ok('F1 무적 봇이 120판 모두 클리어 (진행이 막히는 판 0)', cleared === 120, cleared + '/120 ' + timeouts.slice(0,3).join(' | '));
  ok('F2 전체 플레이 중 예외 0', errors.length === 0, errors.slice(0,3).join(' | '));

  let c2 = 0, o2 = 0, t2 = 0, times = [];
  for (let s = 0; s < 60; s++){ newGame(3000 + s); const r = botPlay(420);
    if (r.res === 'cleared'){ c2++; times.push(r.t); } else if (r.res === 'over') o2++; else t2++; }
  ok('F3 일반 봇 60판: 시간초과 0 (모든 판이 승패로 끝남)', t2 === 0,
     '클리어 ' + c2 + ' · 패배 ' + o2 + ' · 시간초과 ' + t2 + (times.length ? ' · 평균 ' + (times.reduce((a,b)=>a+b)/times.length).toFixed(0) + '초' : ''));
}

// ════════════════ T. 미니맵 목표 표시 ════════════════
{
  let flips = 0, games = 0;
  for (let s = 0; s < 20; s++){
    newGame(4000 + s); sleepMonster();
    hostage.stage = 2; hostage.prog = 0.99; place(nest); usePressed = true; step(2); usePressed = false;
    let prev = null; games++;
    for (let f = 0; f < 60 * 200 && phase === 'key'; f++){
      player.inv = 1;
      if (f % 6 === 0){ const g = botGoal(); if (g) steerTo(g); held.run = 1; }
      usePressed = true; update(DT);
      const c = nextChestTarget();
      if (prev && c && c !== prev && !prev.opened) flips++;
      prev = c;
    }
  }
  ok('T1 목표 상자 표시가 걷는 도중 바뀌지 않음 (20판)', flips === 0, flips + '회');
}

// ════════════════ Z. 무작위 입력 퍼징 ════════════════
{
  let err = null, nan = 0, inWall = 0, frames = 0;
  newGame(9001);
  for (let f = 0; f < 60 * 300; f++){
    if (f % 23 === 0){ held.up = Math.random() < .4 ? 1 : 0; held.down = Math.random() < .4 ? 1 : 0;
      held.left = Math.random() < .4 ? 1 : 0; held.right = Math.random() < .4 ? 1 : 0; held.run = Math.random() < .5 ? 1 : 0; }
    if (f % 37 === 0){ joy.active = Math.random() < .5; const a = Math.random() * 6.283; joy.mag = Math.random(); joy.x = Math.cos(a) * joy.mag; joy.y = Math.sin(a) * joy.mag; }
    if (f % 41 === 0) tapped.plank = 1;
    if (f % 53 === 0) tapped.fire = 1;
    if (f % 97 === 0) tapped.bait = 1;
    if (f % 600 === 0 && player.bow === false) player.bow = true;
    usePressed = (f % 50) < 25;
    try { update(DT); if (f % 30 === 0) draw(); } catch(e){ err = e.message + ' @' + f; break; }
    frames++;
    if (!isFinite(player.x) || !isFinite(player.y) || !isFinite(monster.x) || !isFinite(monster.y)) nan++;
    if (blocked(player.x, player.y, player.r) && player.fall <= 0) inWall++;
    if (phase === 'over' || phase === 'cleared'){ release(); start(); }
  }
  ok('Z1 무작위 입력 5분: 예외 0', !err, err || frames + '프레임');
  ok('Z2 좌표 NaN 0', nan === 0, nan);
  ok('Z3 플레이어가 벽·목재에 박힌 프레임 0', inWall === 0, inWall);
  // 재시작
  start(); const s1 = key(startT); tapped.restart = 1; step(1);
  ok('Z4 R키 재시작 시 새 판 (단계 bow · 체력 4)', phase === 'bow' && player.hp === 4 && runTime < 0.1, phase + ' hp=' + player.hp);
}

return R;
})();
