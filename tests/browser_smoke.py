"""
Browser smoke test for The Paper Trail — Script Studio (3-Step Vertical Layout).
Verifies that clicking "Audit & Polish Script" runs the pass and focuses the Final Polished Script export view.
"""

from playwright.sync_api import sync_playwright


def run_smoke_test(base_url: str = "http://localhost:3000") -> None:
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1440, "height": 900})
        page.goto(base_url, wait_until="networkidle")

        page.get_by_role("button", name="Audit & Polish Script").click()
        page.get_by_role("button", name="Copy Final Script").wait_for(timeout=15000)
        page.get_by_role("button", name="Download .md File").wait_for(timeout=5000)

        browser.close()


if __name__ == "__main__":
    run_smoke_test()
