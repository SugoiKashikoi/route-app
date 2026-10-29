import type { LatLng, Mode } from "../types";

const TRAVEL: Record<Mode, string> = { DRIVE: "driving", WALK: "walking", BICYCLE: "bicycling", TRANSIT: "transit" };
const pt = (p: LatLng) => `${p.lat},${p.lng}`;

/** 区間をGoogleマップで開く。経路そのものの完全一致は保証されない(Googleが再計算する)。 */
export function legUrl(start: LatLng, end: LatLng, mode: Mode): string {
  return `https://www.google.com/maps/dir/?api=1&origin=${pt(start)}&destination=${pt(end)}&travelmode=${TRAVEL[mode]}`;
}

/**
 * 現在地から区間の終点へナビを開始するリンク。
 * iPhoneではGoogleマップアプリがインストール済みならユニバーサルリンクでアプリが開く。
 * 出発地を省略すると現在地が出発地になり、dir_action=navigate でナビが始まる。
 * 自動車の場合、iPhoneがCarPlayに接続されていればGoogleマップのナビがCarPlayにも表示される。
 */
export function navigateFromHereUrl(end: LatLng, mode: Mode = "DRIVE"): string {
  const nav = mode === "TRANSIT" ? "" : "&dir_action=navigate";
  return `https://www.google.com/maps/dir/?api=1&destination=${pt(end)}&travelmode=${TRAVEL[mode]}${nav}`;
}
