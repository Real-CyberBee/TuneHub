#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Copyright 2025 Real-CyberBee
#
# TuneHub 发布脚本：暂存静态产物 → 上传 COS → 刷新 CDN → 自检。
#
#   bash deploy/deploy.sh                 # 完整发布
#   bash deploy/deploy.sh --skip-tests    # 跳过 node --test
#   bash deploy/deploy.sh --stage-only    # 只组装 .deploy/，不碰线上
#   bash deploy/deploy.sh --no-purge      # 上传但不刷 CDN 缓存
#
# 首次使用前先跑一次基础设施：
#   python3 deploy/infra.py setup
#
# 密钥来源（优先级从高到低）：进程环境变量 → deploy/.env.deploy.local
# → ../cyberbee-portal/.env.deploy.local。密钥文件不入库（见 .gitignore）。

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
cd "$ROOT"

BUCKET="${TUNEHUB_BUCKET:-tunehub-1454836334}"
REGION="${COS_REGION:-ap-guangzhou}"
DOMAIN="${TUNEHUB_DOMAIN:-music.cyberbee.top}"
STAGE="$ROOT/.deploy"

SKIP_TESTS=false
STAGE_ONLY=false
DO_PURGE=true
for arg in "$@"; do
  case "$arg" in
    --skip-tests) SKIP_TESTS=true ;;
    --stage-only) STAGE_ONLY=true ;;
    --no-purge) DO_PURGE=false ;;
    *) echo "未知参数：$arg"; exit 2 ;;
  esac
done

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }

load_env() {
  local file="$1"
  [ -f "$file" ] || return 0
  set -a
  # shellcheck disable=SC1090
  . "$file"
  set +a
  echo "🔐 已加载 $file"
}

load_env "$HERE/.env.deploy.local"
if [ -z "${TENCENTCLOUD_SECRET_ID:-}" ] && [ -z "${TENCENT_CLOUD_SECRET_ID:-}" ]; then
  load_env "$ROOT/../cyberbee-portal/.env.deploy.local"
fi

if [ "$SKIP_TESTS" = false ]; then
  say "1/6 跑测试"
  node --test "tests/*.test.mjs"
  python3 examples/validate.py examples/content-pack >/dev/null
else
  say "1/6 跳过测试"
fi

say "2/6 组装发布目录 .deploy/"
rm -rf "$STAGE"
mkdir -p "$STAGE"
# 只发布运行时需要的文件：文档、测试、示例、部署脚本都不上线。
rsync -a --exclude '.DS_Store' \
  index.html handpan.html handpan-guide.html manifest.webmanifest \
  LICENSE NOTICE icons src "$STAGE"/

VERSION="$(git rev-parse --short HEAD 2>/dev/null || echo manual)"
if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
  VERSION="${VERSION}-dirty"
fi
# sw.js 里的版本号决定了浏览器缓存名，必须在发布时替换成这次发布的值。
sed "s/__TUNEHUB_VERSION__/${VERSION}/" sw.js > "$STAGE/sw.js"
if grep -q "__TUNEHUB_VERSION__" "$STAGE/sw.js"; then
  echo "❌ sw.js 的版本占位符没有被替换，放弃发布"
  exit 1
fi
echo "   版本：$VERSION"
echo "   文件：$(find "$STAGE" -type f | wc -l) 个，$(du -sh "$STAGE" | cut -f1)"

if [ "$STAGE_ONLY" = true ]; then
  say "已停在 --stage-only，产物在 $STAGE"
  exit 0
fi

if [ -z "${TENCENTCLOUD_SECRET_ID:-}${TENCENT_CLOUD_SECRET_ID:-}" ]; then
  echo "❌ 缺少腾讯云密钥：请设置 TENCENTCLOUD_SECRET_ID / TENCENTCLOUD_SECRET_KEY，"
  echo "   或把凭据写进 deploy/.env.deploy.local（该文件已被 .gitignore 排除）。"
  exit 1
fi

say "3/6 上传到 COS（cos://$BUCKET/）"
python3 "$HERE/upload-cos.py" --dist "$STAGE" --bucket "$BUCKET" --region "$REGION"

say "4/6 刷新 CDN 缓存（https://$DOMAIN/）"
if [ "$DO_PURGE" = true ]; then
  python3 "$HERE/infra.py" --bucket "$BUCKET" --region "$REGION" --domain "$DOMAIN" purge
else
  echo "   已跳过（--no-purge）"
fi

say "5/6 源站自检"
curl -s -o /dev/null -w "   COS 源站 index.html → %{http_code}\n" \
  "https://${BUCKET}.cos-website.${REGION}.myqcloud.com/index.html" || true
curl -s -o /dev/null -w "   COS 源站 sw.js → %{http_code}\n" \
  "https://${BUCKET}.cos-website.${REGION}.myqcloud.com/sw.js" || true

say "6/6 线上自检"
for path in "" "handpan.html" "manifest.webmanifest" "sw.js" "icons/icon-192.png"; do
  printf "   https://%s/%s → " "$DOMAIN" "$path"
  curl -s -o /dev/null -w "%{http_code}\n" --max-time 25 "https://${DOMAIN}/${path}" || echo "（DNS 可能还没生效）"
done

echo
echo "✅ 发布完成：https://$DOMAIN/"
echo "   提示：Service Worker 会在下次导航时接管；已安装的 PWA 重新打开即可拿到新版本。"
