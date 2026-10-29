import type { LegResult, Mode, Stop } from "../types";
import { describe, expect, it } from "vitest";
import { formatClock, formatDuration, formatDistance, toLocalInput } from "./format";
import { buildRules, forwardSchedule, resolveClock, startForArrival, type StopRule } from "./schedule";
import { fillFixedEnds, fixedLeg } from "./routes";
import { fuelCost } from "./cost";
import { legCautions } from "./cautions";
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
  const r = (...dwell: number[]): StopRule[] => dwell.map((dwellMin) => ({ dwellMin }));
  it("出発時刻指定は早く着いたら待つ、到着希望は余裕/遅れを出す", () => {
    // A 9:00発 → B 10:00着、Bは10:30発指定 → C 10:50着(10:45までに着きたい)
    const rules: StopRule[] = [{ dwellMin: 0 }, { dwellMin: 10, departAt: resolveClock("10:30", start) }, { dwellMin: 0, arriveBy: resolveClock("10:45", start) }];
    const s = forwardSchedule([3600, 1200], rules, start);
    expect(formatClock(s[1].depart!)).toBe("10:30");
    expect(s[1].waitMin).toBe(20);
    expect(formatClock(s[2].arrive!)).toBe("10:50");
    expect(s[2].slackMin).toBe(-5);
  });
  it("時刻は日付をまたぐと翌日に解釈", () => {
    const late = new Date(2026, 9, 29, 22, 0);
    expect(resolveClock("0:30", late)!.getDate()).toBe(30);
    expect(resolveClock("23:00", late)!.getDate()).toBe(29);
    expect(resolveClock("", late)).toBeUndefined();
  });
  it("滞在を挟んで順に時刻を割り当てる", () => {
    // A→B 60分, Bで30分滞在, B→C 20分
    const s = forwardSchedule([3600, 1200], r(0, 30, 0), start);
    expect(formatClock(s[0].depart!)).toBe("9:00");
    expect(formatClock(s[1].arrive!)).toBe("10:00");
    expect(formatClock(s[1].depart!)).toBe("10:30");
    expect(formatClock(s[2].arrive!)).toBe("10:50");
    expect(s[2].depart).toBeUndefined();
  });
  it("取得失敗の区間以降は時刻不明", () => {
    const s = forwardSchedule([3600, null, 600], r(0, 0, 0, 0), start);
    expect(s[1].arrive).toBeDefined();
    expect(s[2].arrive).toBeUndefined();
    expect(s[3].arrive).toBeUndefined();
  });
  it("到着時刻から出発時刻を逆算", () => {
    const arr = new Date(2026, 9, 29, 12, 0);
    expect(formatClock(startForArrival([3600, 1200], r(0, 30, 0), arr)!)).toBe("10:10");
    expect(startForArrival([3600, null], r(0, 0, 0), arr)).toBeNull();
  });
  it("日付またぎは「翌」", () => {
    expect(formatClock(new Date(2026, 9, 30, 0, 15), start)).toBe("翌 0:15");
    expect(toLocalInput(start)).toBe("2026-10-29T09:00");
  });
});

describe("新幹線・飛行機(時刻固定)", () => {
  const st = (o: Partial<Stop>): Stop => ({ id: "x", text: "駅", modeToNext: "FIXED", ...o });
  it("所要は着−発。日付またぎは翌日扱い、未入力は失敗", () => {
    expect(fixedLeg(st({ fixedDepart: "10:00", fixedArrive: "12:30" }))).toMatchObject({ ok: true, durationSec: 150 * 60 });
    expect(fixedLeg(st({ fixedDepart: "23:30", fixedArrive: "0:45" }))).toMatchObject({ ok: true, durationSec: 75 * 60 });
    expect(fixedLeg(st({ fixedDepart: "10:00" })).ok).toBe(false);
  });
  it("両端の座標を前後の区間から補う", () => {
    const a = { lat: 1, lng: 1 };
    const b = { lat: 2, lng: 2 };
    const legs = fillFixedEnds([
      { ok: true, mode: "DRIVE", distanceMeters: 1, durationSec: 1, path: [], start: { lat: 0, lng: 0 }, end: a },
      { ok: true, mode: "FIXED", distanceMeters: 0, durationSec: 1, path: [] },
      { ok: true, mode: "WALK", distanceMeters: 1, durationSec: 1, path: [], start: b, end: b },
    ]);
    expect(legs[1]).toMatchObject({ start: a, end: b, path: [a, b] });
  });
  it("発車時刻まで待ち、発車に間に合うかを判定する", () => {
    const base = new Date(2026, 0, 1, 8, 0);
    const stops = [
      st({ modeToNext: "DRIVE" }),
      st({ dwellMin: 10, fixedDepart: "9:00", fixedArrive: "11:00" }),
      st({ modeToNext: "WALK" }),
    ];
    const rules = buildRules(stops, base);
    // 車30分で8:30着、滞在10分 → 9:00発まで20分待ち、余裕20分
    const t = forwardSchedule([30 * 60, 120 * 60], rules, base);
    expect(t[1]).toMatchObject({ waitMin: 20, slackMin: 20 });
    expect(t[2].arrive?.getHours()).toBe(11);
  });
});

describe("ガソリン代・要注意", () => {
  it("距離÷燃費×単価、未設定はnull", () => {
    expect(fuelCost(150_000, { kmPerL: 15, yenPerL: 170 })).toBe(1700);
    expect(fuelCost(150_000, {})).toBeNull();
  });
  it("乗り継ぎが厳しい・長い徒歩・長時間運転を指摘", () => {
    const leg = (mode: Mode, min: number): LegResult => ({ ok: true, mode, distanceMeters: 0, durationSec: min * 60, path: [] });
    expect(legCautions(leg("DRIVE", 30), 12, true)).toEqual(["発車まで余裕12分(乗り遅れ注意)"]);
    expect(legCautions(leg("DRIVE", 30), 12, false)).toEqual([]);
    expect(legCautions(leg("DRIVE", 30), -5, true)).toEqual(["発車に5分間に合いません"]);
    expect(legCautions(leg("WALK", 25), undefined, false)).toHaveLength(1);
    expect(legCautions(leg("DRIVE", 130), undefined, false)).toHaveLength(1);
  });
});
