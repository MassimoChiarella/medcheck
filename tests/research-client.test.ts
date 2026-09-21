import test from 'node:test';
import assert from 'node:assert/strict';
import { ACCESS_ERROR, readResearchResponse } from '../lib/research-client.ts';

void test('research requests distinguish access failures, gateway responses and source errors', async () => {
  const data = { data: [], notes: [], completeness: 'complete' };
  assert.deepEqual(await readResearchResponse(Response.json(data)), data);
  for (const status of [401, 403]) {
    await assert.rejects(readResearchResponse(new Response('error code: 1010', { status })), { message: ACCESS_ERROR });
  }
  const signIn = new Response('<html>Sign in required</html>', { headers: { 'Content-Type': 'text/html' } });
  Object.defineProperties(signIn, { redirected: { value: true }, url: { value: 'https://example.test/signin-with-chatgpt' } });
  await assert.rejects(readResearchResponse(signIn), { message: ACCESS_ERROR });
  for (const response of [
    new Response('<html>Gateway unavailable</html>', { status: 502 }),
    new Response('incomplete', { headers: { 'Content-Type': 'application/json' } }),
    Response.json(null), Response.json({}),
  ]) await assert.rejects(readResearchResponse(response), /unreadable response/);
  await assert.rejects(readResearchResponse(Response.json({ error: 'Enter between 3 and 100 characters.' }, { status: 400 })), /Enter between/);
  await assert.rejects(readResearchResponse(Response.json({ error: 'Source temporarily unavailable.' }, { status: 503 })), /Source temporarily unavailable/);
});
