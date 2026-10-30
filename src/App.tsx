import { Fragment, useEffect, useState } from "react";
import { MapView, MODE_COLOR } from "./MapView";
import { PlaceInput } from "./PlaceInput";
import { DateTimeField, TimeField } from "./TimeFields";
import { formatClock, formatDistance, formatDuration, toLocalInput } from "./lib/format";
import { legUrl, legUrlByName, navigateFromHereUrl, placeUrl } from "./lib/mapsLinks";
import { loadUsage, SKU, type Sku } from "./lib/quota";
import { loadNavitimeKey, saveNavitimeKey, testNavitime } from "./lib/navitime";
import { testTransitApi } from "./lib/transitApiTest";
import { TRANSIT_ATTRIBUTION } from "./lib/transit";
import { optimizeOrder, searchAll, searchFrom } from "./lib/routes";
import { fetchHours, hoursWarning } from "./lib/hours";
import { dayKey, eventDays, parseIcs, type CalEvent } from "./lib/ics";
import { buildRules, DEFAULT_MORNING, forwardSchedule, startForArrival, type StopTime } from "./lib/schedule";
import { encodePlan, toSharedPlan } from "./lib/share";
import { fuelCost, formatYen, loadCar, saveCar, type CarSettings } from "./lib/cost";
import { legCautions } from "./lib/cautions";
import { decodeFavorite, encodeFavorite, loadFavorites, saveFavorites, toFavorite, type Favorite } from "./lib/favorites";
import { MODE_ICON, MODE_LABEL, type LegResult, type Mode, type Stop } from "./types";

const MAX_STOPS = 10;
const MIN_STOPS = 2;
const STORAGE_KEY = "multimodal-route:stops";
const API_KEY_STORAGE = "multimodal-route:apikey";
const MODES = Object.keys(MODE_LABEL) as Mode[];

function loadApiKey(): string {
  try {
    return localStorage.getItem(API_KEY_STORAGE) ?? "";
  } catch {
    return "";
  }
}
const label = (i: number) => String.fromCharCode(65 + i);
const durations = (legs: LegResult[]) => legs.map((l) => (l.ok ? l.durationSec : null));

type TimeMode = "now" | "depart" | "arrive";

/** 入力欄の初期値: 30分後を5分単位に切り上げ */
function defaultTime(): string {
  const d = new Date(Date.now() + 30 * 60_000);
  d.setMinutes(Math.ceil(d.getMinutes() / 5) * 5, 0, 0);
  return toLocalInput(d);
}
const newStop = (modeToNext: Mode = "DRIVE"): Stop => ({ id: crypto.randomUUID(), text: "", modeToNext });

function loadStops(): Stop[] {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    if (Array.isArray(saved) && saved.length >= MIN_STOPS) return saved;
  } catch {
    /* 保存データが使えなければ初期状態 */
  }
  return [newStop(), newStop(), newStop()];
}

/** 動作確認用のサンプル(公共の場所のみ) */
function samplePreset(): Stop[] {
  const s = (text: string, modeToNext: Mode, dwellMin = 0): Stop => ({ ...newStop(modeToNext), text, dwellMin });
  return [
    s("上野駅", "WALK"),
    { ...s("上野恩賜公園", "TRANSIT", 30), transitMin: 15 },
    s("東京駅", "WALK"),
    s("皇居外苑", "WALK"),
  ];
}

const fromFavorite = (f: Favorite): Stop[] => f.stops.map((x) => ({ ...newStop(x.modeToNext), ...x }));

/**
 * URLのハッシュからルートを取り込む(取り込んだらハッシュは消す)。
 * #fav=…  共有リンク(お気に入りに追加)
 * #plan=… 人やAIが手で書けるJSON(encodeURIComponent)。例: #plan={"stops":[{"text":"上野駅","modeToNext":"WALK"},{"text":"東京駅"}]}
 */
function importFromHash(): { fav: Favorite; save: boolean } | null {
  const m = location.hash.match(/^#(fav|plan)=(.+)$/);
  if (!m) return null;
  history.replaceState(null, "", location.pathname + location.search);
  if (m[1] === "fav") {
    const f = decodeFavorite(m[2]);
    return f && { fav: f, save: true };
  }
  try {
    const v = JSON.parse(decodeURIComponent(m[2]));
    const stops = (Array.isArray(v) ? v : v?.stops) as Partial<Stop>[] | undefined;
    if (!Array.isArray(stops) || stops.length < MIN_STOPS) return null;
    const ok = stops.slice(0, MAX_STOPS).map((x) => ({
      ...x,
      text: String(x.text ?? ""),
      modeToNext: MODES.includes(x.modeToNext as Mode) ? (x.modeToNext as Mode) : "DRIVE",
    }));
    return { fav: { id: crypto.randomUUID(), name: String(v?.name ?? ""), stops: ok }, save: false };
  } catch {
    return null;
  }
}

/** 余裕・遅れ・待ちの表示 */
function Badges({ t, overnight }: { t?: StopTime; overnight?: boolean }) {
  if (!t) return null;
  return (
    <>
      {t.slackMin !== undefined &&
        (t.slackMin >= 0 ? (
          <span className="chip ok">余裕 {formatDuration(t.slackMin * 60)}</span>
        ) : (
          <span className="chip bad">遅れ {formatDuration(-t.slackMin * 60)}</span>
        ))}
      {overnight && <span className="chip wait">🏨 宿泊</span>}
      {!overnight && t.waitMin > 0 && <span className="chip wait">待ち {formatDuration(t.waitMin * 60)}</span>}
    </>
  );
}

export function App() {
  const [stops, setStops] = useState<Stop[]>(loadStops);
  const [legs, setLegs] = useState<LegResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<"list" | "map">("list");
  /** ナビ進行中の区間(0始まり)。降車・到着のたびに次へ進める */
  const [step, setStep] = useState(0);
  const [apiKey, setApiKey] = useState(loadApiKey);
  const [car, setCar] = useState<CarSettings>(loadCar);
  const [navKey, setNavKey] = useState(loadNavitimeKey);
  const [navTest, setNavTest] = useState("");
  const updateCar = (patch: CarSettings) => {
    const c = { ...car, ...patch };
    setCar(c);
    saveCar(c);
  };
  const [timeMode, setTimeMode] = useState<TimeMode>("now");
  const [timeValue, setTimeValue] = useState(defaultTime);
  const [schedule, setSchedule] = useState<StopTime[]>([]);
  const [notice, setNotice] = useState("");
  const [favs, setFavs] = useState<Favorite[]>(loadFavorites);
  const [favName, setFavName] = useState("");
  const [favMsg, setFavMsg] = useState("");
  const [drawer, setDrawer] = useState<"" | "key" | "fav">(() => (loadApiKey() ? "" : "key"));
  /** 時刻条件の入力欄を開いている地点 */
  const [timeOpen, setTimeOpen] = useState<Set<string>>(new Set());
  /** 地図で強調する区間 */
  const [focus, setFocus] = useState<number | null>(null);
  const showLeg = (i: number | null) => {
    setFocus((f) => (f === i ? null : i));
    if (i !== null && window.matchMedia("(max-width: 760px)").matches) setTab("map");
  };

  const setFavsSaved = (f: Favorite[]) => {
    setFavs(f);
    saveFavorites(f);
  };
  const resetResult = () => {
    setFocus(null);
    setLegs([]);
    setSchedule([]);
    setHoursWarn([]);
    setStep(0);
  };

  // 共有リンクで開かれたら、お気に入りに追加して読み込む
  useEffect(() => {
    const got = importFromHash();
    if (!got) return;
    const f = got.fav;
    if (!got.save) return setStops(fromFavorite(f));
    const cur = loadFavorites();
    const rest = cur.filter((x) => x.name !== f.name);
    setFavsSaved([...rest, f]);
    setStops(fromFavorite(f));
    setDrawer("fav");
    setFavMsg(`お気に入り「${f.name}」を${rest.length < cur.length ? "更新" : "追加"}しました`);
  }, []);

  async function shareFav(f: Favorite) {
    const url = `${location.origin}${location.pathname}#fav=${encodeFavorite(f)}`;
    try {
      await navigator.clipboard.writeText(url);
      setFavMsg(`「${f.name}」の共有リンクをコピーしました。iPhoneなどで開くとお気に入りに追加されます`);
    } catch {
      setFavMsg(`コピーできませんでした。このリンクを手動で送ってください: ${url}`);
    }
  }

  const saveApiKey = (v: string) => {
    const key = v.trim();
    setApiKey(key);
    try {
      localStorage.setItem(API_KEY_STORAGE, key);
    } catch {
      /* 保存できなくても今回の画面では使える */
    }
  };

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(stops));
    } catch {
      /* 保存できなくても動作に影響なし */
    }
  }, [stops]);

  const update = (i: number, patch: Partial<Stop>) =>
    setStops((s) => s.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const remove = (i: number) => setStops((s) => s.filter((_, j) => j !== i));
  const move = (i: number, d: -1 | 1) =>
    setStops((s) => {
      const n = [...s];
      [n[i], n[i + d]] = [n[i + d], n[i]];
      return n;
    });
  const add = () => setStops((s) => [...s.slice(0, -1), { ...newStop(), modeToNext: s[s.length - 2]?.modeToNext ?? "DRIVE" }, s[s.length - 1]]);
  const toggleTime = (id: string) =>
    setTimeOpen((o) => {
      const n = new Set(o);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  const ready = stops.every((s) => s.text.trim());
  const opts = { tolls: car.tolls, transitAuto: car.transitAuto !== false };
  /** 公共交通を自動検索する区間があれば、前の区間の到着時刻から順に検索する(発車時刻を正しく拾うため) */
  const hasAutoTransit = opts.transitAuto && stops.slice(0, -1).some((s) => s.modeToNext === "TRANSIT");
  /** 地点ごとの営業時間の警告(設定でオンのときだけ取得) */
  const [hoursWarn, setHoursWarn] = useState<(string | undefined)[]>([]);
  const [calEvents, setCalEvents] = useState<CalEvent[]>([]);

  async function checkHours(sched: StopTime[]) {
    if (!car.hours || !apiKey) return setHoursWarn([]);
    const out = await Promise.all(
      stops.map(async (s, i) => {
        if (i === 0 || !s.placeId) return undefined;
        try {
          return hoursWarning((await fetchHours(apiKey, s.placeId)) ?? undefined, sched[i]?.arrive, sched[i]?.depart);
        } catch {
          return undefined;
        }
      }),
    );
    setHoursWarn(out);
  }

  /** 経由地の順番を車の所要で最適化(新幹線・宿泊・時刻指定のある経由地があると使えない) */
  const mids = stops.slice(1, -1);
  const canOptimize = mids.length >= 2 && mids.every((s) => !s.overnight && !s.departAt && !s.arriveBy) && stops.every((s) => s.modeToNext !== "FIXED");
  async function optimize() {
    setBusy(true);
    const res = await optimizeOrder(apiKey, stops);
    setBusy(false);
    if (typeof res === "string") return setNotice(`訪問順を最適化できませんでした: ${res}`);
    if (res.every((v, k) => v === k)) return setNotice("今の順番がすでに最短(車で計算)です。");
    setStops([stops[0], ...res.map((k) => mids[k]), stops[stops.length - 1]]);
    resetResult();
    setNotice("経由地の順番を車の所要時間が短くなるように並べ替えました。検索し直してください。");
  }

  /** .ics から指定日の予定を経由地にする。出発地はそのまま、目的地は出発地に戻る */
  function applyCalendarDay(day: string) {
    const evs = calEvents.filter((e) => dayKey(e.start) === day).slice(0, MAX_STOPS - 2);
    const hm = (d: Date) => `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
    const home = stops[0];
    setStops([
      home,
      ...evs.map((e) => ({
        ...newStop(home.modeToNext),
        text: e.location,
        arriveBy: hm(e.start),
        dwellMin: e.end ? Math.max(0, Math.round((e.end.getTime() - e.start.getTime()) / 60_000)) : 0,
      })),
      { ...newStop(), text: home.text, placeId: home.placeId },
    ]);
    setCalEvents([]);
    resetResult();
    setNotice(`${day} の予定${evs.length}件を経由地にしました(到着時刻=予定の開始、滞在=予定の長さ)。`);
  }

  async function loadIcs(file: File) {
    const evs = parseIcs(await file.text());
    if (!evs.length) return setNotice("場所と時刻のある予定が見つかりませんでした(終日の予定・場所のない予定は使えません)。");
    setCalEvents(evs);
    setNotice("");
  }

  async function search() {
    setBusy(true);
    resetResult();
    setNotice("");
    const now = new Date();
    const target = timeMode === "now" ? undefined : new Date(timeValue);
    const valid = target && !Number.isNaN(target.getTime());
    // 地点ごとの "HH:MM" は、旅程の日付(指定時刻か現在)を基準に日時へ直す
    const base = valid ? target : now;
    const rules = buildRules(stops, base);
    let res: LegResult[];
    let start = now;
    let msg = "";

    if (timeMode === "arrive" && valid) {
      rules[rules.length - 1].arriveBy = target;
      // 1回目: 所要時間の概算 → 出発時刻を逆算 → 2回目: その時刻の渋滞・時刻表で取り直す
      const rough = await searchAll(apiKey, stops, opts);
      const est = startForArrival(durations(rough), rules, target);
      if (!est) {
        res = rough;
        msg = "取得できない区間があるため、到着時刻からの逆算はできませんでした。いま出発した場合の時刻です。";
      } else if (est < now) {
        res = rough;
        msg = "指定の到着時刻には間に合いません。いま出発した場合の時刻です。";
      } else {
        res = await searchFrom(apiKey, stops, est, rules, opts);
        start = startForArrival(durations(res), rules, target) ?? est;
        msg = "到着時刻から逆算した目安です(到着指定は2回検索するため、リクエスト数は区間数×2)。";
      }
    } else if (timeMode === "depart" && valid && target.getTime() > now.getTime() + 60_000) {
      start = target;
      res = await searchFrom(apiKey, stops, start, rules, opts);
    } else {
      if (timeMode === "depart") msg = "過去の時刻のため、いま出発として計算しました。";
      // 地点ごとの出発時刻があると次の区間の出発時刻が変わるので、順番に取得する
      res = rules.some((r) => r.departAt) || hasAutoTransit ? await searchFrom(apiKey, stops, now, rules, opts) : await searchAll(apiKey, stops, opts);
    }

    const sched = forwardSchedule(durations(res), rules, start);
    setLegs(res);
    setSchedule(sched);
    setNotice(msg);
    checkHours(sched);
    setBusy(false);
    setTab("list");
  }

  /** 当日: 現在地から残りの区間を取り直す(済んだ区間はそのまま) */
  async function rerouteFromHere() {
    if (!navigator.geolocation) return setNotice("この端末では現在地を取得できません。");
    setBusy(true);
    setNotice("現在地を取得中…");
    try {
      const pos = await new Promise<GeolocationPosition>((ok, ng) =>
        navigator.geolocation.getCurrentPosition(ok, ng, { enableHighAccuracy: true, timeout: 15_000 }),
      );
      const now = new Date();
      const here: Stop = { ...stops[step], text: "現在地", placeId: undefined, latLng: { lat: pos.coords.latitude, lng: pos.coords.longitude }, dwellMin: 0, departAt: undefined, overnight: undefined };
      const rest = [here, ...stops.slice(step + 1)];
      const rules = buildRules(rest, now);
      const res = await searchFrom(apiKey, rest, now, rules, opts);
      setLegs([...legs.slice(0, step), ...res]);
      setSchedule([...schedule.slice(0, step), ...forwardSchedule(durations(res), rules, now)]);
      setNotice(`${formatClock(now)} に現在地から${label(step + 1)}以降を再計算しました。`);
    } catch (e) {
      setNotice(`現在地を取得できませんでした(${e instanceof GeolocationPositionError ? "位置情報の許可を確認してください" : String(e)})。`);
    } finally {
      setBusy(false);
    }
  }

  /** 予定ごと閲覧専用で共有(APIキーなしで見られる) */
  async function sharePlan() {
    const url = `${location.origin}${location.pathname}#view=${encodePlan(toSharedPlan(favName.trim(), stops, legs, schedule))}`;
    try {
      if (navigator.share) return await navigator.share({ title: "ルートの予定", url });
      await navigator.clipboard.writeText(url);
      setNotice("閲覧専用の予定リンクをコピーしました。開いた人はAPIキーなしで予定表を見られます(地点名が含まれます)。");
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      setNotice(`コピーできませんでした。このリンクを送ってください: ${url}`);
    }
  }

  const okLegs = legs.filter((l): l is Extract<LegResult, { ok: true }> => l.ok);
  const failed = legs.length - okLegs.length;
  const totalSec = okLegs.reduce((a, l) => a + l.durationSec, 0);
  const totalM = okLegs.reduce((a, l) => a + l.distanceMeters, 0);
  const perMode = MODES.map((m) => {
    const ls = okLegs.filter((l) => l.mode === m);
    return { m, sec: ls.reduce((a, l) => a + l.durationSec, 0), meters: ls.reduce((a, l) => a + l.distanceMeters, 0) };
  }).filter((x) => x.sec > 0);
  const driveM = okLegs.filter((l) => l.mode === "DRIVE").reduce((a, l) => a + l.distanceMeters, 0);
  const fuel = driveM > 0 ? fuelCost(driveM, car) : null;
  const cautions = legs.map((l, i) => {
    const c = legCautions(l, schedule[i + 1]?.slackMin, stops[i + 1]?.modeToNext === "FIXED" && i + 1 < stops.length - 1);
    const h = hoursWarn[i + 1];
    return h ? [...c, `${label(i + 1)}: ${h}`] : c;
  });
  const tollLegs = okLegs.filter((l) => l.tollYen !== undefined || l.tollUnknown);
  const tollYen = tollLegs.reduce((a, l) => a + (l.tollYen ?? 0), 0);
  const cautionCount = cautions.filter((c) => c.length > 0).length;
  const startAt = schedule[0]?.depart;
  const endAt = schedule.at(-1)?.arrive;
  const clock = (d?: Date) => (d ? formatClock(d, startAt) : "--:--");

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" />
          <div>
            <div className="brand-name">MULTI ROUTE</div>
            <div className="brand-sub">マルチ移動手段ルート検索</div>
          </div>
        </div>
        <div className="top-actions">
          <button aria-label="お気に入り" className={`ghost ${drawer === "fav" ? "on" : ""}`} onClick={() => setDrawer(drawer === "fav" ? "" : "fav")}>
            ★<span className="lbl"> お気に入り</span><span className="count">{favs.length}</span>
          </button>
          <button aria-label="設定(APIキー・燃費)" className={`ghost ${drawer === "key" ? "on" : ""} ${apiKey ? "" : "alert"}`} onClick={() => setDrawer(drawer === "key" ? "" : "key")}>
            ⚙<span className="lbl"> {apiKey ? "設定" : "APIキー未設定"}</span>
          </button>
        </div>
      </header>

      <nav className="tabs">
        <button className={tab === "list" ? "on" : ""} onClick={() => setTab("list")}>ROUTE</button>
        <button className={tab === "map" ? "on" : ""} onClick={() => setTab("map")}>MAP</button>
      </nav>

      <aside className={`panel ${tab === "list" ? "show" : ""}`}>
        {drawer === "key" && (
          <section className="drawer">
            <h2>API KEY</h2>
            <input
              type="password"
              autoComplete="off"
              placeholder="Google Maps Platform の APIキー"
              value={apiKey}
              onChange={(e) => saveApiKey(e.target.value)}
            />
            <p className="note">
              このブラウザの中にだけ保存され、Google以外へは送信されません。キーはRoutes API・Places API (New)・Maps JavaScript APIに制限し、HTTPリファラ制限でこのサイトのURLだけを許可してください。
            </p>
            <h2>CAR</h2>
            <div className="stop-opts">
              <label className="mini">
                燃費
                <input type="number" inputMode="decimal" min={0} step={0.1} aria-label="燃費(km/L)" value={car.kmPerL ?? ""} onChange={(e) => updateCar({ kmPerL: Number(e.target.value) || undefined })} />
                km/L
              </label>
              <label className="mini">
                ガソリン
                <input type="number" inputMode="numeric" min={0} step={1} aria-label="ガソリン単価(円/L)" value={car.yenPerL ?? ""} onChange={(e) => updateCar({ yenPerL: Number(e.target.value) || undefined })} />
                円/L
              </label>
            </div>
            <p className="note">版: {__BUILD__}(更新が反映されないときはページを再読み込み)</p>
            <p className="note">入力すると、車の区間のガソリン代の目安を表示します(距離÷燃費×単価。高速代は含みません)。</p>
            <h2>FREE</h2>
            <p className="note">
              無料枠を超えないよう、今月このブラウザで使った回数を数え、無料枠の約8割で自動停止します。別の端末の分は合算できないので、Google Cloud の「割り当て(Quota)」で1日の上限も設定してください(READMEに手順)。
            </p>
            <ul className="usage">
              {(Object.keys(SKU) as Sku[]).map((k) => (
                <li key={k}>
                  <span>{SKU[k].label}</span>
                  <span className="mono">{(loadUsage().n[k] ?? 0).toLocaleString()} / {SKU[k].cap.toLocaleString()}</span>
                </li>
              ))}
            </ul>
            <h2>TRANSIT (試験)</h2>
            <input
              type="password"
              autoComplete="off"
              placeholder="NAVITIME(RapidAPI)のキー"
              aria-label="NAVITIMEのキー"
              value={navKey}
              onChange={(e) => {
                setNavKey(e.target.value);
                saveNavitimeKey(e.target.value);
              }}
            />
            <div className="stop-opts">
              <button
                className="mini-btn"
                disabled={!navKey}
                onClick={async () => {
                  setNavTest("テスト中…");
                  setNavTest(await testNavitime(navKey.trim()));
                }}
              >
                接続テスト(岡山駅→倉敷駅・1回分を使用)
              </button>
            </div>
            <div className="stop-opts">
              <button
                className="mini-btn"
                onClick={async () => {
                  setNavTest("Transit API をテスト中…(最大1分)");
                  setNavTest(await testTransitApi());
                }}
              >
                Transit API テスト(キー不要・無料)
              </button>
              {navTest && (
                <button className="mini-btn" onClick={() => navigator.clipboard?.writeText(navTest).catch(() => undefined)}>
                  結果をコピー
                </button>
              )}
            </div>
            {navTest && <p className="note hi nav-test">{navTest}</p>}
            <p className="note">電車の所要時間を自動で取れるか試すための欄です。結果をそのまま開発者に送ってください。まだ検索には使いません。</p>
            <h2>OPTION</h2>
            <label className="check">
              <input type="checkbox" checked={car.transitAuto !== false} onChange={(e) => updateCar({ transitAuto: e.target.checked ? undefined : false })} />
              公共交通(電車・バス)を自動検索(Transit API・無料・キー不要。取れないときは「所要◯分」の手入力を使います)
            </label>
            <label className="check">
              <input type="checkbox" checked={!!car.tolls} onChange={(e) => updateCar({ tolls: e.target.checked || undefined })} />
              高速代を表示(無料枠が月1,000回と少ない区分。オフでも各区間の「Googleマップ」で料金を見られます)
            </label>
            <label className="check">
              <input type="checkbox" checked={!!car.hours} onChange={(e) => updateCar({ hours: e.target.checked || undefined })} />
              営業時間を自動チェック(無料枠が月1,000回と少ない区分。オフでも「営業時間を見る」でGoogleマップを開けます)
            </label>
          </section>
        )}

        {drawer === "fav" && (
          <section className="drawer">
            <h2>FAVORITES</h2>
            {favs.length === 0 && <p className="note">まだありません。下の欄で今のルートを保存できます。</p>}
            <ul className="fav-list">
              {favs.map((f) => (
                <li key={f.id}>
                  <button
                    className="fav-name"
                    onClick={() => {
                      setStops(fromFavorite(f));
                      resetResult();
                      setDrawer("");
                      setFavMsg("");
                    }}
                  >
                    <span>{f.name}</span>
                    <small>{f.stops.length}地点</small>
                  </button>
                  <button className="icon" title="共有リンクをコピー" onClick={() => shareFav(f)}>⤴</button>
                  <button className="icon" title="削除" onClick={() => setFavsSaved(favs.filter((x) => x.id !== f.id))}>✕</button>
                </li>
              ))}
            </ul>
            <div className="fav-add">
              <input placeholder="今のルートに名前をつけて保存" value={favName} onChange={(e) => setFavName(e.target.value)} />
              <button
                disabled={!favName.trim() || !ready}
                onClick={() => {
                  setFavsSaved([...favs.filter((x) => x.name !== favName.trim()), toFavorite(favName.trim(), stops)]);
                  setFavMsg(`「${favName.trim()}」を保存しました`);
                  setFavName("");
                }}
              >
                保存
              </button>
            </div>
            {favMsg && <p className="note hi">{favMsg}</p>}
            <p className="note">お気に入りはこのブラウザの中にだけ保存されます。別の端末へは ⤴ でコピーしたリンクで渡せます。</p>
          </section>
        )}

        <section className="block">
          <h2>
            <span className="num">01</span>ROUTE
            <button className="link" onClick={() => { setStops(samplePreset()); resetResult(); }} title="上野駅→上野公園(30分)→東京駅→皇居外苑">
              サンプル
            </button>
            <label className="link file" title="カレンダーから書き出した .ics を読み込む(ブラウザの中だけで処理)">
              📅 カレンダー
              <input type="file" accept=".ics,text/calendar" aria-label="カレンダー(.ics)を読み込む" onChange={(e) => { const f = e.target.files?.[0]; if (f) loadIcs(f); e.target.value = ""; }} />
            </label>
          </h2>
          {calEvents.length > 0 && (
            <div className="drawer cal-pick">
              <p className="note">どの日の予定を経由地にしますか?(場所のある予定のみ)</p>
              <div className="cal-days">
                {eventDays(calEvents).map((d) => (
                  <button key={d} onClick={() => applyCalendarDay(d)}>
                    {Number(d.slice(5, 7))}/{Number(d.slice(8))}({calEvents.filter((e) => dayKey(e.start) === d).length}件)
                  </button>
                ))}
                <button className="link" onClick={() => setCalEvents([])}>やめる</button>
              </div>
            </div>
          )}
          <ol className="stops">
            {stops.map((s, i) => {
              const first = i === 0;
              const last = i === stops.length - 1;
              const showTime = !first && (timeOpen.has(s.id) || s.departAt || s.arriveBy);
              return (
                <li key={s.id}>
                  <div className="stop">
                    <span className={`plate ${first ? "p-start" : last ? "p-goal" : ""}`}>{label(i)}</span>
                    <div className="stop-main">
                      <PlaceInput
                        apiKey={apiKey}
                        value={s.text}
                        placeholder={first ? "出発地" : last ? "目的地" : "経由地"}
                        label={`地点${label(i)} ${first ? "出発地" : last ? "目的地" : "経由地"}`}
                        onChange={(text, placeId) => update(i, { text, placeId })}
                      />
                      {!first && (
                        <div className="stop-opts">
                          {!last && !s.overnight && (
                            <label className="mini">
                              滞在
                              <input
                                type="number"
                                inputMode="numeric"
                                min={0}
                                step={5}
                                value={s.dwellMin ?? 0}
                                onChange={(e) => update(i, { dwellMin: Math.max(0, Number(e.target.value) || 0) })}
                              />
                              分
                            </label>
                          )}
                          <button className={`mini-btn ${showTime ? "on" : ""}`} onClick={() => toggleTime(s.id)}>
                            ⏱ 時刻指定
                          </button>
                          {!last && (
                            <button
                              className={`mini-btn ${s.overnight ? "on" : ""}`}
                              aria-pressed={!!s.overnight}
                              aria-label={`${label(i)}で宿泊`}
                              onClick={() => update(i, { overnight: !s.overnight || undefined, departAt: undefined })}
                            >
                              🏨 宿泊
                            </button>
                          )}
                        </div>
                      )}
                      {s.overnight && !last && (
                        <div className="stop-opts overnight-opts">
                          <label className="mini">
                            翌日
                            <TimeField value={s.departAt ?? DEFAULT_MORNING} onChange={(v) => update(i, { departAt: v })} />
                            に{label(i)}を出発
                          </label>
                        </div>
                      )}
                      {showTime && (
                        <div className="stop-opts">
                          <label className="mini">
                            {label(i)}に
                            <TimeField optional value={s.arriveBy ?? ""} onChange={(v) => update(i, { arriveBy: v || undefined })} />
                            までに着く
                          </label>
                          {!last && !s.overnight && (
                            <label className="mini">
                              {label(i)}を
                              <TimeField optional value={s.departAt ?? ""} onChange={(v) => update(i, { departAt: v || undefined })} />
                              に出る
                            </label>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="ops">
                      <button className="icon" title="上へ" disabled={first} onClick={() => move(i, -1)}>▲</button>
                      <button className="icon" title="下へ" disabled={last} onClick={() => move(i, 1)}>▼</button>
                      <button className="icon" title="削除" disabled={stops.length <= MIN_STOPS} onClick={() => remove(i)}>✕</button>
                    </div>
                  </div>
                  {!last && (
                    <div className="connector" style={{ ["--mc" as string]: MODE_COLOR[s.modeToNext] }}>
                      <span className="rail" />
                      <div className="modes">
                        {MODES.map((m) => (
                          <button
                            key={m}
                            className={`${s.modeToNext === m ? "on" : ""} ${m === "FIXED" ? "fixed" : ""}`}
                            aria-pressed={s.modeToNext === m}
                            aria-label={`${label(i)}→${label(i + 1)}の移動手段: ${MODE_LABEL[m]}`}
                            style={{ ["--mc" as string]: MODE_COLOR[m] }}
                            title={MODE_LABEL[m]}
                            onClick={() => update(i, { modeToNext: m })}
                          >
                            <span>{MODE_ICON[m]}</span>
                            {MODE_LABEL[m]}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {!last && s.modeToNext === "TRANSIT" && (
                    <div className="stop-opts fixed-opts">
                      <label className="mini">
                        {opts.transitAuto ? "自動検索できないときの所要" : "所要"}
                        <input
                          type="number"
                          inputMode="numeric"
                          min={0}
                          step={1}
                          aria-label={`${label(i)}→${label(i + 1)}の公共交通の所要(分)`}
                          value={s.transitMin ?? ""}
                          onChange={(e) => update(i, { transitMin: Number(e.target.value) || undefined })}
                        />
                        分
                      </label>
                      <a className="mini-link" href={legUrlByName(s.text || "現在地", stops[i + 1]?.text ?? "", "TRANSIT")} target="_blank" rel="noreferrer">
                        Googleマップで乗換を調べる
                      </a>
                    </div>
                  )}
                  {!last && s.modeToNext === "FIXED" && (
                    <div className="stop-opts fixed-opts">
                      <input
                        className="fixed-name"
                        placeholder="便名(任意) 例: のぞみ12号"
                        aria-label={`${label(i)}→${label(i + 1)}の便名`}
                        value={s.fixedName ?? ""}
                        onChange={(e) => update(i, { fixedName: e.target.value || undefined })}
                      />
                      <label className="mini">
                        発
                        <TimeField optional value={s.fixedDepart ?? ""} onChange={(v) => update(i, { fixedDepart: v || undefined })} />
                      </label>
                      <label className="mini">
                        着
                        <TimeField optional value={s.fixedArrive ?? ""} onChange={(v) => update(i, { fixedArrive: v || undefined })} />
                      </label>
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
          <div className="add-row">
            <button className="add" onClick={add} disabled={stops.length >= MAX_STOPS}>＋ 経由地を追加</button>
            <button
              className="add"
              onClick={optimize}
              disabled={!canOptimize || !ready || busy || !apiKey}
              title={canOptimize ? "経由地の順番を車の所要時間が短くなるように並べ替え" : "経由地が2つ以上あり、新幹線・宿泊・時刻指定がないときに使えます"}
            >
              🔀 訪問順を最適化
            </button>
          </div>
          {notice && legs.length === 0 && <p className="note hi">{notice}</p>}
        </section>

        <section className="block">
          <h2><span className="num">02</span>TIMING</h2>
          <div className="seg">
            {(
              [
                ["now", "いまから出発"],
                ["depart", "出発時刻"],
                ["arrive", "到着時刻"],
              ] as const
            ).map(([v, t]) => (
              <button key={v} className={timeMode === v ? "on" : ""} onClick={() => setTimeMode(v)}>
                {t}
              </button>
            ))}
          </div>
          {timeMode !== "now" && (
            <DateTimeField value={timeValue} onChange={setTimeValue} />
          )}
        </section>

        <button className="start" onClick={search} disabled={!ready || busy}>
          <span>{busy ? "CALCULATING…" : "START"}</span>
          <small>{busy ? "検索中" : "ルート検索"}</small>
        </button>

        {legs.length > 0 && (
          <section className="result">
            <div className="hud">
              <div className="hud-label">TOTAL MOVING</div>
              <div className="hud-time">{formatDuration(totalSec)}</div>
              <div className="hud-bar">
                {perMode.map((x) => (
                  <span key={x.m} style={{ flex: x.sec, background: MODE_COLOR[x.m] }} />
                ))}
              </div>
              <ul className="by-mode">
                {perMode.map((x) => (
                  <li key={x.m}>
                    <span className="dot" style={{ background: MODE_COLOR[x.m] }} />
                    <span className="by-mode-name">{MODE_ICON[x.m]} {MODE_LABEL[x.m]}</span>
                    <span className="mono">{formatDuration(x.sec)}</span>
                    <span className="by-mode-dist">{x.meters === 0 ? "—" : formatDistance(x.meters)}</span>
                  </li>
                ))}
              </ul>
              <div className="hud-grid">
                <div><small>DEPART</small><b>{clock(startAt)}</b></div>
                <div><small>ARRIVE</small><b>{clock(endAt)}</b></div>
                <div><small>DISTANCE</small><b>{formatDistance(totalM)}</b></div>
                <div>
                  <small>TOTAL</small>
                  <b>{startAt && endAt ? formatDuration((endAt.getTime() - startAt.getTime()) / 1000) : "--"}</b>
                </div>
              </div>
              <div className="hud-badges">
                <Badges t={schedule.at(-1)} />
                {fuel !== null && <span className="chip">⛽ ガソリン代 約{formatYen(fuel)}</span>}
                {tollLegs.length > 0 && (
                  <span className="chip">🛣 高速代 約{formatYen(tollYen)}{tollLegs.some((l) => l.tollUnknown) ? "+不明分" : ""}</span>
                )}
                {cautionCount > 0 && <span className="chip bad">⚠ 要注意 {cautionCount}区間</span>}
              </div>
              {driveM > 0 && fuel === null && <div className="info">⚙ 設定で燃費とガソリン単価を入れると、ガソリン代の目安を表示します。</div>}
              {failed > 0 && <div className="warn">{failed}区間が取得できなかったため、合計は取得できた区間のみの値です。</div>}
              {notice && <div className="info">{notice}</div>}
              <button className="share-plan" onClick={sharePlan} aria-label="予定を閲覧専用で共有">📤 予定を共有(閲覧専用)</button>
            </div>

            <div className="sector-bar">
              <span>区間をタップすると地図でその区間を表示</span>
              <button className={focus === null ? "on" : ""} onClick={() => { setFocus(null); if (window.matchMedia("(max-width: 760px)").matches) setTab("map"); }}>
                全体を表示
              </button>
            </div>
            <ol className="sectors">
              {legs.map((l, i) => (
                <Fragment key={i}>
                  {i > 0 && schedule[i] && stops[i] && (
                    <li className="pit">
                      <span className="plate sm">{label(i)}</span>
                      <span className="mono">{clock(schedule[i].arrive)}〜{clock(schedule[i].depart)}</span>
                      {schedule[i].dwellMin > 0 && <span className="chip">滞在 {formatDuration(schedule[i].dwellMin * 60)}</span>}
                      {hoursWarn[i] && <span className="chip bad">🕘 {hoursWarn[i]}</span>}
                      <a className="chip" href={placeUrl(stops[i].text, stops[i].placeId)} target="_blank" rel="noreferrer">🕘 営業時間を見る</a>
                      <Badges t={schedule[i]} overnight={stops[i]?.overnight} />
                    </li>
                  )}
                  <li
                    className={`sector ${i === step ? "current" : i < step ? "done" : ""} ${focus === i ? "focus" : ""} ${cautions[i].length ? "caution" : ""}`}
                    style={{ ["--mc" as string]: MODE_COLOR[l.mode] }}
                  >
                    <div className="sector-head" role="button" tabIndex={0} title="地図でこの区間を表示" onClick={() => showLeg(i)}>
                      <span className="sector-no">S{i + 1}</span>
                      <span>{label(i)} → {label(i + 1)}</span>
                      <span className="mode-tag">{MODE_ICON[l.mode]} {(l.mode === "FIXED" && stops[i]?.fixedName) || MODE_LABEL[l.mode]}</span>
                      {i === step && <span className="live">NOW</span>}
                      {i < step && <span className="live off">DONE</span>}
                    </div>
                    {l.ok ? (
                      <div className="sector-body">
                        <div className="sector-time">{formatDuration(l.durationSec)}</div>
                        <div className="sector-meta">
                          <span className="mono">{clock(schedule[i]?.depart)} → {clock(schedule[i + 1]?.arrive)}</span>
                          {l.mode !== "FIXED" && !l.manual && <span>{formatDistance(l.distanceMeters)}</span>}
                          {l.manual && <span>手入力</span>}
                          {l.transit && (
                            <span>
                              {formatClock(new Date(l.transit.departAt), startAt)}発 / 乗換{l.transit.transferCount}回
                              {l.transit.fareYen !== undefined && ` / ¥${l.transit.fareYen.toLocaleString()}`}
                              {l.transit.waitSec >= 60 && ` / 待ち${formatDuration(l.transit.waitSec)}`}
                            </span>
                          )}
                          {l.mode === "DRIVE" && fuel !== null && <span>⛽ 約{formatYen(fuelCost(l.distanceMeters, car)!)}</span>}
                          {l.tollYen !== undefined && <span>🛣 約{formatYen(l.tollYen)}</span>}
                          {l.tollUnknown && <span>🛣 有料道路あり(金額不明)</span>}
                          {l.mode !== "FIXED" && l.start && l.end && (
                            <a href={legUrl(l.start, l.end, l.mode)} target="_blank" rel="noreferrer">Googleマップ</a>
                          )}
                        </div>
                        {l.transit && (
                          <details className="transit-detail">
                            <summary>乗換の詳細</summary>
                            <ol>
                              {l.transit.segments.map((g, k) => (
                                <li key={k} className={g.kind}>
                                  <span className="mono">{formatClock(new Date(g.departAt), startAt)}–{formatClock(new Date(g.arriveAt), startAt)}</span>
                                  <b>{g.name}</b>
                                  <span>{g.from} → {g.to}</span>
                                </li>
                              ))}
                            </ol>
                            <p className="note">
                              時刻表に基づく検索結果(Transit API)。
                              {l.transit.fareIcYen !== undefined && `IC運賃 ¥${l.transit.fareIcYen.toLocaleString()}。`}
                              {stops[i].transitMin ? `手入力の${stops[i].transitMin}分は自動検索できなかったときに使います。` : ""}
                            </p>
                          </details>
                        )}
                      </div>
                    ) : (
                      <>
                        <div className="err">{l.error}</div>
                        {l.mode === "TRANSIT" && (
                          <div className="stop-opts">
                            <a className="mini-link" href={legUrlByName(stops[i].text, stops[i + 1]?.text ?? "", "TRANSIT")} target="_blank" rel="noreferrer">
                              Googleマップで乗換を調べる
                            </a>
                            <label className="mini">
                              所要
                              <input
                                type="number"
                                inputMode="numeric"
                                min={0}
                                aria-label={`${label(i)}→${label(i + 1)}の公共交通の所要(分)`}
                                value={stops[i].transitMin ?? ""}
                                onChange={(e) => update(i, { transitMin: Number(e.target.value) || undefined })}
                              />
                              分を入れて START
                            </label>
                          </div>
                        )}
                      </>
                    )}
                    {cautions[i].length > 0 && (
                      <ul className="cautions">
                        {cautions[i].map((c) => (
                          <li key={c}>⚠ {c}</li>
                        ))}
                      </ul>
                    )}
                    {i === step && (
                      <div className="step-actions">
                        {l.ok && l.mode !== "FIXED" && l.end && (
                          <a className="go" href={navigateFromHereUrl(l.end, l.mode)} target="_blank" rel="noreferrer">
                            {l.mode === "DRIVE" ? "車ナビ開始(CarPlay対応)" : `${MODE_LABEL[l.mode]}で${label(i + 1)}へ出発`}
                          </a>
                        )}
                        {apiKey && (
                          <button className="next" disabled={busy} onClick={rerouteFromHere} aria-label="現在地から再計算">
                            📍 現在地から再計算
                          </button>
                        )}
                        <button className="next" onClick={() => setStep(i + 1)}>
                          {i < legs.length - 1
                            ? l.mode === "DRIVE"
                              ? `${label(i + 1)}に到着・降車 → 次へ`
                              : `${label(i + 1)}に到着 → 次へ`
                            : "目的地に到着"}
                        </button>
                      </div>
                    )}
                  </li>
                </Fragment>
              ))}
            </ol>
            <p className="note">
              {legs.some((l) => l.ok && l.transit) && <>{TRANSIT_ATTRIBUTION}<br /></>}
              ※「Googleマップ」は端点と移動手段を渡すだけで、Googleマップ側が経路を再計算します。ここに表示した経路と完全に同じになる保証はありません。
              ナビ開始ボタンはiPhoneのGoogleマップアプリで現在地を出発地としてナビを始めます。車区間はiPhoneをCarPlayに接続していればCarPlayに表示されます。このアプリ自体はCarPlayには表示されません。
            </p>
          </section>
        )}
      </aside>

      <main className={`mapcol ${tab === "map" ? "show" : ""}`}>
        <MapView apiKey={apiKey} legs={legs} visible={tab === "map"} focus={focus} />
      </main>
    </div>
  );
}
