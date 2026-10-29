import { describe, expect, it } from "vitest";
import { formatClock, formatDuration, formatDistance, toLocalInput } from "./format";
import { forwardSchedule, startForArrival } from "./schedule";
import { decodeFavorite, encodeFavorite, toFavorite } from "./favorites";

describe("favorites", () => {
  it("共有リンク用の文字列で往復できる(日本語・滞在つき)", () => {
    const f = toFavorite("テスト", [
      { id: "1", text: "上野駅", modeToNext: "WALK" },
      { id: "2", text: "皇居外苑", modeToNext: "DRIVE", dwellMin: 15 },
    ]);
    const s = encodeFavorite(f);
    expect(s).toMatch(/^[\w-]+$/);
    expect(decodeFavorite(s)).toMatchObject({ name: "テスト", stops: JSON.parse(JSON.stringify(f.stops)) });
  });
  it("壊れた文字列はnull", () => {
    expect(decodeFavorite("!!!")).toBeNull();
  });
});
import { decodePolyline } from "./polyline";
import { buildRouteRequest, parseRoutesResponse } from "./routes";
import { legUrl, navigateFromHereUrl } from "./mapsLinks";

describe("format", () => {
  it("時間・距離", () => {
    expect(formatDuration(65 * 60)).toBe("1時間5分");
    expect(formatDuration(45 * 60)).toBe("45分");
    expect(formatDistance(1234)).toBe("1.2 km");
  });
});

describe("polyline", () => {
  it("Google公式サンプルをデコード", () => {
    const p = decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@");
    expect(p[0]).toEqual({ lat: 38.5, lng: -120.2 });
    expect(p[2]).toEqual({ lat: 43.252, lng: -126.453 });
  });
});

describe("parseRoutesResponse (モックデータ。実APIの検証ではない)", () => {
  const loc = (latitude: number, longitude: number) => ({ latLng: { latitude, longitude } });
  it("成功", () => {
    const r = parseRoutesResponse("DRIVE", 200, {
      routes: [
        {
          duration: "2700s",
          distanceMeters: 30000,
          polyline: { encodedPolyline: "_p~iF~ps|U" },
          legs: [{ startLocation: loc(1, 2), endLocation: loc(3, 4) }],
        },
      ],
    });
    expect(r).toMatchObject({ ok: true, durationSec: 2700, distanceMeters: 30000, end: { lat: 3, lng: 4 } });
  });
  it("経路なしは失敗", () => {
    expect(parseRoutesResponse("TRANSIT", 200, {})).toMatchObject({ ok: false });
  });
  it("APIエラー", () => {
    expect(parseRoutesResponse("WALK", 403, { error: { message: "denied" } })).toMatchObject({
      ok: false,
      error: "denied",
    });
  });
});

describe("links / request", () => {
  it("ナビリンク", () => {
    expect(navigateFromHereUrl({ lat: 1, lng: 2 })).toContain("travelmode=driving&dir_action=navigate");
    expect(navigateFromHereUrl({ lat: 1, lng: 2 }, "WALK")).toContain("travelmode=walking&dir_action=navigate");
    expect(navigateFromHereUrl({ lat: 1, lng: 2 }, "TRANSIT")).not.toContain("dir_action");
    expect(legUrl({ lat: 1, lng: 2 }, { lat: 3, lng: 4 }, "WALK")).toContain("travelmode=walking");
  });
  it("自動車のみ渋滞考慮", () => {
    expect(buildRouteRequest({ address: "a" }, { address: "b" }, "DRIVE").routingPreference).toBe("TRAFFIC_AWARE");
    expect(buildRouteRequest({ address: "a" }, { address: "b" }, "WALK").routingPreference).toBeUndefined();
  });
  it("出発時刻は自動車・公共交通のみ送る", () => {
    const t = new Date("2030-01-01T00:00:00Z");
    expect(buildRouteRequest({ address: "a" }, { address: "b" }, "DRIVE", t).departureTime).toBe("2030-01-01T00:00:00.000Z");
    expect(buildRouteRequest({ address: "a" }, { address: "b" }, "TRANSIT", t).departureTime).toBeDefined();
    expect(buildRouteRequest({ address: "a" }, { address: "b" }, "WALK", t).departureTime).toBeUndefined();
  });
});

describe("schedule", () => {
  const start = new Date(2026, 9, 29, 9, 0);
  it("滞在を挟んで順に時刻を割り当てる", () => {
    // A→B 60分, Bで30分滞在, B→C 20分
    const s = forwardSchedule([3600, 1200], [0, 30, 0], start);
    expect(formatClock(s[0].depart!)).toBe("9:00");
    expect(formatClock(s[1].arrive!)).toBe("10:00");
    expect(formatClock(s[1].depart!)).toBe("10:30");
    expect(formatClock(s[2].arrive!)).toBe("10:50");
    expect(s[2].depart).toBeUndefined();
  });
  it("取得失敗の区間以降は時刻不明", () => {
    const s = forwardSchedule([3600, null, 600], [0, 0, 0, 0], start);
    expect(s[1].arrive).toBeDefined();
    expect(s[2].arrive).toBeUndefined();
    expect(s[3].arrive).toBeUndefined();
  });
  it("到着時刻から出発時刻を逆算", () => {
    const arr = new Date(2026, 9, 29, 12, 0);
    expect(formatClock(startForArrival([3600, 1200], [0, 30, 0], arr)!)).toBe("10:10");
    expect(startForArrival([3600, null], [0, 0, 0], arr)).toBeNull();
  });
  it("日付またぎは「翌」", () => {
    expect(formatClock(new Date(2026, 9, 30, 0, 15), start)).toBe("翌 0:15");
    expect(toLocalInput(start)).toBe("2026-10-29T09:00");
  });
});
