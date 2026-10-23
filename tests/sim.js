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
let AVOID_MONSTER = false;   // 피하는 봇: 깨어 있는 괴물 주변 2칸도 피해서 길을 찾는다 (사람처럼 돌아간다)
function routeAvoidPits(goal){
  const saved = [], me = w2t(player.x, player.y);
  const block = (x, y) => { if (inB(x, y) && !wall[x][y] && !(x === me[0] && y === me[1]) && !(x === goal[0] && y === goal[1])) { wall[x][y] = true; saved.push([x, y]); } };
  for (const q of pits) block(q.tx, q.ty);
  const M = monster;
  if (AVOID_MONSTER && M && !['stun','eat','dormant'].includes(M.state)){
    const mt = w2t(M.x, M.y);
    for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 2; dy++) if (Math.abs(dx) + Math.abs(dy) <= 2) block(mt[0] + dx, mt[1] + dy);
  }
  let p = astar(me, goal);
  for (const [x, y] of saved) wall[x][y] = false;
  if (!p.length && AVOID_MONSTER){ const sv = []; for (const q of pits) if (!wall[q.tx][q.ty]) { wall[q.tx][q.ty] = true; sv.push(q); }
    p = astar(me, goal); for (const q of sv) wall[q.tx][q.ty] = false; }    // 돌아갈 길이 없으면 그냥 간다
  return p;
}
function steerTo(goal){
  const path = routeAvoidPits(goal);
  const n = path.length ? path[0] : goal;
  const [tx, ty] = tw(n[0], n[1]);
  held.up = held.down = held.left = held.right = 0;
  // 상하좌우만 — 사람처럼 더 많이 가야 하는 쪽 한 방향만 누른다
  const ddx = tx - player.x, ddy = ty - player.y;
  if (Math.abs(ddx) >= Math.abs(ddy)) { if (ddx > 2) held.right = 1; else if (ddx < -2) held.left = 1; }
  else { if (ddy > 2) held.down = 1; else if (ddy < -2) held.up = 1; }
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

// ── 피하는 봇 (기획서 G): 괴물이 가까우면 석궁·목재·미끼를 쓰고, 구출 대기 중엔 둥지를 떠나며, 가까운 아이템은 줍는다 ──
// 피하는 봇: 사람이 할 법한 만큼 도구를 쓴다
function avoidGoal(){
  const M=monster, pt=w2t(player.x,player.y);
  // 구출 대기 중(괴물 호출됨)엔 둥지를 떠나 괴물 반대쪽으로
  if(!hostage.rescued && hostage.cool>0.8 && (phase==='rescue')){
    const mt=w2t(M.x,M.y); let best=null,bd=-1;
    for(const r of respawns){ const d=Math.hypot(r[0]-mt[0],r[1]-mt[1])-0.5*Math.hypot(r[0]-pt[0],r[1]-pt[1]); if(d>bd){bd=d;best=r;} }
    return best;
  }
  // 근처(6칸) 아이템은 주워 간다 (위험하지 않을 때)
  const md=Math.hypot(M.x-player.x,M.y-player.y)/T;
  if(md>5 || M.state==='stun' || M.state==='eat'){
    let bp=null,bd=1e9;
    for(const p of pickups){ if(p.s==='key') continue;
      if(p.s==='planks'&&player.planks>=PLANK_MAX) continue; if(p.s==='meat'&&player.bait>=BAIT_MAX) continue;
      const d=Math.hypot(p.x-player.x,p.y-player.y)/T; if(d<6&&d<bd){bd=d;bp=p;} }
    if(bp) return w2t(bp.x,bp.y);
  }
  return botGoal();
}
function avoidAct(){
  const M=monster, md=Math.hypot(M.x-player.x,M.y-player.y)/T;
  if(M.state==='stun'||M.state==='eat'||M.state==='dormant') return;
  const chasing = M.state==='chase'||M.state==='break';
  if(!chasing || md>4.5) return;
  const pt=w2t(player.x,player.y), mt=w2t(M.x,M.y);
  if(player.bow && player.ammo>0 && los(pt,mt) && (pt[0]===mt[0]||pt[1]===mt[1]) && md<5){
    const fx=player.fx, fy=player.fy;
    player.fx=Math.sign(mt[0]-pt[0]); player.fy=Math.sign(mt[1]-pt[1]); tapped.fire=1; return;
  }
  const away = (player.fx*(M.x-player.x)+player.fy*(M.y-player.y)) < 0;   // 괴물이 등 뒤
  if(player.planks>0 && away && md<3){ tapped.plank=1; return; }
  if(player.bait>0 && md<2.5){ tapped.bait=1; return; }
}
function avoidPlay(maxSec){ AVOID_MONSTER = true; try { return avoidPlay_(maxSec); } finally { AVOID_MONSTER = false; } }
function avoidPlay_(maxSec){
  let rel=0, phases=[phase], minHp=player.hp, mark=[player.x,player.y], wander=0, wgoal=null;
  for (let f = 0; f < maxSec * 60; f++){
    // 3초 동안 1칸도 못 움직였으면 (막힘) 2초간 아무 곳으로
    if (f % 180 === 0){
      const waiting = !hostage.rescued && Math.hypot(hostage.x-player.x,hostage.y-player.y)<T*1.5 && hostage.cool<=0;
      if (!waiting && Math.hypot(player.x-mark[0],player.y-mark[1]) < T){ wander=120; wgoal=rndOpen(); }
      mark=[player.x,player.y];
    }
    if (f % 6 === 0){
      const g = wander>0 ? wgoal : avoidGoal(); if (g) steerTo(g);
      held.run = player.st>25 || Math.hypot(monster.x-player.x,monster.y-player.y)<T*6 ? 1 : 0;
      avoidAct();
    }
    // 구출 대기 중엔 버튼을 누르지 않는다
    const waitRescue = !hostage.rescued && hostage.cool>0;
    if (hostage.locked) rel = 4;
    if (rel > 0 || waitRescue) { usePressed = false; if(rel>0) rel--; } else usePressed = true;
    update(DT); if(wander>0) wander--;
    minHp=Math.min(minHp,player.hp);
    if (phases[phases.length-1] !== phase) phases.push(phase);
    if (phase === 'cleared' || phase === 'over') return {res: phase, t: runTime, phases, hits:stats.hits, falls:stats.falls};
  }
  return {res: 'timeout', t: runTime, phases, hits:stats.hits, falls:stats.falls};
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
  ok('P1 시작 시 단계 bow · 체력 3 · 목재 1 · 미끼 1', phase === 'bow' && player.hp === 3 && player.planks === 1 && player.bait === 1,
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
  // 비명을 들은 괴물은 둥지(공주 칸)로 달려온다 (가는 길에 플레이어를 보면 쫓는다)
  ok('P4 1칸 채우면 괴물이 둥지로 달려옴 (호출 · 목적지 공주 칸)', monster.summoned > 0 && monster.lk[0] === w2t(hostage.x,hostage.y)[0] && monster.lk[1] === w2t(hostage.x,hostage.y)[1] && ['search','chase'].includes(monster.state),
     monster.state + ' summoned=' + (monster.summoned||0).toFixed(1));
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

  // 피격 5번이면 패배 (체력 5), 피격 뒤 무적·괴물 경직
  newGame(31); sleepMonster();
  monster.state = 'chase'; monster.x = player.x + 4; monster.y = player.y; monster.path = [];
  step(1);
  ok('M2 피격: 체력 -1 · 무적 2.2초 · 괴물 1.8초 멈칫', player.hp === player.hpMax - 1 && player.inv > 2 && monster.stagger > 1.7,
     [player.hp, player.inv.toFixed(2), monster.stagger.toFixed(2)].join(','));
  for (let i = 0; i < player.hpMax - 1; i++){ player.inv = 0; monster.stagger = 0; monster.x = player.x + 4; monster.y = player.y; step(1); }
  ok('M3 체력만큼(3번) 맞으면 패배', phase === 'over', phase + ' hp=' + player.hp);

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
  ok('M12 호출 가속(×1.08)은 6초 뒤 끝남 (계속 보고 있어도)', !(monster.summoned > 0), 'summoned=' + monster.summoned);
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

  // N1 난이도 (승인 목표: 피하는 봇 클리어 50% 정도 · 시간초과 0) — 120판
  let gc = 0, go = 0, gt = 0, gtimes = [];
  for (let s = 0; s < 120; s++){ newGame((s < 60 ? 4000 : 4940) + s); const r = avoidPlay(600);
    if (r.res === 'cleared'){ gc++; gtimes.push(r.t); } else if (r.res === 'over') go++; else gt++; }
  const gavg = gtimes.length ? gtimes.reduce((a,b)=>a+b,0)/gtimes.length : 0;
  // 목표 변경 (2026-10-23 송휘): 괴물이 '걸으면 잡히고 달려야 떼어내게' 세지면서 클리어 50% 정도로
  // 목표 변경 (2026-10-23 17:39 송휘): 체력 3칸 · 괴물 더 느리게 · 클리어 75% 정도. 봇도 괴물 주변을 피해 돌아가게(사람처럼)
  ok('N1 난이도: 피하는 봇 120판: 클리어 70~85% · 시간초과 0', gc / 120 >= 0.70 && gc / 120 <= 0.85 && gt === 0,
     `클리어 ${gc} (${(gc/120*100).toFixed(0)}%) · 잡힘 ${go} · 시간초과 ${gt} · 클리어 평균 ${gavg.toFixed(0)}초`);
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
  // T2: 새 판에서 지난 판의 '다음 상자'가 남지 않는다 (같은 칸에 서 있어도)
  let stale = 0;
  for (let s = 0; s < 20; s++){
    newGame(7000 + s); sleepMonster();
    const c = chests[s % 4]; place([c.tx, c.ty]); nextChestTarget();
    const old = chests;
    newGame(7100 + s); sleepMonster(); place([c.tx, c.ty]);
    const t = nextChestTarget();
    if (t && (old.includes(t) || !chests.includes(t))) stale++;
  }
  ok('T2 새 판에서 지난 판의 목표 상자가 남지 않음 (20판)', stale === 0, stale + '회');

  // T3: 움직임 — 벽에 대고 걸으면 걷는 그림이 멈추고, 손을 떼면 바로 선다
  newGame(7200); sleepMonster(); release();
  const [wx, wy] = w2t(player.x, player.y);
  const dirs = [['right',1,0],['left',-1,0],['down',0,1],['up',0,-1]];
  const wd = dirs.find(d => isWall(wx + d[1], wy + d[2]));
  held[wd[0]] = 1; secs(1.0);
  const wallAnim = hunterSprite()[0], wallSpd = player.spd, wallIdle = walkName('hunter', player.fx, player.fy, null)[0];
  release(); const od = dirs.find(d => !isWall(wx + d[1], wy + d[2]) && !isWall(wx + 2*d[1], wy + 2*d[2])) || dirs.find(d => !isWall(wx + d[1], wy + d[2]));
  place([wx, wy]); held[od[0]] = 1; secs(0.5); release();
  const x0 = player.x, y0 = player.y; secs(0.5);
  const slide = Math.hypot(player.x - x0, player.y - y0);
  ok('T3 벽에 대고 걸으면 제자리걸음 안 함 · 손 떼면 3px 안에 멈춤', wallSpd < 1 && wallAnim === wallIdle && slide < 3,
     `벽 앞 속도 ${wallSpd.toFixed(1)} · 그림 ${wallAnim} · 미끄러짐 ${slide.toFixed(1)}px`);
}


// ════════════════ V2. 기획서 v2 개선 (A 목표 화살표 · B 괴물 경고 · C 상황 힌트) ════════════════
{
  const angDiff = (a, b) => { let d = Math.abs(a - b) % (2*Math.PI); return d > Math.PI ? 2*Math.PI - d : d; };
  const onEdge = g => g && g.x >= 0 && g.y >= 0 && g.x <= VW && g.y <= VH &&
    Math.min(g.x, VW - g.x, g.y, VH - g.y) <= 50;
  // A1: 단계별 목표가 화면 밖일 때 가장자리 화살표가 그 목표를 가리킨다
  let a1bad = [], a1n = 0;
  for (let s = 0; s < 10; s++){
    newGame(8000 + s); sleepMonster();
    const cases = [];
    cases.push(['bow', () => pickups.find(p => p.s === 'crossbow')]);
    cases.push(['rescue', () => { onBow(3); return {x: hostage.x, y: hostage.y}; }]);
    // 상자: 플레이어 위치에 따라 '가장 가까운 상자'가 바뀌므로, 아무 상자에서 멀리 선 뒤 그때의 목표 상자를 정답으로 본다
    cases.push(['key', () => { hostage.stage = 3; hostage.rescued = true; hostage.following = true; onRescued(); const c = chests[0]; return {x:(c.tx+.5)*T, y:(c.ty+.5)*T, chest:true}; }]);
    cases.push(['escape', () => { for (const c of chests) c.opened = true; player.frags = 4; onFragment(); return {x:(exitT[0]+.5)*T, y:(exitT[1]+.5)*T}; }]);
    for (const [name, prep] of cases){
      const goal = prep();
      // 목표에서 가장 먼 쪽(걸어서) 빈 칸에 선다
      const d = bfs(w2t(goal.x, goal.y)); let far = null, fd = -1;
      for (let x = 0; x < GW; x++) for (let y = 0; y < GH; y++) if (d[x][y] > fd && !pits.some(q => q.tx === x && q.ty === y)){ fd = d[x][y]; far = [x, y]; }
      place(far); CAM.ready = false; fxUpdate(1/60);
      if (goal.chest){ const c = nextChestTarget(); goal.x = (c.tx+.5)*T; goal.y = (c.ty+.5)*T; }
      draw();
      const g = GUIDE.goal; a1n++;
      if (goal.x - camX > -1 && goal.x - camX < VW + 1 && goal.y - camY > -1 && goal.y - camY < VH + 1) { a1n--; continue; }  // 목표가 화면 안이면 이 경우는 A2 몫
      const want = Math.atan2(goal.y - camY - VH/2, goal.x - camX - VW/2);
      if (!g || g.mode !== 'edge' || !onEdge(g) || angDiff(g.a, want) > 15*Math.PI/180) a1bad.push(name + '@' + (8000+s));
      if (name !== 'bow' && phase !== name) a1bad.push('단계 ' + name + '≠' + phase);
    }
  }
  ok('v2-A1 목표가 화면 밖이면 가장자리 화살표가 목표 방향(15° 이내) — 석궁·공주·상자·출구 × 10판', a1bad.length === 0, a1bad.slice(0,4).join(' ') || a1n + '건');

  // A2: 목표가 화면 안이면 목표 위 표시
  newGame(8100); sleepMonster();
  const bow = pickups.find(p => p.s === 'crossbow'); const bt = w2t(bow.x, bow.y);
  const near = [[1,0],[-1,0],[0,1],[0,-1],[2,0],[-2,0],[0,2],[0,-2]].map(o => [bt[0]+o[0], bt[1]+o[1]]).find(t => inB(t[0],t[1]) && !wall[t[0]][t[1]] && !pits.some(q=>q.tx===t[0]&&q.ty===t[1]));
  place(near); CAM.ready = false; fxUpdate(1/60); draw();
  ok('v2-A2 목표가 화면 안이면 화살표 대신 목표 위 표시', GUIDE.goal && GUIDE.goal.mode === 'on' &&
     Math.abs(GUIDE.goal.x - (bow.x - camX)) <= 1, JSON.stringify(GUIDE.goal));

  // B1: 추격 중 + 화면 밖 → 경고 / 화면 안 또는 추격 아님 → 없음
  newGame(8200); sleepMonster(); fxUpdate(1/60);
  const putM = (dx, dy, st) => { monster.state = st; monster.x = player.x + dx; monster.y = player.y + dy; monster.path = []; draw(); return GUIDE.mon; };
  // 화면 크기(휴대폰 352 / 노트북 최대 704)에 맞춰 화면 밖 거리를 잡는다
  const mOff = putM(VW + T, 0, 'chase'), wantB = Math.atan2(monster.y - camY - VH/2, monster.x - camX - VW/2);
  const mOn = putM(T*2, 0, 'chase'), mPat = putM(VW + T, 0, 'patrol'), mUp = putM(0, -(VH + T), 'chase');
  const wantU = Math.atan2(monster.y - camY - VH/2, monster.x - camX - VW/2);
  ok('v2-B1 괴물 경고: 추격+화면 밖이면 그 방향 가장자리에, 화면 안·순찰 중이면 없음',
     mOff && angDiff(mOff.a, wantB) < 0.26 && mUp && angDiff(mUp.a, wantU) < 0.26 && !mOn && !mPat,
     [!!mOff, !!mOn, !!mPat, !!mUp].join(','));
  sleepMonster();

  // C1: 상황 힌트는 조건이 처음 맞을 때 1번만, 같은 판에서 다시 안 뜸 · 새 판에서 다시 뜸
  // 시뮬레이션은 한 번에 동기로 돌아 배너를 끄는 타이머가 실행되지 않는다 → 배너를 꺼 두고 본다
  const bnr = document.getElementById('banner'); bnr.classList.remove('show');
  let c1bad = 0, kinds = new Set();
  for (let s = 0; s < 6; s++){
    newGame(4000 + s);
    const tl = []; let r;
    // 피하는 봇으로 한 판 (힌트 표시는 화면 루프에서 하므로 매 프레임 tipUpdate 를 같이 돌린다)
    const _u = update; let f = 0;
    window.update = (dt) => { _u(dt); tipUpdate(); };
    try { r = avoidPlay(300); } finally { window.update = _u; }
    const ks = tipLog.map(e => e.k); ks.forEach(k => kinds.add(k));
    if (new Set(ks).size !== ks.length) c1bad++;
  }
  const before = tipLog.length; newGame(4001); tipUpdate(); secs(2); for (let i=0;i<200;i++){ update(DT); tipUpdate(); }
  ok('v2-C1 상황 힌트: 판마다 종류별 1번씩만 (6판) · 이동·석궁·구출·목재·상자 힌트가 실제로 뜸 · 새 판에서 다시 뜸', c1bad === 0 && ['move','fire','rescue','plank','chest'].every(k => kinds.has(k)) && tipLog.length >= 1,
     `중복 ${c1bad}판 · 나온 종류 ${[...kinds].join(',')}`);
}


// ════════════════ K. 상자 배치 · 괴물 추격감 (2026-10-23 피드백) ════════════════
{
  // K1: 상자가 한곳에 몰리지 않는다
  let close = 0, edge = 0, minAll = 99;
  for (let s = 1; s <= 200; s++){
    newGame(1000 + s);
    for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++){
      const d = Math.hypot(chests[i].tx - chests[j].tx, chests[i].ty - chests[j].ty); minAll = Math.min(minAll, d); if (d < 10) close++; }
    for (const c of chests){ const dx = Math.abs(c.tx - nest[0]), dy = Math.abs(c.ty - nest[1]);
      const core = (c.reg === 0 || c.reg === 2) ? dy - dx : dx - dy; if (core < 3) edge++; }
  }
  ok('K1 상자 4개가 서로 10칸 이상 떨어짐 · 구역 경계(대각선)에서 3칸 이상 (200판)', close === 0 && edge === 0,
     `가까운 쌍 ${close} · 경계 붙음 ${edge} · 최소 거리 ${minAll.toFixed(1)}칸`);

  // K2: 걸어서 도망치면 잡히고, 달리면 떼어낸다 — 플레이어가 1초 먼저 출발, 괴물이 출발점에서 추격
  const trial = (run, secsMax, seed) => {
    newGame(seed); sleepMonster(); release();
    const st = w2t(player.x, player.y), d = bfs(st);
    let far = st, fd = -1; for (let x = 0; x < GW; x++) for (let y = 0; y < GH; y++) if (d[x][y] > fd){ fd = d[x][y]; far = [x, y]; }
    const saved = pits.splice(0);                       // 이 측정에선 구덩이를 치운다
    const go = (n) => { for (let f = 0; f < n; f++){ if (f % 6 === 0) steerTo(far); held.run = run ? 1 : 0; update(DT); } };
    go(60);
    const [sx, sy] = tw(st[0], st[1]);
    monster.state = 'chase'; monster.x = sx; monster.y = sy; monster.path = []; monster.repath = 0; monster.lk = w2t(player.x, player.y);
    monster.tired = 0; monster.summoned = 0; monster.stagger = 0;
    const hp0 = player.hp; let caughtAt = -1;
    const d0 = Math.hypot(monster.x - player.x, monster.y - player.y); let d5 = null;
    for (let f = 0; f < secsMax * 60; f++){ go(1); if (f === 300) d5 = Math.hypot(monster.x - player.x, monster.y - player.y);
      if (player.hp < hp0){ caughtAt = f / 60; break; } }
    pits.push(...saved);
    return {caughtAt, closed: caughtAt >= 0 || (d5 !== null && d5 < d0 + T)};
  };
  // 2026-10-23 "조금 더 쉽게 · 체력 3칸 · 클리어 75% 정도": 괴물은 걷기(6.8)보다 아주 조금 빠른 7.15
  // → 걸어서는 떼어내지 못하고(5초 뒤에도 1칸 넘게 벌어지지 않음), 달리면 떼어낸다
  let walkClose = 0, runSafe = 0;
  for (let i = 0; i < 20; i++){ if (trial(false, 6, 9000 + i).closed) walkClose++; }
  for (let i = 0; i < 20; i++){ if (trial(true, 4, 9000 + i).caughtAt < 0) runSafe++; }
  ok('K2 추격감: 걸어서는 못 떼어냄(5초 뒤 1칸 넘게 안 벌어짐 80%+) · 달리면 4초 동안 안 잡힘(80%+)', walkClose >= 16 && runSafe >= 16,
     `걸을 때 못 떼어냄 ${walkClose}/20 · 달리기 안 잡힘 ${runSafe}/20`);
}


// ════════════════ X. 상하좌우 조작만 (2026-10-23 "상하좌우 조작만 가능하게") ════════════════
{
  const isCard = v => (v[0] === 0) !== (v[1] === 0) || (v[0] === 0 && v[1] === 0);
  const press = k => { keys[k] = 1; dirPress(k); }, lift = k => { keys[k] = 0; dirRelease(k); };
  const clearKeys = () => { for (const k in keys) keys[k] = 0; dirOrder.length = 0; release(); };
  // 열린 십자 교차로를 찾아 선다 (네 방향 다 열림)
  newGame(9100); sleepMonster(); clearKeys();
  let cross = null;
  for (let x = 1; x < GW-1 && !cross; x++) for (let y = 1; y < GH-1; y++)
    if (!wall[x][y] && !wall[x+1][y] && !wall[x-1][y] && !wall[x][y+1] && !wall[x][y-1] && !pits.some(q=>Math.abs(q.tx-x)+Math.abs(q.ty-y)<=1)){ cross = [x, y]; break; }
  place(cross);
  press('d'); press('w'); const a1 = axis();
  lift('w'); const a2 = axis();
  press('arrowdown'); const a3 = axis();
  clearKeys();
  ok('X1 키 두 개를 같이 눌러도 한 방향만 (나중에 누른 키 · 떼면 남은 키로)',
     a1[0] === 0 && a1[1] === -1 && a2[0] === 1 && a2[1] === 0 && a3[0] === 0 && a3[1] === 1, JSON.stringify([a1, a2, a3]));

  // X2 조이스틱: 어느 각도로 밀어도 한 축
  let diag = 0;
  for (let deg = 0; deg < 360; deg += 5){ const r = deg * Math.PI / 180;
    joy.active = true; joy.mag = 0.7; joy.x = Math.cos(r) * 0.7; joy.y = Math.sin(r) * 0.7;
    if (!isCard(axis())) diag++; }
  joy.active = false; joy.mag = 0;
  ok('X2 조이스틱을 어느 각도(5°마다 72방향)로 밀어도 한 방향만', diag === 0, diag + '개 대각선');

  // X3 미리 꺾기: 오른쪽으로 가며 '위'를 같이 누르고 있으면, 위가 막힌 동안은 오른쪽으로 가다가 위가 열리는 칸에서 꺾는다
  let ok3 = 0, tried = 0, why = [];
  for (let s = 0; s < 40 && tried < 10; s++){
    newGame(9200 + s); sleepMonster(); clearKeys();
    // 오른쪽 3칸이 열린 복도 + 처음 2칸은 위가 막힘 + 3번째 칸은 위가 열림
    let st = null;
    for (let x = 1; x < GW-4 && !st; x++) for (let y = 2; y < GH-2; y++){
      if (wall[x][y]||wall[x+1][y]||wall[x+2][y]) continue;
      if (!wall[x][y-1] || !wall[x+1][y-1] || wall[x+2][y-1]) continue;
      if (pits.some(q => q.ty >= y-1 && q.ty <= y && q.tx >= x && q.tx <= x+2)) continue;
      st = [x, y]; break; }
    if (!st) continue; tried++;
    place(st); press('d'); press('w');
    let turnedAt = null;
    for (let f = 0; f < 120; f++){ update(DT); const t = w2t(player.x, player.y); if (t[1] < st[1]) { turnedAt = t; break; } }
    clearKeys();
    if (turnedAt && turnedAt[0] === st[0] + 2) ok3++; else why.push(JSON.stringify([st, turnedAt]));
  }
  ok('X3 미리 꺾기: 꺾으려는 쪽이 막힌 동안은 원래 방향으로 가다가 열리는 칸에서 꺾음', tried >= 5 && ok3 === tried, `${ok3}/${tried} ${why.slice(0,2).join(' ')}`);
}

// ════════════════ Z. 무작위 입력 퍼징 ════════════════
{
  let err = null, nan = 0, inWall = 0, frames = 0, zdiag = 0;
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
    { const a = axis(); if (a[0] !== 0 && a[1] !== 0) zdiag++; }
    if (blocked(player.x, player.y, player.r) && player.fall <= 0) inWall++;
    if (phase === 'over' || phase === 'cleared'){ release(); start(); }
  }
  ok('Z1 무작위 입력 5분: 예외 0', !err, err || frames + '프레임');
  ok('Z2 좌표 NaN 0', nan === 0, nan);
  ok('Z2b 무작위 입력 5분 동안 대각선 이동 입력 0', zdiag === 0, zdiag);
  ok('Z3 플레이어가 벽·목재에 박힌 프레임 0', inWall === 0, inWall);
  // 재시작
  start(); const s1 = key(startT); tapped.restart = 1; step(1);
  ok('Z4 R키 재시작 시 새 판 (단계 bow · 체력 3)', phase === 'bow' && player.hp === 3 && runTime < 0.1, phase + ' hp=' + player.hp);
}

return R;
})();
