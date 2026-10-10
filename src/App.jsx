import React, { useCallback, useEffect, useMemo, useState } from "react";

const API_BASE = (import.meta.env.VITE_API_BASE_URL || "https://sentinelflow-backend-4337.onrender.com").replace(/\/+$/, "");
const REFRESH_MS = 15000;

const sensorConfig = [
  { key: "pressure", label: "Pressure", unit: "bar", icon: "◉", normal: "2.5–5.0" },
  { key: "flow_rate", label: "Flow rate", unit: "L/min", icon: "≈", normal: "80–140" },
  { key: "temperature", label: "Temperature", unit: "°C", icon: "♨", normal: "19–25" },
  { key: "vibration", label: "Pump vibration", unit: "mm/s", icon: "⌁", normal: "≤ 1.8" },
  { key: "current", label: "Pump current", unit: "A", icon: "ϟ", normal: "≤ 10" },
  { key: "ph", label: "Water pH", unit: "pH", icon: "◌", normal: "6.5–8.0" },
  { key: "tank_level", label: "Tank level", unit: "%", icon: "▤", normal: "20–90" }
];

function toReading(row, index) {
  // The current backend returns SQLite rows as arrays from SELECT *.
  if (Array.isArray(row)) {
    return {
      id: row[0] ?? `row-${index}`,
      timestamp: row[1] ?? "",
      pressure: Number(row[2]),
      flow_rate: Number(row[3]),
      temperature: Number(row[4]),
      vibration: Number(row[5]),
      current: Number(row[6]),
      ph: Number(row[7]),
      tank_level: Number(row[8]),
      status: row[9] || "UNKNOWN",
      anomaly: Boolean(row[10]),
      anomaly_message: row[11] || ""
    };
  }
  // Also tolerate a future backend response that uses objects.
  return {
    id: row.id ?? row.reading_id ?? `row-${index}`,
    timestamp: row.timestamp ?? "",
    pressure: Number(row.pressure),
    flow_rate: Number(row.flow_rate),
    temperature: Number(row.temperature),
    vibration: Number(row.vibration),
    current: Number(row.current),
    ph: Number(row.ph ?? row.pH),
    tank_level: Number(row.tank_level),
    status: row.status || "UNKNOWN",
    anomaly: Boolean(row.anomaly),
    anomaly_message: row.anomaly_message || (Array.isArray(row.anomalies) ? row.anomalies.join(" · ") : "")
  };
}

function prettyTime(value) {
  if (!value) return "Time unavailable";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}
function statusClass(status) {
  const s = String(status || "").toUpperCase();
  if (s === "NORMAL") return "normal";
  if (s === "WARNING") return "warning";
  if (s === "CRITICAL") return "critical";
  return "unknown";
}
function StatCard({ label, value, sub, icon, tone = "" }) {
  return <article className="stat-card">
    <div className={`stat-icon ${tone}`}>{icon}</div>
    <div className="stat-copy"><span>{label}</span><strong>{value}</strong><small>{sub}</small></div>
  </article>;
}
function EmptyState({ title, text }) {
  return <div className="empty-state"><div className="empty-icon">⌁</div><strong>{title}</strong><p>{text}</p></div>;
}

export default function App() {
  const [activePage, setActivePage] = useState("Overview");
  const [readings, setReadings] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [health, setHealth] = useState("checking");
  const [lastUpdated, setLastUpdated] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

  const refresh = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true);
    try {
      // Health, readings and alerts are separate so one endpoint failure doesn't hide the others.
      const healthPromise = fetch(`${API_BASE}/health`, { method: "GET" });
      const readingsPromise = fetch(`${API_BASE}/api/v1/scada/readings`, { method: "GET" });
      const alertsPromise = fetch(`${API_BASE}/api/v1/scada/alerts`, { method: "GET" });
      const [healthResult, readingsResult, alertsResult] = await Promise.allSettled([
        healthPromise, readingsPromise, alertsPromise
      ]);

      let healthOk = false;
      if (healthResult.status === "fulfilled" && healthResult.value.ok) {
        const body = await healthResult.value.json();
        healthOk = body?.status === "healthy" || body?.status === "running";
      }
      setHealth(healthOk ? "online" : "offline");

      let nextReadings = null;
      if (readingsResult.status === "fulfilled" && readingsResult.value.ok) {
        const body = await readingsResult.value.json();
        const rows = Array.isArray(body) ? body : (body.readings || body.data || []);
        nextReadings = rows.map(toReading).sort((a, b) => Number(b.id) - Number(a.id));
        setReadings(nextReadings);
      }

      if (alertsResult.status === "fulfilled" && alertsResult.value.ok) {
        const body = await alertsResult.value.json();
        const rows = Array.isArray(body) ? body : (body.alerts || body.data || []);
        setAlerts(rows.map(toReading).sort((a, b) => Number(b.id) - Number(a.id)));
      }

      const failures = [];
      if (!healthOk) failures.push("health check");
      if (readingsResult.status === "rejected" || (readingsResult.status === "fulfilled" && !readingsResult.value.ok)) failures.push("readings");
      if (alertsResult.status === "rejected" || (alertsResult.status === "fulfilled" && !alertsResult.value.ok)) failures.push("alerts");

      if (failures.length === 3) {
        setError("The backend could not be reached. It may be waking up, or the API may be temporarily unavailable.");
      } else if (failures.length) {
        setError(`Some data could not be loaded (${failures.join(", ")}). Other available data is still shown.`);
      } else {
        setError("");
      }
      setLastUpdated(new Date());
    } catch {
      setHealth("offline");
      setError("Could not connect to the backend. Check your internet connection and try again.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const timer = setInterval(() => refresh(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  const latest = readings[0] || null;
  const normalCount = readings.filter(r => String(r.status).toUpperCase() === "NORMAL").length;
  const warningCount = readings.filter(r => String(r.status).toUpperCase() === "WARNING").length;
  const criticalCount = readings.filter(r => String(r.status).toUpperCase() === "CRITICAL").length;
  const shownReadings = useMemo(() => readings.filter(r => {
    const term = search.toLowerCase().trim();
    return !term || [r.id, r.timestamp, r.status, r.anomaly_message, ...sensorConfig.map(s => r[s.key])]
      .some(value => String(value ?? "").toLowerCase().includes(term));
  }), [readings, search]);

  const navItems = [
    { name: "Overview", icon: "▦" },
    { name: "SCADA Monitoring", icon: "⌁" },
    { name: "Anomaly Detection", icon: "⚠" },
    { name: "Alerts & History", icon: "◷" }
  ];

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark"><span>SF</span><i /></div>
        <div><strong>SentinelFlow</strong><small>INDUSTRIAL INTELLIGENCE</small></div>
      </div>
      <div className="nav-label">WORKSPACE</div>
      <nav>
        {navItems.map(item => <button key={item.name} className={`nav-item ${activePage === item.name ? "active" : ""}`} onClick={() => setActivePage(item.name)}>
          <span className="nav-icon">{item.icon}</span>{item.name}
          {item.name === "Alerts & History" && alerts.length > 0 && <b className="nav-count">{alerts.length}</b>}
        </button>)}
      </nav>
      <div className="sidebar-bottom">
        <div className={`connection-card ${health}`}>
          <span className="pulse-dot" />
          <div><strong>{health === "online" ? "Backend connected" : health === "checking" ? "Connecting..." : "Backend unavailable"}</strong><small>{health === "online" ? "API responding" : "Render service"}</small></div>
        </div>
        <div className="sidebar-foot"><span className="mini-shield">⬡</span> SCADA SECURITY MONITOR</div>
      </div>
    </aside>

    <main className="main-area">
      <header className="topbar">
        <div className="breadcrumb"><span>SentinelFlow</span><span className="crumb-slash">/</span><strong>{activePage}</strong></div>
        <div className="top-actions">
          <div className={`api-pill ${health}`}><span className="pulse-dot" />{health === "online" ? "API Online" : health === "checking" ? "Connecting" : "API Offline"}</div>
          <button className="refresh-button" onClick={() => refresh(true)} disabled={refreshing} title="Refresh data"><span className={refreshing ? "spin" : ""}>↻</span><span>{refreshing ? "Refreshing" : "Refresh"}</span></button>
        </div>
      </header>

      <div className="page-content">
        <section className="welcome-row">
          <div>
            <div className="eyebrow"><span className="eyebrow-line" /> WATER TREATMENT · SCADA OPERATIONS</div>
            <h1>{activePage === "Overview" ? "System overview" : activePage}</h1>
            <p className="subtitle">Monitor telemetry, identify abnormal patterns, and review SCADA events.</p>
          </div>
          <div className="updated-label"><span className="live-dot" /> AUTO-REFRESH · 15 SEC <small>{lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString()}` : "Waiting for data"}</small></div>
        </section>

        {error && <div className="notice"><span>ⓘ</span><div><strong>Connection notice</strong><p>{error}</p></div><button onClick={() => setError("")} aria-label="Dismiss notice">×</button></div>}

        {activePage === "Overview" && <>
          <section className="stat-grid">
            <StatCard label="Total readings" value={readings.length} sub="Latest records from API" icon="▤" />
            <StatCard label="Normal readings" value={normalCount} sub="Within expected thresholds" icon="✓" tone="green" />
            <StatCard label="Warnings" value={warningCount} sub="Needs operator attention" icon="!" tone="amber" />
            <StatCard label="Critical events" value={criticalCount} sub="Multiple anomalies detected" icon="⚠" tone="red" />
          </section>
          <section className="content-grid">
            <article className="panel latest-panel">
              <div className="panel-heading"><div><span className="section-kicker">LIVE TELEMETRY</span><h2>Latest SCADA reading</h2></div><span className="panel-tag">LATEST</span></div>
              {latest ? <>
                <div className="latest-status"><div><span className="field-label">CURRENT SYSTEM STATUS</span><div className="status-line"><span className={`status-dot ${statusClass(latest.status)}`} /><strong>{latest.status}</strong></div></div><span className="reading-time">{prettyTime(latest.timestamp)}</span></div>
                <div className="sensor-grid">
                  {sensorConfig.map(sensor => <div className="sensor-tile" key={sensor.key}>
                    <div className="sensor-top"><span>{sensor.label}</span><span className="sensor-icon">{sensor.icon}</span></div>
                    <div className="sensor-value">{Number.isFinite(latest[sensor.key]) ? latest[sensor.key].toLocaleString(undefined, { maximumFractionDigits: 2 }) : "—"}<small>{sensor.unit}</small></div>
                    <div className="sensor-range">Reference: {sensor.normal}</div>
                  </div>)}
                </div>
              </> : <EmptyState title={loading ? "Loading telemetry…" : "No readings yet"} text={loading ? "Connecting to the SentinelFlow API." : "Once UiPath sends SCADA data, the latest readings will appear here."} />}
            </article>
            <article className="panel events-panel">
              <div className="panel-heading"><div><span className="section-kicker">EVENT STREAM</span><h2>Recent anomalies</h2></div><span className="event-total">{alerts.length} EVENTS</span></div>
              {alerts.length ? <div className="event-list">{alerts.slice(0, 6).map((event, i) => <div className="event-row" key={`${event.id}-${i}`}>
                <span className={`event-symbol ${statusClass(event.status)}`}>!</span><div className="event-main"><div className="event-title">{event.anomaly_message || "Abnormal SCADA reading detected"}</div><div className="event-meta">Reading #{event.id} · {prettyTime(event.timestamp)}</div></div><span className={`badge ${statusClass(event.status)}`}>{event.status}</span>
              </div>)}</div> : <EmptyState title="No anomaly events" text="Detected anomalies will appear here when readings are stored by the backend." />}
            </article>
          </section>
          <section className="panel table-panel">
            <div className="panel-heading"><div><span className="section-kicker">DATA LOG</span><h2>Recent readings</h2></div><button className="text-button" onClick={() => setActivePage("SCADA Monitoring")}>View all readings <span>→</span></button></div>
            <ReadingsTable rows={readings.slice(0, 5)} loading={loading} />
          </section>
        </>}

        {activePage === "SCADA Monitoring" && <section className="panel table-panel full-panel">
          <div className="panel-heading"><div><span className="section-kicker">SENSOR TELEMETRY</span><h2>SCADA readings</h2><p className="panel-description">Most recent readings received by the backend.</p></div><span className="panel-tag">{readings.length} LOADED</span></div>
          <div className="table-toolbar"><label className="search-box"><span>⌕</span><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search readings, status, values..." /></label><span className="muted-label">Auto-refreshes every 15 seconds</span></div>
          <ReadingsTable rows={shownReadings} loading={loading} />
        </section>}

        {activePage === "Anomaly Detection" && <section className="panel full-panel">
          <div className="panel-heading"><div><span className="section-kicker">DETECTION RESULTS</span><h2>Anomaly analysis</h2><p className="panel-description">Results produced by the current backend detection logic.</p></div><span className="panel-tag">{alerts.length} FLAGGED</span></div>
          {alerts.length ? <div className="analysis-list">{alerts.map((event, i) => <article className="analysis-card" key={`${event.id}-${i}`}>
            <div className={`analysis-icon ${statusClass(event.status)}`}>⚠</div><div className="analysis-content"><div className="analysis-title-row"><strong>Reading #{event.id}</strong><span className={`badge ${statusClass(event.status)}`}>{event.status}</span></div><p>{event.anomaly_message || "Anomaly flag recorded by backend."}</p><small>{prettyTime(event.timestamp)}</small></div>
            <div className="analysis-metrics">{sensorConfig.filter(s => Number.isFinite(event[s.key])).slice(0, 3).map(s => <span key={s.key}>{s.label}: <b>{event[s.key]}</b></span>)}</div>
          </article>)}</div> : <EmptyState title="No anomalies recorded" text="The backend has not returned any flagged readings yet. Send a test reading through /docs or UiPath." />}
          <div className="info-footnote"><span>ⓘ</span><p>This page displays backend results; it does not independently claim to run a machine-learning model in the browser.</p></div>
        </section>}

        {activePage === "Alerts & History" && <section className="panel full-panel">
          <div className="panel-heading"><div><span className="section-kicker">INCIDENT LOG</span><h2>Alerts & history</h2><p className="panel-description">Anomaly records returned by the SentinelFlow API.</p></div><span className="panel-tag">{alerts.length} ALERTS</span></div>
          {alerts.length ? <div className="history-list">{alerts.map((event, i) => <div className="history-row" key={`${event.id}-${i}`}><div className={`history-marker ${statusClass(event.status)}`} /><div className="history-body"><div className="history-title">{event.anomaly_message || "Abnormal SCADA reading detected"}</div><div className="history-meta">Reading #{event.id} · {prettyTime(event.timestamp)}</div></div><span className={`badge ${statusClass(event.status)}`}>{event.status}</span></div>)}</div> : <EmptyState title="Your incident log is clear" text={loading ? "Loading alert history…" : "No alert records are currently available from the backend."} />}
        </section>}

        <footer className="footer"><span>© {new Date().getFullYear()} SentinelFlow</span><span><i className="footer-dot" /> SCADA monitoring interface</span><span>API: {new URL(API_BASE).host}</span></footer>
      </div>
    </main>
  </div>;
}

function ReadingsTable({ rows, loading }) {
  if (!rows.length) return <EmptyState title={loading ? "Loading readings…" : "No readings to display"} text={loading ? "Waiting for the API response." : "Send a SCADA reading through UiPath or test the endpoint in Swagger."} />;
  return <div className="table-wrap"><table><thead><tr><th>ID / TIMESTAMP</th><th>PRESSURE</th><th>FLOW RATE</th><th>TEMP.</th><th>VIBRATION</th><th>CURRENT</th><th>pH</th><th>TANK</th><th>STATUS</th></tr></thead><tbody>
    {rows.map((r, i) => <tr key={`${r.id}-${i}`}><td><strong>#{r.id}</strong><small>{prettyTime(r.timestamp)}</small></td><td>{Number.isFinite(r.pressure) ? r.pressure : "—"} <small>bar</small></td><td>{Number.isFinite(r.flow_rate) ? r.flow_rate : "—"} <small>L/min</small></td><td>{Number.isFinite(r.temperature) ? r.temperature : "—"} <small>°C</small></td><td>{Number.isFinite(r.vibration) ? r.vibration : "—"} <small>mm/s</small></td><td>{Number.isFinite(r.current) ? r.current : "—"} <small>A</small></td><td>{Number.isFinite(r.ph) ? r.ph : "—"}</td><td>{Number.isFinite(r.tank_level) ? r.tank_level : "—"} <small>%</small></td><td><span className={`badge ${statusClass(r.status)}`}><i />{r.status}</span></td></tr>)}
  </tbody></table></div>;
}