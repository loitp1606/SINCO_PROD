from __future__ import annotations

import html
import json
import os
import re
import sys
import traceback
from datetime import datetime
from pathlib import Path

from playwright.sync_api import Page, TimeoutError as PlaywrightTimeoutError, sync_playwright


BASE_URL = os.environ.get("SINCO_QC_URL", "http://localhost:4200").rstrip("/")
USERNAME = os.environ.get("SINCO_QC_USER", "")
PASSWORD = os.environ.get("SINCO_QC_PASSWORD", "")
UNIT = os.environ.get("SINCO_QC_UNIT", "Tổng công ty")
OUTPUT_DIR = Path(os.environ.get("SINCO_QC_OUTPUT", "QC-Evidence/2026-08-02-playwright"))

RESULTS: list[dict[str, object]] = []


def evidence_path(name: str) -> Path:
    path = OUTPUT_DIR / name
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def screenshot(page: Page, name: str, full_page: bool = True) -> str:
    path = evidence_path(name)
    page.screenshot(path=str(path), full_page=full_page)
    return name


def record(issue: str, status: str, detail: str, evidence: list[str]) -> None:
    RESULTS.append(
        {
            "issue": issue,
            "status": status,
            "detail": detail,
            "evidence": evidence,
        }
    )


def run_case(page: Page, issue: str, test) -> None:
    try:
        detail, evidence = test(page)
        record(issue, "PASS", detail, evidence)
        print(f"PASS {issue}: {detail}", flush=True)
    except Exception as exc:
        failure_name = f"{issue.lstrip('#')}-failure.png"
        try:
            screenshot(page, failure_name)
            evidence = [failure_name]
        except Exception:
            evidence = []
        detail = f"{type(exc).__name__}: {exc}"
        record(issue, "FAIL", detail, evidence)
        print(f"FAIL {issue}: {detail}", flush=True)
        traceback.print_exc()


def wait_for_grid(page: Page) -> None:
    page.locator("tbody tr").first.wait_for(state="visible", timeout=20_000)


def login(page: Page) -> None:
    if not USERNAME or not PASSWORD:
        raise RuntimeError("Thiếu SINCO_QC_USER hoặc SINCO_QC_PASSWORD")
    page.goto(f"{BASE_URL}/login", wait_until="networkidle")
    page.locator('input[name="username"]').fill(USERNAME)
    page.locator('input[name="password"]').fill(PASSWORD)
    page.locator("select").select_option(label=UNIT)
    page.get_by_role("button", name="Đăng nhập", exact=True).click()
    page.wait_for_url(re.compile(r"^(?!.*\/login).*$"), timeout=20_000)
    page.wait_for_load_state("networkidle")


def open_first_poin_for_edit(page: Page) -> None:
    page.goto(f"{BASE_URL}/poin", wait_until="networkidle")
    wait_for_grid(page)
    page.locator("tbody tr").first.click()
    page.locator('button[title*="(F2"]').click()
    page.wait_for_url("**/poin/popup", timeout=15_000)
    page.locator(".detail-table-container tbody tr").first.wait_for(timeout=15_000)


def test_48_and_53(page: Page):
    open_first_poin_for_edit(page)
    detail_rows = page.locator(".detail-table-container tbody tr")
    original_count = detail_rows.count()
    original_summary = page.locator(".summary-value").all_inner_texts()

    page.get_by_role("button", name="+ Thêm dòng", exact=True).click()
    assert detail_rows.count() == original_count + 1, "Không thêm được dòng tạm"
    new_row = detail_rows.last
    numeric_inputs = new_row.locator('input[placeholder="0"]')
    zero_input = None
    for index in range(numeric_inputs.count()):
        candidate = numeric_inputs.nth(index)
        if candidate.input_value().strip() in {"0", "0,00", "0.00"}:
            zero_input = candidate
            break
    if zero_input is None:
        raise AssertionError("Không tìm thấy ô số có giá trị 0 trên dòng mới")

    zero_input.click()
    assert zero_input.input_value() == "", "Focus chưa xóa số 0 mặc định"
    focus_image = screenshot(page, "48-focus-clears-zero.png")
    zero_input.press("Tab")
    page.wait_for_timeout(150)
    assert zero_input.input_value() != "", "Blur không khôi phục giá trị 0"
    blur_image = screenshot(page, "48-blur-restores-zero.png")

    row_checkboxes = page.locator('.detail-table-container input[type="checkbox"]')
    row_checkboxes.last.check()
    bulk_button = page.get_by_role("button", name=re.compile(r"\(1\)$"))
    bulk_button.wait_for(timeout=5_000)
    selected_image = screenshot(page, "53-selected-unsaved-row.png")
    page.once("dialog", lambda dialog: dialog.accept())
    bulk_button.click()
    page.wait_for_timeout(250)
    assert detail_rows.count() == original_count, "Số dòng sau xóa hàng loạt không đúng"
    assert page.locator(".summary-value").all_inner_texts() == original_summary, "Tổng tiền chưa trở lại giá trị ban đầu"
    deleted_image = screenshot(page, "53-after-bulk-delete.png")

    page.locator("button.btn-cancel").click()
    page.wait_for_url("**/poin", timeout=15_000)
    return (
        f"#48 focus/blur đúng; #53 xóa dòng tạm {original_count + 1}→{original_count}, tổng tiền giữ nguyên; không lưu dữ liệu.",
        [focus_image, blur_image, selected_image, deleted_image],
    )


def test_90(page: Page):
    page.goto(f"{BASE_URL}/poin", wait_until="networkidle")
    wait_for_grid(page)
    rows = page.locator("tbody tr")
    target_index = 1 if rows.count() > 1 else 0
    target = rows.nth(target_index)
    voucher = target.inner_text().split()[0]
    target.click()
    before_image = screenshot(page, "90-selected-before-view.png")
    page.locator('button[title*="(F4"]').click()
    page.wait_for_url("**/poin/popup", timeout=15_000)
    popup_image = screenshot(page, "90-view-popup.png")
    page.locator("button.btn-cancel").click()
    page.wait_for_url("**/poin", timeout=15_000)
    restored = page.locator("tr.master-row-active")
    restored.wait_for(timeout=10_000)
    assert voucher in restored.inner_text(), f"Dòng khôi phục không phải {voucher}"
    after_image = screenshot(page, "90-restored-after-close.png")
    return f"Giữ đúng dòng {voucher} sau Xem → Hủy.", [before_image, popup_image, after_image]


def normalized_header_text(text: str) -> str:
    return " ".join(text.replace("↕", "").replace("▼", "").replace("▲", "").split())


def test_91(page: Page):
    expected = {
        "quotationPaper": ["Số báo giá", "Ngày báo giá", "Khách hàng", "Tổng tiền", "Trạng thái"],
        "order": ["Số đơn hàng", "Ngày đơn hàng", "Khách hàng", "Tổng tiền", "Trạng thái"],
        "contract": ["Số hợp đồng", "Ngày tạo", "Mã khách hàng", "Tổng tiền", "Đã nhận"],
        "deliveryNote": ["Số phiếu", "Ngày xuất hàng", "Khách hàng", "Tổng tiền", "Trạng thái"],
        "goodsReceipt": ["Số phiếu nhập hàng", "Ngày nhập hàng", "Khách hàng", "Tổng tiền", "Trạng thái"],
        "orderReturn": ["Số phiếu xuất trả", "Ngày xuất", "Khách hàng", "Tổng tiền", "Trạng thái"],
        "paymentslip": ["Số phiếu", "Ngày phiếu chi", "Mã NCC", "Số tiền chi", "Đã chi tiền"],
        "poin": ["Số phiếu", "Ngày tạo", "Mã NCC", "Tổng tiền", "Trạng thái"],
        "purchaseReturnReceipt": ["Số phiếu nhập hàng", "Ngày nhập hàng", "Khách hàng", "Tổng tiền", "Trạng thái"],
        "receiptV2": ["Số phiếu", "Ngày", "Khách hàng", "Số tiền thu", "Đã thu tiền"],
    }
    evidence: list[str] = []
    verified: list[str] = []
    for route, expected_headers in expected.items():
        page.goto(f"{BASE_URL}/{route}", wait_until="networkidle")
        page.locator("table:visible thead tr").first.wait_for(timeout=20_000)
        header_cells = page.locator("table:visible thead tr").first.locator("th")
        actual = [normalized_header_text(value) for value in header_cells.all_inner_texts()]
        actual = [value for value in actual if value]
        positions = []
        for label in expected_headers:
            expected_label = label.casefold()
            matches = [
                index
                for index, value in enumerate(actual)
                if expected_label == value.casefold() or expected_label in value.casefold()
            ]
            if not matches:
                raise AssertionError(f"{route}: thiếu cột '{label}', thực tế={actual}")
            positions.append(matches[0])
        assert positions == sorted(positions), f"{route}: sai thứ tự {expected_headers}, thực tế={actual}"
        filename = f"91-{route}-column-order.png"
        evidence.append(screenshot(page, filename, full_page=False))
        verified.append(route)
    return f"Đúng thứ tự JSON trên {len(verified)} danh sách: {', '.join(verified)}.", evidence


def test_60(page: Page):
    page.goto(f"{BASE_URL}/contract", wait_until="networkidle")
    wait_for_grid(page)
    checkboxes = page.locator('input[type="checkbox"]')
    checkboxes.nth(1).check()
    evidence: list[str] = []
    sizes: list[int] = []
    for option in ("1", "2", "3", "4"):
        page.locator("button.toolbar-file-btn").click()
        page.get_by_role("button", name=re.compile("PDF")).click()
        dialog = page.locator("mat-dialog-container")
        dialog.wait_for(timeout=5_000)
        dialog.locator(f'input[type="radio"][value="{option}"]').check(force=True)
        if option == "1":
            evidence.append(screenshot(page, "60-contract-template-options.png", full_page=False))
        with page.expect_response(
            lambda response: "/api/AttachedFile/export" in response.url
            and response.request.method == "POST",
            timeout=30_000,
        ) as response_info:
            dialog.get_by_role("button", name="OK", exact=True).click()
        response = response_info.value
        assert response.status == 200, f"API export mẫu {option} trả HTTP {response.status}"
        assert "application/pdf" in response.headers.get("content-type", ""), (
            f"Mẫu {option} không trả PDF: {response.headers.get('content-type')}"
        )
        output_name = f"60-contract-template-{option}.pdf"
        output_path = evidence_path(output_name)
        output_path.write_bytes(response.body())
        size = output_path.stat().st_size
        assert size > 10_000, f"PDF mẫu {option} quá nhỏ: {size} bytes"
        sizes.append(size)
        evidence.append(output_name)
    return f"Xuất đủ 4 PDF, dung lượng {', '.join(str(size) for size in sizes)} bytes.", evidence


def write_reports(started_at: datetime, finished_at: datetime) -> None:
    report = {
        "url": BASE_URL,
        "unit": UNIT,
        "startedAt": started_at.isoformat(),
        "finishedAt": finished_at.isoformat(),
        "results": RESULTS,
    }
    evidence_path("qc-results.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    rows = []
    for result in RESULTS:
        links = "<br>".join(
            f'<a href="{html.escape(str(item))}">{html.escape(str(item))}</a>'
            for item in result["evidence"]
        )
        status = html.escape(str(result["status"]))
        rows.append(
            "<tr>"
            f'<td>{html.escape(str(result["issue"]))}</td>'
            f'<td class="{status.lower()}">{status}</td>'
            f'<td>{html.escape(str(result["detail"]))}</td>'
            f"<td>{links}</td>"
            "</tr>"
        )
    html_report = f"""<!doctype html>
<html lang="vi"><head><meta charset="utf-8"><title>Sinco QC Evidence</title>
<style>body{{font:14px Arial;margin:24px;color:#172033}}table{{border-collapse:collapse;width:100%}}th,td{{border:1px solid #ccd3df;padding:9px;vertical-align:top}}th{{background:#eef3f8}}.pass{{color:#08783e;font-weight:bold}}.fail{{color:#b42318;font-weight:bold}}a{{color:#075da8}}</style>
</head><body><h1>Sinco Playwright QC Report</h1>
<p>URL: {html.escape(BASE_URL)}<br>Đơn vị: {html.escape(UNIT)}<br>Bắt đầu: {started_at.isoformat()}<br>Kết thúc: {finished_at.isoformat()}</p>
<table><thead><tr><th>Issue</th><th>Kết quả</th><th>Chi tiết</th><th>Evidence</th></tr></thead><tbody>{''.join(rows)}</tbody></table>
<p>Trace toàn phiên: <a href="trace.zip">trace.zip</a>. Video nằm trong thư mục <a href="video/">video/</a>.</p>
</body></html>"""
    evidence_path("index.html").write_text(html_report, encoding="utf-8")


def main() -> int:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    started_at = datetime.now().astimezone()
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        context = browser.new_context(
            viewport={"width": 1440, "height": 1000},
            accept_downloads=True,
            record_video_dir=str(evidence_path("video/.keep").parent),
            record_video_size={"width": 1280, "height": 720},
        )
        context.set_default_timeout(10_000)
        context.tracing.start(screenshots=True, snapshots=True, sources=True)
        page = context.new_page()
        try:
            login(page)
            run_case(page, "#48/#53", test_48_and_53)
            run_case(page, "#90", test_90)
            run_case(page, "#91", test_91)
            run_case(page, "#60", test_60)
        finally:
            context.tracing.stop(path=str(evidence_path("trace.zip")))
            context.close()
            browser.close()

    finished_at = datetime.now().astimezone()
    write_reports(started_at, finished_at)
    failures = [result for result in RESULTS if result["status"] != "PASS"]
    print(f"REPORT {OUTPUT_DIR / 'index.html'}", flush=True)
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
