#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
# Copyright 2025 Real-CyberBee
"""TuneHub 在 cyberbee.top 下的腾讯云基础设施（一次性 / 运维用）。

    python3 deploy/infra.py status           # 看桶、CDN 域名、DNS、证书现状
    python3 deploy/infra.py setup            # 幂等：建桶 + 配静态网站 + 建 CDN 域名 + DNS + 证书
    python3 deploy/infra.py apply-cert       # 只申请（或复用）免费 DV 证书
    python3 deploy/infra.py purge            # 刷新 CDN 缓存

密钥只从环境变量或未入库的 .env.deploy.local 读取：
    1. 进程环境变量 TENCENTCLOUD_SECRET_ID / TENCENTCLOUD_SECRET_KEY
    2. deploy/.env.deploy.local
    3. ../cyberbee-portal/.env.deploy.local（与门户站共用一套凭据）

只用标准库实现 TC3-HMAC-SHA256，不引入腾讯云 SDK。
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import hmac
import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from cos_client import ensure_bucket, website_host  # noqa: E402

HERE = Path(__file__).resolve().parent
DEFAULT_BUCKET = "tunehub-1454836334"
DEFAULT_REGION = "ap-guangzhou"
DEFAULT_DOMAIN = "music.cyberbee.top"
DEFAULT_ROOT = "cyberbee.top"
DEFAULT_CNAME_SUFFIX = ".cdn.dnsv1.com"


# ---------------------------------------------------------------------------
# 凭据
# ---------------------------------------------------------------------------

def load_env_file(path: Path) -> None:
    if not path.exists():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def credentials() -> tuple[str, str]:
    for candidate in (HERE / ".env.deploy.local", HERE.parent.parent / "cyberbee-portal" / ".env.deploy.local"):
        load_env_file(candidate)
    secret_id = os.getenv("TENCENTCLOUD_SECRET_ID") or os.getenv("TENCENT_CLOUD_SECRET_ID")
    secret_key = os.getenv("TENCENTCLOUD_SECRET_KEY") or os.getenv("TENCENT_CLOUD_SECRET_KEY")
    if not secret_id or not secret_key:
        sys.exit("缺少 TENCENTCLOUD_SECRET_ID / TENCENTCLOUD_SECRET_KEY（见 deploy/.env.deploy.example）")
    return secret_id, secret_key


# ---------------------------------------------------------------------------
# TC3 调用
# ---------------------------------------------------------------------------

def tc3(host: str, service: str, version: str, action: str, payload: dict, region: str | None = None) -> dict:
    secret_id, secret_key = credentials()
    body = json.dumps(payload, separators=(",", ":"), ensure_ascii=False)
    timestamp = int(time.time())
    date = dt.datetime.fromtimestamp(timestamp, dt.timezone.utc).strftime("%Y-%m-%d")
    canonical_headers = f"content-type:application/json; charset=utf-8\nhost:{host}\n"
    signed_headers = "content-type;host"
    hashed_payload = hashlib.sha256(body.encode()).hexdigest()
    canonical_request = "\n".join(["POST", "/", "", canonical_headers, signed_headers, hashed_payload])
    scope = f"{date}/{service}/tc3_request"
    string_to_sign = "\n".join(
        ["TC3-HMAC-SHA256", str(timestamp), scope, hashlib.sha256(canonical_request.encode()).hexdigest()]
    )
    secret_date = hmac.new(("TC3" + secret_key).encode(), date.encode(), hashlib.sha256).digest()
    secret_service = hmac.new(secret_date, service.encode(), hashlib.sha256).digest()
    secret_signing = hmac.new(secret_service, b"tc3_request", hashlib.sha256).digest()
    signature = hmac.new(secret_signing, string_to_sign.encode(), hashlib.sha256).hexdigest()
    headers = {
        "Authorization": (
            f"TC3-HMAC-SHA256 Credential={secret_id}/{scope}, "
            f"SignedHeaders={signed_headers}, Signature={signature}"
        ),
        "Content-Type": "application/json; charset=utf-8",
        "Host": host,
        "X-TC-Action": action,
        "X-TC-Version": version,
        "X-TC-Timestamp": str(timestamp),
    }
    if region:
        headers["X-TC-Region"] = region
    request = urllib.request.Request(f"https://{host}/", data=body.encode(), headers=headers, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=40) as response:
            data = json.loads(response.read().decode())
    except urllib.error.HTTPError as error:
        data = json.loads(error.read().decode())
    result = data.get("Response", {})
    if "Error" in result:
        raise RuntimeError(f"{action} 失败：{result['Error']}")
    return result


def cdn(action: str, payload: dict) -> dict:
    return tc3("cdn.tencentcloudapi.com", "cdn", "2018-06-06", action, payload)


def dnspod(action: str, payload: dict) -> dict:
    return tc3("dnspod.tencentcloudapi.com", "dnspod", "2021-03-23", action, payload)


def ssl(action: str, payload: dict) -> dict:
    return tc3("ssl.tencentcloudapi.com", "ssl", "2019-12-05", action, payload)


# ---------------------------------------------------------------------------
# CDN
# ---------------------------------------------------------------------------

def find_domain(domain: str) -> dict | None:
    result = cdn("DescribeDomains", {"Offset": 0, "Limit": 100})
    for item in result.get("Domains", []):
        if item.get("Domain") == domain:
            return item
    return None


def ensure_cdn_domain(domain: str, bucket: str, region: str, area: str = "mainland") -> dict:
    existing = find_domain(domain)
    if existing:
        print(f"  · CDN 域名已存在：{domain}（{existing.get('Status')}）")
        return existing
    origin_host = website_host(bucket, region)
    result = cdn("AddCdnDomain", {
        "Domain": domain,
        "ServiceType": "web",
        "Area": area,
        "ProjectId": 0,
        "Origin": {
            "Origins": [origin_host],
            "OriginType": "domain",
            "ServerName": origin_host,
            "OriginPullProtocol": "http",
        },
    })
    print(f"  ✅ 已添加 CDN 域名 {domain}（RequestId {result.get('RequestId', '?')}）")
    # AddCdnDomain 之后配置不一定立刻可读，稍等再查一次。
    for _ in range(10):
        time.sleep(2)
        found = find_domain(domain)
        if found:
            return found
    raise RuntimeError(f"CDN 域名 {domain} 添加后查不到，请稍后用 status 复查")


def ensure_cdn_behavior(domain: str, cert_id: str | None) -> None:
    """缓存策略 + 压缩 + HTTPS。只传需要改的字段，其余保持默认。"""
    payload: dict = {
        "Domain": domain,
        "Cache": {
            "SimpleCache": {
                "CacheRules": [
                    {"CacheType": "all", "CacheContents": ["*"], "CacheTime": 86400},
                    {"CacheType": "file", "CacheContents": ["html", "webmanifest"], "CacheTime": 0},
                ],
                "FollowOrigin": "off",
                "IgnoreCacheControl": "off",
                "CompareMaxAge": "off",
                "IgnoreSetCookie": "off",
            }
        },
        "Compression": {
            "Switch": "on",
            "CompressionRules": [
                {
                    "Compress": True,
                    "Algorithms": ["gzip"],
                    "MinLength": 256,
                    "MaxLength": 2097152,
                    # mjs 一定要在列表里：整个应用都是 ES Module，
                    # 只写 js 的话模块会以未压缩的形式发出去。
                    "FileExtensions": ["mjs", "js", "html", "css", "json", "svg", "webmanifest", "xml", "txt"],
                    "RulePaths": [],
                }
            ],
        },
        # PWA 需要安全上下文：Service Worker 只在 HTTPS（或 localhost）下注册。
        # 明文 HTTP 一律 301 到 HTTPS，避免用户装了"半个"应用。
        "ForceRedirect": {
            "Switch": "on",
            "RedirectType": "https",
            "RedirectStatusCode": 301,
        },
    }
    if cert_id:
        payload["Https"] = {
            "Switch": "on",
            "Http2": "on",
            "CertInfo": {"CertId": cert_id},
            "TlsVersion": ["TLSv1.2", "TLSv1.3"],
        }
    try:
        cdn("UpdateDomainConfig", payload)
        print(f"  ✅ 已配置缓存 / 压缩{' / HTTPS' if cert_id else ''}：{domain}")
    except RuntimeError as error:
        print(f"  ⚠️  UpdateDomainConfig 失败（域名仍可用，可稍后重试）：{error}", file=sys.stderr)


def purge(domain: str) -> None:
    paths = [
        f"https://{domain}/",
        f"https://{domain}/index.html",
        f"https://{domain}/handpan.html",
        f"https://{domain}/handpan-guide.html",
        f"https://{domain}/manifest.webmanifest",
        f"https://{domain}/sw.js",
    ]
    result = cdn("PurgePathCache", {"Paths": paths, "FlushType": "flush"})
    print(f"  ✅ 已提交 CDN 刷新，TaskId {result.get('TaskId', '?')}")


# ---------------------------------------------------------------------------
# DNS
# ---------------------------------------------------------------------------

def list_records(root: str) -> list[dict]:
    result = dnspod("DescribeRecordList", {"Domain": root, "Limit": 200})
    return result.get("RecordList", [])


def ensure_cname(root: str, name: str, value: str) -> None:
    for record in list_records(root):
        if record.get("Name") != name:
            continue
        if record.get("Type") == "CNAME" and record.get("Value").rstrip(".") == value.rstrip("."):
            print(f"  · DNS 已存在：{name}.{root} → {value}")
            return
        dnspod("ModifyRecord", {
            "Domain": root,
            "RecordId": record["RecordId"],
            "SubDomain": name,
            "RecordType": "CNAME",
            "RecordLine": "默认",
            "Value": value,
            "TTL": 600,
        })
        print(f"  ♻️  已把 {name}.{root} 从 {record.get('Value')} 改为 {value}")
        return
    dnspod("CreateRecord", {
        "Domain": root,
        "SubDomain": name,
        "RecordType": "CNAME",
        "RecordLine": "默认",
        "Value": value,
        "TTL": 600,
    })
    print(f"  ✅ 已创建 DNS 记录：{name}.{root} → {value}")


# ---------------------------------------------------------------------------
# 证书
# ---------------------------------------------------------------------------

def issued_certificate_for(domain: str, root: str) -> str | None:
    result = ssl("DescribeCertificates", {"Limit": 100})
    for cert in result.get("Certificates", []):
        if cert.get("Status") != 1:
            continue
        names = [name.strip() for name in (cert.get("Domain") or "").replace("；", ",").split(",") if name.strip()]
        if domain in names or f"*.{root}" in names:
            print(f"  · 复用已颁发证书 {cert['CertificateId']}（{cert.get('Domain')}）")
            return cert["CertificateId"]
    return None


def apply_certificate(domain: str, timeout_seconds: int = 900) -> str:
    result = ssl("ApplyCertificate", {"DomainName": domain, "DvAuthMethod": "DNS_AUTO"})
    cert_id = result.get("CertificateId")
    print(f"  ⏳ 已提交免费 DV 证书申请：{cert_id}（DNS 自动验证，通常几分钟内签发）")
    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        # DescribeCertificate 把证书字段直接放在 Response 顶层（老接口才包一层
        # Certificate），所以两种形状都要认。
        result = ssl("DescribeCertificate", {"CertificateId": cert_id})
        info = result.get("Certificate") or result
        status = info.get("Status")
        if status == 1:
            print(f"  ✅ 证书已颁发：{cert_id}（{info.get('Domain')}）")
            return cert_id
        if status in (2, 4, 5):
            raise RuntimeError(f"证书申请失败，状态 {status}（{info.get('StatusName')}）")
        time.sleep(15)
    raise RuntimeError(f"等待证书签发超时（{timeout_seconds}s）。稍后用 status 复查 {cert_id}")


def ensure_certificate(domain: str, root: str) -> str:
    existing = issued_certificate_for(domain, root)
    if existing:
        return existing
    return apply_certificate(domain)


# ---------------------------------------------------------------------------
# 命令
# ---------------------------------------------------------------------------

def cmd_setup(args) -> int:
    secret_id, secret_key = credentials()
    print(f"🚀 配置 {args.domain}（桶 {args.bucket}，地域 {args.region}）")

    print("1/5 存储桶")
    ensure_bucket(secret_id, secret_key, args.bucket, args.region)

    print("2/5 CDN 加速域名")
    item = ensure_cdn_domain(args.domain, args.bucket, args.region, args.area)
    cname = item.get("Cname") or f"{args.domain}{DEFAULT_CNAME_SUFFIX}"

    print("3/5 DNS 解析")
    ensure_cname(args.root, args.domain[: -len(args.root) - 1], cname)

    print("4/5 HTTPS 证书")
    cert_id = ensure_certificate(args.domain, args.root)

    print("5/5 缓存 / 压缩 / HTTPS 绑定")
    ensure_cdn_behavior(args.domain, cert_id)

    print("\n✅ 基础设施就绪。接着跑：bash deploy/deploy.sh")
    print(f"   CNAME：{cname}")
    return 0


def cmd_apply_cert(args) -> int:
    cert_id = ensure_certificate(args.domain, args.root)
    print(f"证书：{cert_id}")
    return 0


def cmd_purge(args) -> int:
    purge(args.domain)
    return 0


def cmd_status(args) -> int:
    print(f"存储桶：{args.bucket}（{args.region}）")
    print(f"网站源站：{website_host(args.bucket, args.region)}")
    try:
        item = find_domain(args.domain)
        if not item:
            print(f"CDN 域名：{args.domain} 不存在")
        else:
            origin = (item.get("Origin") or {}).get("Origins")
            print(f"CDN 域名：{args.domain} | 状态 {item.get('Status')} | CNAME {item.get('Cname')}")
            print(f"  回源：{origin}")
    except RuntimeError as error:
        print(f"CDN 查询失败：{error}")
    try:
        for record in list_records(args.root):
            if record.get("Name") in {"music", "@", "www"}:
                print(f"DNS：{record['Name']}.{args.root} {record['Type']} → {record['Value']}")
    except RuntimeError as error:
        print(f"DNS 查询失败：{error}")
    try:
        result = ssl("DescribeCertificates", {"Limit": 100})
        for cert in result.get("Certificates", []):
            print(f"证书：{cert['CertificateId']} | {cert.get('Domain')} | {cert.get('StatusName')} | 到期 {cert.get('CertEndTime')}")
    except RuntimeError as error:
        print(f"证书查询失败：{error}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="TuneHub 腾讯云基础设施")
    parser.add_argument("--bucket", default=os.getenv("TUNEHUB_BUCKET", DEFAULT_BUCKET))
    parser.add_argument("--region", default=os.getenv("COS_REGION", DEFAULT_REGION))
    parser.add_argument("--domain", default=os.getenv("TUNEHUB_DOMAIN", DEFAULT_DOMAIN))
    parser.add_argument("--root", default=os.getenv("TUNEHUB_ROOT_DOMAIN", DEFAULT_ROOT))
    parser.add_argument("--area", default=os.getenv("TUNEHUB_CDN_AREA", "mainland"))
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("setup").set_defaults(func=cmd_setup)
    sub.add_parser("apply-cert").set_defaults(func=cmd_apply_cert)
    sub.add_parser("purge").set_defaults(func=cmd_purge)
    sub.add_parser("status").set_defaults(func=cmd_status)
    args = parser.parse_args()
    try:
        return args.func(args)
    except RuntimeError as error:
        print(f"❌ {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
