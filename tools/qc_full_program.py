from __future__ import annotations

import html
import json
import os
import re
import sys
import traceback
from datetime import datetime
from pathlib import Path
from typing import Any

from playwright.sync_api import Page, TimeoutError as PlaywrightTimeoutError, sync_playwright


FRONTEND_URL = os.environ.get("SINCO_QC_URL", "http://localhost:4200").rstrip("/")
BACKEND_URL = os.environ.get("SINCO_QC_API_URL", "http://localhost:5000").rstrip("/")
USERNAME = os.environ.get("SINCO_QC_USER", "")
PASSWORD = os.environ.get("SINCO_QC_PASSWORD", "")
UNIT_CODE = os.environ.get("SINCO_QC_UNIT_CODE", "CTY")
UNIT_NAME = os.environ.get("SINCO_QC_UNIT", "Tổng công ty")
OUTPUT = Path(os.environ.get("SINCO_QC_OUTPUT", "QC-Evidence/full-program"))
EXERCISE_FORMS = os.environ.get("SINCO_QC_EXERCISE_FORMS", "0") == "1"


def safe_name(value: str) -> str:
    value = value.strip("/") or "root"
    return re.sub(r"[^A-Za-z0-9._-]+", "-", value)


def flatten_leaf_menu(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    leaves: list[dict[str, Any]] = []
    for item in items or []:
        children = item.get("children") or []
        if children:
            leaves.extend(flatten_leaf_menu(children))
        elif item.get("hasAccess") and item.get("url"):
            leaves.append(item)
    unique: dict[str, dict[str, Any]] = {}
    for item in leaves:
        unique.setdefault(item["url"], item)
    return list(unique.values())


def browser_auth_script(auth: dict[str, Any]) -> str:
    values = {
        "token": auth["token"],
        "sessionId": auth.get("sessionId", ""),
        "unit": auth.get("unit") or UNIT_CODE,
        "userId": str(auth["userId"]),
        "userName": auth["userName"],
    }
    return f"""
    (() => {{
      const values = {json.dumps(values, ensure_ascii=False)};
      for (const [key, value] of Object.entries(values)) localStorage.setItem(key, value);
      localStorage.setItem('language', 'vi');
    }})();
    """


def visible_count(page: Page, selector: str) -> int:
    return page.locator(selector).count()


def is_ignored_external_asset(url: str) -> bool:
    lowered = url.lower()
    return any(
        host in lowered
        for host in (
            "fonts.googleapis.com",
            "fonts.gstatic.com",
            "cdnjs.cloudflare.com",
        )
    )


def cancel_form(page: Page) -> bool:
    candidates = [
        page.locator("button.btn-cancel:visible"),
        page.locator("mat-dialog-container button:visible").filter(has_text=re.compile("Hủy|Cancel", re.I)),
        page.get_by_role("button", name=re.compile("Hủy|Cancel", re.I)),
    ]
    for candidate in candidates:
        try:
            if candidate.count() and candidate.first.is_visible():
                candidate.first.click(timeout=5_000)
                page.wait_for_timeout(250)
                return True
        except Exception:
            continue
    return False


def exercise_generic_form(page: Page, route: str, evidence_dir: Path) -> dict[str, Any]:
    result: dict[str, Any] = {"attempted": False, "mode": "none", "status": "NOT_APPLICABLE"}
    view = page.locator('button[title*="(F4"]:visible')
    rows = page.locator("table:visible tbody tr")

    if view.count() and rows.count():
        result.update({"attempted": True, "mode": "view"})
        try:
            rows.first.click(timeout=5_000)
            page.wait_for_timeout(150)
            if view.first.is_enabled():
                view.first.click(timeout=5_000)
                page.locator("button.btn-cancel:visible").first.wait_for(timeout=12_000)
                form_image = evidence_dir / "forms" / f"{safe_name(route)}-view.png"
                form_image.parent.mkdir(parents=True, exist_ok=True)
                page.screenshot(path=str(form_image), full_page=False)
                result["evidence"] = str(form_image.relative_to(OUTPUT)).replace("\\", "/")
                result["status"] = "PASS" if cancel_form(page) else "FAIL"
                if result["status"] == "FAIL":
                    result["error"] = "Không tìm thấy nút Hủy sau khi mở Xem"
            else:
                result["status"] = "SKIP"
                result["reason"] = "Nút Xem bị disable"
            return result
        except Exception as exc:
            result["status"] = "FAIL"
            result["error"] = f"{type(exc).__name__}: {exc}"
            return result

    add = page.get_by_role("button", name="Thêm mới", exact=True)
    if add.count() and add.first.is_visible() and add.first.is_enabled():
        result.update({"attempted": True, "mode": "add"})
        try:
            add.first.click(timeout=5_000)
            page.locator("button.btn-cancel:visible").first.wait_for(timeout=12_000)
            form_image = evidence_dir / "forms" / f"{safe_name(route)}-add.png"
            form_image.parent.mkdir(parents=True, exist_ok=True)
            page.screenshot(path=str(form_image), full_page=False)
            result["evidence"] = str(form_image.relative_to(OUTPUT)).replace("\\", "/")
            result["status"] = "PASS" if cancel_form(page) else "FAIL"
            if result["status"] == "FAIL":
                result["error"] = "Không tìm thấy nút Hủy sau khi mở Thêm mới"
        except Exception as exc:
            result["status"] = "FAIL"
            result["error"] = f"{type(exc).__name__}: {exc}"
    return result


def classify_status(result: dict[str, Any]) -> str:
    if result.get("redirectedToLogin") or result.get("navigationStatus", 200) >= 400:
        return "FAIL"
    if result.get("pageErrors"):
        return "FAIL"
    severe_http = [x for x in result.get("httpErrors", []) if x["status"] >= 500 or x["status"] in (401, 403)]
    if severe_http:
        return "FAIL"
    if result.get("interaction", {}).get("status") == "FAIL":
        return "FAIL"
    if result.get("bodyLength", 0) < 30:
        return "FAIL"
    if result.get("consoleErrors") or result.get("httpErrors"):
        return "WARN"
    return "PASS"


def write_reports(meta: dict[str, Any], routes: list[dict[str, Any]]) -> None:
    payload = {"meta": meta, "summary": {}, "routes": routes}
    for status in ("PASS", "WARN", "FAIL"):
        payload["summary"][status] = sum(1 for route in routes if route["status"] == status)
    (OUTPUT / "qc-full-results.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    rows = []
    for item in routes:
        errors = []
        errors.extend(item.get("pageErrors", []))
        errors.extend(f"HTTP {x['status']} {x['url']}" for x in item.get("httpErrors", []))
        errors.extend(item.get("consoleErrors", []))
        interaction = item.get("interaction", {})
        if interaction.get("error"):
            errors.append(interaction["error"])
        evidence = item.get("evidence", "")
        evidence_link = f'<a href="{html.escape(evidence)}">Screenshot</a>' if evidence else ""
        if interaction.get("evidence"):
            evidence_link += f'<br><a href="{html.escape(interaction["evidence"])}">Form</a>'
        rows.append(
            "<tr>"
            f"<td>{html.escape(item['name'])}</td>"
            f"<td><code>{html.escape(item['route'])}</code></td>"
            f'<td class="{item["status"].lower()}">{item["status"]}</td>'
            f"<td>{item.get('tables', 0)} table / {item.get('inputs', 0)} input / {item.get('buttons', 0)} button</td>"
            f"<td>{html.escape(interaction.get('mode', 'none'))}: {html.escape(interaction.get('status', ''))}</td>"
            f"<td>{'<br>'.join(html.escape(str(error)) for error in errors)}</td>"
            f"<td>{evidence_link}</td>"
            "</tr>"
        )

    summary = payload["summary"]
    report = f"""<!doctype html><html lang="vi"><head><meta charset="utf-8">
<title>SINCO Full Program QC</title><style>
body{{font:14px Arial;margin:24px;color:#172033}}table{{border-collapse:collapse;width:100%}}
th,td{{border:1px solid #ccd3df;padding:8px;vertical-align:top}}th{{background:#eef3f8}}
.pass{{color:#08783e;font-weight:bold}}.warn{{color:#9a6700;font-weight:bold}}.fail{{color:#b42318;font-weight:bold}}
code{{white-space:nowrap}}a{{color:#075da8}}</style></head><body>
<h1>SINCO Full Program QC</h1>
<p>URL: {html.escape(meta['frontendUrl'])}<br>Đơn vị: {html.escape(UNIT_NAME)}<br>
Commit: <code>{html.escape(meta['commit'])}</code><br>Bắt đầu: {meta['startedAt']}<br>Kết thúc: {meta['finishedAt']}</p>
<h2>Smoke route: PASS {summary['PASS']} / WARN {summary['WARN']} / FAIL {summary['FAIL']}</h2>
<table><thead><tr><th>Màn hình</th><th>Route</th><th>Kết quả</th><th>DOM</th><th>Form check</th><th>Lỗi</th><th>Evidence</th></tr></thead>
<tbody>{''.join(rows)}</tbody></table><p><a href="trace.zip">Playwright trace</a> · <a href="qc-full-results.json">JSON result</a></p>
</body></html>"""
    (OUTPUT / "index.html").write_text(report, encoding="utf-8")

    md_lines = [
        "# SINCO Full Program QC",
        "",
        f"- URL: `{meta['frontendUrl']}`",
        f"- Đơn vị: {UNIT_NAME}",
        f"- Commit: `{meta['commit']}`",
        f"- Kết quả route: PASS {summary['PASS']} / WARN {summary['WARN']} / FAIL {summary['FAIL']}",
        "- Phạm vi lượt này: smoke toàn bộ menu và mở Xem/Thêm rồi Hủy khi có thể; không lưu dữ liệu.",
        "",
        "| Màn hình | Route | Kết quả | Form |",
        "|---|---|---|---|",
    ]
    for item in routes:
        interaction = item.get("interaction", {})
        md_lines.append(
            f"| {item['name']} | `{item['route']}` | {item['status']} | {interaction.get('mode', 'none')}: {interaction.get('status', '')} |"
        )
    (OUTPUT / "QC-FULL-REPORT.md").write_text("\n".join(md_lines) + "\n", encoding="utf-8")


def main() -> int:
    if not USERNAME or not PASSWORD:
        raise RuntimeError("Thiếu SINCO_QC_USER hoặc SINCO_QC_PASSWORD")
    OUTPUT.mkdir(parents=True, exist_ok=True)
    (OUTPUT / "routes").mkdir(exist_ok=True)
    started = datetime.now().astimezone()
    route_results: list[dict[str, Any]] = []

    with sync_playwright() as playwright:
        api = playwright.request.new_context(base_url=BACKEND_URL)
        login = api.post(
            "/api/auth/login",
            data={"userName": USERNAME, "password": PASSWORD, "unit": UNIT_CODE},
            timeout=20_000,
        )
        if not login.ok:
            raise RuntimeError(f"Đăng nhập API trả HTTP {login.status}: {login.text()}")
        login_payload = login.json()
        if not login_payload.get("success"):
            raise RuntimeError(login_payload.get("message") or "Đăng nhập API thất bại")
        auth = login_payload["data"]

        authorized_api = playwright.request.new_context(
            base_url=BACKEND_URL,
            extra_http_headers={"Authorization": f"Bearer {auth['token']}"},
        )
        menu_response = authorized_api.get(f"/api/menu/user-menu/{auth['userId']}", timeout=20_000)
        if not menu_response.ok:
            raise RuntimeError(f"Menu API trả HTTP {menu_response.status}: {menu_response.text()}")
        menu_payload = menu_response.json()
        routes = flatten_leaf_menu(menu_payload.get("data") or [])
        print(f"INVENTORY {len(routes)} accessible leaf routes", flush=True)

        browser = playwright.chromium.launch(headless=True)
        context = browser.new_context(viewport={"width": 1440, "height": 1000})
        context.add_init_script(browser_auth_script(auth))
        context.tracing.start(screenshots=True, snapshots=True, sources=False)
        page = context.new_page()

        current: dict[str, Any] = {}

        def on_page_error(error: Any) -> None:
            current.setdefault("pageErrors", []).append(str(error))

        def on_console(message: Any) -> None:
            if message.type == "error":
                text = message.text
                if "favicon.ico" not in text and "ERR_NETWORK_ACCESS_DENIED" not in text:
                    current.setdefault("consoleErrors", []).append(text[:500])

        def on_response(response: Any) -> None:
            if (
                response.status >= 400
                and "favicon.ico" not in response.url
                and not is_ignored_external_asset(response.url)
            ):
                current.setdefault("httpErrors", []).append(
                    {"status": response.status, "url": response.url}
                )

        page.on("pageerror", on_page_error)
        page.on("console", on_console)
        page.on("response", on_response)

        try:
            for index, menu in enumerate(routes, start=1):
                if index > 1 and (index - 1) % 10 == 0:
                    page.close()
                    page = context.new_page()
                    page.on("pageerror", on_page_error)
                    page.on("console", on_console)
                    page.on("response", on_response)
                route = menu["url"]
                current = {
                    "name": menu.get("name") or menu.get("title") or route,
                    "route": route,
                    "pageErrors": [],
                    "consoleErrors": [],
                    "httpErrors": [],
                }
                try:
                    response = page.goto(
                        f"{FRONTEND_URL}{route}", wait_until="domcontentloaded", timeout=25_000
                    )
                    current["navigationStatus"] = response.status if response else 0
                    page.locator("body").wait_for(timeout=10_000)
                    page.wait_for_timeout(900)
                    current["finalUrl"] = page.url
                    current["redirectedToLogin"] = "/login" in page.url
                    current["title"] = page.title()
                    current["bodyLength"] = len(page.locator("body").inner_text())
                    current["tables"] = visible_count(page, "table:visible")
                    current["inputs"] = visible_count(page, "input:visible, select:visible, textarea:visible")
                    current["buttons"] = visible_count(page, "button:visible")

                    image = OUTPUT / "routes" / f"{index:02d}-{safe_name(route)}.png"
                    page.screenshot(path=str(image), full_page=False)
                    current["evidence"] = str(image.relative_to(OUTPUT)).replace("\\", "/")
                    current["interaction"] = (
                        exercise_generic_form(page, route, OUTPUT)
                        if EXERCISE_FORMS
                        else {"attempted": False, "mode": "none", "status": "SKIP"}
                    )
                except Exception as exc:
                    current["exception"] = f"{type(exc).__name__}: {exc}"
                    current.setdefault("pageErrors", []).append(current["exception"])
                    try:
                        image = OUTPUT / "routes" / f"{index:02d}-{safe_name(route)}-failure.png"
                        page.screenshot(path=str(image), full_page=False)
                        current["evidence"] = str(image.relative_to(OUTPUT)).replace("\\", "/")
                    except Exception:
                        pass
                current["status"] = classify_status(current)
                route_results.append(current)
                print(
                    f"ROUTE {index:02d}/{len(routes):02d} {current['status']:4s} {route}",
                    flush=True,
                )
        finally:
            context.tracing.stop(path=str(OUTPUT / "trace.zip"))
            context.close()
            browser.close()
            try:
                authorized_api.post("/api/auth/logout", timeout=5_000)
            except Exception:
                pass
            authorized_api.dispose()
            api.dispose()

    finished = datetime.now().astimezone()
    commit = os.popen("git rev-parse --short HEAD").read().strip() or "unknown"
    meta = {
        "frontendUrl": FRONTEND_URL,
        "backendUrl": BACKEND_URL,
        "commit": commit,
        "startedAt": started.isoformat(),
        "finishedAt": finished.isoformat(),
        "routeCount": len(route_results),
    }
    write_reports(meta, route_results)
    failures = [route for route in route_results if route["status"] == "FAIL"]
    print(f"REPORT {OUTPUT / 'index.html'}", flush=True)
    print(f"SUMMARY PASS={sum(x['status']=='PASS' for x in route_results)} WARN={sum(x['status']=='WARN' for x in route_results)} FAIL={len(failures)}", flush=True)
    return 1 if failures else 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:
        traceback.print_exc()
        sys.exit(2)
