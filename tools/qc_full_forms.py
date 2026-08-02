from __future__ import annotations

import json
import os
import sys
from datetime import datetime
from pathlib import Path
from typing import Any

from playwright.sync_api import sync_playwright

from qc_full_program import browser_auth_script, exercise_generic_form


FRONTEND_URL = os.environ.get("SINCO_QC_URL", "http://localhost:4200").rstrip("/")
BACKEND_URL = os.environ.get("SINCO_QC_API_URL", "http://localhost:5000").rstrip("/")
USERNAME = os.environ.get("SINCO_QC_USER", "")
PASSWORD = os.environ.get("SINCO_QC_PASSWORD", "")
UNIT_CODE = os.environ.get("SINCO_QC_UNIT_CODE", "CTY")
OUTPUT = Path(os.environ.get("SINCO_QC_OUTPUT", "QC-Evidence/full-program/forms"))

LIST_ROUTES = [
    "/customer", "/quotationPaper", "/order", "/contract", "/deliveryNote",
    "/purchaseReturnReceipt", "/poin", "/goodsReceipt", "/orderReturn",
    "/customer-group", "/company", "/item", "/uom", "/industry-group",
    "/delivery-location", "/tax", "/price", "/employee", "/supplier",
    "/purchase", "/note", "/job", "/item-group", "/position",
    "/account-sinco", "/income-expenditure", "/location", "/roleEmployee",
    "/manufacturer", "/screen/bank", "/receiptV2", "/paymentslip",
]


def write_report(results: list[dict[str, Any]], started: datetime) -> None:
    summary = {status: sum(x["status"] == status for x in results) for status in ("PASS", "WARN", "FAIL")}
    payload = {
        "startedAt": started.isoformat(),
        "finishedAt": datetime.now().astimezone().isoformat(),
        "summary": summary,
        "forms": results,
    }
    (OUTPUT / "qc-form-results.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    lines = [
        "# SINCO List/Form QC",
        "",
        f"- PASS {summary['PASS']} / WARN {summary['WARN']} / FAIL {summary['FAIL']}",
        "- Mỗi danh sách chạy trong browser riêng; chỉ Xem/Thêm rồi Hủy, không bấm Lưu.",
        "",
        "| Route | Kết quả | Chế độ | Ghi chú | Evidence |",
        "|---|---|---|---|---|",
    ]
    for item in results:
        interaction = item.get("interaction", {})
        evidence = interaction.get("evidence", "")
        evidence_link = f"[{Path(evidence).name}]({evidence})" if evidence else ""
        lines.append(
            f"| `{item['route']}` | {item['status']} | {interaction.get('mode', 'none')} | "
            f"{interaction.get('error') or interaction.get('reason') or ''} | {evidence_link} |"
        )
    (OUTPUT / "QC-FORMS.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> int:
    if not USERNAME or not PASSWORD:
        raise RuntimeError("Thiếu SINCO_QC_USER hoặc SINCO_QC_PASSWORD")
    OUTPUT.mkdir(parents=True, exist_ok=True)
    started = datetime.now().astimezone()
    results: list[dict[str, Any]] = []

    with sync_playwright() as playwright:
        api = playwright.request.new_context(base_url=BACKEND_URL)
        login = api.post(
            "/api/auth/login",
            data={"userName": USERNAME, "password": PASSWORD, "unit": UNIT_CODE},
            timeout=20_000,
        )
        payload = login.json()
        if not login.ok or not payload.get("success"):
            raise RuntimeError(payload.get("message") or f"Login HTTP {login.status}")
        auth = payload["data"]

        for index, route in enumerate(LIST_ROUTES, start=1):
            item: dict[str, Any] = {"route": route, "pageErrors": [], "httpErrors": []}
            browser = playwright.chromium.launch(headless=True)
            context = browser.new_context(viewport={"width": 1440, "height": 1000})
            context.add_init_script(browser_auth_script(auth))
            page = context.new_page()
            page.on("pageerror", lambda error, target=item: target["pageErrors"].append(str(error)))
            page.on(
                "response",
                lambda response, target=item: target["httpErrors"].append(
                    {"status": response.status, "url": response.url}
                )
                if response.status >= 400 and "favicon.ico" not in response.url
                else None,
            )
            try:
                page.goto(f"{FRONTEND_URL}{route}", wait_until="domcontentloaded", timeout=30_000)
                page.locator("body").wait_for(timeout=10_000)
                page.wait_for_timeout(650)
                item["interaction"] = exercise_generic_form(page, route, OUTPUT)
                severe_http = [x for x in item["httpErrors"] if x["status"] >= 500 or x["status"] in (401, 403)]
                interaction_status = item["interaction"].get("status")
                if item["pageErrors"] or severe_http or interaction_status == "FAIL":
                    item["status"] = "FAIL"
                elif interaction_status in ("SKIP", "NOT_APPLICABLE"):
                    item["status"] = "WARN"
                else:
                    item["status"] = "PASS"
            except Exception as exc:
                item["status"] = "FAIL"
                item["interaction"] = {"mode": "none", "status": "FAIL", "error": f"{type(exc).__name__}: {exc}"}
            finally:
                context.close()
                browser.close()
            results.append(item)
            write_report(results, started)
            print(f"FORM {index:02d}/{len(LIST_ROUTES):02d} {item['status']} {route}", flush=True)
        api.dispose()

    print(f"REPORT {OUTPUT / 'QC-FORMS.md'}", flush=True)
    return 1 if any(x["status"] == "FAIL" for x in results) else 0


if __name__ == "__main__":
    sys.exit(main())
