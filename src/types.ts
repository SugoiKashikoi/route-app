export type Mode = "DRIVE" | "WALK" | "BICYCLE" | "TRANSIT";

export const MODE_LABEL: Record<Mode, string> = {
  DRIVE: "自動車",
  WALK: "徒歩",
  BICYCLE: "自転車",
  TRANSIT: "公共交通",
};

export interface Stop {
  id: string;
  text: string;
  placeId?: string;
  /** この地点から次の地点までの移動手段 */
  modeToNext: Mode;
  /** この地点での滞在(分)。経由地のみ有効 */
  dwellMin?: number;
  /** この地点を出る時刻 "HH:MM"(早く着いたら待つ)。経由地のみ */
  departAt?: string;
  /** この地点に着きたい時刻 "HH:MM" */
  arriveBy?: string;
}

export interface LatLng {
  lat: number;
  lng: number;
}

export type LegResult =
  | { ok: true; mode: Mode; distanceMeters: number; durationSec: number; path: LatLng[]; start: LatLng; end: LatLng }
  | { ok: false; mode: Mode; error: string };
