/** 車の設定(燃費・ガソリン単価)。ブラウザ(localStorage)にだけ保存 */
export interface CarSettings {
  /** 燃費 km/L */
  kmPerL?: number;
  /** ガソリン単価 円/L */
  yenPerL?: number;
  /** 車区間の高速代を取得する(Routes API が Enterprise 料金になる) */
  tolls?: boolean;
  /** 立ち寄り先の営業時間を確認する(Places API の Enterprise 料金) */
  hours?: boolean;
  /** false のとき公共交通の自動検索をしない(既定はオン) */
  transitAuto?: boolean;
}

const KEY = "multimodal-route:car";

export function loadCar(): CarSettings {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

export function saveCar(c: CarSettings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(c));
  } catch {
    /* 保存できなくても今回の画面では使える */
  }
}

/** 走行距離からガソリン代(円)。設定が未入力なら null */
export function fuelCost(meters: number, c: CarSettings): number | null {
  if (!c.kmPerL || !c.yenPerL || c.kmPerL <= 0 || c.yenPerL <= 0) return null;
  return Math.round((meters / 1000 / c.kmPerL) * c.yenPerL);
}

export const formatYen = (y: number) => `¥${y.toLocaleString("ja-JP")}`;
