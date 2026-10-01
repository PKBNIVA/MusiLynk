import { expect, test } from '@playwright/test';
import { signInShowcase } from './support/showcase-fixtures';

// The My work form's file upload (the successor of the removed Work samples page): progress
// while sending, a clear error when the storage refuses or the connection drops, and choosing
// the file again. Mocked storage; the real-Rails journey is tests/e2e/portfolio-uploads.spec.ts.
test.skip(Boolean(process.env.QA_BASE_URL) || process.env.QA_INTEGRATION === 'true', 'Uses local API fixtures only.');

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);
const bucket = 'https://bucket.verse-upload.test';
const publicUrl = 'https://media.verse.test/uploads/cover.png';

test('upload shows progress, reports a refused or dropped upload, and works when the file is chosen again', async ({
  page,
}) => {
  await signInShowcase(page);
  let attempt = 0;
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => (release = resolve));
  await page.route('**/api/uploads/presign', (route) =>
    route.fulfill({
      json: {
        mode: 'direct',
        id: 'upl_fake',
        method: 'PUT',
        uploadUrl: `${bucket}/cover.png`,
        headers: { 'Content-Type': 'image/png' },
        publicUrl,
        completeUrl: '/api/uploads/upl_fake/complete',
      },
    }),
  );
  await page.route(`${bucket}/cover.png`, async (route) => {
    attempt += 1;
    if (attempt === 1) {
      await gate;
      return route.fulfill({ status: 403, headers: { 'access-control-allow-origin': '*' }, body: '' });
    }
    if (attempt === 2) return route.abort('connectionreset');
    return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*' }, body: '' });
  });
  await page.route('**/api/uploads/upl_fake/complete', (route) =>
    route.fulfill({
      json: {
        url: publicUrl,
        upload: { id: 'upl_fake', url: publicUrl, status: 'complete', contentType: 'image/png', byteSize: PNG.length },
      },
    }),
  );

  await page.goto('/jobseeker/library');
  await page.getByRole('button', { name: 'Add work' }).click();
  const input = page.getByLabel(/Or upload a file/);
  const file = { name: 'cover.png', mimeType: 'image/png', buffer: PNG };

  // Progress is visible while the file is on its way, with a way to cancel.
  await input.setInputFiles(file);
  await expect(page.getByText(/Uploading cover\.png · \d+%/)).toBeVisible();
  await expect(
    page
      .getByText(/Uploading cover\.png/)
      .locator('..')
      .getByRole('button', { name: 'Cancel' }),
  ).toBeVisible();
  release();

  // Storage refused it: a plain message, nothing attached.
  await expect(page.getByRole('alert').filter({ hasText: 'Storage refused the file' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Remove file' })).toHaveCount(0);

  // The connection dropped: say so, still nothing attached.
  await input.setInputFiles(file);
  await expect(page.getByRole('alert').filter({ hasText: /./ }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Remove file' })).toHaveCount(0);

  // Choosing the file again works, and it is attached.
  await input.setInputFiles(file);
  await expect(page.getByRole('button', { name: 'Remove file' })).toBeVisible();
  await expect(page.getByTestId('work-preview')).toBeVisible();
  expect(attempt).toBe(3);
});
