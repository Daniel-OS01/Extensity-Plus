from playwright.sync_api import sync_playwright

def run_cuj(page):
    page.goto("file:///app/profiles.html")
    page.wait_for_timeout(1000)

    # Add a new profile
    page.locator("#name").fill("Test Profile")
    page.wait_for_timeout(500)
    page.locator("button.add").click()
    page.wait_for_timeout(1000)

    # Focus the remove-profile button to show keyboard accessibility styling
    page.locator(".remove-profile").first.focus()
    page.wait_for_timeout(1000)

    # Hover over the remove-profile button to show hover styling
    page.locator(".remove-profile").first.hover()
    page.wait_for_timeout(1000)

    # Take screenshot
    page.screenshot(path="verification.png")
    page.wait_for_timeout(1000)

if __name__ == "__main__":
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(
            record_video_dir="videos",
            viewport={'width': 800, 'height': 600}
        )
        page = context.new_page()
        try:
            run_cuj(page)
        finally:
            context.close()
            browser.close()
