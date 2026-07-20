#!/usr/bin/env python3
"""Dev server for lucas-academy-chinese. Usage: python3 serve.py [port]"""
import http.server
import os
import sys

os.chdir(os.path.dirname(os.path.abspath(__file__)))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8099


class NoStoreHandler(http.server.SimpleHTTPRequestHandler):
    # no-store via HTTP header so ES module imports are never cached on iPads
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


print(f"lucas-academy-chinese at http://0.0.0.0:{PORT}")
http.server.ThreadingHTTPServer(("0.0.0.0", PORT), NoStoreHandler).serve_forever()
