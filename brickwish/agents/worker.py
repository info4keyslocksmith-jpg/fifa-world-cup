"""BrickWish order worker: runs 24/7 and moves every order through the business with no human steps.

Each order lives in data/orders/<code>/ with order.json (the wish), status.json (state + parent details
after payment) and the engine output. States:

    received ──design agent + engine──▶ preview_ready ──Stripe webhook──▶ paid
        ──manual with builder's name + vendor order + parent email──▶ sent_to_vendor ──tracking──▶ shipped
    (any step can go to needs_help: the founders get an email and the order waits)

    python3 -m agents.worker            # run forever (systemd / Docker / any small server)
    python3 -m agents.worker --once     # process what's waiting and exit (cron, tests)

Settings come from environment variables: ANTHROPIC_API_KEY, SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASSWORD,
MAIL_FROM, FOUNDERS_EMAIL, VENDOR_EMAIL, PUBLIC_URL (where api.py is served), DATA_DIR.
Without SMTP settings emails are written to data/outbox/ instead of sent (safe for testing).
"""

import argparse
import json
import os
import secrets
import shutil
import smtplib
import subprocess
import time
import traceback
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CLI = ROOT / "engine" / "cli.js"
DATA = Path(os.environ.get("DATA_DIR", ROOT / "data"))
ORDERS = DATA / "orders"
OUTBOX = DATA / "outbox"
PUBLIC_URL = os.environ.get("PUBLIC_URL", "http://localhost:8080")
UNPAID_DAYS = 30        # unpaid designs are deleted after this
KEEP_PERSONAL_DAYS = 90  # wish text, first name and address are deleted this long after shipping


def now():
    return datetime.now(timezone.utc)


def load(code, name="status.json"):
    return json.loads((ORDERS / code / name).read_text())


def save_status(code, **changes):
    path = ORDERS / code / "status.json"
    st = json.loads(path.read_text()) if path.exists() else {}
    st.update(changes, updated=now().isoformat())
    st.setdefault("history", []).append({"state": st.get("state"), "at": st["updated"]})
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(st, indent=1))
    tmp.replace(path)
    return st


# ---------------------------------------------------------------- email

def send_email(to, subject, body, attachments=()):
    msg = EmailMessage()
    msg["From"] = os.environ.get("MAIL_FROM", "BrickWish <orders@brickwish.example>")
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(body)
    for path in attachments:
        path = Path(path)
        sub = {"pdf": "pdf", "csv": "csv", "xml": "xml"}.get(path.suffix[1:], "octet-stream")
        msg.add_attachment(path.read_bytes(), maintype="application", subtype=sub, filename=path.name)
    host = os.environ.get("SMTP_HOST")
    if not host:
        OUTBOX.mkdir(parents=True, exist_ok=True)
        (OUTBOX / f"{int(time.time() * 1000)}-{to.split('@')[0]}.eml").write_bytes(bytes(msg))
        return
    with smtplib.SMTP(host, int(os.environ.get("SMTP_PORT", "587"))) as s:
        s.starttls()
        if os.environ.get("SMTP_USER"):
            s.login(os.environ["SMTP_USER"], os.environ["SMTP_PASSWORD"])
        s.send_message(msg)


def alert_founders(code, problem):
    to = os.environ.get("FOUNDERS_EMAIL")
    if to:
        send_email(to, f"BrickWish needs help with {code}", f"Order {code}: {problem}\n\nFolder: {ORDERS / code}")


# ---------------------------------------------------------------- stages

def engine(*args):
    """Run the brick engine (engine/cli.js) and return its JSON summary."""
    run = subprocess.run(["node", str(CLI), *map(str, args)], capture_output=True, text=True, timeout=3600)
    if run.returncode != 0:
        raise RuntimeError(f"engine failed: {run.stdout[-300:]} {run.stderr[-800:]}")
    return json.loads(run.stdout.strip().splitlines()[-1])


def stage_design(code, design_fn):
    """received -> preview_ready: the Design Agent designs the wish; the engine makes the manual, the preview and the video."""
    order = load(code, "order.json")
    save_status(code, state="designing")
    try:
        spec = design_fn(order)
        out = ORDERS / code
        (out / "spec.json").write_text(json.dumps(spec, indent=1))
        summary = engine("build", out / "spec.json", out, "--code", code)
        save_status(code, state="preview_ready", title=spec.get("title", "My build"), parent_note=spec.get("parent_note", ""),
                    level=summary["level"], pieces=summary["pieces"], steps=summary["steps"], pages=summary["pages"],
                    preview=[f"preview-{i}.png" for i in range(1, 6)], video="build.mp4", poster="poster.png")
    except Exception as e:  # keep the queue moving; a person looks at this one
        save_status(code, state="needs_help", error=f"{type(e).__name__}: {e}")
        alert_founders(code, f"design failed: {e}\n\n{traceback.format_exc()}")


def stage_paid(code):
    """paid -> sent_to_vendor: personalize the manual, order the parts, email the parent."""
    st = load(code)
    out = ORDERS / code
    try:
        engine("manual", out, "--builder", st.get("builder", ""), "--code", code)
        order = json.loads((out / "vendor_order.json").read_text())
        order["ship_to"] = st["ship_to"]
        (out / "vendor_order.json").write_text(json.dumps(order, indent=1))
        subject, body = vendor_email(order)
        send_email(os.environ.get("VENDOR_EMAIL", "vendor@example.com"), subject, body, [out / "parts.csv", out / "bricklink.xml"])
        token = st.get("download_token") or secrets.token_urlsafe(24)
        link = f"{PUBLIC_URL}/files/{code}/manual.pdf?t={token}"
        send_email(st["email"], f"Your BrickWish manual: {st.get('title', '')}",
                   f"Thank you! The full building manual is ready:\n{link}\n\n"
                   f"The bricks are on their way; we'll email the tracking number.\n\nOrder {code}")
        save_status(code, state="sent_to_vendor", download_token=token, sent_to_vendor_at=now().isoformat())
    except Exception as e:
        save_status(code, state="needs_help", error=f"{type(e).__name__}: {e}")
        alert_founders(code, f"after payment: {e}\n\n{traceback.format_exc()}")


def vendor_email(order):
    st = order["ship_to"]
    lines = [
        "Hello,", "",
        f"Please pick, pack and dropship BrickWish order {order['order_code']}.",
        f"- Parts: see the attached parts.csv (bag by bag) or bricklink.xml ({order['pieces_with_spares']} pieces including spares).",
        "- Pack each bag number separately and label it 'Bag N'. Put the spares bag in last.",
        f"- Packaging: {order['packing']['packaging']}",
        "- Labels on the outside of the package:",
        *[f"    * {label}" for label in order["packing"]["labels"]],
        "- No vendor branding, invoices or prices inside the parcel.",
        f"- Shipping: {order['packing']['shipping']}", "",
        "Ship to:", f"    {st.get('name', '')}", f"    {st.get('address1', '')} {st.get('address2', '')}".rstrip(),
        f"    {st.get('city', '')}, {st.get('state', '')} {st.get('zip', '')}", f"    {st.get('country', 'US')}", "",
        "Please reply with the tracking number and any part substitutions before shipping.", "", "Thank you,", "BrickWish Orders",
    ]
    subject = f"BrickWish order {order['order_code']} - {order['model']} ({order['pieces_with_spares']} pcs)"
    return subject, "\n".join(lines)


def cleanup():
    """Retention policy from the privacy notice: unpaid designs 30 days, personal details 90 days after shipping."""
    if not ORDERS.exists():
        return
    for d in ORDERS.iterdir():
        try:
            st = json.loads((d / "status.json").read_text())
        except (OSError, json.JSONDecodeError):
            continue
        updated = datetime.fromisoformat(st["updated"])
        if st.get("state") in ("received", "designing", "preview_ready") and now() - updated > timedelta(days=UNPAID_DAYS):
            shutil.rmtree(d)
        elif st.get("state") in ("shipped", "delivered") and not st.get("personal_deleted") \
                and now() - updated > timedelta(days=KEEP_PERSONAL_DAYS):
            order = json.loads((d / "order.json").read_text())
            order["wish"] = "[deleted]"
            (d / "order.json").write_text(json.dumps(order))
            save_status(d.name, builder="", ship_to={}, email="", personal_deleted=True)


def daily_report():
    to = os.environ.get("FOUNDERS_EMAIL")
    if not to or not ORDERS.exists():
        return
    counts = {}
    for d in ORDERS.iterdir():
        try:
            s = json.loads((d / "status.json").read_text())["state"]
            counts[s] = counts.get(s, 0) + 1
        except (OSError, json.JSONDecodeError, KeyError):
            pass
    send_email(to, "BrickWish daily report", "\n".join(f"{k}: {v}" for k, v in sorted(counts.items())) or "No orders yet.")


# ---------------------------------------------------------------- loop

def pending(state):
    if not ORDERS.exists():
        return []
    out = []
    for d in sorted(ORDERS.iterdir()):
        try:
            if json.loads((d / "status.json").read_text()).get("state") == state:
                out.append(d.name)
        except (OSError, json.JSONDecodeError):
            pass
    return out


def run_once(design_fn):
    for code in pending("paid"):      # paying customers first
        stage_paid(code)
    for code in pending("received"):
        stage_design(code, design_fn)


def run_forever(design_fn, poll=10):
    last_hourly = last_daily = None
    while True:
        run_once(design_fn)
        t = now()
        if last_hourly is None or t - last_hourly > timedelta(hours=1):
            cleanup()
            last_hourly = t
        if t.hour == 12 and (last_daily is None or last_daily.date() != t.date()):  # 8:00 in Atlanta (EDT)
            daily_report()
            last_daily = t
        time.sleep(poll)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--once", action="store_true")
    ap.add_argument("--offline-spec", help="skip Claude and use this spec for every design (demos and tests)")
    a = ap.parse_args()
    if a.offline_spec:
        fixed = json.loads(Path(a.offline_spec).read_text())

        def design_fn(order):
            return dict(fixed, level=int(order["level"]), age=order["age"], wish=order["wish"])
    else:
        from agents.design_agent import design as design_fn
    if a.once:
        run_once(design_fn)
    else:
        run_forever(design_fn)


if __name__ == "__main__":
    main()
