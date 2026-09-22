#!/usr/bin/env node
/**
 * 无头浏览器自检运行器。
 *
 * 用途：在 CI 或命令行里验证**浏览器专属路径**（离线区间渲染、WAV 编码与回解码、
 * 实时播放器出声）。纯 Node 测试（tests/*.test.mjs）覆盖不到这些。
 *
 * 用法：
 *   python3 serve.py 8765 &            # 先起静态服务器
 *   node tests/run-browser-check.mjs http://127.0.0.1:8765
 *
 * 实现说明：直接使用 Chrome DevTools Protocol（Node 内置 WebSocket，无需任何依赖），
 * 而不是 --dump-dom——因为自检是异步的（要等 OfflineAudioContext 渲染完），
 * dump-dom 会在结果写出来之前就抓取页面。
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TARGET_URL = (process.argv[2] || 'http://127.0.0.1:8765').replace(/\/$/, '') + '/tests/browser.html';
const CHROME = process.env.CHROME_BIN || 'google-chrome';
const PORT = 9222 + Math.floor(Math.random() * 500);

const profileDir = mkdtempSync(join(tmpdir(), 'tunehub-cdp-'));
let child = null;

function log(...a) {
  console.log(...a);
}

async function waitFor(fn, { timeout = 30000, interval = 150, label = 'condition' } = {}) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn().catch(() => null);
    if (v) return v;
    if (Date.now() - t0 > timeout) throw new Error(`等待超时: ${label}`);
    await new Promise((r) => setTimeout(r, interval));
  }
}

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      }
    });
  }

  send(method, params = {}, sessionId) {
    const id = ++this.id;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    this.ws.send(JSON.stringify(payload));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP 超时: ${method}`));
        }
      }, 60000);
    });
  }
}

async function main() {
  const args = [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--disable-crashpad',
    '--disable-breakpad',
    '--disable-dev-shm-usage',
    '--no-zygote',
    // 注意：不要加 --mute-audio。在无头环境里它会让 AudioContext 不渲染，
    // 导致"实时播放器出声"这一项永远等不到信号。
    '--autoplay-policy=no-user-gesture-required',
    `--user-data-dir=${profileDir}`,
    `--remote-debugging-port=${PORT}`,
    'about:blank',
  ];
  log(`启动 ${CHROME} …`);
  child = spawn(CHROME, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (d) => { stderr += d.toString(); });
  child.on('exit', (code) => {
    if (code !== 0 && code !== null) log(`（chrome 退出码 ${code}）`);
  });

  const version = await waitFor(async () => {
    const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
    return r.ok ? r.json() : null;
  }, { timeout: 25000, label: 'chromium 启动' });
  log(`浏览器: ${version.Browser}`);

  const ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', rej, { once: true });
  });
  const cdp = new CDP(ws);

  // 新建标签页
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });

  await cdp.send('Runtime.enable', {}, sessionId);
  await cdp.send('Log.enable', {}, sessionId);
  await cdp.send('Page.enable', {}, sessionId);

  const consoleErrors = [];
  const consoleAll = [];
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.method === 'Log.entryAdded') {
      const e = m.params?.entry ?? {};
      consoleAll.push(`[${e.level}] ${e.text}`);
      if (e.level === 'error') consoleErrors.push(e.text);
    }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params?.exceptionDetails ?? {};
      const desc = d.exception?.description ?? d.exception?.value ?? d.text ?? 'unknown exception';
      consoleErrors.push(desc);
      consoleAll.push(`[exception] ${desc}`);
      if (d.url) consoleAll.push(`            位置 ${d.url}:${d.lineNumber}:${d.columnNumber}`);
      if (d.stackTrace?.callFrames?.length) {
        for (const f of d.stackTrace.callFrames.slice(0, 6)) {
          consoleAll.push(`            at ${f.functionName || '(anonymous)'} ${f.url}:${f.lineNumber + 1}:${f.columnNumber + 1}`);
        }
      }
    }
  });

  log(`打开 ${TARGET_URL}`);
  await cdp.send('Page.navigate', { url: TARGET_URL }, sessionId);

  // 等自检把结果写出来（页面会把 pass/fail 写进 #out 的 dataset）
  const result = await waitFor(async () => {
    const r = await cdp.send('Runtime.evaluate', {
      expression: `(() => {
        const el = document.getElementById('out');
        if (!el || el.dataset.fail === undefined) return null;
        return { text: el.textContent, pass: +el.dataset.pass, fail: +el.dataset.fail };
      })()`,
      returnByValue: true,
    }, sessionId);
    return r.result?.value ?? null;
  }, { timeout: 120000, interval: 250, label: '浏览器自检完成' }).catch(async (e) => {
    // 超时时把页面现状抓回来，便于诊断
    const r = await cdp.send('Runtime.evaluate', {
      expression: `document.getElementById('out') ? document.getElementById('out').textContent : '(无 #out)'`,
      returnByValue: true,
    }, sessionId).catch(() => null);
    log('\n── 超时时的页面输出 ──');
    log(r?.result?.value ?? '(无法读取)');
    log('── 页面控制台（全部） ──');
    for (const l of consoleAll.slice(-40)) log('  ' + l);
    throw e;
  });

  log('\n──────── 浏览器自检结果 ────────');
  log(result.text);
  if (consoleErrors.length) {
    log('\n页面控制台错误:');
    for (const e of consoleErrors.slice(0, 10)) log('  · ' + e);
  } else {
    log('\n页面控制台: 无错误');
  }
  log('────────────────────────────────');

  ws.close();
  return result.fail === 0 && consoleErrors.length === 0 ? 0 : 1;
}

main()
  .then((code) => {
    cleanup();
    process.exit(code);
  })
  .catch((err) => {
    console.error('运行失败:', err.message);
    cleanup();
    process.exit(2);
  });

function cleanup() {
  try { child?.kill('SIGKILL'); } catch {}
  try { rmSync(profileDir, { recursive: true, force: true }); } catch {}
}
