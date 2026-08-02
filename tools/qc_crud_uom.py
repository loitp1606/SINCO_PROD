from __future__ import annotations

import json
import os
import sys
from datetime import datetime
from pathlib import Path

from playwright.sync_api import sync_playwright

from qc_full_program import browser_auth_script


FRONTEND_URL = os.environ.get("SINCO_QC_URL", "http://localhost:4200").rstrip("/")
BACKEND_URL = os.environ.get("SINCO_QC_API_URL", "http://localhost:5000").rstrip("/")
USERNAME = os.environ.get("SINCO_QC_USER", "")
PASSWORD = os.environ.get("SINCO_QC_PASSWORD", "")
OUTPUT = Path(os.environ.get("SINCO_QC_OUTPUT", "QC-Evidence/full-program/crud-uom"))


def main() -> int:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    code = "QC" + datetime.now().strftime("%m%d%H%M%S")
    created_name = "QCAUTO"
    updated_name = "QCUPD"
    result = {"entity": "uom", "key": code, "steps": [], "cleanup": False, "status": "FAIL"}

    with sync_playwright() as playwright:
        api = playwright.request.new_context(base_url=BACKEND_URL)
        login = api.post(
            "/api/auth/login",
            data={"userName": USERNAME, "password": PASSWORD, "unit": "CTY"},
            timeout=20_000,
        )
        auth = login.json()["data"]
        browser = playwright.chromium.launch(headless=True)
        context = browser.new_context(viewport={"width": 1440, "height": 1000})
        context.add_init_script(browser_auth_script(auth))
        page = context.new_page()
        try:
            page.goto(f"{FRONTEND_URL}/uom", wait_until="domcontentloaded")
            page.get_by_role("button", name="Thêm mới", exact=True).click()
            page.wait_for_url("**/uom/popup", timeout=15_000)
            master_inputs = page.locator(".master-form input:visible")
            master_inputs.nth(0).fill(code)
            master_inputs.nth(1).fill(created_name)
            master_inputs.nth(2).fill("QC AUTO")
            page.screenshot(path=str(OUTPUT / "01-create-before-save.png"), full_page=False)
            with page.expect_response(
                lambda response: "/api/Dynamic/save" in response.url, timeout=15_000
            ) as create_response_info:
                page.locator("button.btn-save").click()
            create_response = create_response_info.value
            if create_response.status >= 400:
                raise AssertionError(f"CREATE HTTP {create_response.status}: {create_response.text()}")
            page.wait_for_url("**/uom", timeout=20_000)
            page.locator("tbody tr", has_text=code).first.wait_for(timeout=15_000)
            result["steps"].append("CREATE PASS")
            page.screenshot(path=str(OUTPUT / "02-created.png"), full_page=False)

            row = page.locator("tbody tr", has_text=code).first
            row.click()
            page.locator('button[title*="(F2"]').click()
            page.wait_for_url("**/uom/popup", timeout=15_000)
            page.locator(".master-form input:visible").nth(1).fill(updated_name)
            page.screenshot(path=str(OUTPUT / "03-update-before-save.png"), full_page=False)
            with page.expect_response(
                lambda response: "/api/Dynamic/save" in response.url, timeout=15_000
            ) as update_response_info:
                page.locator("button.btn-save").click()
            update_response = update_response_info.value
            if update_response.status >= 400:
                raise AssertionError(f"UPDATE HTTP {update_response.status}: {update_response.text()}")
            page.wait_for_url("**/uom", timeout=20_000)
            page.locator("tbody tr", has_text=updated_name).first.wait_for(timeout=15_000)
            result["steps"].append("UPDATE PASS")
            page.screenshot(path=str(OUTPUT / "04-updated.png"), full_page=False)

            row = page.locator("tbody tr", has_text=code).first
            row.click()
            page.once("dialog", lambda dialog: dialog.accept())
            page.locator('button[title*="F8"]').click()
            page.wait_for_timeout(1_200)
            if page.locator("tbody tr", has_text=code).count() != 0:
                raise AssertionError(f"Bản ghi {code} vẫn còn sau khi xóa")
            result["steps"].append("DELETE PASS")
            result["cleanup"] = True
            result["status"] = "PASS"
            page.screenshot(path=str(OUTPUT / "05-deleted.png"), full_page=False)
        except Exception as exc:
            result["error"] = f"{type(exc).__name__}: {exc}"
            try:
                page.screenshot(path=str(OUTPUT / "failure.png"), full_page=False)
            except Exception:
                pass
        finally:
            context.close()
            browser.close()
            api.dispose()

    (OUTPUT / "qc-crud-result.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    (OUTPUT / "QC-CRUD-UOM.md").write_text(
        "# CRUD UOM QC\n\n"
        f"- Test key: `{code}`\n"
        f"- Status: **{result['status']}**\n"
        f"- Steps: {', '.join(result['steps'])}\n"
        f"- Cleanup: {'đã xóa dữ liệu test' if result['cleanup'] else 'chưa xác nhận'}\n"
        f"- Error: {result.get('error', '')}\n",
        encoding="utf-8",
    )
    print(json.dumps(result, ensure_ascii=False), flush=True)
    return 0 if result["status"] == "PASS" else 1


if __name__ == "__main__":
    sys.exit(main())
