// SPDX-License-Identifier: Apache-2.0
// Copyright 2025 Real-CyberBee
/**
 * TuneHub service worker —— 应用外壳预缓存 + 离线可用。
 *
 * 设计取舍：
 *  - **导航请求走 network-first**：先拿最新 HTML，断网时回退到缓存的外壳。
 *    这样发版后用户刷新一次就能拿到新版本，而不是被缓存钉死在旧版。
 *  - **其余同源请求走 stale-while-revalidate**：先返回缓存（首屏快、离线可用），
 *    同时后台拉一份新的写回缓存。
 *  - `VERSION` 的占位符由 deploy/deploy.sh 在发布时替换成本次发布的 commit，
 *    因此 sw.js 内容一变，浏览器就会安装新 worker 并清掉旧缓存。
 *
 * 图标 / manifest / HTML 的路径全部是相对路径，所以整套站点放在子路径下也能用。
 */

const VERSION = "__TUNEHUB_VERSION__";
const CACHE_PREFIX = "tunehub-";
const CACHE = `${CACHE_PREFIX}${VERSION}`;

// 应用外壳：三个页面 + 它们的全部 ES Module 依赖 + 样式 + 图标。
// tests/pwa.test.mjs 会遍历 import 图，确认这里没有漏文件。
const PRECACHE = [
  "./",
  "./index.html",
  "./handpan.html",
  "./handpan-guide.html",
  "./manifest.webmanifest",
  "./icons/icon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon.png",
  "./icons/favicon-32.png",
  "./src/ui/style.css",
  "./src/ui/handpan.css",
  "./src/ui/handpan-guide.css",
  "./src/ui/app.mjs",
  "./src/ui/handpan.mjs",
  "./src/ui/handpan-guide.mjs",
  "./src/ui/i18n.mjs",
  "./src/ui/pwa.mjs",
  "./src/ui/media-session.mjs",
  "./src/audio/engine.mjs",
  "./src/audio/player.mjs",
  "./src/audio/export.mjs",
  "./src/audio/midi.mjs",
  "./src/core/rng.mjs",
  "./src/core/model.mjs",
  "./src/core/generate.mjs",
  "./src/core/ambient.mjs",
  "./src/core/handpan.mjs",
  "./src/core/score.mjs",
  "./src/content/builtin.mjs",
  "./src/content/registry.mjs",
  "./src/content/packs/handpan-solo/index.mjs",
  "./src/content/packs/tunehub-ambient/index.mjs",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // 用 reload 绕开 HTTP 缓存，确保预缓存的是本次发布的真实文件。
      await cache.addAll(
        PRECACHE.map((url) => new Request(url, { cache: "reload" })),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE)
          .map((key) => caches.delete(key)),
      );
      // 让新 worker 立刻接管已打开的页面，不必等用户重开。
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "tunehub:skip-waiting") self.skipWaiting();
});

function isCacheable(request, response) {
  return (
    request.method === "GET" &&
    response &&
    response.status === 200 &&
    response.type === "basic" &&
    !request.headers.has("range")
  );
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (isCacheable(request, response)) {
      cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  } catch (error) {
    const cached =
      (await cache.match(request)) ||
      (await cache.match("./index.html")) ||
      (await cache.match("./"));
    if (cached) return cached;
    throw error;
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((response) => {
      if (isCacheable(request, response)) {
        cache.put(request, response.clone()).catch(() => {});
      }
      return response;
    })
    .catch(() => null);
  if (cached) return cached;
  const response = await network;
  if (response) return response;
  throw new Error(`offline and not cached: ${request.url}`);
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // 永远不要用 SW 缓存拦截 sw.js 自身，否则新版本无法生效。
  if (url.pathname.endsWith("/sw.js")) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request));
    return;
  }
  event.respondWith(staleWhileRevalidate(request));
});
