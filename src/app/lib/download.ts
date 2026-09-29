import { API_BASE, ApiError, fetchWithTimeout, readToken, type ApiErrorBody } from './api';

/** GET a file (a CSV export) with the signed-in token; a failure is an ApiError with the API's message. */
export async function apiDownload(path: string): Promise<Blob> {
  const headers = new Headers();
  const token = readToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const response = await fetchWithTimeout(`${API_BASE}${path}`, {
    method: 'GET',
    headers,
    credentials: 'omit',
    timeoutMs: 30_000,
  });
  if (response.ok) return response.blob();
  const body = (await response.json().catch(() => ({}))) as ApiErrorBody;
  throw new ApiError(body.error || `Download failed (${response.status})`, response.status, body.code);
}
