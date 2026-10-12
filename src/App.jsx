import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

const API_BASE = (import.meta.env.VITE_API_BASE_URL || "https://sentinelflow-backend-4337.onrender.com").replace(/\/+$/, "");
const REFRESH_MS = 15000;

const sensorConfig = [
  { key: "pressure", label: "Pressure", unit: "bar", icon: "◉", normal: "2.5–5.0", step: "0.1", min: 0 },
  { key: "flow_rate", label: "Flow rate", unit: "L/min", icon: "≈", normal: "80–140", step: "1", min: 0 },
  { key: "temperature", label: "Temperature", unit: "°C", icon: "♨", normal: "19–25", step: "0.1", min: -50 },
  { key: "vibration", label: "Pump vibration", unit: "mm/s", icon: "⌁", normal: "≤ 1.8", step: "0.01", min: 0 },
  { key: "current", label: "Pump current", unit: "A", icon: "ϟ", normal: "≤ 10", step: "0.1", min: 0 },
  { key: "ph", label: "Water pH", unit: "pH", icon: "◌", normal: "6.5–8.0", step: "0.01", min: 0, max: 14 },
  { key: "tank_level", label: "Tank level", unit: "%", icon: "▤", normal: "20–90", step: "1", min: 0, max: 100 }
];

function toReading(row, index) {
  if (Array.isArray(row)) {
    return {
      id: row[0] ?? `row-${index}`,
      timestamp: row[1] ?? "",
      pressure: Number(row[2] ?? 0),
      flow_rate: Number(row[3] ?? 0),
      temperature: Number(row[4] ?? 0),
      vibration: Number(row[5] ?? 0),
      current: Number(row[6] ?? 0),
      ph: Number(row[7] ?? 7),
      tank_level: Number(row[8] ?? 0),
      status: row[9] || "UNKNOWN",
      anomaly: Boolean(row[10]),
      anomaly_message: row[11] || ""
    };
  }
  return {
    id: row.id ?? row.reading_id ?? `row-${index}`,
    timestamp: row.timestamp ?? "",
    pressure: Number(row.pressure ?? 0),
    flow_rate: Number(row.flow_rate ?? 0),
    temperature: Number(row.temperature ?? 0),
    vibration: Number(row.vibration ?? 0),
    current: Number(row.current ?? 0),
    ph: Number(row.ph ?? row.pH ?? 7),
    tank_level: Number(row.tank_level ?? 0),
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
  return (
    <article className="stat-card">
      <div className={`stat-icon ${tone}`}>{icon}</div>
      <div className="stat-copy">
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{sub}</small>
      </div>
    </article>
  );
}

function EmptyState({ title, text }) {
  return (
    <div className="empty-state">
      <div className="empty-icon">⌁</div>
      <strong>{title}</strong>
      <p>{text}</p>
    </div>
  );
}

export default function App() {
  const [activePage, setActivePage] = useState("Overview");
  const [readings, setReadings] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [emailAlerts, setEmailAlerts] = useState([]);
  const [health, setHealth] = useState("checking");
  const [lastUpdated, setLastUpdated] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

  // Email Configuration State
  const [recipientEmail, setRecipientEmail] = useState("");
  const [emailConfigStatus, setEmailConfigStatus] = useState("");
  const [emailTesting, setEmailTesting] = useState(false);
  const [emailTestMsg, setEmailTestMsg] = useState("");

  // Manual Ingestion Form State
  const [manualForm, setManualForm] = useState({
    pressure: "3.5",
    flow_rate: "110",
    temperature: "21.5",
    vibration: "0.5",
    current: "5.0",
    ph: "7.2",
    tank_level: "55"
  });
  const [manualLoading, setManualLoading] = useState(false);
  const [manualResult, setManualResult] = useState(null);
  const [manualError, setManualError] = useState("");

  // Bulk Upload State
  const [selectedFile, setSelectedFile] = useState(null);
  const [uploadLoading, setUploadLoading] = useState(false);
  const [uploadResult, setUploadResult] = useState(null);
  const [uploadError, setUploadError] = useState("");
  const fileInputRef = useRef(null);

  const fetchEmailData = useCallback(async () => {
    try {
      const [cfgRes, alertsRes] = await Promise.allSettled([
        fetch(`${API_BASE}/api/v1/scada/email-config`),
        fetch(`${API_BASE}/api/v1/scada/email-alerts`)
      ]);
      if (cfgRes.status === "fulfilled" && cfgRes.value.ok) {
        const cfg = await cfgRes.value.json();
        if (cfg.recipient) setRecipientEmail(cfg.recipient);
      }
      if (alertsRes.status === "fulfilled" && alertsRes.value.ok) {
        const log = await alertsRes.value.json();
        setEmailAlerts(log.alerts || []);
      }
    } catch {
      // Non-critical, ignore
    }
  }, []);

  const refresh = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true);
    try {
      const healthPromise = fetch(`${API_BASE}/health`, { method: "GET" });
      const readingsPromise = fetch(`${API_BASE}/api/v1/scada/readings`, { method: "GET" });
      const alertsPromise = fetch(`${API_BASE}/api/v1/scada/alerts`, { method: "GET" });

      const [healthResult, readingsResult, alertsResult] = await Promise.allSettled([
        healthPromise,
        readingsPromise,
        alertsPromise
      ]);

      let healthOk = false;
      if (healthResult.status === "fulfilled" && healthResult.value.ok) {
        const body = await healthResult.value.json();
        healthOk = body?.status === "healthy" || body?.status === "running";
      }
      setHealth(healthOk ? "online" : "offline");

      if (readingsResult.status === "fulfilled" && readingsResult.value.ok) {
        const body = await readingsResult.value.json();
        const rows = Array.isArray(body) ? body : (body.readings || body.data || []);
        setReadings(rows.map(toReading).sort((a, b) => Number(b.id) - Number(a.id)));
      }

      if (alertsResult.status === "fulfilled" && alertsResult.value.ok) {
        const body = await alertsResult.value.json();
        const rows = Array.isArray(body) ? body : (body.alerts || body.data || []);
        setAlerts(rows.map(toReading).sort((a, b) => Number(b.id) - Number(a.id)));
      }

      await fetchEmailData();

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
      setError("Could not connect to the backend server. Check your connection.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [fetchEmailData]);

  useEffect(() => {
    refresh();
    const timer = setInterval(() => refresh(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  // Handle Manual Ingestion Submission
  const handleManualSubmit = async (e) => {
    e.preventDefault();
    setManualError("");
    setManualResult(null);

    for (const sensor of sensorConfig) {
      const val = manualForm[sensor.key];
      if (val === "" || val === null || isNaN(Number(val))) {
        setManualError(`Please enter a valid numeric value for ${sensor.label}.`);
        return;
      }
    }

    setManualLoading(true);
    const formData = new FormData();
    Object.keys(manualForm).forEach((k) => formData.append(k, manualForm[k]));

    try {
      const res = await fetch(`${API_BASE}/api/v1/scada/ingest`, {
        method: "POST",
        body: formData
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setManualResult(data);
        refresh();
      } else {
        const errDetail = data?.detail;
        const msg = typeof errDetail === "string" ? errDetail : data?.message || "Ingestion failed.";
        setManualError(msg);
      }
    } catch {
      setManualError("Failed to communicate with ingestion endpoint. Check backend status.");
    } finally {
      setManualLoading(false);
    }
  };

  const loadPreset = (type) => {
    setManualResult(null);
    setManualError("");
    if (type === "NORMAL") {
      setManualForm({
        pressure: "3.5", flow_rate: "110", temperature: "21.5", vibration: "0.5", current: "5.0", ph: "7.2", tank_level: "55"
      });
    } else if (type === "WARNING_PRESSURE") {
      setManualForm({
        pressure: "5.8", flow_rate: "110", temperature: "21.5", vibration: "0.5", current: "5.0", ph: "7.2", tank_level: "55"
      });
    } else if (type === "CRITICAL_PUMP") {
      setManualForm({
        pressure: "3.2", flow_rate: "118", temperature: "21.9", vibration: "2.4", current: "11.2", ph: "7.1", tank_level: "65"
      });
    }
  };

  // Handle File Upload Submission
  const handleFileUpload = async (e) => {
    e.preventDefault();
    if (!selectedFile) {
      setUploadError("Please select a .csv or .xlsx file to upload.");
      return;
    }
    setUploadError("");
    setUploadResult(null);
    setUploadLoading(true);

    const formData = new FormData();
    formData.append("file", selectedFile);

    try {
      const res = await fetch(`${API_BASE}/api/v1/scada/upload`, {
        method: "POST",
        body: formData
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setUploadResult(data);
        refresh();
      } else {
        const detail = data?.detail;
        let msg = "Upload failed.";
        if (typeof detail === "string") {
          msg = detail;
        } else if (detail?.message) {
          msg = detail.message;
        }
        setUploadError(msg);
      }
    } catch {
      setUploadError("Network error occurred during file upload. Backend might be unreachable.");
    } finally {
      setUploadLoading(false);
    }
  };

  // Save Recipient Email
  const handleSaveEmailConfig = async (e) => {
    e.preventDefault();
    setEmailConfigStatus("Saving...");
    const formData = new FormData();
    formData.append("recipient", recipientEmail);
    try {
      const res = await fetch(`${API_BASE}/api/v1/scada/email-config`, {
        method: "POST",
        body: formData
      });
      const data = await res.json();
      if (res.ok) {
        setEmailConfigStatus(`✓ ${data.message}`);
        setTimeout(() => setEmailConfigStatus(""), 4000);
      } else {
        setEmailConfigStatus(`Error: ${data.detail || "Could not update email"}`);
      }
    } catch {
      setEmailConfigStatus("Connection failed.");
    }
  };

  // Trigger Test Email
  const handleSendTestEmail = async () => {
    setEmailTesting(true);
    setEmailTestMsg("Dispatched test notification...");
    const formData = new FormData();
    if (recipientEmail) formData.append("recipient", recipientEmail);
    try {
      const res = await fetch(`${API_BASE}/api/v1/scada/email-alerts/test`, {
        method: "POST",
        body: formData
      });
      const data = await res.json();
      if (res.ok && data.success) {
        const st = data.result?.status;
        setEmailTestMsg(`✓ Alert test created (${st}): Sent to ${data.result?.recipient}`);
        refresh();
      } else {
        setEmailTestMsg(`Test dispatch failed: ${data.detail || "Server error"}`);
      }
    } catch {
      setEmailTestMsg("Error connecting to test email endpoint.");
    } finally {
      setEmailTesting(false);
    }
  };

  const latest = readings[0] || null;
  const normalCount = readings.filter((r) => String(r.status).toUpperCase() === "NORMAL").length;
  const warningCount = readings.filter((r) => String(r.status).toUpperCase() === "WARNING").length;
  const criticalCount = readings.filter((r) => String(r.status).toUpperCase() === "CRITICAL").length;

  const shownReadings = useMemo(() => {
    return readings.filter((r) => {
      const term = search.toLowerCase().trim();
      return (
        !term ||
        [r.id, r.timestamp, r.status, r.anomaly_message, ...sensorConfig.map((s) => r[s.key])]
          .some((val) => String(val ?? "").toLowerCase().includes(term))
      );
    });
  }, [readings, search]);

  const navItems = [
    { name: "Overview", icon: "▦" },
    { name: "SCADA Monitoring", icon: "⌁" },
    { name: "Data Ingestion & Controls", icon: "📥" },
    { name: "Anomaly Detection", icon: "⚠" },
    { name: "Alerts & History", icon: "◷" }
  ];

  return (
    <div className="app-shell">
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <span>SF</span>
            <i />
          </div>
          <div>
            <strong>SentinelFlow</strong>
            <small>INDUSTRIAL INTELLIGENCE</small>
          </div>
        </div>
        <div className="nav-label">WORKSPACE</div>
        <nav>
          {navItems.map((item) => (
            <button
              key={item.name}
              className={`nav-item ${activePage === item.name ? "active" : ""}`}
              onClick={() => setActivePage(item.name)}
            >
              <span className="nav-icon">{item.icon}</span>
              {item.name}
              {item.name === "Alerts & History" && alerts.length > 0 && (
                <b className="nav-count">{alerts.length}</b>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className={`connection-card ${health}`}>
            <span className="pulse-dot" />
            <div>
              <strong>
                {health === "online"
                  ? "Backend connected"
                  : health === "checking"
                  ? "Connecting..."
                  : "Backend unavailable"}
              </strong>
              <small>{health === "online" ? "API responding" : "Render service"}</small>
            </div>
          </div>
          <div className="sidebar-foot">
            <span className="mini-shield">⬡</span> SCADA SECURITY MONITOR
          </div>
        </div>
      </aside>

      {/* Main Area */}
      <main className="main-area">
        <header className="topbar">
          <div className="breadcrumb">
            <span>SentinelFlow</span>
            <span className="crumb-slash">/</span>
            <strong>{activePage}</strong>
          </div>
          <div className="top-actions">
            <div className={`api-pill ${health}`}>
              <span className="pulse-dot" />
              {health === "online" ? "API Online" : health === "checking" ? "Connecting" : "API Offline"}
            </div>
            <button
              className="refresh-button"
              onClick={() => refresh(true)}
              disabled={refreshing}
              title="Refresh data"
            >
              <span className={refreshing ? "spin" : ""}>↻</span>
              <span>{refreshing ? "Refreshing" : "Refresh"}</span>
            </button>
          </div>
        </header>

        <div className="page-content">
          <section className="welcome-row">
            <div>
              <div className="eyebrow">
                <span className="eyebrow-line" /> WATER TREATMENT · SCADA OPERATIONS
              </div>
              <h1>{activePage === "Overview" ? "System overview" : activePage}</h1>
              <p className="subtitle">Monitor telemetry, ingest readings, and evaluate SCADA anomalies with instant operator alerts.</p>
            </div>
            <div className="updated-label">
              <span className="live-dot" /> AUTO-REFRESH · 15 SEC
              <small>{lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString()}` : "Waiting for data"}</small>
            </div>
          </section>

          {error && (
            <div className="notice">
              <span>ⓘ</span>
              <div>
                <strong>Connection notice</strong>
                <p>{error}</p>
              </div>
              <button onClick={() => setError("")} aria-label="Dismiss notice">×</button>
            </div>
          )}

          {/* PAGE 1: OVERVIEW */}
          {activePage === "Overview" && (
            <>
              <section className="stat-grid">
                <StatCard label="Total readings" value={readings.length} sub="Saved in database" icon="▤" />
                <StatCard label="Normal readings" value={normalCount} sub="Within expected range" icon="✓" tone="green" />
                <StatCard label="Warnings" value={warningCount} sub="Single threshold fault" icon="!" tone="amber" />
                <StatCard label="Critical events" value={criticalCount} sub="Multiple simultaneous faults" icon="⚠" tone="red" />
              </section>

              <section className="content-grid">
                <article className="panel latest-panel">
                  <div className="panel-heading">
                    <div>
                      <span className="section-kicker">LIVE TELEMETRY</span>
                      <h2>Latest SCADA reading</h2>
                    </div>
                    <span className="panel-tag">LATEST</span>
                  </div>
                  {latest ? (
                    <>
                      <div className="latest-status">
                        <div>
                          <span className="field-label">CURRENT SYSTEM STATUS</span>
                          <div className="status-line">
                            <span className={`status-dot ${statusClass(latest.status)}`} />
                            <strong>{latest.status}</strong>
                          </div>
                        </div>
                        <span className="reading-time">{prettyTime(latest.timestamp)}</span>
                      </div>
                      <div className="sensor-grid">
                        {sensorConfig.map((sensor) => (
                          <div className="sensor-tile" key={sensor.key}>
                            <div className="sensor-top">
                              <span>{sensor.label}</span>
                              <span className="sensor-icon">{sensor.icon}</span>
                            </div>
                            <div className="sensor-value">
                              {Number.isFinite(latest[sensor.key])
                                ? latest[sensor.key].toLocaleString(undefined, { maximumFractionDigits: 2 })
                                : "—"}
                              <small>{sensor.unit}</small>
                            </div>
                            <div className="sensor-range">Reference: {sensor.normal}</div>
                          </div>
                        ))}
                      </div>
                    </>
                  ) : (
                    <EmptyState
                      title={loading ? "Loading telemetry…" : "No readings recorded yet"}
                      text={loading ? "Connecting to backend..." : "Use Data Ingestion & Controls to submit manual readings or upload datasets."}
                    />
                  )}
                </article>

                <article className="panel events-panel">
                  <div className="panel-heading">
                    <div>
                      <span className="section-kicker">EVENT STREAM</span>
                      <h2>Recent anomalies</h2>
                    </div>
                    <span className="event-total">{alerts.length} EVENTS</span>
                  </div>
                  {alerts.length ? (
                    <div className="event-list">
                      {alerts.slice(0, 6).map((event, i) => (
                        <div className="event-row" key={`${event.id}-${i}`}>
                          <span className={`event-symbol ${statusClass(event.status)}`}>!</span>
                          <div className="event-main">
                            <div className="event-title">{event.anomaly_message || "Abnormal SCADA reading detected"}</div>
                            <div className="event-meta">Reading #{event.id} · {prettyTime(event.timestamp)}</div>
                          </div>
                          <span className={`badge ${statusClass(event.status)}`}>{event.status}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <EmptyState
                      title="No anomaly events"
                      text="Detected anomalies will appear here when abnormal sensor values are logged."
                    />
                  )}
                </article>
              </section>

              <section className="panel table-panel">
                <div className="panel-heading">
                  <div>
                    <span className="section-kicker">DATA LOG</span>
                    <h2>Recent readings</h2>
                  </div>
                  <button className="text-button" onClick={() => setActivePage("SCADA Monitoring")}>
                    View all readings <span>→</span>
                  </button>
                </div>
                <ReadingsTable rows={readings.slice(0, 5)} loading={loading} />
              </section>
            </>
          )}

          {/* PAGE 2: SCADA MONITORING */}
          {activePage === "SCADA Monitoring" && (
            <section className="panel table-panel full-panel">
              <div className="panel-heading">
                <div>
                  <span className="section-kicker">SENSOR TELEMETRY</span>
                  <h2>SCADA readings</h2>
                  <p className="panel-description">Most recent readings stored in the SentinelFlow database.</p>
                </div>
                <span className="panel-tag">{readings.length} LOADED</span>
              </div>
              <div className="table-toolbar">
                <label className="search-box">
                  <span>⌕</span>
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search by ID, timestamp, status, sensor values..."
                  />
                </label>
                <span className="muted-label">Auto-refreshes every 15 seconds</span>
              </div>
              <ReadingsTable rows={shownReadings} loading={loading} />
            </section>
          )}

          {/* PAGE 3: DATA INGESTION & CONTROLS */}
          {activePage === "Data Ingestion & Controls" && (
            <div className="ingest-container">
              <div className="ingest-grid">
                {/* METHOD 1: MANUAL SENSOR ENTRY */}
                <article className="panel">
                  <div className="panel-heading">
                    <div>
                      <span className="section-kicker">METHOD 1</span>
                      <h2>Manual sensor entry</h2>
                      <p className="panel-description">Inject single telemetry readings with real-time email dispatch.</p>
                    </div>
                    <span className="panel-tag">LIVE INGESTION</span>
                  </div>

                  {/* Preset Buttons */}
                  <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "12px" }}>
                    <button
                      type="button"
                      onClick={() => loadPreset("NORMAL")}
                      className="text-button"
                      style={{ background: "#0c1725", border: "1px solid #203448", borderRadius: "6px", padding: "6px 10px" }}
                    >
                      Normal Preset
                    </button>
                    <button
                      type="button"
                      onClick={() => loadPreset("WARNING_PRESSURE")}
                      className="text-button"
                      style={{ background: "#0c1725", border: "1px solid #203448", borderRadius: "6px", padding: "6px 10px", color: "var(--amber)" }}
                    >
                      Warning Preset (High Pressure)
                    </button>
                    <button
                      type="button"
                      onClick={() => loadPreset("CRITICAL_PUMP")}
                      className="text-button"
                      style={{ background: "#0c1725", border: "1px solid #203448", borderRadius: "6px", padding: "6px 10px", color: "var(--red)" }}
                    >
                      Critical Preset (Pump Overload)
                    </button>
                  </div>

                  <form onSubmit={handleManualSubmit}>
                    <div className="form-grid">
                      {sensorConfig.map((s) => (
                        <div className="field-block" key={s.key}>
                          <label>
                            {s.label}
                            <span>{s.unit}</span>
                          </label>
                          <input
                            type="number"
                            step={s.step}
                            min={s.min}
                            max={s.max}
                            required
                            value={manualForm[s.key]}
                            onChange={(e) => setManualForm({ ...manualForm, [s.key]: e.target.value })}
                          />
                          <small>Normal: {s.normal}</small>
                        </div>
                      ))}
                    </div>

                    <button type="submit" className="btn-action" disabled={manualLoading}>
                      {manualLoading ? "Analyzing & Saving..." : "⚡ Analyze Reading"}
                    </button>
                  </form>

                  {manualError && (
                    <div className="status-callout error">
                      <strong>Ingestion Error</strong>
                      <p>{manualError}</p>
                    </div>
                  )}

                  {manualResult && (
                    <div className={`status-callout ${statusClass(manualResult.status)}`}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <strong>Ingested: Reading #{manualResult.reading_id}</strong>
                        <span className={`badge ${statusClass(manualResult.status)}`}>
                          {manualResult.status}
                        </span>
                      </div>
                      <p style={{ margin: "4px 0" }}>{manualResult.message}</p>
                      {manualResult.anomalies?.length > 0 && (
                        <ul style={{ margin: "4px 0 0 16px", padding: 0 }}>
                          {manualResult.anomalies.map((anom, idx) => (
                            <li key={idx}>{anom}</li>
                          ))}
                        </ul>
                      )}
                      
                      {manualResult.email_alert && (
                        <div className="email-alert-box">
                          <span>📧</span>
                          <div>
                            <strong>
                              Email Alert Triggered:{" "}
                              <span className={`email-badge ${manualResult.email_alert.status.toLowerCase()}`}>
                                {manualResult.email_alert.status}
                              </span>
                            </strong>
                            <p style={{ margin: "2px 0 0" }}>Recipient: {manualResult.email_alert.recipient}</p>
                            <small style={{ color: "#79a4cc" }}>{manualResult.email_alert.details}</small>
                          </div>
                        </div>
                      )}

                      <small style={{ color: "#8c9bb1", marginTop: "4px" }}>
                        Timestamp: {prettyTime(manualResult.timestamp)}
                      </small>
                    </div>
                  )}
                </article>

                {/* METHOD 2: CSV & EXCEL FILE UPLOAD */}
                <article className="panel">
                  <div className="panel-heading">
                    <div>
                      <span className="section-kicker">METHOD 2</span>
                      <h2>Batch file upload</h2>
                      <p className="panel-description">Upload SCADA logs (.csv or .xlsx) with automatic anomaly digest alert.</p>
                    </div>
                    <span className="panel-tag">CSV / XLSX</span>
                  </div>

                  <form onSubmit={handleFileUpload}>
                    <div
                      className="drop-zone"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <input
                        type="file"
                        ref={fileInputRef}
                        accept=".csv,.xlsx,.xls"
                        style={{ display: "none" }}
                        onChange={(e) => {
                          if (e.target.files?.[0]) setSelectedFile(e.target.files[0]);
                        }}
                      />
                      <div className="drop-zone-icon">📁</div>
                      <strong style={{ display: "block", color: "#e8edf7", fontSize: "13px" }}>
                        Click to select dataset file
                      </strong>
                      <p style={{ color: "#71829a", fontSize: "11px", margin: "4px 0 0" }}>
                        Compatible with .csv and .xlsx spreadsheets
                      </p>
                      {selectedFile && (
                        <div className="file-badge">
                          <span>📄 {selectedFile.name}</span>
                          <small>({(selectedFile.size / 1024).toFixed(1)} KB)</small>
                        </div>
                      )}
                    </div>

                    <button
                      type="submit"
                      className="btn-action"
                      disabled={uploadLoading || !selectedFile}
                    >
                      {uploadLoading ? "Processing Telemetry Matrix..." : "🚀 Upload & Analyze Matrix"}
                    </button>
                  </form>

                  {uploadError && (
                    <div className="status-callout error">
                      <strong>Upload Error</strong>
                      <p>{uploadError}</p>
                    </div>
                  )}

                  {uploadResult && (
                    <div>
                      <div className="status-callout success">
                        <strong>Upload Successful: {uploadResult.filename}</strong>
                        <p>Processed {uploadResult.records_processed} total telemetry logs and saved to database.</p>
                      </div>

                      <div className="summary-stats-bar">
                        <div className="stat-pill">
                          <span>TOTAL ROWS</span>
                          <strong>{uploadResult.records_processed}</strong>
                        </div>
                        <div className="stat-pill">
                          <span>NORMAL</span>
                          <strong style={{ color: "var(--green)" }}>{uploadResult.normal_count}</strong>
                        </div>
                        <div className="stat-pill">
                          <span>WARNINGS</span>
                          <strong style={{ color: "var(--amber)" }}>{uploadResult.warning_count}</strong>
                        </div>
                        <div className="stat-pill">
                          <span>CRITICAL</span>
                          <strong style={{ color: "var(--red)" }}>{uploadResult.critical_count}</strong>
                        </div>
                      </div>

                      {uploadResult.email_alert && (
                        <div className="email-alert-box">
                          <span>📧</span>
                          <div>
                            <strong>
                              Batch Digest Alert:{" "}
                              <span className={`email-badge ${uploadResult.email_alert.status.toLowerCase()}`}>
                                {uploadResult.email_alert.status}
                              </span>
                            </strong>
                            <p style={{ margin: "2px 0 0" }}>Dispatched to: {uploadResult.email_alert.recipient}</p>
                            <small style={{ color: "#79a4cc" }}>{uploadResult.email_alert.details}</small>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </article>
              </div>

              {/* Upload Fault Inspection Table */}
              {uploadResult && uploadResult.results?.some((r) => r.anomaly) && (
                <section className="panel table-panel">
                  <div className="panel-heading">
                    <div>
                      <span className="section-kicker">BATCH ANALYSIS SUMMARY</span>
                      <h2>Detected anomalies in uploaded file ({uploadResult.faulty_readings_count} flagged)</h2>
                    </div>
                  </div>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>ROW / ID</th>
                          <th>TIMESTAMP</th>
                          <th>SEVERITY</th>
                          <th>DETECTED FAULTS</th>
                          <th>SENSOR PARAMETERS</th>
                        </tr>
                      </thead>
                      <tbody>
                        {uploadResult.results
                          .filter((r) => r.anomaly)
                          .map((r, i) => (
                            <tr key={`${r.reading_id}-${i}`}>
                              <td>
                                <strong>Row {r.row_number}</strong>
                                <small>DB #{r.reading_id}</small>
                              </td>
                              <td>{prettyTime(r.timestamp)}</td>
                              <td>
                                <span className={`badge ${statusClass(r.status)}`}>
                                  <i />
                                  {r.status}
                                </span>
                              </td>
                              <td style={{ color: "#ff8293", fontWeight: 500 }}>
                                {r.anomalies?.join(" · ") || "Anomaly flagged"}
                              </td>
                              <td>
                                {sensorConfig.map((s) => (
                                  <span key={s.key} style={{ marginRight: "10px", fontSize: "10px" }}>
                                    {s.label}: <b>{r.sensor_values?.[s.key]}</b>
                                  </span>
                                ))}
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}
            </div>
          )}

          {/* PAGE 4: ANOMALY DETECTION */}
          {activePage === "Anomaly Detection" && (
            <section className="panel full-panel">
              <div className="panel-heading">
                <div>
                  <span className="section-kicker">DETECTION RESULTS</span>
                  <h2>Anomaly analysis</h2>
                  <p className="panel-description">Results produced by the rule-based detection engine.</p>
                </div>
                <span className="panel-tag">{alerts.length} FLAGGED</span>
              </div>
              {alerts.length ? (
                <div className="analysis-list">
                  {alerts.map((event, i) => (
                    <article className="analysis-card" key={`${event.id}-${i}`}>
                      <div className={`analysis-icon ${statusClass(event.status)}`}>⚠</div>
                      <div className="analysis-content">
                        <div className="analysis-title-row">
                          <strong>Reading #{event.id}</strong>
                          <span className={`badge ${statusClass(event.status)}`}>{event.status}</span>
                        </div>
                        <p>{event.anomaly_message || "Anomaly flag recorded by backend."}</p>
                        <small>{prettyTime(event.timestamp)}</small>
                      </div>
                      <div className="analysis-metrics">
                        {sensorConfig
                          .filter((s) => Number.isFinite(event[s.key]))
                          .slice(0, 4)
                          .map((s) => (
                            <span key={s.key}>
                              {s.label}: <b>{event[s.key]}</b>
                            </span>
                          ))}
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <EmptyState
                  title="No anomalies recorded"
                  text="The backend has not returned any flagged readings yet. Submit an anomalous test reading through Data Ingestion & Controls."
                />
              )}
              <div className="info-footnote">
                <span>ⓘ</span>
                <p>
                  This dashboard evaluates telemetry using deterministic multi-parameter SCADA threshold logic across pressure, flow rate, temperature, vibration, current, pH, and tank levels.
                </p>
              </div>
            </section>
          )}

          {/* PAGE 5: ALERTS & HISTORY (WITH EMAIL ALERT CONSOLE) */}
          {activePage === "Alerts & History" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
              {/* OPERATOR EMAIL ALERT CONFIGURATION & TEST CONSOLE */}
              <article className="panel">
                <div className="panel-heading">
                  <div>
                    <span className="section-kicker">IMMEDIATE NOTIFICATIONS</span>
                    <h2>Operator email alert console</h2>
                    <p className="panel-description">Configure the safety operator recipient address and dispatch test telemetry alerts.</p>
                  </div>
                  <span className="panel-tag">SMTP ALERTS</span>
                </div>

                <form onSubmit={handleSaveEmailConfig}>
                  <div className="config-row">
                    <input
                      type="email"
                      required
                      placeholder="operator@waterplant.org"
                      value={recipientEmail}
                      onChange={(e) => setRecipientEmail(e.target.value)}
                    />
                    <button type="submit" className="btn-sm">
                      💾 Save Recipient Email
                    </button>
                    <button
                      type="button"
                      className="btn-sm btn-test"
                      onClick={handleSendTestEmail}
                      disabled={emailTesting}
                    >
                      {emailTesting ? "Dispatching..." : "⚡ Send Test Alert Email"}
                    </button>
                  </div>
                  {emailConfigStatus && (
                    <small style={{ color: "#5eead4", display: "block", marginTop: "6px" }}>
                      {emailConfigStatus}
                    </small>
                  )}
                  {emailTestMsg && (
                    <small style={{ color: "#fcd34d", display: "block", marginTop: "6px" }}>
                      {emailTestMsg}
                    </small>
                  )}
                </form>

                <div className="info-footnote" style={{ marginTop: "14px" }}>
                  <span>ⓘ</span>
                  <p>
                    <strong>Email Delivery Mode:</strong> Alerts are instantly formatted with telemetry metrics, violation types, and immediate mitigation actions. If SMTP credentials (<code>SMTP_USER</code> and <code>SMTP_PASSWORD</code>) are configured on Render, live emails are sent directly to your inbox. In demonstration mode, alerts are automatically recorded in the audit log below without requiring external credentials.
                  </p>
                </div>
              </article>

              {/* RECENT EMAIL ALERTS AUDIT LOG */}
              {emailAlerts.length > 0 && (
                <section className="panel table-panel">
                  <div className="panel-heading">
                    <div>
                      <span className="section-kicker">NOTIFICATION AUDIT LOG</span>
                      <h2>Recent email alert dispatches ({emailAlerts.length})</h2>
                    </div>
                  </div>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>TIMESTAMP</th>
                          <th>SEVERITY</th>
                          <th>RECIPIENT</th>
                          <th>SUBJECT</th>
                          <th>DELIVERY STATUS</th>
                          <th>DELIVERY DETAILS</th>
                        </tr>
                      </thead>
                      <tbody>
                        {emailAlerts.slice(0, 10).map((ea, i) => (
                          <tr key={`${ea.id}-${i}`}>
                            <td>{prettyTime(ea.timestamp)}</td>
                            <td>
                              <span className={`badge ${statusClass(ea.severity)}`}>
                                {ea.severity}
                              </span>
                            </td>
                            <td>{ea.recipient}</td>
                            <td style={{ color: "#e2e8f0" }}>{ea.subject}</td>
                            <td>
                              <span className={`email-badge ${ea.status.toLowerCase()}`}>
                                {ea.status}
                              </span>
                            </td>
                            <td style={{ fontSize: "10px", color: ea.status === "FAILED" ? "#fca5a5" : "#94a3b8", maxWidth: "340px", whiteSpace: "normal", lineHeight: 1.4 }}>
                              {ea.details}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}

              {/* SCADA ANOMALY INCIDENT LOG */}
              <section className="panel full-panel">
                <div className="panel-heading">
                  <div>
                    <span className="section-kicker">INCIDENT LOG</span>
                    <h2>SCADA alerts & fault history</h2>
                    <p className="panel-description">Historical anomaly events logged in the database.</p>
                  </div>
                  <span className="panel-tag">{alerts.length} ALERTS</span>
                </div>
                {alerts.length ? (
                  <div className="history-list">
                    {alerts.map((event, i) => (
                      <div className="history-row" key={`${event.id}-${i}`}>
                        <div className={`history-marker ${statusClass(event.status)}`} />
                        <div className="history-body">
                          <div className="history-title">
                            {event.anomaly_message || "Abnormal SCADA reading detected"}
                          </div>
                          <div className="history-meta">
                            Reading #{event.id} · {prettyTime(event.timestamp)}
                          </div>
                        </div>
                        <span className={`badge ${statusClass(event.status)}`}>{event.status}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState
                    title="Your incident log is clear"
                    text={loading ? "Loading alert history…" : "No alert records are currently available."}
                  />
                )}
              </section>
            </div>
          )}

          <footer className="footer">
            <span>© {new Date().getFullYear()} SentinelFlow</span>
            <span>
              <i className="footer-dot" /> SCADA monitoring interface
            </span>
            <span>API: {new URL(API_BASE).host}</span>
          </footer>
        </div>
      </main>
    </div>
  );
}

function ReadingsTable({ rows, loading }) {
  if (!rows.length) {
    return (
      <EmptyState
        title={loading ? "Loading readings…" : "No readings to display"}
        text={loading ? "Waiting for the API response." : "Use Data Ingestion & Controls to inject new sensor data."}
      />
    );
  }
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>ID / TIMESTAMP</th>
            <th>PRESSURE</th>
            <th>FLOW RATE</th>
            <th>TEMP.</th>
            <th>VIBRATION</th>
            <th>CURRENT</th>
            <th>pH</th>
            <th>TANK</th>
            <th>STATUS</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={`${r.id}-${i}`}>
              <td>
                <strong>#{r.id}</strong>
                <small>{prettyTime(r.timestamp)}</small>
              </td>
              <td>{Number.isFinite(r.pressure) ? r.pressure : "—"} <small>bar</small></td>
              <td>{Number.isFinite(r.flow_rate) ? r.flow_rate : "—"} <small>L/min</small></td>
              <td>{Number.isFinite(r.temperature) ? r.temperature : "—"} <small>°C</small></td>
              <td>{Number.isFinite(r.vibration) ? r.vibration : "—"} <small>mm/s</small></td>
              <td>{Number.isFinite(r.current) ? r.current : "—"} <small>A</small></td>
              <td>{Number.isFinite(r.ph) ? r.ph : "—"}</td>
              <td>{Number.isFinite(r.tank_level) ? r.tank_level : "—"} <small>%</small></td>
              <td>
                <span className={`badge ${statusClass(r.status)}`}>
                  <i />
                  {r.status}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}