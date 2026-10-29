import type { LegResult, Mode, Stop } from "../types";
import type { StopTime } from "./schedule";

/**
 * 閲覧専用の共有データ。検索結果(時刻・所要・距離)をそのままURLに入れるので、
 * 開く側はAPIキーなしで予定表を見られる。地点名が含まれるので渡す相手に注意。
 */
export interface SharedPlan {
  v: 1;
  name?: string;
  stops: { t: string; a?: number; d?: number; dw?: number; o?: 1 }[];
  legs: { m: Mode; s?: number; km?: number; f?: string; e?: 1 }[];
}

export function toSharedPlan(name: string, stops: Stop[], legs: LegResult[], schedule: StopTime[]): SharedPlan {
  return {
    v: 1,
    name: name || undefined,
    stops: stops.map((s, i) => ({
      t: s.text,
      a: schedule[i]?.arrive?.getTime(),
      d: schedule[i]?.depart?.getTime(),
      dw: schedule[i]?.dwellMin || undefined,
      o: s.overnight && i > 0 && i < stops.length - 1 ? 1 : undefined,
    })),
    legs: legs.map((l, i) =>
      l.ok
        ? {
            m: l.mode,
            s: l.durationSec,
            km: l.mode === "FIXED" ? undefined : Math.round(l.distanceMeters / 100) / 10,
            f: l.mode === "FIXED" ? stops[i]?.fixedName : undefined,
          }
        : { m: l.mode, e: 1 },
    ),
  };
}

const toB64Url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export function encodePlan(p: SharedPlan): string {
  return toB64Url(new TextEncoder().encode(JSON.stringify(p)));
}

export function decodePlan(s: string): SharedPlan | null {
  try {
    const bytes = Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
    const v = JSON.parse(new TextDecoder().decode(bytes));
    if (v?.v !== 1 || !Array.isArray(v.stops) || !Array.isArray(v.legs) || v.legs.length !== v.stops.length - 1) return null;
    return v;
  } catch {
    return null;
  }
}
