import { readFile, realpath } from 'node:fs/promises'
import { isAbsolute, join, relative, sep } from 'node:path'
import { compareDigestRows, type DigestCounts, type DigestRow, type DigestStatus, type ReadNight } from './types.js'

interface Event {
  at: string
  job: string
  status: DigestStatus
  owner: string | null
  error?: string
  second: number
  fraction: string
  line: number
}

function isCalendarDate(value: string): boolean {
  if (value.length !== 10 || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  return month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1]
}

function parseEvent(value: unknown, line: number): Event | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const input = value as Record<string, unknown>
  if (typeof input.at !== 'string' || typeof input.job !== 'string') return null
  if (input.status !== 'ok' && input.status !== 'retry' && input.status !== 'fail') return null
  if (input.owner !== null && typeof input.owner !== 'string') return null
  if ('error' in input && typeof input.error !== 'string') return null

  const time = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/.exec(input.at)
  if (!time || time[0] !== input.at || !isCalendarDate(time[1])) return null
  const [, date, hour, minute, second, fraction = '', offset] = time
  if (Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) return null
  if (offset !== 'Z' && (Number(offset.slice(1, 3)) > 23 || Number(offset.slice(4)) > 59)) return null
  const instant = Date.parse(`${date}T${hour}:${minute}:${second}${offset}`)
  if (!Number.isFinite(instant)) return null
  return {
    at: input.at, job: input.job, status: input.status, owner: input.owner,
    error: input.error as string | undefined, second: instant, fraction, line,
  }
}

function compareEvents(a: Event, b: Event): number {
  if (a.second !== b.second) return a.second - b.second
  // Compare all supplied fractional digits, without Date's millisecond truncation.
  const length = Math.max(a.fraction.length, b.fraction.length)
  const left = a.fraction.padEnd(length, '0')
  const right = b.fraction.padEnd(length, '0')
  return left < right ? -1 : left > right ? 1 : a.line - b.line
}

const emptyCounts = (): DigestCounts => ({ ok: 0, retry: 0, fail: 0 })

export const readNight: ReadNight = async (runsDir, night) => {
  if (!isCalendarDate(night)) return null

  let contents: string
  try {
    const root = await realpath(runsDir)
    const file = await realpath(join(root, `${night}.jsonl`))
    const inside = relative(root, file)
    if (inside === '..' || inside.startsWith(`..${sep}`) || isAbsolute(inside)) {
      throw new Error('Run log resolves outside runsDir')
    }
    contents = await readFile(file, 'utf8')
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null
    throw error
  }

  let badLines = 0
  const events: Event[] = []
  for (const [line, text] of contents.split(/\r?\n/).entries()) {
    if (!text.trim()) continue
    let value: unknown
    try {
      value = JSON.parse(text)
    } catch {
      badLines++
      continue
    }
    const event = parseEvent(value, line)
    if (event) events.push(event)
    else badLines++
  }

  const jobs = new Map<string, DigestRow>()
  const counts = emptyCounts()
  for (const event of events.sort(compareEvents)) {
    let row = jobs.get(event.job)
    if (!row) {
      row = {
        job: event.job, owner: event.owner, runs: 0, retries: 0,
        lastStatus: event.status, lastError: null, firstAt: event.at, lastAt: event.at,
        counts: emptyCounts(),
      }
      jobs.set(event.job, row)
    }
    row.runs++
    if (event.status === 'retry') row.retries++
    row.counts[event.status]++
    counts[event.status]++
    row.owner = event.owner
    row.lastStatus = event.status
    row.lastAt = event.at
    if (event.error !== undefined) row.lastError = event.error
  }
  return { night, rows: [...jobs.values()].sort(compareDigestRows), badLines, counts }
}
