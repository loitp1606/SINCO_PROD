from __future__ import annotations

import json
import os
import re
import sys
from datetime import datetime
from pathlib import Path
from typing import Any

from playwright.sync_api import sync_playwright

from qc_full_program import browser_auth_script, safe_name


FRONTEND_URL = os.environ.get("SINCO_QC_URL", "http://localhost:4200").rstrip("/")
BACKEND_URL = os.environ.get("SINCO_QC_API_URL", "http://localhost:5000").rstrip("/")
USERNAME = os.environ.get("SINCO_QC_USER", "")
PASSWORD = os.environ.get("SINCO_QC_PASSWORD", "")
UNIT_CODE = os.environ.get("SINCO_QC_UNIT_CODE", "CTY")
OUTPUT = Path(os.environ.get("SINCO_QC_OUTPUT", "QC-Evidence/full-program/reports"))
REPORT_START = max(1, int(os.environ.get("SINCO_QC_REPORT_START", "1")))
REPORT_END = int(os.environ.get("SINCO_QC_REPORT_END", "0"))

REPORTS = [
    ("Báo cáo doanh thu lợi nhuận", "/bcdtln"),
    ("Báo cáo doanh thu lợi nhuận chi tiết", "/bcdtlnct"),
    ("Bảng tổng hợp công nợ khách hàng", "/bthcnkh"),
    ("Báo cáo công nợ theo thời gian", "/bccnttg"),
    ("Tỷ lệ thành công báo giá", "/bctltcbgnvkd"),
    ("Danh sách báo giá không thành công", "/bcdsbgktc"),
    ("Lợi nhuận dự kiến theo báo giá", "/bclndktbg"),
    ("Sản phẩm mua theo nhà cung cấp", "/bcthspdmnccttg91"),
    ("Giao hàng dự kiến", "/bcghdkgh135792"),
    ("Báo cáo thẻ kho", "/bcthekho94"),
    ("Tổng hợp nhập xuất tồn", "/bcthnxt95"),
    ("Thu chi tiền mặt, chuyển khoản", "/bcthuchi81"),
    ("Công nợ theo ngày", "/bccntheongay61"),
    ("Công nợ nhà cung cấp", "/screen/bthcnncc/report"),
]


def status_for(result: dict[str, Any]) -> str:
    if result.get("exception") or result.get("redirectedToLogin") or result.get("pageErrors"):
        return "FAIL"
    severe = [x for x in result.get("httpErrors", []) if x["status"] >= 500 or x["status"] in (401, 403)]
    if severe or result.get("bodyLength", 0) < 30:
        return "FAIL"
    app_console_errors = [
        error
        for error in result.get("consoleErrors", [])
        if "ERR_NETWORK_ACCESS_DENIED" not in error
    ]
    if app_console_errors or result.get("httpErrors") or result.get("filterStatus") != "PASS":
        return "WARN"
    return "PASS"


def write_results(results: list[dict[str, Any]], started: datetime) -> None:
    summary = {status: sum(x["status"] == status for x in results) for status in ("PASS", "WARN", "FAIL")}
    payload = {
        "startedAt": started.isoformat(),
        "finishedAt": datetime.now().astimezone().isoformat(),
        "summary": summary,
        "reports": results,
    }
    (OUTPUT / "qc-report-results.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    lines = [
        "# SINCO Report Smoke QC",
        "",
        f"- PASS {summary['PASS']} / WARN {summary['WARN']} / FAIL {summary['FAIL']}",
        "- Mỗi báo cáo chạy trong browser riêng để tránh tích lũy tài nguyên.",
        "",
        "| Báo cáo | Route | Kết quả | Controls | Evidence |",
        "|---|---|---|---|---|",
    ]
    for item in results:
        lines.append(
            f"| {item['name']} | `{item['route']}` | {item['status']} | "
            f"{item.get('inputs', 0)} input / {item.get('buttons', 0)} button | "
            f"[{Path(item['evidence']).name}]({item['evidence']}) |"
        )
    (OUTPUT / "QC-REPORTS.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> int:
    if not USERNAME or not PASSWORD:
        raise RuntimeError("Thiếu SINCO_QC_USER hoặc SINCO_QC_PASSWORD")
    OUTPUT.mkdir(parents=True, exist_ok=True)
    started = datetime.now().astimezone()
    results: list[dict[str, Any]] = []

    with sync_playwright() as playwright:
        api = playwright.request.new_context(base_url=BACKEND_URL)
        response = api.post(
            "/api/auth/login",
            data={"userName": USERNAME, "password": PASSWORD, "unit": UNIT_CODE},
            timeout=20_000,
        )
        if not response.ok:
            raise RuntimeError(f"Login HTTP {response.status}: {response.text()}")
        payload = response.json()
        if not payload.get("success"):
            raise RuntimeError(payload.get("message") or "Đăng nhập thất bại")
        auth = payload["data"]

        selected_reports = REPORTS[REPORT_START - 1 : REPORT_END or None]
        for index, (name, route) in enumerate(selected_reports, start=REPORT_START):
            result: dict[str, Any] = {
                "name": name,
                "route": route,
                "pageErrors": [],
                "consoleErrors": [],
                "httpErrors": [],
            }
            browser = playwright.chromium.launch(headless=True)
            context = browser.new_context(viewport={"width": 1440, "height": 1000})
            context.add_init_script(browser_auth_script(auth))
            page = context.new_page()
            dialogs: list[str] = []
            page.on("dialog", lambda dialog, target=dialogs: (target.append(dialog.message), dialog.accept()))
            page.on("pageerror", lambda error, r=result: r["pageErrors"].append(str(error)))
            page.on(
                "console",
                lambda message, r=result: r["consoleErrors"].append(message.text[:500])
                if message.type == "error" and "favicon.ico" not in message.text
                else None,
            )
            page.on(
                "response",
                lambda response, r=result: r["httpErrors"].append(
                    {"status": response.status, "url": response.url}
                )
                if response.status >= 400 and "favicon.ico" not in response.url
                else None,
            )
            try:
                nav = page.goto(f"{FRONTEND_URL}{route}", wait_until="domcontentloaded", timeout=30_000)
                page.locator("body").wait_for(timeout=10_000)
                page.wait_for_timeout(1_200)
                result["navigationStatus"] = nav.status if nav else 0
                result["finalUrl"] = page.url
                result["redirectedToLogin"] = "/login" in page.url
                result["bodyLength"] = len(page.locator("body").inner_text())
                result["inputs"] = page.locator("input:visible,select:visible,textarea:visible").count()
                result["buttons"] = page.locator("button:visible").count()
                filter_button = page.get_by_role(
                    "button", name=re.compile(r"^(Lọc dữ liệu|Xem báo cáo)$", re.I)
                )
                if filter_button.count() and filter_button.first.is_enabled():
                    filter_button.first.click()
                    page.wait_for_timeout(1_500)
                    result["filterStatus"] = "PASS" if not dialogs else "WARN"
                    result["dialogs"] = dialogs
                else:
                    result["filterStatus"] = "NOT_FOUND"
                result["rowsAfterFilter"] = page.locator("table:visible tbody tr").count()
                image = OUTPUT / f"{index:02d}-{safe_name(route)}-filtered.png"
                page.screenshot(path=str(image), full_page=False)
                result["evidence"] = image.name
            except Exception as exc:
                result["exception"] = f"{type(exc).__name__}: {exc}"
                image = OUTPUT / f"{index:02d}-{safe_name(route)}-failure.png"
                try:
                    page.screenshot(path=str(image), full_page=False)
                    result["evidence"] = image.name
                except Exception:
                    result["evidence"] = ""
            finally:
                context.close()
                browser.close()
            result["status"] = status_for(result)
            results.append(result)
            write_results(results, started)
            print(f"REPORT {index:02d}/{len(REPORTS):02d} {result['status']} {route}", flush=True)
        api.dispose()

    summary_fail = sum(x["status"] == "FAIL" for x in results)
    print(f"REPORT_FILE {OUTPUT / 'QC-REPORTS.md'}", flush=True)
    return 1 if summary_fail else 0


if __name__ == "__main__":
    sys.exit(main())
