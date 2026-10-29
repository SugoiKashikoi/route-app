import { useEffect, useRef, useState } from "react";
import type { LegResult, Mode } from "./types";
import { capMessage, take } from "./lib/quota";

export const MODE_COLOR: Record<Mode, string> = {
  DRIVE: "#1a73e8",
  WALK: "#e8710a",
  BICYCLE: "#188038",
  TRANSIT: "#9334e6",
  FIXED: "#00a6a6",
};

let loader: Promise<void> | undefined;

function loadMaps(key: string): Promise<void> {
  loader ??= new Promise((resolve, reject) => {
    // 地図の読み込み1回 = Dynamic Maps 1回
    if (!take("maps")) return reject(new Error(capMessage("maps")));
    // loading=async では onload の時点で importLibrary が未定義のことがあるため、callback で完了を待つ
    (window as unknown as { __mapsReady: () => void }).__mapsReady = () => resolve();
    const s = document.createElement("script");
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&loading=async&callback=__mapsReady&v=weekly&language=ja&region=JP`;
    s.async = true;
    s.onerror = () => reject(new Error("Maps JavaScript API を読み込めませんでした"));
    document.head.appendChild(s);
  });
  return loader;
}

interface Props {
  apiKey: string;
  legs: LegResult[];
  visible: boolean;
  /** 強調して表示する区間(null は全体) */
  focus: number | null;
}

export function MapView({ apiKey, legs, visible, focus }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<google.maps.Map>();
  const overlays = useRef<{ setMap(m: null): void }[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "nokey" | "error">("loading");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (map.current) return;
    if (!apiKey) return setStatus("nokey");
    setStatus("loading");
    (async () => {
      try {
        await loadMaps(apiKey);
        const { Map } = (await google.maps.importLibrary("maps")) as google.maps.MapsLibrary;
        await google.maps.importLibrary("marker");
        map.current = new Map(el.current!, {
          center: { lat: 35.68, lng: 139.76 },
          zoom: 11,
          mapId: "DEMO_MAP_ID",
          colorScheme: "LIGHT",
          mapTypeControl: false,
          streetViewControl: false,
        });
        setStatus("ready");
      } catch (e) {
        setMessage(String(e));
        setStatus("error");
      }
    })();
  }, [apiKey]);

  useEffect(() => {
    const m = map.current;
    if (status !== "ready" || !m) return;
    overlays.current.forEach((o) => o.setMap(null));
    overlays.current = [];
    const bounds = new google.maps.LatLngBounds();
    // 地点iの位置: 区間iの始点、なければ区間i-1の終点(失敗区間があっても記号がずれないように)
    const pos = Array.from({ length: legs.length + 1 }, (_, i) => {
      const a = legs[i];
      const b = legs[i - 1];
      return (a?.ok && a.start) || (b?.ok && b.end) || undefined;
    });
    const dim = (i: number) => focus !== null && focus !== i;
    legs.forEach((l, i) => {
      if (!l.ok) {
        // 経路が取れなかった区間は、両端が分かれば灰色の点線(直線)でつなぐ。実際の経路ではない
        const [p, q] = [pos[i], pos[i + 1]];
        if (!p || !q) return;
        const line = new google.maps.Polyline({
          path: [p, q],
          strokeOpacity: 0,
          icons: [{ icon: { path: "M 0,-1 0,1", strokeOpacity: dim(i) ? 0.25 : 0.8, scale: 2, strokeColor: "#8a98b0" }, offset: "0", repeat: "10px" }],
          map: m,
        });
        overlays.current.push(line);
        bounds.extend(p);
        bounds.extend(q);
        return;
      }
      // 新幹線・飛行機は経路が分からないので、両端を結ぶ破線(大圏)で示す
      const dashed = l.mode === "WALK" || l.mode === "FIXED";
      const line = new google.maps.Polyline({
        path: l.path,
        geodesic: l.mode === "FIXED",
        strokeColor: MODE_COLOR[l.mode],
        strokeOpacity: dashed ? 0 : dim(i) ? 0.25 : 0.9,
        strokeWeight: focus === i ? 8 : 6,
        zIndex: focus === i ? 10 : 1,
        icons:
          dashed
            ? [{ icon: { path: "M 0,-1 0,1", strokeOpacity: dim(i) ? 0.3 : 1, scale: 3, strokeColor: MODE_COLOR[l.mode] }, offset: "0", repeat: l.mode === "FIXED" ? "18px" : "12px" }]
            : undefined,
        map: m,
      });
      overlays.current.push(line);
      if (focus === null || focus === i) l.path.forEach((p) => bounds.extend(p));
    });
    pos.forEach((p, i) => {
      if (!p) return;
      if (focus !== null && (focus === i || focus + 1 === i)) bounds.extend(p);
      const pin = new google.maps.marker.PinElement({
        glyph: String.fromCharCode(65 + i),
        background: "#ff8a1f",
        borderColor: "#ffffff",
        glyphColor: "#ffffff",
      });
      const marker = new google.maps.marker.AdvancedMarkerElement({ map: m, position: p, content: pin.element });
      overlays.current.push({ setMap: (x) => (marker.map = x) });
    });
    if (!bounds.isEmpty()) m.fitBounds(bounds, 60);
  }, [legs, status, focus]);

  useEffect(() => {
    if (visible && map.current) google.maps.event.trigger(map.current, "resize");
  }, [visible]);

  return (
    <div className="map-wrap">
      <div ref={el} className="map" />
      {status !== "ready" && (
        <div className="map-msg">
          {status === "loading" && "地図を読み込み中…"}
          {status === "nokey" && "地図を表示するには、右上の「⚙ APIキー」でキーを入力してください。"}
          {status === "error" && message}
        </div>
      )}
    </div>
  );
}
