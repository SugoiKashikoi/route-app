import type { LegResult, LatLng, Mode, Stop } from "../types";
import { decodePolyline } from "./polyline";
import { nextDepart, type StopRule } from "./schedule";
import { capMessage, take, type Sku } from "./quota";

interface LatLngObj {
  latitude: number;
  longitude: number;
}

interface RoutesResponse {
  routes?: {
    duration: string;
    distanceMeters?: number;
    polyline: { encodedPolyline: string };
    legs: { startLocation: { latLng: LatLngObj }; endLocation: { latLng: LatLngObj } }[];
    travelAdvisory?: { tollInfo?: { estimatedPrice?: { currencyCode: string; units?: string; nanos?: number }[] } };
  }[];
  error?: { message?: string; status?: string };
}

interface PlaceRef {
  placeId?: string;
  address?: string;
  latLng?: LatLng;
}

const ll = (p: LatLngObj): LatLng => ({ lat: p.latitude, lng: p.longitude });
const waypoint = (p: PlaceRef) =>
  p.latLng
    ? { location: { latLng: { latitude: p.latLng.lat, longitude: p.latLng.lng } } }
    : p.placeId
      ? { placeId: p.placeId }
      : { address: p.address };

/** 検索の追加オプション(料金区分が上がるものは既定でオフ) */
export interface SearchOpts {
  /** 車区間の高速代を取得(Compute Routes Enterprise の料金になる) */
  tolls?: boolean;
}

export function buildRouteRequest(origin: PlaceRef, destination: PlaceRef, mode: Mode, departure?: Date, opts: SearchOpts = {}) {
  const body: Record<string, unknown> = {
    origin: waypoint(origin),
    destination: waypoint(destination),
    travelMode: mode,
    languageCode: "ja",
    regionCode: "JP",
    units: "METRIC",
  };
  if (mode === "DRIVE") body.routingPreference = "TRAFFIC_AWARE";
  if (mode === "DRIVE" && opts.tolls) {
    body.extraComputations = ["TOLLS"];
    body.routeModifiers = { vehicleInfo: { emissionType: "GASOLINE" } };
  }
  // 出発時刻で結果が変わるのは渋滞(自動車)と時刻表(公共交通)のみ
  if (departure && (mode === "DRIVE" || mode === "TRANSIT")) body.departureTime = departure.toISOString();
  return body;
}

/** Routes API のレスポンスを区間結果に変換する(経路なしは失敗として扱い、捏造しない) */
export function parseRoutesResponse(mode: Mode, status: number, data: RoutesResponse): LegResult {
  if (status >= 400) {
    return { ok: false, mode, error: data.error?.message ?? `APIエラー (HTTP ${status})` };
  }
  const route = data.routes?.[0];
  if (!route) {
    const hint = mode === "TRANSIT" || mode === "BICYCLE" ? "(この地域・区間では未対応の可能性があります)" : "";
    return { ok: false, mode, error: `経路が見つかりませんでした${hint}` };
  }
  const leg = route.legs[0];
  const toll = route.travelAdvisory?.tollInfo;
  const jpy = toll?.estimatedPrice?.find((p) => p.currencyCode === "JPY");
  return {
    ok: true,
    mode,
    distanceMeters: route.distanceMeters ?? 0,
    durationSec: parseInt(route.duration, 10),
    path: decodePolyline(route.polyline.encodedPolyline),
    start: ll(leg.startLocation.latLng),
    end: ll(leg.endLocation.latLng),
    // tollInfo があれば有料道路を通る。金額が出ない区間もある(捏造しない)
    ...(jpy ? { tollYen: Number(jpy.units ?? 0) + Math.round((jpy.nanos ?? 0) / 1e9) } : toll ? { tollUnknown: true } : {}),
  };
}

/** "HH:MM" → 0時からの分 */
const clockMin = (hhmm?: string) => {
  const m = hhmm?.match(/^(\d{1,2}):(\d{2})$/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : undefined;
};

/** 新幹線・飛行機など時刻が決まっている区間。所要は着−発(日付またぎは翌日扱い)。距離は不明なので0 */
export function fixedLeg(from: Stop): LegResult {
  const dep = clockMin(from.fixedDepart);
  const arr = clockMin(from.fixedArrive);
  if (dep === undefined || arr === undefined) return { ok: false, mode: "FIXED", error: "発車・到着の時刻を入力してください" };
  const min = (arr - dep + 1440) % 1440;
  if (min === 0) return { ok: false, mode: "FIXED", error: "発車と到着が同じ時刻です" };
  return { ok: true, mode: "FIXED", distanceMeters: 0, durationSec: min * 60, path: [] };
}

/** 固定区間の両端の座標を、前後の区間の終点・始点から補う(地図に直線で描くため) */
export function fillFixedEnds(legs: LegResult[]): LegResult[] {
  return legs.map((l, i) => {
    if (!l.ok || l.mode !== "FIXED") return l;
    const prev = legs[i - 1];
    const next = legs[i + 1];
    const start = prev?.ok ? prev.end : undefined;
    const end = next?.ok ? next.start : undefined;
    return { ...l, start, end, path: start && end ? [start, end] : [] };
  });
}

export async function fetchLeg(apiKey: string, from: Stop, to: Stop, departure?: Date, opts: SearchOpts = {}): Promise<LegResult> {
  const mode = from.modeToNext;
  if (mode === "FIXED") return fixedLeg(from);
  if (!apiKey) return { ok: false, mode, error: "APIキーが未設定です(画面上部の設定で入力してください)" };
  const ref = (s: Stop): PlaceRef => (s.latLng ? { latLng: s.latLng } : s.placeId ? { placeId: s.placeId } : { address: s.text });
  // 過去・直近の時刻を渡すとAPIがエラーを返すため、その場合は「いま」として省略する
  const dep = departure && departure.getTime() > Date.now() + 60_000 ? departure : undefined;
  // 1リクエストは使った機能のうち最も高い区分で課金される
  const sku: Sku = mode === "DRIVE" ? (opts.tolls ? "routesEnt" : "routesPro") : "routesEss";
  if (!take(sku)) return { ok: false, mode, error: capMessage(sku) };
  try {
    const r = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask":
          "routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline,routes.legs.startLocation,routes.legs.endLocation" +
          (opts.tolls && mode === "DRIVE" ? ",routes.travelAdvisory.tollInfo" : ""),
      },
      body: JSON.stringify(buildRouteRequest(ref(from), ref(to), mode, dep, opts)),
    });
    return parseRoutesResponse(mode, r.status, await r.json());
  } catch (e) {
    return { ok: false, mode, error: `通信エラー: ${String(e)}` };
  }
}

/** 全区間を並列取得(1検索 = 区間数ぶんのリクエスト) */
export async function searchAll(apiKey: string, stops: Stop[], opts: SearchOpts = {}): Promise<LegResult[]> {
  return fillFixedEnds(await Promise.all(stops.slice(0, -1).map((s, i) => fetchLeg(apiKey, s, stops[i + 1], undefined, opts))));
}

/** 出発時刻つきで順番に取得(前の区間の到着+滞在が次の出発時刻になるため並列にできない) */
export async function searchFrom(apiKey: string, stops: Stop[], start: Date, rules: StopRule[], opts: SearchOpts = {}): Promise<LegResult[]> {
  const out: LegResult[] = [];
  let t: number | undefined = start.getTime();
  for (let i = 0; i < stops.length - 1; i++) {
    const leg = await fetchLeg(apiKey, stops[i], stops[i + 1], t === undefined ? undefined : new Date(t), opts);
    out.push(leg);
    t = t === undefined || !leg.ok ? undefined : nextDepart(t + leg.durationSec * 1000, rules[i + 1]);
  }
  return fillFixedEnds(out);
}

/**
 * 経由地の訪問順を最適化(車で1回だけ問い合わせ。Compute Routes Pro の料金)。
 * 返り値は経由地(先頭・末尾を除く)の新しい並び順。失敗時はエラー文。
 */
export async function optimizeOrder(apiKey: string, stops: Stop[]): Promise<number[] | string> {
  if (!apiKey) return "APIキーが未設定です";
  if (!take("routesPro")) return capMessage("routesPro");
  const ref = (s: Stop) => waypoint(s.latLng ? { latLng: s.latLng } : s.placeId ? { placeId: s.placeId } : { address: s.text });
  try {
    const r = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "routes.optimizedIntermediateWaypointIndex",
      },
      body: JSON.stringify(buildOptimizeRequest(stops.map(ref))),
    });
    const data = await r.json();
    const idx = data.routes?.[0]?.optimizedIntermediateWaypointIndex;
    if (r.status >= 400) return data.error?.message ?? `APIエラー (HTTP ${r.status})`;
    return Array.isArray(idx) ? idx : "順番を最適化できませんでした";
  } catch (e) {
    return `通信エラー: ${String(e)}`;
  }
}

export function buildOptimizeRequest(points: object[]) {
  return {
    origin: points[0],
    destination: points[points.length - 1],
    intermediates: points.slice(1, -1),
    travelMode: "DRIVE",
    optimizeWaypointOrder: true,
    languageCode: "ja",
    regionCode: "JP",
  };
}
