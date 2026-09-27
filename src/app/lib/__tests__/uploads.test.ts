import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeXhr, flush, jsonResponse } from './helpers';

vi.mock('../monitoring', () => ({ reportApiFailure: vi.fn() }));

type ApiModule = typeof import('../api');

async function loadApi(): Promise<ApiModule> {
  vi.resetModules();
  return import('../api');
}

function fileOf(name: string, type: string, size?: number) {
  const file = new File(['abc'], name, { type });
  if (size !== undefined) Object.defineProperty(file, 'size', { value: size });
  return file;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  FakeXhr.instances = [];
  vi.stubGlobal('XMLHttpRequest', FakeXhr);
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

/** Waits until the upload has reached the XMLHttpRequest stage. */
async function nextXhr() {
  for (let i = 0; i < 20 && !FakeXhr.latest()?.sent && !FakeXhr.latest()?.aborted; i += 1) await flush();
  return FakeXhr.latest();
}

describe('uploadContentType', () => {
  it('accepts the supported types and canonicalises browser aliases', async () => {
    const { uploadContentType } = await loadApi();
    expect(uploadContentType(fileOf('a.mp3', 'audio/mpeg'))).toBe('audio/mpeg');
    expect(uploadContentType(fileOf('a.mp3', 'audio/mp3'))).toBe('audio/mpeg');
    expect(uploadContentType(fileOf('a.wav', 'audio/x-wav'))).toBe('audio/wav');
    expect(uploadContentType(fileOf('a.wav', 'AUDIO/WAVE'))).toBe('audio/wav');
    expect(uploadContentType(fileOf('a.jpg', 'image/pjpeg'))).toBe('image/jpeg');
    expect(uploadContentType(fileOf('cv.pdf', 'application/pdf'))).toBe('application/pdf');
  });

  it('falls back to the extension only when the browser gives no real type', async () => {
    const { uploadContentType } = await loadApi();
    expect(uploadContentType(fileOf('Track.WAV', ''))).toBe('audio/wav');
    expect(uploadContentType(fileOf('clip.mp4', 'application/octet-stream'))).toBe('video/mp4');
    expect(uploadContentType(fileOf('notes', ''))).toBeNull();
    expect(uploadContentType(fileOf('setup.exe', ''))).toBeNull();
    // A declared, unsupported type is not overridden by a friendly-looking extension.
    expect(uploadContentType(fileOf('evil.mp3', 'text/html'))).toBeNull();
  });
});

describe('validateUploadFile', () => {
  it('rejects unsupported, empty and oversized files with specific errors', async () => {
    const { validateUploadFile, UPLOAD_MAX_BYTES } = await loadApi();
    expect(() => validateUploadFile(fileOf('a.gif', 'image/gif'))).toThrow(
      expect.objectContaining({ code: 'UNSUPPORTED_TYPE', status: 422 }),
    );
    expect(() => validateUploadFile(fileOf('a.png', 'image/png', 0))).toThrow(
      expect.objectContaining({ code: 'FILE_EMPTY' }),
    );
    expect(() => validateUploadFile(fileOf('a.mp4', 'video/mp4', UPLOAD_MAX_BYTES + 1))).toThrow(
      'File is too large (101 MB). The limit is 100 MB.',
    );
    expect(() => validateUploadFile(fileOf('a.mp4', 'video/mp4', UPLOAD_MAX_BYTES))).not.toThrow();
  });

  it('keeps the accept list in step with the validator', async () => {
    const { UPLOAD_ACCEPT } = await loadApi();
    for (const type of [
      'audio/mpeg',
      'audio/wav',
      'video/mp4',
      'image/jpeg',
      'image/png',
      'image/webp',
      'application/pdf',
    ]) {
      expect(UPLOAD_ACCEPT.split(',')).toContain(type);
    }
  });
});

describe('uploadMedia', () => {
  it('rejects an invalid file before contacting the server', async () => {
    const { uploadMedia } = await loadApi();
    await expect(uploadMedia(fileOf('a.txt', 'text/plain'))).rejects.toMatchObject({ code: 'UNSUPPORTED_TYPE' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uploads directly to storage with PUT and completes the upload', async () => {
    const { uploadMedia } = await loadApi();
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          mode: 'direct',
          id: 'up1',
          uploadUrl: 'https://bucket.example/put',
          headers: { 'Content-Type': 'audio/mpeg', 'x-amz-acl': 'private' },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          url: 'https://cdn.example/a.mp3',
          upload: { id: 'up1', contentType: 'audio/mpeg', byteSize: 3 },
        }),
      );
    const progress = vi.fn();

    const result = uploadMedia(fileOf('a.mp3', 'audio/mpeg'), progress);
    const xhr = await nextXhr();
    expect(xhr).toMatchObject({ method: 'PUT', url: 'https://bucket.example/put', timeout: 30 * 60_000 });
    expect(xhr.requestHeaders).toEqual({ 'Content-Type': 'audio/mpeg', 'x-amz-acl': 'private' });
    xhr.upload.onprogress!({ lengthComputable: true, loaded: 3, total: 3 });
    xhr.upload.onprogress!({ lengthComputable: false, loaded: 1, total: 0 });
    xhr.respond(200);

    await expect(result).resolves.toEqual({
      id: 'up1',
      url: 'https://cdn.example/a.mp3',
      contentType: 'audio/mpeg',
      byteSize: 3,
    });
    expect(progress.mock.calls.map((call) => call[0])).toEqual([0, 99, 100]);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      filename: 'a.mp3',
      contentType: 'audio/mpeg',
      size: 3,
    });
    expect(fetchMock.mock.calls[1][0]).toBe('/api/uploads/up1/complete');
  });

  it('defaults direct PUT headers to the content type and the id to the presign id', async () => {
    const { uploadMedia } = await loadApi();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ mode: 'direct', id: 'up5', uploadUrl: 'https://bucket.example/put' }))
      .mockResolvedValueOnce(jsonResponse({ url: 'https://cdn.example/x.png' }));

    const result = uploadMedia(fileOf('x.png', 'image/png'), {});
    const xhr = await nextXhr();
    expect(xhr.requestHeaders).toEqual({ 'Content-Type': 'image/png' });
    xhr.respond(204);
    await expect(result).resolves.toMatchObject({ id: 'up5', url: 'https://cdn.example/x.png' });
  });

  it('sends S3 POST policies as multipart with the file as the last field', async () => {
    const { uploadMedia } = await loadApi();
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          mode: 'direct',
          method: 'POST',
          id: 'up2',
          uploadUrl: 'https://bucket.example/',
          fields: { key: 'k/1', policy: 'p' },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ url: 'u', upload: { id: 'up2' } }));

    const result = uploadMedia(fileOf('a.pdf', 'application/pdf'));
    const xhr = await nextXhr();
    expect(xhr.method).toBe('POST');
    expect(xhr.requestHeaders).toEqual({});
    const body = xhr.body as FormData;
    expect([...body.keys()]).toEqual(['key', 'policy', 'file']);
    xhr.respond(201);
    await expect(result).resolves.toMatchObject({ id: 'up2' });
  });

  it('discards the pending upload when storage refuses the file', async () => {
    const { uploadMedia } = await loadApi();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ mode: 'direct', id: 'up3', uploadUrl: 'https://bucket.example/put' }))
      .mockResolvedValueOnce(jsonResponse(null, 204));

    const result = uploadMedia(fileOf('a.webp', 'image/webp')).catch((e) => e);
    (await nextXhr()).respond(403);

    expect(await result).toMatchObject({
      status: 403,
      code: 'UPLOAD_FAILED',
      message: expect.stringContaining('Storage refused the file'),
    });
    expect(fetchMock.mock.calls[1][0]).toBe('/api/uploads/up3');
    expect(fetchMock.mock.calls[1][1].method).toBe('DELETE');
  });

  it('reports other storage failures with their status even if cleanup fails', async () => {
    const { uploadMedia } = await loadApi();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ mode: 'direct', id: 'up4', uploadUrl: 'https://bucket.example/put' }))
      .mockRejectedValueOnce(new TypeError('offline'));

    const result = uploadMedia(fileOf('a.webp', 'image/webp')).catch((e) => e);
    (await nextXhr()).respond(500);
    expect(await result).toMatchObject({ status: 500, message: 'Upload failed (500). Please retry.' });
  });

  it('streams proxied uploads to the API with the token and a safe filename', async () => {
    const { uploadMedia, setAccessToken } = await loadApi();
    setAccessToken('tok');
    fetchMock.mockResolvedValueOnce(jsonResponse({ mode: 'proxy', uploadUrl: '/api/uploads/local/abc' }));

    const result = uploadMedia(fileOf('my demo (final).mp3', 'audio/mpeg'));
    const xhr = await nextXhr();
    expect(xhr.url).toBe('/api/uploads/local/abc');
    expect(xhr.requestHeaders).toEqual({
      'Content-Type': 'audio/mpeg',
      'X-Filename': 'my_demo__final_.mp3',
      Authorization: 'Bearer tok',
    });
    xhr.respond(
      201,
      { id: 'p1', url: '/media/p1', upload: { contentType: 'audio/mpeg', byteSize: 3 } },
      { 'x-request-id': 'r' },
    );

    await expect(result).resolves.toMatchObject({ id: 'p1', url: '/media/p1', contentType: 'audio/mpeg', byteSize: 3 });
  });

  it('keeps absolute proxied upload URLs and surfaces server errors', async () => {
    const { uploadMedia } = await loadApi();
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ mode: 'proxy', uploadUrl: 'https://api.example/api/uploads/local/x' }),
    );

    const result = uploadMedia(fileOf('a.mp3', 'audio/mpeg')).catch((e) => e);
    const xhr = await nextXhr();
    expect(xhr.url).toBe('https://api.example/api/uploads/local/x');
    expect(xhr.requestHeaders.Authorization).toBeUndefined();
    xhr.respond(422, { error: 'That is not really an MP3', code: 'TYPE_MISMATCH', requestId: 'rid' });

    expect(await result).toMatchObject({
      status: 422,
      code: 'TYPE_MISMATCH',
      message: 'That is not really an MP3',
      requestId: 'rid',
    });
  });

  it('tolerates an unreadable error body', async () => {
    const { uploadMedia } = await loadApi();
    fetchMock.mockResolvedValueOnce(jsonResponse({ mode: 'proxy', uploadUrl: '/api/uploads/local/x' }));
    const result = uploadMedia(fileOf('a.mp3', 'audio/mpeg')).catch((e) => e);
    (await nextXhr()).respond(500, '{broken');
    expect(await result).toMatchObject({ status: 500, message: 'Upload failed (500)' });
  });

  it('signs out when the proxied upload is rejected as unauthorised', async () => {
    const { uploadMedia, setAccessToken, hasAccessToken } = await loadApi();
    setAccessToken('expired');
    fetchMock.mockResolvedValueOnce(jsonResponse({ mode: 'proxy', uploadUrl: '/api/uploads/local/x' }));

    const result = uploadMedia(fileOf('a.mp3', 'audio/mpeg')).catch((e) => e);
    (await nextXhr()).respond(401, { error: 'Unauthorized' });

    expect(await result).toMatchObject({ status: 401 });
    expect(hasAccessToken()).toBe(false);
  });

  it.each([
    ['onerror', 'NETWORK_ERROR', 'Upload interrupted. Check your connection and retry.'],
    ['ontimeout', 'REQUEST_TIMEOUT', 'Upload timed out. Please retry.'],
  ] as const)('maps xhr %s to %s', async (handler, code, message) => {
    const { uploadMedia } = await loadApi();
    fetchMock.mockResolvedValueOnce(jsonResponse({ mode: 'proxy', uploadUrl: '/api/uploads/local/x' }));
    const result = uploadMedia(fileOf('a.mp3', 'audio/mpeg')).catch((e) => e);
    (await nextXhr())[handler]!();
    expect(await result).toMatchObject({ code, message });
  });

  it('cancels an upload in progress when the caller aborts', async () => {
    const { uploadMedia } = await loadApi();
    const controller = new AbortController();
    fetchMock.mockResolvedValueOnce(jsonResponse({ mode: 'proxy', uploadUrl: '/api/uploads/local/x' }));

    const result = uploadMedia(fileOf('a.mp3', 'audio/mpeg'), { signal: controller.signal }).catch((e) => e);
    const xhr = await nextXhr();
    controller.abort();

    expect(xhr.aborted).toBe(true);
    expect(await result).toMatchObject({ code: 'UPLOAD_CANCELLED' });
  });

  it('does not send at all when aborted before the transfer starts', async () => {
    const { uploadMedia } = await loadApi();
    const controller = new AbortController();
    fetchMock.mockImplementationOnce(async () => {
      controller.abort();
      return jsonResponse({ mode: 'proxy', uploadUrl: '/api/uploads/local/x' });
    });

    const result = await uploadMedia(fileOf('a.mp3', 'audio/mpeg'), { signal: controller.signal }).catch((e) => e);
    expect(result).toMatchObject({ code: 'UPLOAD_CANCELLED' });
    expect(FakeXhr.latest().sent).toBe(false);
  });

  it('discardUpload deletes without forcing a sign-in redirect', async () => {
    const { discardUpload } = await loadApi();
    fetchMock.mockResolvedValueOnce(jsonResponse(null, 204));
    await discardUpload('u9');
    expect(fetchMock.mock.calls[0][0]).toBe('/api/uploads/u9');
    expect(fetchMock.mock.calls[0][1].method).toBe('DELETE');
  });
});
