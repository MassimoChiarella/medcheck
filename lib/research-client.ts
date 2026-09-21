export const ACCESS_ERROR = 'MedCheck could not verify access to this private preview. Reload the page and sign in again if prompted.';
const RESPONSE_ERROR = 'MedCheck returned an unreadable response. Please try again shortly.';

// Private-site sign-in pages and gateway errors are not research JSON.
export async function readResearchResponse<T>(response: Response): Promise<T> {
  if (response.status === 401 || response.status === 403 ||
      (response.redirected && new URL(response.url).pathname.startsWith('/signin-with-chatgpt'))) {
    throw new Error(ACCESS_ERROR);
  }
  if (!/^application\/(?:[\w.+-]+\+)?json\b/i.test(response.headers.get('content-type') || '')) {
    throw new Error(RESPONSE_ERROR);
  }
  const body: unknown = await response.json().catch(() => { throw new Error(RESPONSE_ERROR); });
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error(RESPONSE_ERROR);
  if (!response.ok) throw new Error('error' in body && typeof body.error === 'string' ? body.error : 'The source is unavailable.');
  if (!('data' in body)) throw new Error(RESPONSE_ERROR);
  return body as T;
}
