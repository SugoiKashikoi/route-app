import type { LatLng, Mode } from "../types";

const TRAVEL: Record<Mode, string> = { DRIVE: "driving", WALK: "walking", BICYCLE: "bicycling", TRANSIT: "transit", FIXED: "transit" };
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

/** 地名どうしでGoogleマップの経路を開く(座標が手元にない閲覧専用ページ用) */
export function legUrlByName(from: string, to: string, mode: Mode): string {
  const q = encodeURIComponent;
  return `https://www.google.com/maps/dir/?api=1&origin=${q(from)}&destination=${q(to)}&travelmode=${TRAVEL[mode]}`;
}

/** 地点をGoogleマップで開く(営業時間・口コミなどはGoogleマップ側で見る。APIを使わないので無料) */
export function placeUrl(text: string, placeId?: string): string {
  const id = placeId ? `&query_place_id=${encodeURIComponent(placeId)}` : "";
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(text)}${id}`;
}
