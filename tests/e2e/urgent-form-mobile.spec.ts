import { expect, test } from '@playwright/test';

// At phone width the urgent form's date-and-time field must show its whole value, not clip it.
test.skip(Boolean(process.env.QA_BASE_URL) || process.env.QA_INTEGRATION === 'true', 'Uses local API fixtures only.');

for (const width of [390, 360]) {
  test(`the urgent form's date and time shows its full value at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.route('**/api/**', (route) => {
      const { pathname } = new URL(route.request().url());
      if (pathname.endsWith('/me'))
        return route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({}) });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) });
    });
    await page.goto('/urgent');
    const field = page.locator('#urgent-start');
    await expect(field).toBeVisible();
    await expect(field).not.toHaveValue('');
    await page.getByRole('button', { name: 'More details (optional)' }).click();
    const ends = page.getByLabel('Ends');
    await ends.fill('2026-12-31T23:30');

    for (const input of [field, ends]) {
      const box = await input.boundingBox();
      expect(box).not.toBeNull();
      // Inside the viewport, and the value is not cut off by the field's own edge.
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width);
      const clipped = await input.evaluate((el: HTMLInputElement) => {
        const edit = el.shadowRoot?.querySelector('[pseudo="-webkit-datetime-edit"]') as HTMLElement | null;
        const target = edit ?? el;
        return target.scrollWidth - el.clientWidth;
      });
      expect(clipped).toBeLessThanOrEqual(0);
    }

    // Nothing makes the page itself scroll sideways.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}
