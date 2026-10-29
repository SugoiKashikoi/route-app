/** カレンダー(.ics)の予定。ファイルはブラウザの中で読むだけで、どこにも送らない */
export interface CalEvent {
  summary: string;
  location: string;
  start: Date;
  end?: Date;
}

const unescape = (v: string) => v.replace(/\\n/gi, " ").replace(/\\([,;\\])/g, "$1").trim();

/** "20261102T100000Z" / "20261102T100000"(TZID付きは端末の時間帯とみなす)。日付だけ(終日)は undefined */
export function parseIcsDate(v: string): Date | undefined {
  const m = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/);
  if (!m) return undefined;
  const [, y, mo, d, h, mi, s, z] = m;
  const args = [Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s ?? 0)] as const;
  return z ? new Date(Date.UTC(...args)) : new Date(...args);
}

/** 場所と時刻のある予定だけを開始順に返す(終日・場所なしは除く) */
export function parseIcs(text: string): CalEvent[] {
  // 折り返し行(改行+空白)をつなぐ
  const lines = text.replace(/\r?\n[ \t]/g, "").split(/\r?\n/);
  const out: CalEvent[] = [];
  let cur: Record<string, string> | null = null;
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") cur = {};
    else if (line === "END:VEVENT") {
      const start = cur?.DTSTART ? parseIcsDate(cur.DTSTART) : undefined;
      if (cur && start && cur.LOCATION) {
        out.push({
          summary: unescape(cur.SUMMARY ?? ""),
          location: unescape(cur.LOCATION),
          start,
          end: cur.DTEND ? parseIcsDate(cur.DTEND) : undefined,
        });
      }
      cur = null;
    } else if (cur) {
      const i = line.indexOf(":");
      if (i < 0) continue;
      const name = line.slice(0, i).split(";")[0].toUpperCase();
      if (!(name in cur)) cur[name] = line.slice(i + 1);
    }
  }
  return out.sort((a, b) => a.start.getTime() - b.start.getTime());
}

/** 予定がある日付("YYYY-MM-DD")の一覧 */
export function eventDays(events: CalEvent[]): string[] {
  return [...new Set(events.map((e) => dayKey(e.start)))];
}

export function dayKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
