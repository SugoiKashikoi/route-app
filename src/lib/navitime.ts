/**
 * NAVITIME Route(totalnavi) / RapidAPI の接続テスト。
 * RapidAPI版の電車は実際の時刻表ではなく NAVITIME 独自の推定所要時間、バスは対象外(公式掲載情報)。
 * 本格的に組み込む前に、ブラウザから直接呼べるか(CORS)と返り値の形を利用者の端末で確かめるためのもの。
 */
const HOST = "navitime-route-totalnavi.p.rapidapi.com";
const KEY = "multimodal-route:navitime-key";

export function loadNavitimeKey(): string {
  try {
    return localStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}

export function saveNavitimeKey(v: string) {
  try {
    localStorage.setItem(KEY, v.trim());
  } catch {
    /* 保存できなくても今回の画面では使える */
  }
}

/** 岡山駅→倉敷駅(座標指定)で1回だけ検索し、結果の要点か失敗理由を返す */
export async function testNavitime(key: string): Promise<string> {
  if (!key) return "NAVITIMEのキーが未設定です";
  const p2 = (n: number) => String(n).padStart(2, "0");
  const d = new Date(Date.now() + 3600_000);
  const start_time = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:00:00`;
  const q = new URLSearchParams({ start: "34.6661,133.9177", goal: "34.6013,133.7660", start_time });
  const t0 = performance.now();
  let r: Response;
  try {
    r = await fetch(`https://${HOST}/route_transit?${q}`, { headers: { "X-RapidAPI-Key": key, "X-RapidAPI-Host": HOST } });
  } catch (e) {
    return `通信できませんでした(ブラウザから直接呼べない=CORSの可能性): ${String(e)}`;
  }
  const ms = Math.round(performance.now() - t0);
  const text = await r.text();
  if (!r.ok) return `HTTP ${r.status}(${ms}ms): ${text.slice(0, 300)}`;
  try {
    const move = JSON.parse(text)?.items?.[0]?.summary?.move;
    return `成功(${ms}ms) 岡山駅→倉敷駅: ${JSON.stringify(move ?? "items[0].summary.move なし").slice(0, 500)}`;
  } catch {
    return `成功(${ms}ms)だがJSONではありません: ${text.slice(0, 300)}`;
  }
}
