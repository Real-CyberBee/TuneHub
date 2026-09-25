# SPDX-License-Identifier: Apache-2.0
# Copyright 2025 Real-CyberBee
"""腾讯云 COS 的最小客户端（XML API + v5 签名，仅标准库）。

只实现部署 TuneHub 需要的那几个操作：建桶、设公共读、配静态网站、上传对象。
COS 运行时零依赖，部署脚本也不想为了几个 PUT 去装 SDK。
"""

from __future__ import annotations

import hashlib
import hmac
import mimetypes
import time
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import quote

# HTML / manifest / sw.js 必须每次回源校验，否则发版后浏览器与 CDN 都还捧着旧文件。
NO_STORE_SUFFIXES = (".html", ".webmanifest")
NO_STORE_NAMES = {"sw.js"}
LONG_CACHE = "public, max-age=86400"
NO_STORE = "no-store, no-cache, must-revalidate"

WEBSITE_XML = (
    '<?xml version="1.0" encoding="UTF-8"?>'
    "<WebsiteConfiguration>"
    "<IndexDocument><Suffix>index.html</Suffix></IndexDocument>"
    "<ErrorDocument><Key>index.html</Key></ErrorDocument>"
    "</WebsiteConfiguration>"
)


def cos_sign(secret_id, secret_key, method, path, host, params=None, extra_headers=None, duration=3600):
    """COS v5 (sha1) 签名。path 形如 `/` 或 `/src/ui/app.mjs`。"""
    now = int(time.time())
    sign_time = f"{now};{now + duration}"
    header_pairs = {"host": host}
    for name, value in (extra_headers or {}).items():
        header_pairs[name.lower()] = value
    header_list = sorted(header_pairs)
    # HttpHeaders 内部用 `&` 连接，最后再补一个换行——这一点和直觉相反，
    # 单头（host）时看不出区别，多头（host + x-cos-acl）时必须这样才对得上签名。
    header_string = "&".join(f"{key}={quote(str(header_pairs[key]), safe='')}" for key in header_list)
    param_names = sorted((params or {}).keys())
    param_string = "&".join(f"{key}={quote(str(params[key]), safe='')}" for key in param_names)
    http_string = f"{method.lower()}\n{path}\n{param_string}\n{header_string}\n"
    string_to_sign = f"sha1\n{sign_time}\n{hashlib.sha1(http_string.encode()).hexdigest()}\n"
    sign_key = hmac.new(secret_key.encode(), sign_time.encode(), hashlib.sha1).hexdigest()
    signature = hmac.new(sign_key.encode(), string_to_sign.encode(), hashlib.sha1).hexdigest()
    return (
        "q-sign-algorithm=sha1"
        f"&q-ak={secret_id}"
        f"&q-sign-time={sign_time}"
        f"&q-key-time={sign_time}"
        f"&q-header-list={';'.join(header_list)}"
        f"&q-url-param-list={';'.join(param_names)}"
        f"&q-signature={signature}"
    )


def http_request(method, url, headers, body=None, timeout=180):
    """返回 (status, headers, body)；网络异常时 status=0。"""
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            return response.status, response.headers, response.read()
    except urllib.error.HTTPError as error:
        return error.code, error.headers, error.read()
    except urllib.error.URLError as error:
        return 0, {}, str(error).encode()


def cache_control_for(name: str) -> str:
    if name in NO_STORE_NAMES or name.endswith(NO_STORE_SUFFIXES):
        return NO_STORE
    return LONG_CACHE


def content_type_for(path: Path) -> str:
    if path.suffix == ".mjs":
        return "text/javascript; charset=utf-8"
    guessed = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    if path.suffix in {".html", ".css", ".js", ".json", ".svg", ".webmanifest"} and "charset" not in guessed:
        return f"{guessed}; charset=utf-8"
    return guessed


def iter_files(root: Path):
    for path in sorted(root.rglob("*")):
        if not path.is_file():
            continue
        if path.name == ".DS_Store" or path.name.startswith("._"):
            continue
        yield path


def bucket_host(bucket: str, region: str) -> str:
    return f"{bucket}.cos.{region}.myqcloud.com"


def website_host(bucket: str, region: str) -> str:
    return f"{bucket}.cos-website.{region}.myqcloud.com"


def ensure_bucket(secret_id, secret_key, bucket, region, *, public_read=True, website=True, log=print):
    """建桶 + 设公共读 + 配静态网站。幂等：已存在就跳过创建。"""
    host = bucket_host(bucket, region)
    authorization = cos_sign(secret_id, secret_key, "PUT", "/", host)
    status, _, body = http_request("PUT", f"https://{host}/", {"Authorization": authorization, "Host": host})
    if status in (200, 204):
        log(f"  ✅ 已创建存储桶 {bucket}（{region}）")
    elif status == 409:
        log(f"  · 存储桶 {bucket} 已存在")
    else:
        raise RuntimeError(f"建桶失败 HTTP {status}: {body[:300].decode('utf-8', 'replace')}")

    if public_read:
        # x-cos-* 头必须参与签名，所以这里把它加进 header list。
        acl_headers = {"x-cos-acl": "public-read"}
        authorization = cos_sign(
            secret_id, secret_key, "PUT", "/", host,
            params={"acl": ""}, extra_headers=acl_headers,
        )
        status, _, body = http_request(
            "PUT", f"https://{host}/?acl",
            {"Authorization": authorization, "Host": host, **acl_headers},
        )
        if status != 200:
            raise RuntimeError(f"设置公共读失败 HTTP {status}: {body[:300].decode('utf-8', 'replace')}")
        log("  ✅ 已设为公共读（CDN 回源需要）")

    if website:
        authorization = cos_sign(secret_id, secret_key, "PUT", "/", host, params={"website": ""})
        status, _, body = http_request(
            "PUT", f"https://{host}/?website",
            {
                "Authorization": authorization,
                "Host": host,
                "Content-Type": "application/xml",
                "Content-Length": str(len(WEBSITE_XML.encode())),
            },
            body=WEBSITE_XML.encode(),
        )
        if status != 200:
            raise RuntimeError(f"配置静态网站失败 HTTP {status}: {body[:300].decode('utf-8', 'replace')}")
        log("  ✅ 已配置静态网站（索引 index.html）")


def head_etag(secret_id, secret_key, bucket, region, key):
    host = bucket_host(bucket, region)
    authorization = cos_sign(secret_id, secret_key, "HEAD", f"/{key}", host)
    status, headers, _ = http_request(
        "HEAD", f"https://{host}/{quote(key, safe='/')}",
        {"Authorization": authorization, "Host": host}, timeout=30,
    )
    if status != 200:
        return None
    return (headers.get("ETag") or "").strip('"')


def put_object(secret_id, secret_key, bucket, region, key, body, content_type, cache_control, retries=4, sleep=time.sleep):
    host = bucket_host(bucket, region)
    url = f"https://{host}/{quote(key, safe='/')}"
    headers = {
        "Authorization": cos_sign(secret_id, secret_key, "PUT", f"/{key}", host),
        "Host": host,
        "Content-Type": content_type,
        "Content-Length": str(len(body)),
        "Cache-Control": cache_control,
        "Connection": "close",
    }
    last = ""
    for attempt in range(1, retries + 1):
        status, _, payload = http_request("PUT", url, headers, body=body)
        if status in (200, 201):
            return True, ""
        last = f"HTTP {status} {payload[:200].decode('utf-8', 'replace')}"
        if attempt < retries:
            sleep(3)
    return False, last
