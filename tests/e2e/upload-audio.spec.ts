import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { fixtureSamples, fixtureTalent } from './qa-helpers';

// An uploaded audio work sample arrives with its generated variants (backend AudioSet): the player
// starts on the 30 s preview clip, never the original, draws the waveform from the peaks file and
// switches to the full track on demand.
test.skip(Boolean(process.env.QA_BASE_URL) || process.env.QA_INTEGRATION === 'true', 'Uses local API fixtures only.');

const MEDIA = 'https://media.example.test/uploads/qa';
const ORIGINAL = `${MEDIA}/take.wav`;
const audio = {
  preview: `${ORIGINAL}/v/preview.m4a`,
  full: `${ORIGINAL}/v/full.m4a`,
  peaks: `${ORIGINAL}/v/peaks.json`,
  duration: 2,
};
// The 2 s WAV the backend job test uses; served for every media URL (the browser plays by Content-Type, not name).
const WAV = readFileSync(new URL('../../backend/test/fixtures/files/audio-sample.wav', import.meta.url));
const PEAKS = JSON.stringify({ version: 1, duration: 2, peaks: Array.from({ length: 400 }, (_, i) => (i % 40) / 40) });

const professional = { ...fixtureTalent[0], demo: false };
const sample = { ...fixtureSamples[professional.id][0], url: ORIGINAL, audio, mediaMetadata: { contentType: 'audio/wav' } };

async function mockProfile(page: import('@playwright/test').Page) {
  const requested: string[] = [];
  await page.route(`${MEDIA}/**`, (route) => {
    const url = route.request().url();
    requested.push(url);
    if (url.endsWith('peaks.json')) return route.fulfill({ status: 200, contentType: 'application/json', body: PEAKS });
    return route.fulfill({
      status: 200,
      contentType: 'audio/wav',
      headers: { 'Accept-Ranges': 'bytes', 'Cache-Control': 'public, max-age=31536000, immutable' },
      body: WAV,
    });
  });
  await page.route('**/api/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === `/api/public/talent/${professional.id}`) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ professional, portfolio: [sample] }) });
    }
    if (path === '/api/me') return route.fulfill({ status: 401, contentType: 'application/json', body: '{}' });
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  return requested;
}

test('a work sample starts playing from the preview clip, shows the waveform and can switch to the full track', async ({ page }) => {
  const requested = await mockProfile(page);
  await page.goto(`/professionals/${professional.id}`);
  const player = page.getByTestId('audio-player').first();
  await expect(player).toBeVisible();
  await expect(player).toHaveAttribute('data-audio-mode', 'preview');
  const audioEl = player.locator('audio');
  await expect(audioEl).toHaveAttribute('src', audio.preview);
  await expect(player.getByTestId('waveform-canvas')).toBeVisible();
  await expect(player.getByTestId('waveform-canvas')).toHaveAttribute('data-bars', '200');

  // Play: the browser fetches the preview clip, and only the preview clip, to start.
  await audioEl.evaluate((el: HTMLAudioElement) => el.play());
  await expect.poll(() => audioEl.evaluate((el: HTMLAudioElement) => el.currentTime > 0 || el.ended)).toBe(true);
  expect(requested.filter((url) => url.endsWith('preview.m4a')).length).toBeGreaterThan(0);
  expect(requested.filter((url) => url.endsWith('peaks.json')).length).toBeGreaterThan(0);
  expect(requested.filter((url) => url === ORIGINAL || url.endsWith('full.m4a'))).toEqual([]);

  // Ask for the whole track: the source swaps to the transcode.
  await player.getByRole('button', { name: 'Play full track' }).click();
  await expect(player).toHaveAttribute('data-audio-mode', 'full');
  await expect(audioEl).toHaveAttribute('src', audio.full);
  await expect.poll(() => requested.filter((url) => url.endsWith('full.m4a')).length).toBeGreaterThan(0);
  expect(requested.filter((url) => url === ORIGINAL)).toEqual([]);
});
