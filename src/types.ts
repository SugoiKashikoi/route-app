import type { TransitDetails } from "./lib/transit";

/** FIXED は新幹線・飛行機など発着時刻が決まっている区間(APIを使わず、入力した時刻で計算) */
export type Mode = "DRIVE" | "WALK" | "BICYCLE" | "TRANSIT" | "FIXED";

export const MODE_LABEL: Record<Mode, string> = {
  DRIVE: "自動車",
  WALK: "徒歩",
  BICYCLE: "自転車",
  TRANSIT: "公共交通",
  FIXED: "新幹線・飛行機",
};

export const MODE_ICON: Record<Mode, string> = { DRIVE: "🚗", WALK: "🚶", BICYCLE: "🚲", TRANSIT: "🚆", FIXED: "🚄" };

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
  /** ここで宿泊する(経由地のみ)。departAt は翌日の出発時刻として扱う */
  overnight?: boolean;
  /** modeToNext が TRANSIT のとき、所要(分)を手入力(APIを使わない。日本の電車はAPIで取れないため) */
  transitMin?: number;
  /** 地名の代わりに座標で指定(現在地からの再計算で使う) */
  latLng?: LatLng;
  /** modeToNext が FIXED のときの便名(例: のぞみ12号) */
  fixedName?: string;
  /** modeToNext が FIXED のときの発車・出発時刻 "HH:MM" */
  fixedDepart?: string;
  /** modeToNext が FIXED のときの到着時刻 "HH:MM" */
  fixedArrive?: string;
}

export interface LatLng {
  lat: number;
  lng: number;
}

export type LegResult =
  // FIXED は両端の座標が前後の区間から分かったときだけ start/end が入る
  // tollYen は高速代の取得を有効にした車区間のみ。tollUnknown は有料道路を通るが金額が出なかったとき
  | { ok: true; mode: Mode; distanceMeters: number; durationSec: number; path: LatLng[]; start?: LatLng; end?: LatLng; tollYen?: number; tollUnknown?: boolean; manual?: boolean; transit?: TransitDetails }
  | { ok: false; mode: Mode; error: string };
