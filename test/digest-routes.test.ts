import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

const configBase = {
  adapter: 'shim',
  installed: '2026-10-29T14:06:00+01:00',
  beatEverySeconds: 60,
};

const tempDirs: string[] = [];

async function makeRunsDir(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'rig-digest-routes-'));
  const runsDir = join(root, 'runs');
  await mkdir(runsDir);
  tempDirs.push(root);
  return runsDir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function event(at: string, job: string, status: string, owner: string | null, error?: string) {
  return JSON.stringify({ at, job, status, owner, ...(error === undefined ? {} : { error }) });
}

describe('digest routes', () => {
  it('serves the same ordered rows and values as HTML and JSON, marking retry-heavy and ever-failed jobs', async () => {
    const runsDir = await makeRunsDir();
    await writeFile(
      join(runsDir, '2026-10-28.jsonl'),
      [
        event('2026-10-28T08:00:00+02:00', 'z-retries', 'retry', null, '<script>bad()</script>'),
        event('2026-10-28T08:01:00+02:00', 'z-retries', 'retry', null),
        event('2026-10-28T08:02:00+02:00', 'z-retries', 'retry', null),
        event('2026-10-28T08:03:00+02:00', 'z-retries', 'ok', null),
        event('2026-10-28T08:04:00+02:00', 'a-recovered', 'fail', 'owner<&', 'first failure'),
        event('2026-10-28T08:05:00+02:00', 'a-recovered', 'ok', 'owner<&'),
        '{not-json',
      ].join('\n') + '\n',
    );

    const app = createApp({ ...configBase, runsDir });
    const [htmlResponse, jsonResponse] = await Promise.all([
      app.request('/digest/2026-10-28'),
      app.request('/api/digest/2026-10-28'),
    ]);
    const html = await htmlResponse.text();
    const digest = await jsonResponse.json();

    expect(htmlResponse.status).toBe(200);
    expect(jsonResponse.status).toBe(200);
    expect(digest).toEqual({
      night: '2026-10-28',
      badLines: 1,
      counts: { ok: 2, retry: 3, fail: 1 },
      rows: [
        {
          job: 'a-recovered', owner: 'owner<&', runs: 2, retries: 0,
          lastStatus: 'ok', lastError: 'first failure',
          firstAt: '2026-10-28T08:04:00+02:00', lastAt: '2026-10-28T08:05:00+02:00',
          counts: { ok: 1, retry: 0, fail: 1 },
        },
        {
          job: 'z-retries', owner: null, runs: 4, retries: 3,
          lastStatus: 'ok', lastError: '<script>bad()</script>',
          firstAt: '2026-10-28T08:00:00+02:00', lastAt: '2026-10-28T08:03:00+02:00',
          counts: { ok: 1, retry: 3, fail: 0 },
        },
      ],
    });

    const aIndex = html.indexOf('<td>a-recovered</td>');
    const zIndex = html.indexOf('<td>z-retries</td>');
    expect(aIndex).toBeGreaterThan(-1);
    expect(zIndex).toBeGreaterThan(aIndex);
    expect(html).toContain('<td>—</td>');
    expect(html).toContain('<td>first failure</td>');
    expect(html).toContain('2026-10-28T08:04:00+02:00');
    expect(html).toContain('2026-10-28T08:05:00+02:00');
    expect(html).toContain('2026-10-28T08:00:00+02:00');
    expect(html).toContain('2026-10-28T08:03:00+02:00');
    expect(html).toContain('&lt;script&gt;bad()&lt;/script&gt;');
    expect(html).toContain('owner&lt;&amp;');
    expect(html).toContain('bad lines 1');
    expect(html).toMatch(/<tr class="warn"><td>a-recovered<\/td>/);
    expect(html).toMatch(/<tr class="warn"><td>z-retries<\/td>/);
  });

  it('returns 404 for a missing night in both representations', async () => {
    const runsDir = await makeRunsDir();
    const app = createApp({ ...configBase, runsDir });

    const [html, json] = await Promise.all([
      app.request('/digest/2026-10-28'),
      app.request('/api/digest/2026-10-28'),
    ]);

    expect(html.status).toBe(404);
    expect(json.status).toBe(404);
    expect(json.headers.get('content-type')).toContain('application/json');
    expect(await json.json()).toEqual({ error: 'Night not found' });
  });

  it('renders an existing empty night as nothing ran and returns empty JSON data', async () => {
    const runsDir = await makeRunsDir();
    await writeFile(join(runsDir, '2026-10-28.jsonl'), '');
    const app = createApp({ ...configBase, runsDir });

    const [html, json] = await Promise.all([
      app.request('/digest/2026-10-28'),
      app.request('/api/digest/2026-10-28'),
    ]);

    expect(html.status).toBe(200);
    expect(await html.text()).toContain('nothing ran');
    expect(json.status).toBe(200);
    expect(await json.json()).toEqual({
      night: '2026-10-28', rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 },
    });
  });

  it('counts malformed lines while still rendering accepted events', async () => {
    const runsDir = await makeRunsDir();
    await writeFile(
      join(runsDir, '2026-10-28.jsonl'),
      `${event('2026-10-28T08:00:00Z', 'still-ran', 'ok', 'reader')}\nthis is not JSON\n`,
    );
    const app = createApp({ ...configBase, runsDir });

    const [html, json] = await Promise.all([
      app.request('/digest/2026-10-28'),
      app.request('/api/digest/2026-10-28'),
    ]);

    expect(html.status).toBe(200);
    expect(await html.text()).toContain('still-ran');
    expect(json.status).toBe(200);
    const digest = await json.json();
    expect(digest.badLines).toBe(1);
    expect(digest.rows.map((row: { job: string }) => row.job)).toEqual(['still-ran']);
  });

  it('rejects invalid calendar dates without reading a neighboring file', async () => {
    const runsDir = await makeRunsDir();
    await writeFile(join(runsDir, '2026-10-28.jsonl'), '');
    await writeFile(
      join(runsDir, '..', 'outside.jsonl'),
      event('2026-10-28T08:00:00Z', 'outside', 'ok', 'test'),
    );
    const app = createApp({ ...configBase, runsDir });

    const [html, json, traversal] = await Promise.all([
      app.request('/digest/2026-02-30'),
      app.request('/api/digest/2026-02-30'),
      app.request('/api/digest/%2e%2e%2foutside'),
    ]);

    expect(html.status).toBe(404);
    expect(json.status).toBe(404);
    expect(traversal.status).toBe(404);
  });
});
