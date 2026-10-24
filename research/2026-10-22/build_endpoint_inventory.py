"""Rebuild the bounded REST inventory offline from preserved official schemas.

Run from any directory with Python 3. No credentials or network calls are used.
"""

import csv
import hashlib
import json
import re
from collections import Counter
from pathlib import Path
from urllib.parse import urlparse

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
METHODS = {"get", "post", "put", "patch", "delete", "head", "options", "trace"}
EXPECTED = {
    "billing_subscriptions_v1.json": 17,
    "catalogs_products_v1.json": 4,
    "checkout_orders_v2.json": 10,
    "customer_disputes_v1.json": 15,
    "customer_partner_referrals_v2.json": 2,
    "invoicing_v2.json": 44,
    "notifications_webhooks_v1.json": 16,
    "payment-experience_web_experience_profiles_v1.json": 6,
    "payments_payment_v2.json": 8,
    "payments_payouts_batch_v1.json": 4,
    "reporting_transactions_v1.json": 4,
    "shipping_shipment_tracking_v1.json": 5,
    "vault_payment_tokens_v3.json": 6,
    "usage_based_billing_v1.json": 75,
    "pricing_v2.json": 1,
    "payment_links_buttons_v1.json": 5,
}


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def annotations(name, path):
    direction = "Application to provider"
    access = "Published contract; account/product permissions and production eligibility not tested."
    note = ""
    if name == "usage_based_billing_v1.json":
        access = "Specification only; activation, routing, account availability, and production access unverified."
        note = "Preserve the published unprefixed path; do not invent an API prefix. Listed server is sandbox."
    elif name == "pricing_v2.json":
        access = "Specification only; account and production access unverified."
        note = "Listed server is sandbox; currency quotes are not general-purpose FX trading."
    elif name == "payment_links_buttons_v1.json":
        access = "Feature enablement required; sandbox integration documented; account access not tested."
        note = "The API integration guide currently supports payment links, not generated button code."
    elif name == "customer_partner_referrals_v2.json":
        access = "Platform sandbox documented before partner approval; production approval and capabilities required."
    elif name == "payment-experience_web_experience_profiles_v1.json":
        note = "Compatibility surface; do not assume this configures Orders/JS SDK v6."
    elif name == "payments_payouts_batch_v1.json":
        access = "Production Payouts approval, verification, and funding required; account access not tested."
    elif name == "invoicing_v2.json":
        if any(x in path for x in ["conditional-rules", "recurring-invoices", "reminders"]):
            access = "Expanded published contract; feature availability and execution not verified."
            note = "Recurring invoice series do not by themselves establish automatic subscription charging."
        elif "/payments" in path or "/refunds" in path:
            note = "External payment/refund record operations do not themselves move funds."
    elif name == "reporting_transactions_v1.json" and "summary" in path:
        access = "Expanded published reporting contract; account access not tested."
    elif name == "customer_disputes_v1.json":
        note = "Available actions depend on role, dispute stage, and returned HATEOAS links."
        if path.endswith(("/adjudicate", "/require-evidence")):
            access = "Explicitly sandbox-only in the operation description."
            note = "Test control; does not authorize a merchant to adjudicate or control a live dispute."
    if path == "/v2/checkout/orders/order-update-callback":
        direction = "PayPal to merchant callback URL"
        note = "Reversed client/server contract. Schema path is not an ordinary merchant-to-PayPal endpoint."
    return direction, access, note


def main():
    original = read_json(HERE / "spec-sources.json")
    current = read_json(HERE / "docs-spec-sources.json")
    selected = {}
    checked_hashes = 0
    for manifest, folder in [(original, "specs"), (current, "docs-specs")]:
        for entry in manifest["sources"]:
            if "sha256" not in entry:
                continue
            path = HERE / folder / entry["name"]
            assert digest(path) == entry["sha256"], f"Snapshot hash mismatch: {path}"
            checked_hashes += 1
            selected[entry["name"]] = {**entry, "local_file": f"{folder}/{entry['name']}"}
    for entry in read_json(HERE / "initial-sources.json")["sources"]:
        if "sha256" in entry and "file" in entry:
            assert digest(HERE / entry["file"]) == entry["sha256"], entry["file"]
            checked_hashes += 1

    rows = []
    for name, entry in selected.items():
        spec = read_json(HERE / entry["local_file"])
        count = 0
        for path, path_item in spec.get("paths", {}).items():
            for method, op in path_item.items():
                if method not in METHODS:
                    continue
                direction, access, note = annotations(name, path)
                servers = op.get("servers", path_item.get("servers", spec.get("servers", [])))
                rows.append({
                    "api": spec["info"]["title"], "spec": name,
                    "method": method.upper(), "path": path,
                    "operation_id": op.get("operationId", ""), "summary": op.get("summary", ""),
                    "deprecated": bool(op.get("deprecated", False)),
                    "servers": "; ".join(s["url"] for s in servers), "source": entry["url"],
                    "direction": direction, "availability_note": access, "implementation_note": note,
                })
                count += 1
        assert count == EXPECTED[name] == entry["operations"], (name, count)
    assert len(rows) == 222
    assert Counter(row["spec"] for row in rows) == Counter(EXPECTED)
    assert len({(r["spec"], r["method"], r["path"]) for r in rows}) == len(rows)
    assert len({(r["method"], r["path"]) for r in rows}) == len(rows)

    with (ROOT / "PAYPAL-REST-ENDPOINTS.csv").open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)
    (HERE / "selected-spec-sources.json").write_text(json.dumps({
        "research_date": "2026-10-22", "github_commit": original["github_commit"],
        "selection_rule": "Prefer retrieved developer-site schema; use pinned official GitHub fallback for Payouts.",
        "sources": list(selected.values()),
    }, indent=2) + "\n", encoding="utf-8")

    doc = ROOT / "PAYPAL-API-CAPABILITIES.md"
    content = doc.read_text(encoding="utf-8")
    links = re.findall(r"\[[^\]]+\]\(([^)]+)\)", content)
    external = sorted({url for url in links if url.startswith("https://")})
    local = sorted({url for url in links if not url.startswith(("https://", "http://", "#"))})
    assert all(urlparse(url).netloc for url in external)
    assert all((ROOT / url.split("#")[0]).exists() for url in local), local
    table_columns = None
    table_count = 0
    for line in content.splitlines():
        if line.startswith("|"):
            width = len(re.split(r"(?<!\\)\|", line))
            if table_columns is None:
                table_columns = width
                table_count += 1
            assert width == table_columns, f"Malformed table row: {line}"
        else:
            table_columns = None
    old = HERE / "PAYPAL-API-CAPABILITIES.before-review.md"
    assert digest(old) == "b97eafc4469decbe97a8874380a3242dc094887d642f1e97b3c945eb8eb0ccea"
    report = {
        "research_date": "2026-10-22", "status": "passed", "operations": len(rows),
        "specifications": len(selected), "snapshot_hashes_checked": checked_hashes,
        "sandbox_only_controls": sum("Explicitly sandbox-only" in row["availability_note"] for row in rows),
        "merchant_callback_contracts": sum(row["direction"] == "PayPal to merchant callback URL" for row in rows),
        "markdown_tables_checked": table_count, "unique_external_links": len(external),
        "local_links_checked": len(local), "original_draft_preserved": True,
        "scope": "Offline schema/hash/count/annotation and document structure checks. Not a live HTTP link crawl or authenticated API test.",
        "files": {name: digest(ROOT / name) for name in ["PAYPAL-API-CAPABILITIES.md", "PAYPAL-REST-ENDPOINTS.csv"]},
    }
    (HERE / "verification.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    with (HERE / "capability-source-links.csv").open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(["url"])
        writer.writerows([url] for url in external)
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
