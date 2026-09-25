# 部署到 music.cyberbee.top

TuneHub 是**零构建的纯静态站点**：没有 `npm install`，没有打包，发布就是把仓库里那几个文件原样放到对象存储上，再让 CDN 回源。

```
浏览器 ──▶ music.cyberbee.top (腾讯云 CDN，gzip / HTTPS)
              └──▶ tunehub-1454836334.cos-website.ap-guangzhou.myqcloud.com
                      （COS 桶，公共读 + 静态网站，索引 index.html）
```

| 部件 | 值 |
|---|---|
| 加速域名 | `music.cyberbee.top`（CNAME → `music.cyberbee.top.cdn.dnsv1.com`） |
| COS 桶 | `tunehub-1454836334`，`ap-guangzhou`，**公共读** |
| 证书 | 腾讯云免费 DV（TrustAsia），`DNS_AUTO` 自动验证 |
| DNS | DNSPod 上 `cyberbee.top` 的 `music` 记录 |

## 0. 密钥（绝不入库）

脚本只从环境变量或**未入库**的 `.env.deploy.local` 读凭据，顺序是：

1. 进程环境变量 `TENCENTCLOUD_SECRET_ID` / `TENCENTCLOUD_SECRET_KEY`
2. `deploy/.env.deploy.local`
3. `../cyberbee-portal/.env.deploy.local`（与门户站共用一套）

```bash
cp deploy/.env.deploy.example deploy/.env.deploy.local
chmod 600 deploy/.env.deploy.local
# 填入腾讯云密钥
```

`.gitignore` 已经排除 `.env.deploy.local`、`*.pem`、`*.key`、`.deploy/`。
`tests/pwa.test.mjs` 里有一条测试专门守着这件事：密钥文件必须被忽略，部署脚本里不许出现疑似 AK/SK 的字符串。

> 生产环境建议用 CAM 子账号，只授予 COS / CDN / DNSPod / SSL 这四类权限，而不是主账号密钥。

## 1. 一次性基础设施

```bash
python3 deploy/infra.py setup
```

幂等地做完这五件事（已经存在的会跳过）：

1. 建 COS 桶、设为公共读、配置静态网站（索引 `index.html`）
2. 添加 CDN 加速域名，回源到桶的 `cos-website` 端点
3. 在 DNSPod 上把 `music` 指到 CDN 给的 CNAME
4. 申请（或复用）一张覆盖该域名的免费 DV 证书
5. 配置 CDN 缓存、gzip 压缩，并把证书绑上去

之后随时可以复查：

```bash
python3 deploy/infra.py status
dig +short music.cyberbee.top        # 期望 xxx.cdn.dnsv1.com 的解析
```

> 证书走 `DNS_AUTO` 自动验证，通常几分钟内签发。首次 `setup` 会等它签完再绑定 HTTPS；
> 如果等待超时，稍后重跑 `python3 deploy/infra.py setup` 即可（证书申请是幂等的）。

## 2. 发版

```bash
bash deploy/deploy.sh
```

流程：

1. `node --test "tests/*.test.mjs"` + 内容包校验（`--skip-tests` 可跳过）
2. 把运行时文件 rsync 到 `.deploy/`：三个页面、`sw.js`、`manifest.webmanifest`、`src/`、`icons/`、`LICENSE`、`NOTICE`
3. 把 `sw.js` 里的 `__TUNEHUB_VERSION__` 替换成 `git rev-parse --short HEAD`（脏工作区会带 `-dirty`）
4. 上传到 COS（内容没变的文件按 ETag 跳过）
5. 刷新 CDN 缓存
6. 源站与线上各跑一遍 HTTP 自检

常用开关：

```bash
bash deploy/deploy.sh --stage-only     # 只组装 .deploy/，不碰线上
bash deploy/deploy.sh --skip-tests     # 跳过测试
bash deploy/deploy.sh --no-purge       # 上传但不刷 CDN
```

## 3. 缓存策略（发版能否立刻生效的关键）

| 文件 | Cache-Control | 为什么 |
|---|---|---|
| `*.html`、`manifest.webmanifest` | `no-store, no-cache, must-revalidate` | 入口必须每次拿到最新的，否则用户看到旧界面 |
| `sw.js` | `no-store, no-cache, must-revalidate` | **Service Worker 一旦被缓存住，浏览器就永远等不到新版本** |
| 其余静态资源 | `public, max-age=86400` | 首屏更快；SW 预缓存时带 `cache: reload` 绕过 HTTP 缓存，所以长缓存不影响发版 |

CDN 侧对应配置了：`*` 缓存 1 天、`html`/`webmanifest` 不缓存，并且 `IgnoreCacheControl=off`
（尊重源站的 `Cache-Control`）。每次发版还会整目录刷新一次。

## 4. Service Worker 与版本

`sw.js` 采用「导航 network-first + 其余 stale-while-revalidate」：

- **导航请求**先走网络，断网才回退到缓存的外壳——所以发版后刷新一次就能拿到新版本。
- **其余同源请求**先给缓存（首屏快、离线可用），同时后台拉一份新的写回。
- 缓存名里带发布版本号，`activate` 时会删掉所有旧缓存。

`tests/pwa.test.mjs` 会从三个 HTML 入口遍历 import 图，确认 `PRECACHE` 没有漏文件——
漏一个模块，离线打开就是白屏，而且只有断网时才暴露。

## 5. 验收

```bash
curl -sI https://music.cyberbee.top/ | head -1                  # 期望 200
curl -sI https://music.cyberbee.top/sw.js | grep -i cache-control
curl -s  https://music.cyberbee.top/manifest.webmanifest | head -3
```

浏览器里再确认三件事：

1. DevTools → Application → Manifest：可安装、图标正常
2. Application → Service Workers：已激活，Cache Storage 里有 `tunehub-<版本>`
3. 点播放 → 锁屏/通知栏出现曲目信息，按暂停能停、再按继续能接着放

## 6. 回滚

静态站点没有"半套代码"的问题，直接用上一版重新发一次即可：

```bash
git checkout <上一个 commit>
bash deploy/deploy.sh
```

CDN 刷新是整目录的，所以回滚也会立刻对所有边缘节点生效。

## 7. 排查

| 症状 | 看哪里 |
|---|---|
| 线上还是旧界面 | `curl -sI .../sw.js \| grep -i cache`；CDN 是否刷新成功；浏览器里注销 SW 再看 |
| 装不了 PWA | 必须 HTTPS；`manifest.webmanifest` 的 Content-Type 要是 `application/manifest+json` |
| 离线白屏 | `sw.js` 的 `PRECACHE` 漏了模块——跑 `node --test tests/pwa.test.mjs` |
| HTTPS 报证书错误 | `python3 deploy/infra.py status` 看证书状态；`setup` 会重试申请与绑定 |
| DNS 还没生效 | `dig +short music.cyberbee.top`；DNSPod 记录是 CNAME，TTL 600 |
| 上传 403 | 密钥权限是否覆盖 COS / CDN / DNSPod / SSL；桶名有没有写错 |
