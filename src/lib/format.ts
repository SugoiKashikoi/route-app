export function formatDuration(sec: number): string {
  const totalMin = Math.round(sec / 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m}分`;
  return m === 0 ? `${h}時間` : `${h}時間${m}分`;
}

/** "9:05"。基準日と日付が違えば "翌 9:05" / "10/30 9:05" */
export function formatClock(d: Date, base?: Date): string {
  const hm = `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
  if (!base || d.toDateString() === base.toDateString()) return hm;
  const next = new Date(base);
  next.setDate(next.getDate() + 1);
  return d.toDateString() === next.toDateString() ? `翌 ${hm}` : `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
}

/** <input type="datetime-local"> 用の "YYYY-MM-DDTHH:mm"(ローカル時刻) */
export function toLocalInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function formatDistance(m: number): string {
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
}
