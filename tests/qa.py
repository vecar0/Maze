"""
미궁의 사냥꾼 — 자동 검수 실행기

    python3 tests/qa.py          # 시뮬레이션 + 브라우저 테스트 전부
    python3 tests/qa.py sim      # 로직 시뮬레이션만
    python3 tests/qa.py ui       # 브라우저 실제 플레이만

index.html 을 로컬 서버로 띄워 Chromium 에서 연다.
"""
import sys, json, time, pathlib, threading, http.server, functools, socketserver

ROOT = pathlib.Path(__file__).resolve().parent.parent
TESTS = ROOT / 'tests'
OUT = TESTS / 'out'
OUT.mkdir(exist_ok=True)

# 같은 시드 → 같은 미로. 실패한 판을 그대로 재현할 수 있게 한다.
SEEDED_RANDOM = """
(() => {
  let s = 1;
  window.__reseed = (n) => { s = (n >>> 0) || 1; };
  Math.random = () => { s |= 0; s = s + 0x6D2B79F5 | 0;
    let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296; };
})();
"""
MANUAL_CLOCK = "window.requestAnimationFrame = () => 0;"   # 시뮬레이션: 게임 시계를 직접 돌린다


def serve():
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(ROOT))
    handler.log_message = lambda *a, **k: None
    httpd = socketserver.TCPServer(('127.0.0.1', 0), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, f'http://127.0.0.1:{httpd.server_address[1]}/index.html'


def report(title, results):
    print(f'\n━━ {title} ━━')
    for r in results:
        mark = '✅' if r['ok'] else '❌'
        print(f"{mark} {r['name']}" + (f"  — {r['detail']}" if r['detail'] else ''))
    n_ok = sum(r['ok'] for r in results)
    print(f'→ {n_ok}/{len(results)} 통과')
    return n_ok == len(results)


def run_sim(browser, url):
    page = browser.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda m: m.type in ('error', 'warning') and errors.append(f'{m.type}: {m.text}'))
    page.add_init_script(SEEDED_RANDOM + MANUAL_CLOCK)
    page.goto(url)
    page.wait_for_function('assetsReady === true', timeout=20000)
    t0 = time.time()
    results = page.evaluate((TESTS / 'sim.js').read_text(encoding='utf-8'))
    results.append({'name': 'C0 시뮬레이션 중 콘솔 에러·경고 0', 'ok': not errors,
                    'detail': ' | '.join(errors[:3])})
    print(f'(시뮬레이션 {time.time() - t0:.0f}초)')
    page.close()
    (OUT / 'sim_results.json').write_text(json.dumps(results, ensure_ascii=False, indent=1), encoding='utf-8')
    return report('A. 로직 시뮬레이션', results)


def run_ui(browser, url):
    from ui import ui_tests
    results = ui_tests(browser, url, SEEDED_RANDOM, OUT)
    (OUT / 'ui_results.json').write_text(json.dumps(results, ensure_ascii=False, indent=1), encoding='utf-8')
    return report('B. 브라우저 실제 플레이', results)


if __name__ == '__main__':
    sys.path.insert(0, str(TESTS))
    from playwright.sync_api import sync_playwright
    mode = sys.argv[1] if len(sys.argv) > 1 else 'all'
    httpd, url = serve()
    all_ok = True
    with sync_playwright() as p:
        browser = p.chromium.launch()
        if mode in ('all', 'sim'): all_ok &= run_sim(browser, url)
        if mode in ('all', 'ui'):  all_ok &= run_ui(browser, url)
        browser.close()
    httpd.shutdown()
    print('\n' + ('🟢 전부 통과' if all_ok else '🔴 실패 있음'))
    sys.exit(0 if all_ok else 1)
