import { toLocalInput } from "./lib/format";

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const MINUTES = Array.from({ length: 12 }, (_, i) => i * 5);
const p2 = (n: number) => String(n).padStart(2, "0");

/** "HH:MM" の時・分をプルダウンで選ぶ(ブラウザ標準の時刻欄は59→00で一周して使いにくいため)。空は未指定 */
export function TimeField({ value, onChange, optional }: { value: string; onChange: (v: string) => void; optional?: boolean }) {
  const m = value.match(/^(\d{1,2}):(\d{2})$/);
  const h = m ? Number(m[1]) : -1;
  // 5分刻みにない値(手入力の名残など)も表示できるよう、近い5分に寄せる
  const mi = m ? Math.min(55, Math.round(Number(m[2]) / 5) * 5) : -1;
  const set = (nh: number, nm: number) => onChange(nh < 0 ? "" : `${p2(nh)}:${p2(nm < 0 ? 0 : nm)}`);
  return (
    <span className="tf">
      <select value={h} onChange={(e) => set(Number(e.target.value), mi)}>
        {optional && <option value={-1}>--</option>}
        {HOURS.map((x) => (
          <option key={x} value={x}>{x}</option>
        ))}
      </select>
      :
      <select value={mi} disabled={h < 0} onChange={(e) => set(h, Number(e.target.value))}>
        {optional && h < 0 && <option value={-1}>--</option>}
        {MINUTES.map((x) => (
          <option key={x} value={x}>{p2(x)}</option>
        ))}
      </select>
    </span>
  );
}

/** "YYYY-MM-DDTHH:mm" を 日付(今日/明日/明後日/カレンダー) + 時刻 で選ぶ */
export function DateTimeField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [date, time = "09:00"] = value.split("T");
  const day = (n: number) => {
    const d = new Date();
    d.setDate(d.getDate() + n);
    return toLocalInput(d).slice(0, 10);
  };
  const quick: [string, string][] = [
    ["今日", day(0)],
    ["明日", day(1)],
    ["明後日", day(2)],
  ];
  const shift = (min: number) => {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return;
    d.setMinutes(d.getMinutes() + min);
    onChange(toLocalInput(d));
  };
  return (
    <div className="dtf">
      <div className="dtf-row">
        {quick.map(([t, v]) => (
          <button key={t} className={date === v ? "on" : ""} onClick={() => onChange(`${v}T${time}`)}>
            {t}
          </button>
        ))}
        <input type="date" value={date} onChange={(e) => e.target.value && onChange(`${e.target.value}T${time}`)} />
      </div>
      <div className="dtf-row">
        <TimeField value={time} onChange={(t) => onChange(`${date}T${t}`)} />
        <button onClick={() => shift(-15)}>−15分</button>
        <button onClick={() => shift(15)}>＋15分</button>
      </div>
    </div>
  );
}
