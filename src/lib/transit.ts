import type { LegResult, Stop } from "../types";

/**
 * 公共交通の経路検索(Transit API: https://api.transit.ls8h.com/ 非公式・無料・認証不要・CORS開放)。
 * 各事業者の公開データ(GTFS・ODPT等)に基づく時刻表検索。実際の運行と異なる場合がある。
 * 地点は Transit API 自身の地点検索で解決し、Google 由来の座標は渡さない(現在地の座標は端末のもの)。
 */
const BASE = "https://api.transit.ls8h.com";
// 東京など路線の多い地域は検索に20秒以上かかることがある(実機テストで東京駅→渋谷駅が20秒で打ち切り)
const TIMEOUT_MS = 45_000;

export const TRANSIT_ATTRIBUTION = "公共交通は Transit API(各事業者の公開データ)を利用しています。実際の運行と異なる場合があります。";

interface Ref {
  id?: string;
  name: string;
}
interface ApiLeg {
  kind: "walk" | "transit";
  routeName?: string;
  mode?: string;
  headsign?: string;
  from: Ref;
  to: Ref;
  departureSecs: number;
  arrivalSecs: number;
  distanceMeters?: number;
}
interface Journey {
  departureSecs: number;
  arrivalSecs: number;
  durationSecs: number;
  transferCount: number;
  fare?: { currency: string; ticket: number; ic?: number };
  /** 乗車区間の前後の徒歩(秒)。departureSecs〜arrivalSecs には含まれない(実応答で確認) */
  accessWalkSecs?: number;
  egressWalkSecs?: number;
  legs: ApiLeg[];
}
interface PlanResponse {
  date: string;
  journeys: Journey[];
}

/** 公共交通区間の詳細(LegResult.transit) */
export interface TransitDetails {
  provider: "transitApi";
  /** 実際の発車・到着(ms) */
  departAt: number;
  arriveAt: number;
  /** 出発可能時刻から発車までの待ち(秒) */
  waitSec: number;
  transferCount: number;
  fareYen?: number;
  fareIcYen?: number;
  segments: { kind: "walk" | "transit"; name: string; from: string; to: string; departAt: number; arriveAt: number }[];
}

async function getJSON<T>(path: string, params: Record<string, string | undefined>): Promise<T> {
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(params)) if (v !== undefined) url.searchParams.set(k, v);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    if (!r.ok) throw new Error(`Transit API HTTP ${r.status}`);
    return (await r.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

/** 地点名から検索候補を作る: 全文 → 最後の語(例: "岡山県…1-1 岡山駅" → "岡山駅") */
export function placeQueries(text: string): string[] {
  const t = text.replace(/^日本、\s*/, "").replace(/〒\d{3}-?\d{4}\s*/, "").trim();
  const last = t.split(/\s+/).at(-1) ?? t;
  return [...new Set([t, last])].filter((q) => q.length >= 2);
}

const endpointCache = new Map<string, string | null>();

/** 地点を Transit API の endpoint("geo:緯度,経度" や駅ID)に変換。見つからなければ null */
export async function resolveEndpoint(s: Stop): Promise<string | null> {
  if (s.latLng) return `geo:${s.latLng.lat},${s.latLng.lng}`;
  const key = s.text.trim();
  if (endpointCache.has(key)) return endpointCache.get(key)!;
  let found: string | null = null;
  for (const q of placeQueries(key)) {
    const res = await getJSON<{ places?: { endpoint: string }[] }>("/api/v1/places/suggest", { q, limit: "1" });
    found = res.places?.[0]?.endpoint ?? null;
    if (found) break;
  }
  endpointCache.set(key, found);
  return found;
}

/**
 * 日付・時刻は端末の時間帯ではなく日本時間(Asia/Tokyo、UTC+9・夏時間なし)で扱う。
 * API の秒数は応答の日付(日本時間)の0時からの秒。
 */
const JST = 9 * 3600_000;
const p2 = (n: number) => String(n).padStart(2, "0");
const jst = (d: Date) => new Date(d.getTime() + JST); // UTC の各値が日本時間の値になる
const ymd = (d: Date) => { const j = jst(d); return `${j.getUTCFullYear()}${p2(j.getUTCMonth() + 1)}${p2(j.getUTCDate())}`; };
/** 検索時刻は分単位に切り捨てて渡し(候補を取りこぼさない)、乗れるかは秒単位で判定する */
const hm = (d: Date) => { const j = jst(d); return `${p2(j.getUTCHours())}:${p2(j.getUTCMinutes())}`; };
/** "YYYYMMDD"(日本時間)の0時 */
const midnight = (s: string) => Date.UTC(Number(s.slice(0, 4)), Number(s.slice(4, 6)) - 1, Number(s.slice(6, 8))) - JST;

/**
 * 新幹線の判定。実応答では路線名が「のぞみ のぞみ102号」のように列車名だけのことがあるため、列車名でも判定する
 */
const SHINKANSEN = /新幹線|^(のぞみ|ひかり|こだま|さくら|みずほ|つばめ|はやぶさ|はやて|やまびこ|なすの|つばさ|こまち|とき|たにがわ|かがやき|はくたか|あさま|つるぎ|かもめ)(\s|\d|号|$)/;
export const isShinkansen = (routeName: string | undefined) => SHINKANSEN.test((routeName ?? "").trim());
const usesShinkansen = (j: Journey) => j.legs.some((l) => l.kind === "transit" && isShinkansen(l.routeName));

/**
 * API の結果を区間結果に変換。候補のうち最も早く着くものを選ぶ(新幹線を使わない設定なら新幹線を含む候補を除く)。
 * 所要は「出発可能時刻→到着」で、発車待ちを含む(時刻計算で二重に数えない)
 */
export function journeyToLeg(plan: PlanResponse, ready: Date, shinkansen = false): LegResult {
  const base = midnight(plan.date);
  const at = (secs: number) => base + secs * 1000; // 24時以降の秒数は翌日になる
  const all = plan.journeys ?? [];
  // 出発可能時刻より前に歩き出す必要がある候補(=乗れない便)は除く
  const reachable = all.filter((x) => at(x.departureSecs - (x.accessWalkSecs ?? 0)) >= ready.getTime());
  const usable = shinkansen ? reachable : reachable.filter((x) => !usesShinkansen(x));
  const doorArrive = (x: Journey) => x.arrivalSecs + (x.egressWalkSecs ?? 0);
  const j = usable.reduce<Journey | undefined>((best, x) => (!best || doorArrive(x) < doorArrive(best) ? x : best), undefined);
  if (!j)
    return {
      ok: false,
      mode: "TRANSIT",
      error: !all.length
        ? "公共交通の経路が見つかりませんでした"
        : !reachable.length
          ? "出発できる時刻より後に乗れる便が見つかりませんでした"
          : "新幹線を使わない経路が見つかりませんでした(「🚄 新幹線も使う」をオンにすると候補に入ります)",
    };
  // 出発地を出る時刻〜目的地に着く時刻(駅までの徒歩・駅からの徒歩を含める)
  const access = j.accessWalkSecs ?? 0;
  const egress = j.egressWalkSecs ?? 0;
  const departAt = at(j.departureSecs - access);
  const arriveAt = at(j.arrivalSecs + egress);
  const walk = (name: string, from: string, to: string, a: number, b: number) =>
    ({ kind: "walk" as const, name, from, to, departAt: at(a), arriveAt: at(b) });
  const transit: TransitDetails = {
    provider: "transitApi",
    departAt,
    arriveAt,
    waitSec: Math.max(0, Math.round((departAt - ready.getTime()) / 1000)),
    transferCount: j.transferCount,
    fareYen: j.fare?.currency === "JPY" ? j.fare.ticket : undefined,
    fareIcYen: j.fare?.currency === "JPY" ? j.fare.ic : undefined,
    segments: [
      ...(access > 0 ? [walk("徒歩", "出発地", j.legs[0]?.from.name ?? "駅", j.departureSecs - access, j.departureSecs)] : []),
      ...j.legs.map((l) => ({
        kind: l.kind,
        name: l.kind === "walk" ? "徒歩" : [l.routeName, l.headsign && `${l.headsign}行`].filter(Boolean).join(" "),
        from: l.from.name,
        to: l.to.name,
        departAt: at(l.departureSecs),
        arriveAt: at(l.arrivalSecs),
      })),
      ...(egress > 0 ? [walk("徒歩", j.legs.at(-1)?.to.name ?? "駅", "目的地", j.arrivalSecs, j.arrivalSecs + egress)] : []),
    ],
  };
  const distance = j.legs.reduce((a, l) => a + (l.distanceMeters ?? 0), 0);
  return {
    ok: true,
    mode: "TRANSIT",
    distanceMeters: distance,
    durationSec: Math.round((arriveAt - ready.getTime()) / 1000),
    path: [],
    transit,
  };
}

/** 出発可能時刻以降に乗れる経路を検索する */
export async function searchTransit(from: Stop, to: Stop, ready: Date): Promise<LegResult> {
  try {
    const [a, b] = await Promise.all([resolveEndpoint(from), resolveEndpoint(to)]);
    if (!a || !b) return { ok: false, mode: "TRANSIT", error: `公共交通の検索で地点「${!a ? from.text : to.text}」が見つかりませんでした` };
    const plan = await getJSON<PlanResponse>("/api/v1/plan", {
      from: a,
      to: b,
      date: ymd(ready),
      time: hm(ready),
      type: "departure",
      // 新幹線あり/なしの両方から選べるよう、候補を多めに取る(上限6)
      numItineraries: "6",
    });
    return journeyToLeg(plan, ready, !!from.shinkansen);
  } catch (e) {
    return { ok: false, mode: "TRANSIT", error: `公共交通を自動検索できませんでした(${e instanceof Error ? e.message : String(e)})` };
  }
}
