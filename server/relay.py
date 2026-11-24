"""Narrow HTTPS task-page relay. The listener is private; nginx supplies TLS."""
import argparse
import base64
import hmac
import json
import re
import secrets
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

GET_ROUTES = {"/", "/app.js", "/style.css", "/api/roster", "/api/session", "/api/me"}
POST_ROUTES = {"/api/claim", "/api/verify"}
REQUEST_HEADERS = {"authorization", "x-party-entry", "content-type", "origin"}
RESPONSE_HEADERS = {"content-type", "cache-control", "x-content-type-options", "referrer-policy", "x-frame-options", "content-security-policy"}


class Relay:
    def __init__(self, config):
        if not re.fullmatch(r"[A-Za-z0-9_-]{43}", config["token"]):
            raise ValueError("Invalid relay token")
        origin = urlsplit(config["origin"])
        if origin.scheme != "https" or not origin.netloc or origin.path not in ("", "/") or origin.query or origin.fragment or origin.username:
            raise ValueError("Invalid public origin")
        self.token, self.origin = config["token"], config["origin"].rstrip("/")
        self.host = origin.netloc
        self.cv = threading.Condition()
        self.session = ""
        self.client = ""
        self.seen = 0
        self.jobs = {}

    def online(self):
        return bool(self.session) and time.monotonic() - self.seen < 45

    def replace(self, client=""):
        for job in self.jobs.values():
            job["error"] = True
        self.jobs.clear()
        self.session, self.seen = secrets.token_urlsafe(32), time.monotonic()
        self.client = client
        self.cv.notify_all()
        return self.session


def create_server(config, port=18742):
    relay = Relay(config)

    class Handler(BaseHTTPRequestHandler):
        # No application payloads, credentials, player names or URL queries in logs.
        def log_message(self, *args):
            pass

        def send_data(self, status, data, headers=None):
            self.send_response(status)
            for key, value in (headers or {"content-type": "application/json; charset=utf-8"}).items():
                if key.lower() in RESPONSE_HEADERS and isinstance(value, str) and "\r" not in value and "\n" not in value:
                    self.send_header(key, value)
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Connection", "close")
            self.end_headers()
            self.wfile.write(data)

        def js(self, status, data):
            self.send_data(status, json.dumps(data, ensure_ascii=False).encode("utf-8"))

        def read_body(self, size):
            if self.headers.get("Transfer-Encoding"):
                raise ValueError("Invalid transfer encoding")
            length = int(self.headers.get("Content-Length", "0"))
            if length < 0 or length > size:
                raise ValueError("Request too large")
            return self.rfile.read(length)

        def host_command(self):
            if self.command != "POST":
                return self.js(405, {"error": "Method not allowed"})
            if not hmac.compare_digest(self.headers.get("Authorization", ""), "Bearer " + relay.token):
                return self.js(403, {"error": "服务器连接凭证不正确"})
            data = json.loads(self.read_body(800000))
            if not isinstance(data, dict):
                raise ValueError("Invalid command")
            with relay.cv:
                if self.path == "/_party/connect":
                    client = data.get("client", "")
                    if not isinstance(client, str) or not re.fullmatch(r"[A-Za-z0-9_-]{43}", client):
                        raise ValueError("Invalid client identifier")
                    if relay.online() and client != relay.client and data.get("takeover") is not True:
                        return self.js(409, {"error": "服务器已由另一电脑连接，请确认后重新连接"})
                    if relay.session and client == relay.client:
                        relay.seen = time.monotonic()
                        session = relay.session
                    else:
                        session = relay.replace(client)
                    return self.js(200, {"session": session, "service": "wolfsen-party-relay-v1"})
                session = self.headers.get("X-Party-Connection", "")
                if not session or session != relay.session:
                    return self.js(409, {"error": "服务器已由另一电脑连接，请确认后重新连接"})
                relay.seen = time.monotonic()
                if self.path == "/_party/poll":
                    until = time.monotonic() + 20
                    while session == relay.session:
                        pending, wire_size = [], 0
                        for job in relay.jobs.values():
                            if job.get("sent") or job.get("error"):
                                continue
                            size = len(json.dumps(job["request"], ensure_ascii=False).encode("utf-8")) + 2
                            if len(pending) >= 32 or wire_size + size > 500000:
                                break
                            pending.append(job)
                            wire_size += size
                        if pending or time.monotonic() >= until:
                            break
                        relay.cv.wait(max(0.01, until - time.monotonic()))
                    if session != relay.session:
                        return self.js(409, {"error": "服务器连接已替换"})
                    relay.seen = time.monotonic()
                    for j in pending:
                        j["sent"] = True
                    return self.js(200, {"requests": [j["request"] for j in pending]})
                if self.path == "/_party/reply":
                    job = relay.jobs.get(data.get("id"))
                    if job and job["session"] == session:
                        status = data.get("status")
                        if type(status) is not int or status < 200 or status > 599:
                            raise ValueError("Invalid status")
                        response = base64.b64decode(data.get("body", ""), validate=True)
                        if len(response) > 524288 or not isinstance(data.get("headers"), dict):
                            raise ValueError("Response too large")
                        job["response"] = (status, response, {k: v for k, v in data["headers"].items() if k in RESPONSE_HEADERS})
                        relay.cv.notify_all()
                    return self.js(200, {"ok": True})
                if self.path == "/_party/disconnect":
                    relay.replace()
                    relay.session = ""
                    return self.js(200, {"ok": True})
            return self.js(404, {"error": "Not found"})

        def handle_task(self):
            self.connection.settimeout(30)
            try:
                if self.path in {"/_party/connect", "/_party/poll", "/_party/reply", "/_party/disconnect"}:
                    return self.host_command()
                if self.path == "/health" and self.command == "GET":
                    return self.js(200, {"service": "wolfsen-party-relay-v1", "connected": relay.online()})
                if self.path not in (GET_ROUTES if self.command == "GET" else POST_ROUTES if self.command == "POST" else set()):
                    return self.js(404, {"error": "没有这个页面"})
                if self.headers.get("Origin") and self.headers.get("Origin") != relay.origin:
                    return self.js(403, {"error": "禁止跨站操作"})
                headers = {k.lower(): v for k, v in self.headers.items() if k.lower() in REQUEST_HEADERS}
                if any(len(value) > 1024 for value in headers.values()) or sum(len(value) for value in headers.values()) > 4096:
                    return self.js(431, {"error": "请求头过大"})
                payload = self.read_body(8192) if self.command == "POST" else b""
                with relay.cv:
                    if not relay.online():
                        return self.js(503, {"error": "电脑端尚未连接，请联系主持人开启固定服务器连接"})
                    if len(relay.jobs) >= 192:
                        return self.js(503, {"error": "连接较多，请稍后重试"})
                    ident = secrets.token_hex(16)
                    job = {"session": relay.session, "request": {"id": ident, "method": self.command, "path": self.path,
                           "headers": headers, "body": base64.b64encode(payload).decode("ascii")}}
                    relay.jobs[ident] = job
                    relay.cv.notify_all()
                    until = time.monotonic() + 12
                    while "response" not in job and not job.get("error") and time.monotonic() < until:
                        relay.cv.wait(max(0.01, until - time.monotonic()))
                    relay.jobs.pop(ident, None)
                    response = job.get("response")
                if response:
                    return self.send_data(*response)
                return self.js(503, {"error": "电脑连接暂时中断，请稍后重试"})
            except (BrokenPipeError, ConnectionResetError, TimeoutError):
                pass
            except (ValueError, KeyError, TypeError, UnicodeError):
                self.js(400, {"error": "请求内容无效"})

        do_GET = handle_task
        do_POST = handle_task

    class TaskServer(ThreadingHTTPServer):
        request_queue_size = 256

    server = TaskServer(("127.0.0.1", port), Handler)
    server.daemon_threads = True
    return server


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", required=True)
    parser.add_argument("--port", type=int, default=18742)
    args = parser.parse_args()
    with open(args.config, encoding="utf-8") as stream:
        config = json.load(stream)
    server = create_server(config, args.port)
    print(json.dumps({"port": server.server_port}), flush=True)
    server.serve_forever()
