import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readNight } from '../src/digest/reader.js'

const night = '2026-10-28'
const temporaryDirectories: string[] = []

async function temporaryRuns(contents = ''): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'rig-reader-'))
  temporaryDirectories.push(directory)
  await writeFile(join(directory, `${night}.jsonl`), contents)
  return directory
}

function event(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { at: '2026-10-28T23:00:00+01:00', job: 'job', status: 'ok', owner: 'rook', ...overrides }
}

const jsonLines = (events: unknown[]): string => events.map(value => JSON.stringify(value)).join('\n')

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

describe('readNight', () => {
  it('matches the independently audited real night without changing it', async () => {
    const runs = fileURLToPath(new URL('../runs/', import.meta.url))
    const path = join(runs, `${night}.jsonl`)
    const before = await readFile(path)
    const result = await readNight(runs, night)
    expect(result).toEqual({
      night, badLines: 1, counts: { ok: 10, retry: 4, fail: 1 },
      rows: [
        {
          job: 'digest/render', owner: null, runs: 1, retries: 0, lastStatus: 'ok', lastError: null,
          firstAt: '2026-10-29T05:41:09+01:00', lastAt: '2026-10-29T05:41:09+01:00',
          counts: { ok: 1, retry: 0, fail: 0 },
        },
        {
          job: 'fixtures/refresh', owner: 'rook', runs: 4, retries: 3, lastStatus: 'ok', lastError: 'upstream 503',
          firstAt: '2026-10-29T01:30:00+01:00', lastAt: '2026-10-29T01:37:00+01:00',
          counts: { ok: 1, retry: 3, fail: 0 },
        },
        {
          job: 'lane/sync', owner: 'rook', runs: 8, retries: 1, lastStatus: 'ok', lastError: 'lock held',
          firstAt: '2026-10-28T23:00:06+01:00', lastAt: '2026-10-29T05:00:04+01:00',
          counts: { ok: 7, retry: 1, fail: 0 },
        },
        {
          job: 'notes/backup', owner: 'lane-07', runs: 1, retries: 0, lastStatus: 'fail', lastError: 'quota exceeded',
          firstAt: '2026-10-29T04:00:01+01:00', lastAt: '2026-10-29T04:00:01+01:00',
          counts: { ok: 0, retry: 0, fail: 1 },
        },
        {
          job: 'rig/rotate-logs', owner: 'lane-07', runs: 1, retries: 0, lastStatus: 'ok', lastError: null,
          firstAt: '2026-10-28T23:00:02+01:00', lastAt: '2026-10-28T23:00:02+01:00',
          counts: { ok: 1, retry: 0, fail: 0 },
        },
      ],
    })
    expect(await readFile(path)).toEqual(before)
  })

  it('distinguishes a missing file from empty or whitespace-only nights', async () => {
    const runs = await temporaryRuns()
    expect(await readNight(runs, '2026-10-29')).toBeNull()
    const empty = { night, rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 } }
    expect(await readNight(runs, night)).toEqual(empty)
    await writeFile(join(runs, `${night}.jsonl`), '\n \r\n\t\n')
    expect(await readNight(runs, night)).toEqual(empty)
  })

  it('rejects invalid identifiers before trying to read and accepts real leap dates', async () => {
    const runs = await temporaryRuns()
    const invalid = ['../2026-10-28', '/2026-10-28', '2026-10-28.jsonl', '2026-1-01', '2026-02-29',
      '1900-02-29', '2026-04-31', '2026-00-01', '2026-13-01', '2026-10-00', '2026-10-28\n', '2026-10-28\0']
    for (const identifier of invalid) {
      // runsDir is deliberately a regular file: any attempted lookup would reject.
      expect(await readNight(join(runs, `${night}.jsonl`), identifier)).toBeNull()
    }
    await writeFile(join(runs, '2000-02-29.jsonl'), '')
    expect((await readNight(runs, '2000-02-29'))?.rows).toEqual([])
  })

  it('counts malformed JSON and invalid events once each, ignoring blank lines', async () => {
    const invalid = [null, [], 42, {}, event({ at: 123 }), event({ job: null }), event({ status: 'pending' }),
      event({ owner: undefined }), event({ owner: 1 }), event({ error: null }), event({ error: 2 }),
      ...['2026-02-30T12:00:00Z', '2026-02-29T12:00:00Z', '2026-10-28', '2026-10-28T12:00:00',
        '2026-10-28T24:00:00Z', '2026-10-28T12:60:00Z', '2026-10-28T12:00:60Z',
        '2026-10-28T12:00:00+24:00', '2026-10-28T12:00:00+01:60'].map(at => event({ at }))]
    const runs = await temporaryRuns(` \r\n{broken\n${jsonLines(invalid)}\n\t\n${jsonLines([event({ owner: null })])}\n`)
    const result = await readNight(runs, night)
    expect(result?.badLines).toBe(invalid.length + 1)
    expect(result?.counts).toEqual({ ok: 1, retry: 0, fail: 0 })
    expect(result?.rows).toHaveLength(1)
    expect(result?.rows[0].owner).toBeNull()
  })

  it('uses instants and source-line ties for final owner/status and the latest supplied error', async () => {
    const runs = await temporaryRuns(jsonLines([
      event({ at: '2026-10-29T01:00:00+02:00', status: 'retry', error: 'latest error', owner: 'later' }),
      event({ at: '2026-10-29T00:30:00+02:00', status: 'fail', error: 'old error' }),
      event({ at: '2026-10-28T23:00:00Z', owner: null }),
      event({ at: '2026-10-28T22:00:00Z', status: 'retry', error: 'earliest error' }),
    ]))
    expect((await readNight(runs, night))?.rows).toEqual([{
      job: 'job', owner: null, runs: 4, retries: 2, lastStatus: 'ok', lastError: 'latest error',
      firstAt: '2026-10-28T22:00:00Z', lastAt: '2026-10-28T23:00:00Z',
      counts: { ok: 1, retry: 2, fail: 1 },
    }])
  })

  it('preserves submillisecond order, equivalent fraction ties, and an explicitly empty error', async () => {
    const runs = await temporaryRuns(jsonLines([
      event({ at: '2026-10-28T12:00:00.0002Z', error: '', owner: 'second' }),
      event({ at: '2026-10-28T12:00:00.0001Z', error: 'earlier', owner: 'first' }),
      event({ at: '2026-10-28T12:00:00.000200Z', owner: 'tie winner' }),
    ]))
    expect((await readNight(runs, night))?.rows[0]).toMatchObject({
      firstAt: '2026-10-28T12:00:00.0001Z', lastAt: '2026-10-28T12:00:00.000200Z',
      owner: 'tie winner', lastError: '',
    })
  })

  it('sorts jobs without locale dependence and safely groups object-property names', async () => {
    const runs = await temporaryRuns(jsonLines(['z', '__proto__', 'a', 'Z', 'constructor', ''].map(job => event({ job }))))
    expect((await readNight(runs, night))?.rows.map(row => row.job)).toEqual(['', 'Z', '__proto__', 'a', 'constructor', 'z'])
  })

  it('rejects filesystem errors other than missing files', async () => {
    const runs = await temporaryRuns()
    await mkdir(join(runs, '2026-10-29.jsonl'))
    await expect(readNight(runs, '2026-10-29')).rejects.toMatchObject({ code: 'EISDIR' })
    await expect(readNight(join(runs, `${night}.jsonl`), night)).rejects.toMatchObject({ code: 'ENOTDIR' })
  })

  it('does not follow a night symlink outside the configured runs directory', async () => {
    const runs = await temporaryRuns()
    const outside = await temporaryRuns(jsonLines([event()]))
    await symlink(join(outside, `${night}.jsonl`), join(runs, '2026-10-29.jsonl'))
    await expect(readNight(runs, '2026-10-29')).rejects.toThrow('outside runsDir')
  })
})
