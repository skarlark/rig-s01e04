import { compareDigestRows, type DigestNight, type DigestRow } from '../digest/types.js';

function attention(row: DigestRow): boolean {
  return row.retries >= 3 || row.counts.fail > 0;
}

function display(value: string | null): string {
  return value ?? '—';
}

export function DigestView({ digest }: { digest: DigestNight }) {
  const rows = [...digest.rows].sort(compareDigestRows);

  return (
    <>
      <h1>digest · {digest.night}</h1>
      <p>
        runs {digest.counts.ok + digest.counts.retry + digest.counts.fail}
        {' · '}ok {digest.counts.ok}
        {' · '}retry {digest.counts.retry}
        {' · '}fail {digest.counts.fail}
        {' · '}bad lines {digest.badLines}
      </p>
      {rows.length === 0 ? (
        <p class="mute">nothing ran</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>job</th>
              <th>owner</th>
              <th>runs</th>
              <th>retries</th>
              <th>last status</th>
              <th>last error</th>
              <th>first time</th>
              <th>last time</th>
              <th>ok</th>
              <th>retry</th>
              <th>fail</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const marked = attention(row);
              return (
                <tr class={marked ? 'warn' : undefined}>
                  <td>{row.job}</td>
                  <td>{display(row.owner)}</td>
                  <td>{row.runs}</td>
                  <td>{row.retries}</td>
                  <td>{row.lastStatus}</td>
                  <td>{display(row.lastError)}</td>
                  <td>{row.firstAt}</td>
                  <td>{row.lastAt}</td>
                  <td>{row.counts.ok}</td>
                  <td>{row.counts.retry}</td>
                  <td>{row.counts.fail}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </>
  );
}
