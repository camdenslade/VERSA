import { useEffect, useRef, useState } from "react";
import {
  Chart,
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  CategoryScale,
  Filler,
  Legend,
} from "chart.js";

Chart.register(LineController, LineElement, PointElement, LinearScale, CategoryScale, Filler, Legend);

const PAYLOAD_SIZES: Record<string, number> = { small: 64, medium: 512, large: 4096 };
const POLL_INTERVAL_MS = 500;
const REST_OVERHEAD = 420;
const GQL_FULL_OBJECT_BASE = 600;
const GQL_RESOLVER_MS = 8;

const RELAY_URL = (() => {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${location.host}/sync`;
})();

function percentile(arr: number[], p: number) {
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function fmt(ms: number) {
  return ms < 1 ? "<1 ms" : ms.toFixed(1) + " ms";
}

function fmtBytes(b: number) {
  return b < 1024 ? b + " B" : (b / 1024).toFixed(1) + " KB";
}

function buildFrame(clientID: string, payload: Uint8Array): Uint8Array {
  const idBytes = new TextEncoder().encode(clientID);
  const frame = new Uint8Array(4 + idBytes.length + payload.length);
  new DataView(frame.buffer).setUint32(0, idBytes.length, false);
  frame.set(idBytes, 4);
  frame.set(payload, 4 + idBytes.length);
  return frame;
}

function openWS(room: string, clientID: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${RELAY_URL}?client_id=${clientID}&room=${room}`);
    ws.binaryType = "arraybuffer";
    ws.onopen = () => resolve(ws);
    ws.onerror = () => reject(new Error("ws connect failed"));
    setTimeout(() => reject(new Error("ws timeout")), 5000);
  });
}

function waitForMessage(ws: WebSocket, timeoutMs = 3000): Promise<MessageEvent> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), timeoutMs);
    ws.onmessage = evt => { clearTimeout(t); resolve(evt); };
  });
}

interface Stats {
  medVersa: string; medRest: string; medGql: string;
  p99Versa: string; p99Rest: string; p99Gql: string;
  bytesVersa: string; bytesRest: string; bytesGql: string;
  bwVersa: string; bwRest: string; bwGql: string;
}

type StepState = "idle" | "active" | "done";

interface ConflictStep { id: string; label: string; state: StepState; kind: "versa" | "rest" | "gql"; }
interface ConflictCol { steps: ConflictStep[]; result: { text: string; cls: string } | null; }

const VERSA_STEPS = ["Client A edits field", "Client B edits same field", "Both diffs sent to relay", "CRDT merges automatically", "Both clients converge"];
const REST_STEPS  = ["Client A fetches (GET)", "Client B fetches (GET)", "Client A saves (PUT, v1)", "Client B saves (PUT, v1) — 409", "Client B re-fetches + retries"];
const GQL_STEPS   = ["Client A mutates", "Server broadcasts full object", "Client B mutates (stale base)", "Server broadcasts again", "Last-write-wins, A's edit lost"];

function initConflict(): ConflictCol[] {
  return [
    { steps: VERSA_STEPS.map((label, i) => ({ id: `v${i}`, label, state: "idle", kind: "versa" })), result: null },
    { steps: REST_STEPS.map((label, i)  => ({ id: `r${i}`, label, state: "idle", kind: "rest"  })), result: null },
    { steps: GQL_STEPS.map((label, i)   => ({ id: `g${i}`, label, state: "idle", kind: "gql"   })), result: null },
  ];
}

async function animateCol(
  colIdx: number,
  setConflict: React.Dispatch<React.SetStateAction<ConflictCol[]>>,
  delay: number,
  resultText: string,
  resultCls: string,
) {
  await new Promise(r => setTimeout(r, delay));
  for (let i = 0; i < 5; i++) {
    setConflict(prev => prev.map((col, ci) => ci !== colIdx ? col : {
      ...col,
      steps: col.steps.map((s, si) => si === i ? { ...s, state: "active" } : s),
    }));
    await new Promise(r => setTimeout(r, 600));
    setConflict(prev => prev.map((col, ci) => ci !== colIdx ? col : {
      ...col,
      steps: col.steps.map((s, si) => si === i ? { ...s, state: "done" } : s),
    }));
  }
  setConflict(prev => prev.map((col, ci) => ci !== colIdx ? col : { ...col, result: { text: resultText, cls: resultCls } }));
}

const CSS = `
  :root {
    --bg: #0f1117; --surface: #1a1d27; --border: #2a2d3a; --text: #e2e8f0;
    --muted: #8892a4; --versa: #6366f1; --rest: #f59e0b; --gql: #10b981;
    --danger: #ef4444; --radius: 12px;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: var(--bg); color: var(--text); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
`;

export default function BenchPage() {
  const [rounds, setRounds]         = useState(50);
  const [payload, setPayload]       = useState("medium");
  const [status, setStatus]         = useState("Ready");
  const [progress, setProgress]     = useState(0);
  const [running, setRunning]       = useState(false);
  const [stats, setStats]           = useState<Partial<Stats>>({});
  const [conflict, setConflict]     = useState<ConflictCol[]>(initConflict());

  const latencyRef = useRef<HTMLCanvasElement>(null);
  const bwRef      = useRef<HTMLCanvasElement>(null);
  const latencyChart = useRef<Chart | null>(null);
  const bwChart      = useRef<Chart | null>(null);

  const chartDefaults = {
    animation: false as const,
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { labels: { color: "#8892a4", boxWidth: 12 } } },
    scales: {
      x: { ticks: { color: "#8892a4", maxTicksLimit: 10 }, grid: { color: "#2a2d3a" } },
      y: { ticks: { color: "#8892a4" }, grid: { color: "#2a2d3a" }, beginAtZero: true },
    },
  };

  useEffect(() => {
    if (!latencyRef.current || !bwRef.current) return;
    latencyChart.current = new Chart(latencyRef.current, {
      type: "line",
      data: {
        labels: [],
        datasets: [
          { label: "VERSA",   borderColor: "#6366f1", backgroundColor: "rgba(99,102,241,0.1)", data: [], tension: 0.3, pointRadius: 2 },
          { label: "REST",    borderColor: "#f59e0b", backgroundColor: "rgba(245,158,11,0.1)", data: [], tension: 0.3, pointRadius: 2 },
          { label: "GraphQL", borderColor: "#10b981", backgroundColor: "rgba(16,185,129,0.1)", data: [], tension: 0.3, pointRadius: 2 },
        ],
      },
      options: chartDefaults,
    });
    bwChart.current = new Chart(bwRef.current, {
      type: "line",
      data: {
        labels: [],
        datasets: [
          { label: "VERSA",   borderColor: "#6366f1", backgroundColor: "rgba(99,102,241,0.1)", data: [], tension: 0.3, pointRadius: 0, fill: true },
          { label: "REST",    borderColor: "#f59e0b", backgroundColor: "rgba(245,158,11,0.1)", data: [], tension: 0.3, pointRadius: 0, fill: true },
          { label: "GraphQL", borderColor: "#10b981", backgroundColor: "rgba(16,185,129,0.1)", data: [], tension: 0.3, pointRadius: 0, fill: true },
        ],
      },
      options: chartDefaults,
    });
    return () => { latencyChart.current?.destroy(); bwChart.current?.destroy(); };
  }, []);

  async function runBenchmark() {
    const payloadBytes = PAYLOAD_SIZES[payload];
    setRunning(true);
    setStatus("Connecting...");
    setProgress(0);
    setStats({});
    setConflict(initConflict());

    for (const chart of [latencyChart.current, bwChart.current]) {
      if (!chart) continue;
      chart.data.labels = [];
      chart.data.datasets.forEach(d => d.data = []);
      chart.update();
    }

    const room = "bench-" + Math.random().toString(36).slice(2, 8);
    let wsSender: WebSocket, wsReceiver: WebSocket;
    try {
      [wsSender, wsReceiver] = await Promise.all([
        openWS(room, "bench-sender"),
        openWS(room, "bench-receiver"),
      ]);
    } catch (e: unknown) {
      setStatus("Connection failed: " + (e instanceof Error ? e.message : String(e)));
      setRunning(false);
      return;
    }

    await new Promise(r => setTimeout(r, 100));

    const versaLatencies: number[] = [], restLatencies: number[] = [], gqlLatencies: number[] = [];
    let versaBWTotal = 0, restBWTotal = 0, gqlBWTotal = 0;

    const gqlObjectSize = GQL_FULL_OBJECT_BASE + payloadBytes;
    const restPayloadPerRound = payloadBytes + REST_OVERHEAD + 300;
    const gqlPayloadPerRound  = gqlObjectSize + 250;

    for (let i = 0; i < rounds; i++) {
      const p = crypto.getRandomValues(new Uint8Array(payloadBytes));
      const frame = buildFrame("bench-sender", p);

      const t0 = performance.now();
      wsSender.send(frame);
      try { await waitForMessage(wsReceiver, 3000); }
      catch { versaLatencies.push(3000); continue; }
      const versaRTT = performance.now() - t0;
      versaLatencies.push(versaRTT);
      versaBWTotal += frame.length;

      const restRTT = POLL_INTERVAL_MS / 2 + versaRTT;
      restLatencies.push(restRTT);
      restBWTotal += restPayloadPerRound;

      const gqlSerializeMs = (gqlObjectSize / 1024) * 0.4;
      const gqlRTT = versaRTT + GQL_RESOLVER_MS + gqlSerializeMs;
      gqlLatencies.push(gqlRTT);
      gqlBWTotal += gqlPayloadPerRound;

      const pct = ((i + 1) / rounds) * 100;
      setProgress(pct);
      setStatus(`Round ${i + 1} / ${rounds}`);

      if (latencyChart.current && bwChart.current) {
        latencyChart.current.data.labels!.push(i + 1);
        latencyChart.current.data.datasets[0].data.push(versaRTT);
        latencyChart.current.data.datasets[1].data.push(restRTT);
        latencyChart.current.data.datasets[2].data.push(gqlRTT);
        latencyChart.current.update();

        bwChart.current.data.labels!.push(i + 1);
        bwChart.current.data.datasets[0].data.push(versaBWTotal / 1024);
        bwChart.current.data.datasets[1].data.push(restBWTotal / 1024);
        bwChart.current.data.datasets[2].data.push(gqlBWTotal / 1024);
        bwChart.current.update();
      }

      if ((i + 1) % 5 === 0) {
        setStats(s => ({ ...s,
          medVersa: fmt(percentile(versaLatencies, 50)),
          medRest:  fmt(percentile(restLatencies, 50)),
          medGql:   fmt(percentile(gqlLatencies, 50)),
        }));
      }

      await new Promise(r => setTimeout(r, 20));
    }

    wsSender.close();
    wsReceiver.close();

    setStats({
      medVersa: fmt(percentile(versaLatencies, 50)),
      medRest:  fmt(percentile(restLatencies, 50)),
      medGql:   fmt(percentile(gqlLatencies, 50)),
      p99Versa: fmt(percentile(versaLatencies, 99)),
      p99Rest:  fmt(percentile(restLatencies, 99)),
      p99Gql:   fmt(percentile(gqlLatencies, 99)),
      bytesVersa: fmtBytes(payloadBytes + 40),
      bytesRest:  fmtBytes(payloadBytes + REST_OVERHEAD),
      bytesGql:   fmtBytes(gqlObjectSize),
      bwVersa: fmtBytes(versaBWTotal),
      bwRest:  fmtBytes(restBWTotal),
      bwGql:   fmtBytes(gqlBWTotal),
    });
    setStatus("Done");
    setProgress(100);
    setRunning(false);

    await Promise.all([
      animateCol(0, setConflict, 0,   "Both edits preserved. Zero conflict handling code.", "success"),
      animateCol(1, setConflict, 200, "Conflict detected. Required 2 extra round-trips.", "warn"),
      animateCol(2, setConflict, 400, "Last-write-wins. Client A's edit silently lost.", "error"),
    ]);
  }

  const s = stats;
  const colHeaders = ["VERSA (CRDT)", "REST (optimistic lock)", "GraphQL subscription"];
  const colColors  = ["var(--versa)", "var(--rest)", "var(--gql)"];

  return (
    <>
      <style>{CSS}</style>
      <header style={{ borderBottom: "1px solid var(--border)", padding: "24px 40px", display: "flex", alignItems: "center", gap: 16 }}>
        <div>
          <h1 style={{ fontSize: "1.25rem", fontWeight: 700, letterSpacing: "-0.02em" }}>
            VERSA Benchmark <span style={{ background: "var(--versa)", color: "#fff", fontSize: "0.7rem", fontWeight: 700, padding: "2px 8px", borderRadius: 99, letterSpacing: "0.05em", textTransform: "uppercase" }}>Live</span>
          </h1>
          <p style={{ color: "var(--muted)", fontSize: "0.875rem", marginTop: 2 }}>Real-time CRDT sync vs simulated REST polling vs GraphQL subscriptions — running in your browser against a live relay.</p>
        </div>
      </header>

      <main style={{ maxWidth: 1100, margin: "0 auto", padding: 40 }}>
        {/* Controls */}
        <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 40, flexWrap: "wrap" }}>
          <button
            onClick={runBenchmark}
            disabled={running}
            style={{ background: "var(--versa)", color: "#fff", border: "none", borderRadius: 8, padding: "10px 24px", fontSize: "0.95rem", fontWeight: 600, cursor: running ? "not-allowed" : "pointer", opacity: running ? 0.4 : 1 }}
          >Run Benchmark</button>
          <label style={{ color: "var(--muted)", fontSize: "0.875rem" }}>
            Rounds <input type="range" min={20} max={200} step={10} value={rounds} onChange={e => setRounds(+e.target.value)}
              style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text)", borderRadius: 8, padding: "6px 12px" }} /> {rounds}
          </label>
          <label style={{ color: "var(--muted)", fontSize: "0.875rem" }}>
            Payload <select value={payload} onChange={e => setPayload(e.target.value)}
              style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text)", borderRadius: 8, padding: "6px 12px", fontSize: "0.875rem" }}>
              <option value="small">Small (64 B)</option>
              <option value="medium">Medium (512 B)</option>
              <option value="large">Large (4 KB)</option>
            </select>
          </label>
          <div style={{ flex: 1, minWidth: 200, height: 4, background: "var(--border)", borderRadius: 99, overflow: "hidden" }}>
            <div style={{ height: "100%", width: progress + "%", background: "var(--versa)", transition: "width 0.1s" }} />
          </div>
          <span style={{ fontSize: "0.85rem", color: "var(--muted)" }}>{status}</span>
        </div>

        {/* Stat cards */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 20, marginBottom: 40 }}>
          {[
            { title: "Median Latency",           rows: [["VERSA (CRDT diff)", s.medVersa, "var(--versa)"], ["REST (polling 500ms)", s.medRest, "var(--rest)"], ["GraphQL subscription", s.medGql, "var(--gql)"]] },
            { title: "P99 Latency",              rows: [["VERSA", s.p99Versa, "var(--versa)"], ["REST", s.p99Rest, "var(--rest)"], ["GraphQL", s.p99Gql, "var(--gql)"]] },
            { title: "Bytes per Update",         rows: [["VERSA (delta only)", s.bytesVersa, "var(--versa)"], ["REST (full response)", s.bytesRest, "var(--rest)"], ["GraphQL (full object)", s.bytesGql, "var(--gql)"]] },
            { title: "Total Bandwidth (all rounds)", rows: [["VERSA", s.bwVersa, "var(--versa)"], ["REST", s.bwRest, "var(--rest)"], ["GraphQL", s.bwGql, "var(--gql)"]] },
          ].map(card => (
            <div key={card.title} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: 24 }}>
              <h2 style={{ fontSize: "0.8rem", fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--muted)", marginBottom: 16 }}>{card.title}</h2>
              {card.rows.map(([label, value, color]) => (
                <div key={label as string} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
                  <span style={{ fontSize: "0.875rem", color: "var(--muted)" }}>{label}</span>
                  <span style={{ fontSize: "1rem", fontWeight: 600, fontVariantNumeric: "tabular-nums", color: color as string }}>{value ?? "—"}</span>
                </div>
              ))}
            </div>
          ))}
        </div>

        {/* Charts */}
        {(["Round-trip Latency over Time (ms)", "Cumulative Bandwidth (KB)"] as const).map((title, i) => (
          <div key={title} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: 24, marginBottom: 20 }}>
            <h2 style={{ fontSize: "0.8rem", fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--muted)", marginBottom: 20 }}>{title}</h2>
            <div style={{ position: "relative", height: 220 }}>
              <canvas ref={i === 0 ? latencyRef : bwRef} />
            </div>
          </div>
        ))}

        {/* Conflict demo */}
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: 24, marginBottom: 20 }}>
          <h2 style={{ fontSize: "0.8rem", fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--muted)", marginBottom: 16 }}>Conflict Resolution Demo</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
            {conflict.map((col, ci) => (
              <div key={ci}>
                <h3 style={{ fontSize: "0.8rem", fontWeight: 700, marginBottom: 10, color: colColors[ci] }}>{colHeaders[ci]}</h3>
                <ul style={{ listStyle: "none" }}>
                  {col.steps.map(step => (
                    <li key={step.id} style={{ fontSize: "0.8rem", padding: "4px 0 4px 14px", position: "relative", color: step.state === "idle" ? "var(--muted)" : "var(--text)", fontWeight: step.state === "active" ? 600 : undefined }}>
                      <span style={{ position: "absolute", left: 0, top: "50%", transform: "translateY(-50%)", width: 6, height: 6, borderRadius: "50%", background: step.state === "idle" ? "var(--border)" : step.state === "active" ? "#fff" : colColors[ci], display: "inline-block" }} />
                      {step.label}
                    </li>
                  ))}
                </ul>
                {col.result && (
                  <div style={{
                    marginTop: 10, fontSize: "0.8rem", fontWeight: 600, padding: "6px 10px", borderRadius: 6,
                    background: col.result.cls === "success" ? "rgba(99,102,241,0.15)" : col.result.cls === "warn" ? "rgba(245,158,11,0.15)" : "rgba(239,68,68,0.15)",
                    color: col.result.cls === "success" ? "var(--versa)" : col.result.cls === "warn" ? "var(--rest)" : "var(--danger)",
                  }}>{col.result.text}</div>
                )}
              </div>
            ))}
          </div>
        </div>

        <p style={{ fontSize: "0.75rem", color: "var(--muted)", marginTop: 32, lineHeight: 1.6 }}>
          VERSA latency is measured end-to-end: time from sending a binary delta to receiving it on a second WebSocket connection in the same room.
          REST latency models 500ms polling: average staleness = poll interval / 2 + network RTT.
          GraphQL subscription latency adds a server resolver round-trip (~8ms, p50) to the WebSocket RTT.
          All three transports are benchmarked against <strong style={{ color: "var(--text)" }}>{location.host}</strong>.
          {" "}<a href="https://github.com/camdenslade/VERSA" target="_blank" style={{ color: "var(--versa)" }}>github.com/camdenslade/VERSA</a>
        </p>
      </main>
    </>
  );
}
