import { mkdir, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { serve } from '@hono/node-server';
import { createApp } from '../src/app.js';

const night = '2026-10-28';

function outputDirectory(args: string[]): string {
  const index = args.indexOf('--out-dir');
  const directory = index >= 0 ? args[index + 1] : undefined;
  if (!directory || directory.startsWith('--')) {
    throw new Error('Usage: pnpm preview:export -- --out-dir <directory>');
  }
  return resolve(directory);
}

async function main() {
  const outputDir = outputDirectory(process.argv.slice(2));
  const server = serve({ fetch: createApp().fetch, hostname: '127.0.0.1', port: 0 });

  try {
    if (!server.listening) await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Could not determine the ephemeral preview server port');
    }

    const response = await fetch(`http://127.0.0.1:${address.port}/digest/${night}`);
    const contentType = response.headers.get('content-type') ?? '';
    const html = await response.text();

    if (response.status !== 200) {
      throw new Error(`Digest export returned HTTP ${response.status}`);
    }
    if (!contentType.includes('text/html') || !/^\s*<!doctype html>/i.test(html)) {
      throw new Error('Digest export did not return a complete HTML document');
    }

    await mkdir(outputDir, { recursive: true });
    await writeFile(resolve(outputDir, 'index.html'), html, 'utf8');
  } finally {
    if (server.listening) {
      server.close();
      await once(server, 'close');
    }
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown preview export error';
  console.error(message);
  process.exitCode = 1;
});
