import { useEffect, useRef, useState } from "react";
import type { LegResult, Mode } from "./types";

export const MODE_COLOR: Record<Mode, string> = {
  DRIVE: "#1a73e8",
  WALK: "#e8710a",
  BICYCLE: "#188038",
  TRANSIT: "#9334e6",
};

let loader: Promise<void> | undefined;

function loadMaps(key: string): Promise<void> {
  loader ??= new Promise((resolve, reject) => {
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
}

export function MapView({ apiKey, legs, visible }: Props) {
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
          center: { lat: 34.66, lng: 133.92 },
          zoom: 9,
          mapId: "DEMO_MAP_ID",
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
    const points = legs.flatMap((l) => (l.ok ? [l.start, l.end] : []));
    legs.forEach((l) => {
      if (!l.ok) return;
      const line = new google.maps.Polyline({
        path: l.path,
        strokeColor: MODE_COLOR[l.mode],
        strokeOpacity: l.mode === "WALK" ? 0 : 0.9,
        strokeWeight: 6,
        icons:
          l.mode === "WALK"
            ? [{ icon: { path: "M 0,-1 0,1", strokeOpacity: 1, scale: 3, strokeColor: MODE_COLOR.WALK }, offset: "0", repeat: "12px" }]
            : undefined,
        map: m,
      });
      overlays.current.push(line);
      l.path.forEach((p) => bounds.extend(p));
    });
    // 地点マーカー(A, B, C...)。区間の終点を使い、先頭だけ最初の区間の始点を使う
    const stopsPts = points.length ? [points[0], ...legs.flatMap((l) => (l.ok ? [l.end] : []))] : [];
    stopsPts.forEach((p, i) => {
      const pin = new google.maps.marker.PinElement({ glyph: String.fromCharCode(65 + i) });
      const marker = new google.maps.marker.AdvancedMarkerElement({ map: m, position: p, content: pin.element });
      overlays.current.push({ setMap: (x) => (marker.map = x) });
    });
    if (!bounds.isEmpty()) m.fitBounds(bounds, 48);
  }, [legs, status]);

  useEffect(() => {
    if (visible && map.current) google.maps.event.trigger(map.current, "resize");
  }, [visible]);

  return (
    <div className="map-wrap">
      <div ref={el} className="map" />
      {status !== "ready" && (
        <div className="map-msg">
          {status === "loading" && "地図を読み込み中…"}
          {status === "nokey" && "地図を表示するには、行程画面上部の「APIキー」を入力してください。"}
          {status === "error" && message}
        </div>
      )}
    </div>
  );
}
