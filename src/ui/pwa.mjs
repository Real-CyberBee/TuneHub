// SPDX-License-Identifier: Apache-2.0
// Copyright 2025 Real-CyberBee
/**
 * PWA 接线：注册 Service Worker（离线 + 可安装），并在浏览器允许时给出安装入口。
 *
 * 三个页面都 import 这个模块；它不做任何音乐相关的事。
 */

import { t } from "./i18n.mjs";

const SW_URL = "./sw.js";
const BUTTON_ID = "tunehubInstallBtn";

let deferredPrompt = null;
let button = null;

function isStandalone() {
  return (
    window.matchMedia?.("(display-mode: standalone)")?.matches ||
    window.navigator.standalone === true
  );
}

const BUTTON_CSS = `
#${BUTTON_ID} {
  position: fixed;
  right: max(14px, env(safe-area-inset-right));
  bottom: max(14px, env(safe-area-inset-bottom));
  z-index: 40;
  padding: 9px 15px;
  border-radius: 999px;
  border: 1px solid rgba(255, 209, 102, 0.42);
  background: rgba(15, 17, 26, 0.92);
  color: #ffd166;
  font: 600 13px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  letter-spacing: 0.02em;
  cursor: pointer;
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.45);
  -webkit-backdrop-filter: blur(10px);
  backdrop-filter: blur(10px);
}
#${BUTTON_ID}:hover { border-color: #ffd166; }
#${BUTTON_ID}:disabled { opacity: 0.6; cursor: default; }
`;

function injectButtonStyles() {
  if (document.getElementById(`${BUTTON_ID}Style`)) return;
  const style = document.createElement("style");
  style.id = `${BUTTON_ID}Style`;
  style.textContent = BUTTON_CSS;
  document.head.appendChild(style);
}

function ensureButton() {
  if (button || isStandalone()) return button;
  injectButtonStyles();
  button = document.createElement("button");
  button.id = BUTTON_ID;
  button.type = "button";
  button.hidden = true;
  button.addEventListener("click", async () => {
    if (!deferredPrompt) return;
    button.disabled = true;
    try {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === "accepted") hideButton();
    } catch {
      // 用户取消或浏览器拒绝，保持按钮可再试。
    } finally {
      deferredPrompt = null;
      button.disabled = false;
    }
  });
  document.body.appendChild(button);
  refreshInstallButton();
  return button;
}

function hideButton() {
  if (button) button.hidden = true;
}

/** 语言切换后刷新按钮文案。 */
export function refreshInstallButton() {
  if (!button) return;
  button.textContent = t("installApp");
  button.title = t("installAppTitle");
  button.setAttribute("aria-label", t("installApp"));
  button.hidden = !deferredPrompt;
}

function watchInstallPrompt() {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredPrompt = event;
    ensureButton();
    refreshInstallButton();
  });
  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    hideButton();
  });
}

/**
 * 注册 Service Worker。
 * 只在安全上下文（https 或 localhost）下注册——file:// 与普通 http 都不支持。
 */
export function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  const { protocol, hostname } = location;
  const local = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
  if (protocol !== "https:" && !local) return;

  window.addEventListener("load", async () => {
    try {
      const registration = await navigator.serviceWorker.register(SW_URL, { scope: "./" });
      // 已经装了新版本但还在等待：让它在下次导航时接管。
      if (registration.waiting) registration.waiting.postMessage("tunehub:skip-waiting");
      registration.addEventListener("updatefound", () => {
        const installing = registration.installing;
        installing?.addEventListener("statechange", () => {
          if (installing.state === "installed" && navigator.serviceWorker.controller) {
            installing.postMessage("tunehub:skip-waiting");
          }
        });
      });
    } catch (error) {
      console.warn("[TuneHub] Service Worker 注册失败，离线能力不可用：", error);
    }
  });
}

/** 页面启动时调用一次。 */
export function initPwa() {
  registerServiceWorker();
  watchInstallPrompt();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", ensureButton, { once: true });
  } else {
    ensureButton();
  }
}
