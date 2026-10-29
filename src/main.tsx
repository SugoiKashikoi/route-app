import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ViewPage } from "./ViewPage";
import { decodePlan } from "./lib/share";
import "./styles.css";

// #view=… は閲覧専用の予定表(編集画面や保存データには触れない)
const view = location.hash.match(/^#view=(.+)$/);
const plan = view ? decodePlan(view[1]) : null;

createRoot(document.getElementById("root")!).render(plan ? <ViewPage plan={plan} /> : <App />);
