import { afterEach, expect, test, vi } from 'vitest';
import { discoverEmailsFromUrls, mergeEmails } from './email';

afterEach(() => vi.unstubAllGlobals());

test('continues to the contact page when homepage only contains telemetry', async () => {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(new Response('<script>const dsn="https://abc@sentry.io/42"</script><a href="/contact">Contact</a>'))
    .mockResolvedValueOnce(new Response('<p>booking@artist.com</p>'));
  vi.stubGlobal('fetch', fetchMock);
  expect(await discoverEmailsFromUrls(['https://artist.com'])).toEqual(['booking@artist.com']);
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

test('ingestion merges only usable emails including supplied and existing values', () => {
  expect(mergeEmails(['abc@sentry.io', 'BOOKING@artist.com'], ['user@domain.com', 'booking@artist.com'])).toEqual(['booking@artist.com']);
});
