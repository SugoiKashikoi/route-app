import { Fragment, useEffect, useState } from "react";
import { MapView, MODE_COLOR } from "./MapView";
import { PlaceInput } from "./PlaceInput";
import { DateTimeField, TimeField } from "./TimeFields";
import { formatClock, formatDistance, formatDuration, toLocalInput } from "./lib/format";
import { legUrl, navigateFromHereUrl } from "./lib/mapsLinks";
import { searchAll, searchFrom } from "./lib/routes";
import { forwardSchedule, resolveClock, startForArrival, type StopRule, type StopTime } from "./lib/schedule";
import { decodeFavorite, encodeFavorite, loadFavorites, saveFavorites, toFavorite, type Favorite } from "./lib/favorites";
import { MODE_LABEL, type LegResult, type Mode, type Stop } from "./types";

const MAX_STOPS = 10;
const MIN_STOPS = 2;
const STORAGE_KEY = "multimodal-route:stops";
const API_KEY_STORAGE = "multimodal-route:apikey";
const MODES = Object.keys(MODE_LABEL) as Mode[];
const MODE_ICON: Record<Mode, string> = { DRIVE: "🚗", WALK: "🚶", BICYCLE: "🚲", TRANSIT: "🚆" };

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
    s("上野恩賜公園", "TRANSIT", 30),
    s("東京駅", "WALK"),
    s("皇居外苑", "WALK"),
  ];
}

const fromFavorite = (f: Favorite): Stop[] => f.stops.map((x) => ({ ...newStop(x.modeToNext), ...x }));

/** URLの #fav=… からお気に入りを取り込む(取り込んだらハッシュは消す) */
function importFromHash(): Favorite | null {
  const m = location.hash.match(/^#fav=(.+)$/);
  if (!m) return null;
  history.replaceState(null, "", location.pathname + location.search);
  return decodeFavorite(m[1]);
}

/** 余裕・遅れ・待ちの表示 */
function Badges({ t }: { t?: StopTime }) {
  if (!t) return null;
  return (
    <>
      {t.slackMin !== undefined &&
        (t.slackMin >= 0 ? (
          <span className="chip ok">余裕 {formatDuration(t.slackMin * 60)}</span>
        ) : (
          <span className="chip bad">遅れ {formatDuration(-t.slackMin * 60)}</span>
        ))}
      {t.waitMin > 0 && <span className="chip wait">待ち {formatDuration(t.waitMin * 60)}</span>}
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
    setStep(0);
  };

  // 共有リンクで開かれたら、お気に入りに追加して読み込む
  useEffect(() => {
    const f = importFromHash();
    if (!f) return;
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

  async function search() {
    setBusy(true);
    resetResult();
    setNotice("");
    const now = new Date();
    const target = timeMode === "now" ? undefined : new Date(timeValue);
    const valid = target && !Number.isNaN(target.getTime());
    // 地点ごとの "HH:MM" は、旅程の日付(指定時刻か現在)を基準に日時へ直す
    const base = valid ? target : now;
    const rules: StopRule[] = stops.map((s, i) => ({
      dwellMin: s.dwellMin ?? 0,
      departAt: i > 0 && i < stops.length - 1 ? resolveClock(s.departAt, base) : undefined,
      arriveBy: i > 0 ? resolveClock(s.arriveBy, base) : undefined,
    }));
    let res: LegResult[];
    let start = now;
    let msg = "";

    if (timeMode === "arrive" && valid) {
      rules[rules.length - 1].arriveBy = target;
      // 1回目: 所要時間の概算 → 出発時刻を逆算 → 2回目: その時刻の渋滞・時刻表で取り直す
      const rough = await searchAll(apiKey, stops);
      const est = startForArrival(durations(rough), rules, target);
      if (!est) {
        res = rough;
        msg = "取得できない区間があるため、到着時刻からの逆算はできませんでした。いま出発した場合の時刻です。";
      } else if (est < now) {
        res = rough;
        msg = "指定の到着時刻には間に合いません。いま出発した場合の時刻です。";
      } else {
        res = await searchFrom(apiKey, stops, est, rules);
        start = startForArrival(durations(res), rules, target) ?? est;
        msg = "到着時刻から逆算した目安です(到着指定は2回検索するため、リクエスト数は区間数×2)。";
      }
    } else if (timeMode === "depart" && valid && target.getTime() > now.getTime() + 60_000) {
      start = target;
      res = await searchFrom(apiKey, stops, start, rules);
    } else {
      if (timeMode === "depart") msg = "過去の時刻のため、いま出発として計算しました。";
      // 地点ごとの出発時刻があると次の区間の出発時刻が変わるので、順番に取得する
      res = rules.some((r) => r.departAt) ? await searchFrom(apiKey, stops, now, rules) : await searchAll(apiKey, stops);
    }

    setLegs(res);
    setSchedule(forwardSchedule(durations(res), rules, start));
    setNotice(msg);
    setBusy(false);
    setTab("list");
  }

  const okLegs = legs.filter((l): l is Extract<LegResult, { ok: true }> => l.ok);
  const failed = legs.length - okLegs.length;
  const totalSec = okLegs.reduce((a, l) => a + l.durationSec, 0);
  const totalM = okLegs.reduce((a, l) => a + l.distanceMeters, 0);
  const perMode = MODES.map((m) => {
    const ls = okLegs.filter((l) => l.mode === m);
    return { m, sec: ls.reduce((a, l) => a + l.durationSec, 0), meters: ls.reduce((a, l) => a + l.distanceMeters, 0) };
  }).filter((x) => x.sec > 0);
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
          <button className={`ghost ${drawer === "fav" ? "on" : ""}`} onClick={() => setDrawer(drawer === "fav" ? "" : "fav")}>
            ★<span className="lbl"> お気に入り</span><span className="count">{favs.length}</span>
          </button>
          <button className={`ghost ${drawer === "key" ? "on" : ""} ${apiKey ? "" : "alert"}`} onClick={() => setDrawer(drawer === "key" ? "" : "key")}>
            ⚙<span className="lbl"> {apiKey ? "APIキー" : "APIキー未設定"}</span>
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
          </h2>
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
                        onChange={(text, placeId) => update(i, { text, placeId })}
                      />
                      {!first && (
                        <div className="stop-opts">
                          {!last && (
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
                        </div>
                      )}
                      {showTime && (
                        <div className="stop-opts">
                          <label className="mini">
                            {label(i)}に
                            <TimeField optional value={s.arriveBy ?? ""} onChange={(v) => update(i, { arriveBy: v || undefined })} />
                            までに着く
                          </label>
                          {!last && (
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
                            className={s.modeToNext === m ? "on" : ""}
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
                </li>
              );
            })}
          </ol>
          <button className="add" onClick={add} disabled={stops.length >= MAX_STOPS}>＋ 経由地を追加</button>
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
                    <span className="by-mode-dist">{formatDistance(x.meters)}</span>
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
              <div className="hud-badges"><Badges t={schedule.at(-1)} /></div>
              {failed > 0 && <div className="warn">{failed}区間が取得できなかったため、合計は取得できた区間のみの値です。</div>}
              {notice && <div className="info">{notice}</div>}
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
                  {i > 0 && schedule[i] && (schedule[i].dwellMin > 0 || schedule[i].waitMin > 0 || schedule[i].slackMin !== undefined) && (
                    <li className="pit">
                      <span className="plate sm">{label(i)}</span>
                      <span className="mono">{clock(schedule[i].arrive)}〜{clock(schedule[i].depart)}</span>
                      {schedule[i].dwellMin > 0 && <span className="chip">滞在 {formatDuration(schedule[i].dwellMin * 60)}</span>}
                      <Badges t={schedule[i]} />
                    </li>
                  )}
                  <li
                    className={`sector ${i === step ? "current" : i < step ? "done" : ""} ${focus === i ? "focus" : ""}`}
                    style={{ ["--mc" as string]: MODE_COLOR[l.mode] }}
                  >
                    <div className="sector-head" role="button" tabIndex={0} title="地図でこの区間を表示" onClick={() => showLeg(i)}>
                      <span className="sector-no">S{i + 1}</span>
                      <span>{label(i)} → {label(i + 1)}</span>
                      <span className="mode-tag">{MODE_ICON[l.mode]} {MODE_LABEL[l.mode]}</span>
                      {i === step && <span className="live">NOW</span>}
                      {i < step && <span className="live off">DONE</span>}
                    </div>
                    {l.ok ? (
                      <div className="sector-body">
                        <div className="sector-time">{formatDuration(l.durationSec)}</div>
                        <div className="sector-meta">
                          <span className="mono">{clock(schedule[i]?.depart)} → {clock(schedule[i + 1]?.arrive)}</span>
                          <span>{formatDistance(l.distanceMeters)}</span>
                          <a href={legUrl(l.start, l.end, l.mode)} target="_blank" rel="noreferrer">Googleマップ</a>
                        </div>
                      </div>
                    ) : (
                      <div className="err">{l.error}</div>
                    )}
                    {i === step && (
                      <div className="step-actions">
                        {l.ok && (
                          <a className="go" href={navigateFromHereUrl(l.end, l.mode)} target="_blank" rel="noreferrer">
                            {l.mode === "DRIVE" ? "車ナビ開始(CarPlay対応)" : `${MODE_LABEL[l.mode]}で${label(i + 1)}へ出発`}
                          </a>
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
