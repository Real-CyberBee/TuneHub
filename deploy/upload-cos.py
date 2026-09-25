#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
# Copyright 2025 Real-CyberBee
"""把 TuneHub 静态站点上传到腾讯云 COS。

用法：
    TENCENTCLOUD_SECRET_ID=... TENCENTCLOUD_SECRET_KEY=... \
    python3 deploy/upload-cos.py --dist .deploy

通常不用手敲——`deploy/deploy.sh` 会带着环境变量调用它。
"""

from __future__ import annotations

import argparse
import hashlib
import os
import sys
from pathlib import Path

from cos_client import (
    NO_STORE,
    cache_control_for,
    content_type_for,
    head_etag,
    iter_files,
    put_object,
)


def main() -> int:
    parser = argparse.ArgumentParser(description="上传 TuneHub 静态站点到腾讯云 COS")
    parser.add_argument("--dist", required=True, help="待上传目录")
    parser.add_argument("--bucket", default=os.getenv("TUNEHUB_BUCKET", "tunehub-1454836334"))
    parser.add_argument("--region", default=os.getenv("COS_REGION", "ap-guangzhou"))
    parser.add_argument("--retries", type=int, default=4)
    parser.add_argument("--force", action="store_true", help="忽略 ETag，全部重传")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    secret_id = os.getenv("TENCENTCLOUD_SECRET_ID") or os.getenv("TENCENT_CLOUD_SECRET_ID")
    secret_key = os.getenv("TENCENTCLOUD_SECRET_KEY") or os.getenv("TENCENT_CLOUD_SECRET_KEY")
    if not secret_id or not secret_key:
        print("缺少 TENCENTCLOUD_SECRET_ID / TENCENTCLOUD_SECRET_KEY", file=sys.stderr)
        return 1

    dist = Path(args.dist)
    if not dist.is_dir():
        print(f"目录不存在：{dist}", file=sys.stderr)
        return 1

    files = list(iter_files(dist))
    total = sum(path.stat().st_size for path in files)
    print(f"📦 {len(files)} 个文件，共 {total / 1024:.0f} KiB → cos://{args.bucket}/")

    failures = 0
    skipped = 0
    uploaded = 0
    for path in files:
        key = path.relative_to(dist).as_posix()
        body = path.read_bytes()
        if args.dry_run:
            cache = cache_control_for(key)
            mark = "no-store" if cache == NO_STORE else "1d"
            print(f"  · {key}  [{mark}]")
            continue
        if not args.force and head_etag(secret_id, secret_key, args.bucket, args.region, key) == hashlib.md5(body).hexdigest():
            skipped += 1
            continue
        ok, error = put_object(
            secret_id, secret_key, args.bucket, args.region,
            key, body, content_type_for(path), cache_control_for(key), retries=max(1, args.retries),
        )
        if ok:
            uploaded += 1
            print(f"  ✅ {key}")
        else:
            failures += 1
            print(f"  ❌ {key}: {error}", file=sys.stderr)

    if not args.dry_run:
        print(f"   上传 {uploaded} 个，跳过 {skipped} 个（内容未变）")
    if failures:
        print(f"❌ 有 {failures} 个文件上传失败", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
