/** Places API (New) の regularOpeningHours.periods。day は 0=日曜 */
export interface Period {
  open: { day: number; hour: number; minute: number };
  close?: { day: number; hour: number; minute: number };
}

const WEEK = 7 * 24 * 60;
/** 週の始め(日曜0:00)からの分 */
const weekMin = (p: { day: number; hour: number; minute: number }) => p.day * 1440 + p.hour * 60 + p.minute;
const dateWeekMin = (d: Date) => d.getDay() * 1440 + d.getHours() * 60 + d.getMinutes();

/** その時刻に営業中か。close がない期間は24時間営業 */
export function isOpenAt(periods: Period[], d: Date): boolean {
  const t = dateWeekMin(d);
  return periods.some((p) => {
    if (!p.close) return true;
    const o = weekMin(p.open);
    let c = weekMin(p.close);
    if (c <= o) c += WEEK; // 週またぎ(土曜夜→日曜朝)
    return (t >= o && t < c) || (t + WEEK >= o && t + WEEK < c);
  });
}

/** 滞在中(着〜出)の営業時間の問題。端末の時間帯で判定する */
export function hoursWarning(periods: Period[] | undefined, arrive?: Date, depart?: Date): string | undefined {
  if (!periods?.length || !arrive) return undefined;
  if (!isOpenAt(periods, arrive)) return "到着時は営業時間外です";
  // 出発の1分前まで開いているか(出発時刻ちょうどに閉店は問題なし)
  if (depart && depart > arrive && !isOpenAt(periods, new Date(depart.getTime() - 60_000))) return "滞在中に閉店します";
  return undefined;
}

const CACHE_KEY = "multimodal-route:hours";
const CACHE_MS = 7 * 24 * 3600_000;

/**
 * 地点の営業時間を取得(Place Details Enterprise の料金)。
 * 同じ地点は1週間ブラウザに覚えておき、問い合わせを減らす。営業時間の情報がない地点は null。
 */
export async function fetchHours(apiKey: string, placeId: string): Promise<Period[] | null> {
  let cache: Record<string, { at: number; p: Period[] | null }> = {};
  try {
    cache = JSON.parse(localStorage.getItem(CACHE_KEY) ?? "{}");
  } catch {
    /* キャッシュなしで続ける */
  }
  const hit = cache[placeId];
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.p;
  const r = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`, {
    headers: { "X-Goog-Api-Key": apiKey, "X-Goog-FieldMask": "regularOpeningHours" },
  });
  if (!r.ok) throw new Error(`営業時間を取得できませんでした (HTTP ${r.status})`);
  const data = await r.json();
  const p: Period[] | null = data.regularOpeningHours?.periods ?? null;
  cache[placeId] = { at: Date.now(), p };
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    /* 保存できなくても動作に影響なし */
  }
  return p;
}
