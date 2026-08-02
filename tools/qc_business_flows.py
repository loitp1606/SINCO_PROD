from __future__ import annotations

import json
import os
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
OUTPUT = Path(os.environ.get("SINCO_QC_OUTPUT", "QC-Evidence/full-program/business-flows"))

FLOWS = [
    ("Báo giá → Đơn hàng", "/quotationPaper", "Tạo đơn hàng", "/order/popup"),
    ("Đơn hàng → Hợp đồng", "/order", "Tạo hợp đồng", "/contract/popup"),
    ("Đơn hàng → Phiếu xuất", "/order", "Tạo phiếu xuất hàng", "/deliveryNote/popup"),
    ("Đơn hàng → Đặt nhập", "/order", "Tạo đặt hàng nhập", "/poin/popup"),
    ("Hợp đồng → Đặt nhập", "/contract", "Tạo đơn đặt nhập hàng", "/poin/popup"),
    ("Hợp đồng → Phiếu xuất", "/contract", "Tạo phiếu xuất hàng", "/deliveryNote/popup"),
    ("Đặt nhập → Phiếu nhập", "/poin", "Tạo phiếu nhập hàng", "/goodsReceipt/popup"),
    ("Phiếu nhập → Phiếu chi", "/goodsReceipt", "Tạo phiếu chi", "/paymentslip/popup"),
    ("Phiếu nhập → Xuất trả", "/goodsReceipt", "Tạo phiếu xuất trả hàng", "/orderReturn/popup"),
    ("Phiếu xuất → Phiếu thu", "/deliveryNote", "Tạo phiếu thu", "/receiptV2/popup"),
    ("Phiếu xuất → Nhập trả", "/deliveryNote", "Tạo nhập hàng trả lại", "/purchaseReturnReceipt/popup"),
    ("Khách hàng → Nhà cung cấp", "/customer", "Tạo nhà cung cấp", "/supplier/popup"),
]


def write_report(results: list[dict[str, Any]], started: datetime) -> None:
    summary = {status: sum(x["status"] == status for x in results) for status in ("PASS", "WARN", "FAIL", "BLOCKED")}
    payload = {
        "startedAt": started.isoformat(),
        "finishedAt": datetime.now().astimezone().isoformat(),
        "summary": summary,
        "flows": results,
    }
    (OUTPUT / "qc-business-results.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    lines = [
        "# SINCO Business Flow QC",
        "",
        f"- PASS {summary['PASS']} / WARN {summary['WARN']} / FAIL {summary['FAIL']} / BLOCKED {summary['BLOCKED']}",
        "- Chỉ gọi SyncData và mở form đích; không bấm Lưu, không tạo chứng từ trong database.",
        "",
        "| Luồng | Kết quả | Bản ghi thử | Dữ liệu kế thừa | Ghi chú | Evidence |",
        "|---|---|---|---|---|---|",
    ]
    for item in results:
        evidence = f"[{item['evidence']}]({item['evidence']})" if item.get("evidence") else ""
        lines.append(
            f"| {item['name']} | {item['status']} | {item.get('sourceText', '')[:45]} | "
            f"{item.get('filledFields', 0)} field / {item.get('detailRows', 0)} detail | "
            f"{item.get('message', '')} | {evidence} |"
        )
    (OUTPUT / "QC-BUSINESS-FLOWS.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> int:
    if not USERNAME or not PASSWORD:
        raise RuntimeError("Thiếu SINCO_QC_USER hoặc SINCO_QC_PASSWORD")
    OUTPUT.mkdir(parents=True, exist_ok=True)
    started = datetime.now().astimezone()
    results: list[dict[str, Any]] = []
    only_raw = os.environ.get("SINCO_QC_FLOW_ONLY", "").strip()
    only_indexes = {int(value.strip()) for value in only_raw.split(",") if value.strip()}

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

        for index, (name, source, action_label, target) in enumerate(FLOWS, start=1):
            if only_indexes and index not in only_indexes:
                continue
            result: dict[str, Any] = {
                "name": name,
                "source": source,
                "target": target,
                "action": action_label,
                "status": "BLOCKED",
            }
            browser = playwright.chromium.launch(headless=True)
            context = browser.new_context(viewport={"width": 1440, "height": 1000})
            context.add_init_script(browser_auth_script(auth))
            source_page = context.new_page()
            dialogs: list[str] = []
            source_page.on("dialog", lambda dialog: (dialogs.append(dialog.message), dialog.accept()))
            try:
                source_page.goto(f"{FRONTEND_URL}{source}", wait_until="domcontentloaded", timeout=30_000)
                source_page.locator("table:visible tbody tr").first.wait_for(timeout=25_000)
                rows = source_page.locator("table:visible tbody tr")
                attempts: list[str] = []
                destination = None

                for row_index in range(min(rows.count(), 20)):
                    row = rows.nth(row_index)
                    selection = row.locator('input[type="checkbox"]').first
                    if not selection.count():
                        attempts.append(f"Dòng {row_index + 1}: không có checkbox chọn")
                        continue
                    selection.check(force=True)
                    source_page.wait_for_timeout(150)
                    button = source_page.get_by_role("button", name=action_label, exact=True)
                    if not button.count():
                        attempts.append(f"Dòng {row_index + 1}: không hiện action")
                        selection.uncheck(force=True)
                        continue

                    previous_pages = len(context.pages)
                    try:
                        with source_page.expect_response(
                            lambda response: "/api/FormConfig/SyncData" in response.url,
                            timeout=20_000,
                        ) as response_info:
                            button.first.click()
                        sync_response = response_info.value
                        sync_payload = sync_response.json()
                        sync_code = sync_payload.get("StatusCode") or sync_payload.get("statusCode")
                        if sync_response.status != 200 or sync_code not in (200, "200"):
                            message = sync_payload.get("message") or sync_payload.get("Message") or str(sync_payload)[:250]
                            attempts.append(f"Dòng {row_index + 1}: {message}")
                            if selection.is_checked():
                                selection.uncheck(force=True)
                            continue
                        source_page.wait_for_timeout(600)
                        new_pages = context.pages[previous_pages:]
                        if not new_pages:
                            attempts.append(f"Dòng {row_index + 1}: SyncData OK nhưng không mở form đích")
                            if selection.is_checked():
                                selection.uncheck(force=True)
                            continue
                        destination = new_pages[-1]
                        result["sourceText"] = " ".join(row.inner_text().split())
                        break
                    except Exception as exc:
                        attempts.append(f"Dòng {row_index + 1}: {type(exc).__name__}: {exc}")
                        if selection.is_checked():
                            selection.uncheck(force=True)

                if destination is None:
                    result["message"] = " | ".join(attempts + dialogs)[:1000]
                    result["status"] = "BLOCKED"
                else:
                    destination.wait_for_load_state("domcontentloaded", timeout=20_000)
                    destination.locator("button.btn-cancel:visible").first.wait_for(timeout=15_000)
                    result["finalUrl"] = destination.url
                    route_ok = target.lower() in destination.url.lower()
                    fields = destination.locator(
                        ".master-form input:visible,.master-form select:visible,.master-form textarea:visible"
                    )
                    filled = 0
                    for field_index in range(fields.count()):
                        field = fields.nth(field_index)
                        try:
                            value = field.input_value().strip()
                            if value:
                                filled += 1
                        except Exception:
                            pass
                    detail_rows = destination.locator(".detail-table-container tbody tr").count()
                    result["filledFields"] = filled
                    result["detailRows"] = detail_rows
                    image = OUTPUT / f"{index:02d}-{safe_name(source)}-to-{safe_name(target)}.png"
                    destination.screenshot(path=str(image), full_page=False)
                    result["evidence"] = image.name
                    result["status"] = "PASS" if route_ok and (filled > 0 or detail_rows > 0) else "WARN"
                    if not route_ok:
                        result["message"] = f"Sai route đích: {destination.url}"
                    elif filled == 0 and detail_rows == 0:
                        result["message"] = "Form đích mở nhưng chưa thấy dữ liệu kế thừa"
                    else:
                        result["message"] = "Form đích và dữ liệu kế thừa đã hiển thị"
                    destination.close()
            except Exception as exc:
                result["status"] = "FAIL"
                result["message"] = f"{type(exc).__name__}: {exc}"
            finally:
                context.close()
                browser.close()
            results.append(result)
            write_report(results, started)
            print(f"FLOW {index:02d}/{len(FLOWS):02d} {result['status']} {name}", flush=True)
        api.dispose()

    print(f"REPORT {OUTPUT / 'QC-BUSINESS-FLOWS.md'}", flush=True)
    return 1 if any(x["status"] == "FAIL" for x in results) else 0


if __name__ == "__main__":
    sys.exit(main())
