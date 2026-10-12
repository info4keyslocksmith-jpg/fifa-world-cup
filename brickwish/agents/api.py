"""BrickWish web API: the website talks to this; the worker does the heavy lifting.

    POST /api/wish             {wish, extras, colors, surprise, age, level} -> {code}
    GET  /api/wish/<code>      -> {state, title, level, pieces, steps, preview: [urls], video, poster, parent_note}
    GET  /files/<code>/<name>  preview pages, poster and video for anyone with the code;
                               manual.pdf only with ?t=<download token> (sent to the parent after payment)
    POST /api/stripe           Stripe webhook: checkout.session.completed -> state "paid"

    python3 -m agents.api      # listens on PORT (default 8080); put HTTPS in front (Caddy, a load balancer...)

Privacy: no accounts, no cookies, IP addresses are not logged, the wish is scrubbed of contact details
before it is stored, and nothing about the parent is stored until payment.
Settings: STRIPE_WEBHOOK_SECRET, SITE_ORIGIN (the website's origin, for CORS), DESIGNS_PER_HOUR, DATA_DIR, PORT.
"""

import hashlib
import hmac
import json
import os
import re
import secrets
import time
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

from agents.worker import ORDERS, now, save_status

LEVELS = {1, 2, 3, 4, 5, 6}
AGES = {"4-6", "7-9", "10-12", "13+"}
COLORS = {"red", "orange", "yellow", "lime", "green", "azure", "blue", "purple", "pink", "brown", "tan", "gray",
          "dark_gray", "white", "black"}

SITE_ORIGIN = os.environ.get("SITE_ORIGIN", "*")
DESIGNS_PER_HOUR = int(os.environ.get("DESIGNS_PER_HOUR", "60"))  # caps AI spend if the site is spammed
EXTRAS = {"crown", "sunglasses", "wings", "rainbow", "fire", "treasure", "flowers", "friend"}
PUBLIC_FILES = {f"preview-{i}.png" for i in range(1, 6)} | {"poster.png", "build.mp4", "viewer.html"}
CODE_RE = re.compile(r"^BW-[A-Z2-9]{5}$")
_recent = deque()


def scrub(text):
    """Same rules as the website: drop emails, links, phone numbers and street addresses."""
    text = re.sub(r"[^\s@]+@[^\s@]+\.[^\s@]+", "[removed]", text)
    text = re.sub(r"(https?://|www\.)\S+", "[removed]", text, flags=re.I)
    text = re.sub(r"\+?\d[\d\s().-]{6,}\d", "[removed]", text)
    text = re.sub(r"\b\d{1,6}\s+(?:[A-Za-zÀ-ÿ]+\s){0,3}(?:st|street|ave|avenue|rd|road|blvd|dr|drive|ln|lane|ct|calle|avenida)\b\.?",
                  "[removed]", text, flags=re.I)
    return text.strip()


def new_code():
    alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
    while True:
        code = "BW-" + "".join(secrets.choice(alphabet) for _ in range(5))
        if not (ORDERS / code).exists():
            return code


def validate_wish(body):
    wish = scrub(str(body.get("wish", "")))[:140]
    if len(wish) < 2:
        raise ValueError("wish is too short")
    try:
        level = int(body.get("level"))
    except (TypeError, ValueError):
        level = 0
    if level not in LEVELS or body.get("age") not in AGES:
        raise ValueError("unknown level or age")
    colors = [c for c in body.get("colors", []) if c in COLORS][:4]
    extras = [e for e in body.get("extras", []) if e in EXTRAS]
    return {"wish": wish, "level": level, "age": body["age"], "colors": colors, "extras": extras,
            "surprise": bool(body.get("surprise")) and not colors, "created": now().isoformat()}


def verify_stripe(payload, header, secret, tolerance=300):
    parts = dict(p.split("=", 1) for p in header.split(",") if "=" in p)
    sigs = [v for k, v in (p.split("=", 1) for p in header.split(",") if "=" in p) if k == "v1"]
    ts = parts.get("t", "0")
    try:
        if abs(time.time() - int(ts)) > tolerance:
            return False
    except ValueError:
        return False
    expected = hmac.new(secret.encode(), f"{ts}.".encode() + payload, hashlib.sha256).hexdigest()
    return any(hmac.compare_digest(expected, s) for s in sigs)


def apply_payment(session):
    code = session.get("client_reference_id") or ""
    if not CODE_RE.match(code) or not (ORDERS / code).exists() or session.get("payment_status") != "paid":
        return False
    details = (session.get("collected_information") or {}).get("shipping_details") or session.get("shipping_details") or {}
    addr = details.get("address") or {}
    builder = ""
    for field in session.get("custom_fields") or []:
        if field.get("key") == "builder_name":
            builder = ((field.get("text") or {}).get("value") or "")[:12]
    save_status(code, state="paid", email=(session.get("customer_details") or {}).get("email", ""), builder=builder,
                amount_total=session.get("amount_total"),
                ship_to={"name": details.get("name", ""), "address1": addr.get("line1", ""), "address2": addr.get("line2") or "",
                         "city": addr.get("city", ""), "state": addr.get("state", ""), "zip": addr.get("postal_code", ""),
                         "country": addr.get("country", "US")})
    return True


class Handler(BaseHTTPRequestHandler):
    server_version = "BrickWish"

    def log_message(self, fmt, *args):  # no IP addresses in logs
        pass

    def _send(self, status, body=b"", ctype="application/json", extra=None):
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", SITE_ORIGIN)
        self.send_header("Cache-Control", "no-store")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def _json(self, status, obj):
        self._send(status, json.dumps(obj).encode())

    def do_OPTIONS(self):
        self._send(204, extra={"Access-Control-Allow-Methods": "GET, POST", "Access-Control-Allow-Headers": "Content-Type"})

    def do_POST(self):
        length = min(int(self.headers.get("Content-Length", "0")), 65536)
        raw = self.rfile.read(length)
        path = urlparse(self.path).path
        if path == "/api/wish":
            while _recent and time.time() - _recent[0] > 3600:
                _recent.popleft()
            if len(_recent) >= DESIGNS_PER_HOUR:
                return self._json(429, {"error": "We're very busy. Please try again in a little while."})
            try:
                order = validate_wish(json.loads(raw or b"{}"))
            except (ValueError, json.JSONDecodeError) as e:
                return self._json(400, {"error": str(e)})
            code = new_code()
            (ORDERS / code).mkdir(parents=True)
            (ORDERS / code / "order.json").write_text(json.dumps(order))
            save_status(code, state="received")
            _recent.append(time.time())
            return self._json(201, {"code": code})
        if path == "/api/stripe":
            secret = os.environ.get("STRIPE_WEBHOOK_SECRET", "")
            if not secret or not verify_stripe(raw, self.headers.get("Stripe-Signature", ""), secret):
                return self._json(400, {"error": "bad signature"})
            event = json.loads(raw)
            if event.get("type") == "checkout.session.completed":
                apply_payment(event["data"]["object"])
            return self._json(200, {"received": True})
        return self._json(404, {"error": "not found"})

    def do_GET(self):
        url = urlparse(self.path)
        parts = url.path.strip("/").split("/")
        if len(parts) == 3 and parts[:2] == ["api", "wish"] and CODE_RE.match(parts[2]):
            try:
                st = json.loads((ORDERS / parts[2] / "status.json").read_text())
            except OSError:
                return self._json(404, {"error": "not found"})
            base = f"/files/{parts[2]}/"
            public = {"state": st.get("state"), "title": st.get("title"), "parent_note": st.get("parent_note", ""),
                      "level": st.get("level"), "pieces": st.get("pieces"), "steps": st.get("steps"), "pages": st.get("pages")}
            if st.get("state") not in ("received", "designing", "needs_help"):
                public.update(preview=[base + p for p in st.get("preview", [])], video=base + "build.mp4", poster=base + "poster.png")
            return self._json(200, public)
        if len(parts) == 3 and parts[0] == "files" and CODE_RE.match(parts[1]):
            name = parts[2]
            folder = ORDERS / parts[1]
            if name == "manual.pdf":
                try:
                    token = json.loads((folder / "status.json").read_text()).get("download_token")
                except OSError:
                    token = None
                if not token or not hmac.compare_digest(token, parse_qs(url.query).get("t", [""])[0]):
                    return self._json(403, {"error": "This link needs the download code from your email."})
            elif name not in PUBLIC_FILES:
                return self._json(404, {"error": "not found"})
            f = folder / name
            if not f.exists():
                return self._json(404, {"error": "not ready yet"})
            ctype = {"png": "image/png", "mp4": "video/mp4", "pdf": "application/pdf", "html": "text/html"}[name.rsplit(".", 1)[1]]
            return self._send(200, f.read_bytes(), ctype)
        return self._json(404, {"error": "not found"})


def main():
    ORDERS.mkdir(parents=True, exist_ok=True)
    port = int(os.environ.get("PORT", "8080"))
    print(f"BrickWish API on :{port}")
    ThreadingHTTPServer(("", port), Handler).serve_forever()


if __name__ == "__main__":
    main()
