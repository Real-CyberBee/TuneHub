#!/usr/bin/env python3
"""
TuneHub 本地静态服务器。

用法：
    python3 serve.py            # 默认 8765 端口
    python3 serve.py 9000

之所以需要它：页面使用 ES Module（<script type="module">），
直接双击 index.html 会因 file:// 的 CORS 限制而无法加载模块。
"""

import http.server
import socketserver
import sys
import os

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
ROOT = os.path.dirname(os.path.abspath(__file__))


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        # 开发期禁用缓存，避免改了代码却看到旧版本
        self.send_header("Cache-Control", "no-store, max-age=0")
        super().end_headers()

    def log_message(self, fmt, *args):
        # 只记录错误，保持终端干净
        if args and str(args[1]).startswith(("4", "5")):
            super().log_message(fmt, *args)


if __name__ == "__main__":
    os.chdir(ROOT)
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("127.0.0.1", PORT), Handler) as httpd:
        print(f"TuneHub 已启动： http://127.0.0.1:{PORT}/")
        print("按 Ctrl+C 停止")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n已停止")
