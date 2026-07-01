#!/usr/bin/env python3
# Static file server that disables caching — avoids the browser serving stale ES
# modules during multi-agent dev (plain `http.server` sends no cache headers, so
# Chrome heuristically caches old .js and edits don't show up on reload).
# Usage: python3 devserver_nocache.py [port]  (default 5194)
import http.server
import socketserver
import sys
import os

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 5194
os.chdir(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()


with socketserver.TCPServer(('', PORT), NoCacheHandler) as httpd:
    print(f'no-cache dev server on :{PORT}')
    httpd.serve_forever()
