/**
 * 無料枠を超えないための月ごとの回数制限(このブラウザでの利用分だけを数える)。
 * Google の無料枠は料金区分(SKU)ごとに毎月リセット。余裕を見て約8割で止める。
 * 別の端末・別のブラウザの利用分は合算できないので、確実に止めるには Google Cloud の割り当て(Quota)も設定する。
 */
export const SKU = {
  routesEss: { label: "経路(徒歩・自転車・公共交通)", free: 10_000, cap: 8_000 },
  routesPro: { label: "経路(車・渋滞考慮/訪問順の最適化)", free: 5_000, cap: 4_000 },
  routesEnt: { label: "経路(車・高速代つき)", free: 1_000, cap: 800 },
  autocomplete: { label: "地点の候補表示", free: 10_000, cap: 8_000 },
  maps: { label: "地図の表示", free: 10_000, cap: 8_000 },
  hours: { label: "営業時間", free: 1_000, cap: 800 },
} as const;
export type Sku = keyof typeof SKU;

const KEY = "multimodal-route:usage";
const month = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

type Usage = { m: string; n: Partial<Record<Sku, number>> };

export function loadUsage(): Usage {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (v?.m === month()) return v;
  } catch {
    /* 読めなければ今月0回から */
  }
  return { m: month(), n: {} };
}

/** 1回使う。上限に達していれば false(リクエストを送らない) */
export function take(sku: Sku): boolean {
  const u = loadUsage();
  const n = u.n[sku] ?? 0;
  if (n >= SKU[sku].cap) return false;
  u.n[sku] = n + 1;
  try {
    localStorage.setItem(KEY, JSON.stringify(u));
  } catch {
    /* 保存できなくても今回は送る */
  }
  return true;
}

export const capMessage = (sku: Sku) =>
  `今月の無料枠の安全ライン(${SKU[sku].label}: ${SKU[sku].cap.toLocaleString()}回)に達したため、課金を避けて停止しました。来月1日に戻ります。`;
