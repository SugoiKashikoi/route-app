import type { LegResult, LatLng, Mode, Stop } from "../types";
import { decodePolyline } from "./polyline";
import { nextDepart, type StopRule } from "./schedule";

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
  }[];
  error?: { message?: string; status?: string };
}

interface PlaceRef {
  placeId?: string;
  address?: string;
}

const ll = (p: LatLngObj): LatLng => ({ lat: p.latitude, lng: p.longitude });
const waypoint = (p: PlaceRef) => (p.placeId ? { placeId: p.placeId } : { address: p.address });

export function buildRouteRequest(origin: PlaceRef, destination: PlaceRef, mode: Mode, departure?: Date) {
  const body: Record<string, unknown> = {
    origin: waypoint(origin),
    destination: waypoint(destination),
    travelMode: mode,
    languageCode: "ja",
    regionCode: "JP",
    units: "METRIC",
  };
  if (mode === "DRIVE") body.routingPreference = "TRAFFIC_AWARE";
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
  return {
    ok: true,
    mode,
    distanceMeters: route.distanceMeters ?? 0,
    durationSec: parseInt(route.duration, 10),
    path: decodePolyline(route.polyline.encodedPolyline),
    start: ll(leg.startLocation.latLng),
    end: ll(leg.endLocation.latLng),
  };
}

export async function fetchLeg(apiKey: string, from: Stop, to: Stop, departure?: Date): Promise<LegResult> {
  const mode = from.modeToNext;
  if (!apiKey) return { ok: false, mode, error: "APIキーが未設定です(画面上部の設定で入力してください)" };
  const ref = (s: Stop): PlaceRef => (s.placeId ? { placeId: s.placeId } : { address: s.text });
  // 過去・直近の時刻を渡すとAPIがエラーを返すため、その場合は「いま」として省略する
  const dep = departure && departure.getTime() > Date.now() + 60_000 ? departure : undefined;
  try {
    const r = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask":
          "routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline,routes.legs.startLocation,routes.legs.endLocation",
      },
      body: JSON.stringify(buildRouteRequest(ref(from), ref(to), mode, dep)),
    });
    return parseRoutesResponse(mode, r.status, await r.json());
  } catch (e) {
    return { ok: false, mode, error: `通信エラー: ${String(e)}` };
  }
}

/** 全区間を並列取得(1検索 = 区間数ぶんのリクエスト) */
export function searchAll(apiKey: string, stops: Stop[]): Promise<LegResult[]> {
  return Promise.all(stops.slice(0, -1).map((s, i) => fetchLeg(apiKey, s, stops[i + 1])));
}

/** 出発時刻つきで順番に取得(前の区間の到着+滞在が次の出発時刻になるため並列にできない) */
export async function searchFrom(apiKey: string, stops: Stop[], start: Date, rules: StopRule[]): Promise<LegResult[]> {
  const out: LegResult[] = [];
  let t: number | undefined = start.getTime();
  for (let i = 0; i < stops.length - 1; i++) {
    const leg = await fetchLeg(apiKey, stops[i], stops[i + 1], t === undefined ? undefined : new Date(t));
    out.push(leg);
    t = t === undefined || !leg.ok ? undefined : nextDepart(t + leg.durationSec * 1000, rules[i + 1]);
  }
  return out;
}
