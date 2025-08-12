'use client';
import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/src/lib/supabaseClient'; // only to fetch display name (optional)
import RequireRole from '@/components/RequireRole';

const STORAGE_KEY = 'qr_checker_scans_v1';

// Ya Marhaba brand palette (dark brown theme)
const BRAND = {
  bg: '#1f1a17',        // deep brown/near black
  card: '#2a211d',      // card surface
  primary: '#5D3A1A',   // dark brown
  primaryHover: '#774824',
  accent: '#A47148',    // warm accent
  text: '#F3EDE7',      // warm off-white
  textMuted: '#CBB8A0',
  border: '#3a2f2a',
  success: '#22c55e',
  warn: '#f59e0b',
  danger: '#ef4444',
  tableRow: '#241d19'
};

const styles = {
  page: {
    minHeight: '100vh',
    background: `linear-gradient(180deg, ${BRAND.bg} 0%, #211b18 100%)`,
    color: BRAND.text,
    fontFamily: 'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial',
    padding: '24px 16px'
  },
  shell: { maxWidth: 920, margin: '0 auto' },
  headerCard: {
    background: BRAND.card,
    border: `1px solid ${BRAND.border}`,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    boxShadow: '0 10px 24px rgba(0,0,0,0.25)'
  },
  brandRow: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 },
  brandBadge: {
    background: BRAND.primary,
    color: BRAND.text,
    borderRadius: 999,
    padding: '4px 10px',
    fontSize: 12,
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
    border: `1px solid ${BRAND.border}`
  },
  title: { fontSize: 22, fontWeight: 700, margin: 0, color: BRAND.text },
  subtitle: { margin: '4px 0 0', color: BRAND.textMuted, fontSize: 13 },

  controls: {
    display: 'flex', gap: 10, flexWrap: 'wrap',
    background: BRAND.card, border: `1px solid ${BRAND.border}`,
    borderRadius: 16, padding: 12, marginBottom: 16
  },
  select: {
    background: '#201a17', color: BRAND.text,
    border: `1px solid ${BRAND.border}`, borderRadius: 10,
    padding: '10px 12px', minWidth: 240, outline: 'none'
  },
  buttonPrimary: {
    background: BRAND.primary, color: BRAND.text,
    border: `1px solid ${BRAND.border}`, borderRadius: 10,
    padding: '10px 14px', cursor: 'pointer', fontWeight: 600
  },
  buttonSecondary: {
    background: '#201a17', color: BRAND.text,
    border: `1px solid ${BRAND.border}`, borderRadius: 10,
    padding: '10px 14px', cursor: 'pointer', fontWeight: 600
  },

  reader: {
    background: BRAND.card, border: `1px solid ${BRAND.border}`,
    borderRadius: 16, minHeight: 260, width: 420, maxWidth: '100%',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    margin: '0 auto'
  },
  alert: {
    marginTop: 10, padding: 12,
    background: '#3a1f1a', color: BRAND.text,
    border: `1px solid ${BRAND.border}`, borderRadius: 12
  },

  manualBox: {
    background: BRAND.card, border: `1px solid ${BRAND.border}`,
    borderRadius: 16, padding: 12, marginTop: 16
  },
  input: {
    background: '#201a17', color: BRAND.text,
    border: `1px solid ${BRAND.border}`, borderRadius: 10,
    padding: '10px 12px', width: 420, maxWidth: '100%', outline: 'none'
  },
  addBtn: {
    background: BRAND.accent, color: BRAND.text,
    border: `1px solid ${BRAND.border}`, borderRadius: 10,
    padding: '10px 14px', marginInlineStart: 8, cursor: 'pointer', fontWeight: 600
  },

  tableWrap: {
    background: BRAND.card, border: `1px solid ${BRAND.border}`,
    borderRadius: 16, padding: 12, marginTop: 20
  },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: {
    textAlign: 'left', padding: '10px 8px', fontSize: 13,
    color: BRAND.textMuted, borderBottom: `1px solid ${BRAND.border}`
  },
  td: { padding: '10px 8px', borderBottom: `1px solid ${BRAND.border}` },
  row: { background: BRAND.tableRow },
  dotRow: { display: 'flex', alignItems: 'center', gap: 8 }
};

export default function Checker() {
  const [user, setUser] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [cams, setCams] = useState([]);
  const [deviceId, setDeviceId] = useState('');
  const [running, setRunning] = useState(false);
  const [scans, setScans] = useState([]); // rows: {id, name, time, status}
  const scansRef = useRef(scans);
  const seenRef = useRef(new Set());
  const qrRef = useRef(null);
  const manualRef = useRef(null);

  // Load persisted table
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed?.scans)) {
          setScans(parsed.scans);
          scansRef.current = parsed.scans;
          seenRef.current = new Set(parsed.scans.map(r => r.id));
        }
      }
    } catch {}
  }, []);

  // Persist table
  useEffect(() => {
    scansRef.current = scans;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ scans })); } catch {}
  }, [scans]);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data.user)).catch(() => {});
  }, []);

  function normalizeId(text) {
    try {
      const trimmed = (text || '').trim();
      const url = new URL(trimmed);
      const parts = (url.pathname || '').split('/').filter(Boolean);
      const iIndex = parts.findIndex(x => x.toLowerCase() === 'i');
      let id = iIndex >= 0 && parts[iIndex + 1] ? parts[iIndex + 1] : (parts[parts.length - 1] || '');
      return decodeURIComponent(id).trim().toLowerCase();
    } catch {
      return (text || '').trim().toLowerCase();
    }
  }

  async function listCameras() {
    try { const s = await navigator.mediaDevices.getUserMedia({ video: true }); s.getTracks().forEach(t => t.stop()); } catch {}
    const devices = await navigator.mediaDevices.enumerateDevices();
    const vs = devices.filter(d => d.kind === 'videoinput');
    setCams(vs);
    if (vs.length && !deviceId) {
      const back = vs.find(v => /back|rear|environment/i.test(v.label));
      setDeviceId((back || vs[0]).deviceId);
    }
  }

  async function startCamera() {
    setErrorMsg('');
    try {
      const mod = await import('html5-qrcode');
      const { Html5Qrcode } = mod;
      const mountId = 'qr-reader';
      const el = document.getElementById(mountId);
      if (!el) return;
      try { await qrRef.current?.stop(); } catch {}
      try { await qrRef.current?.clear(); } catch {}

      if (!deviceId) await listCameras();
      const chosen = deviceId || cams[0]?.deviceId;
      if (!chosen) { setErrorMsg('No camera available. Enable camera permission.'); return; }

      const qr = new Html5Qrcode(mountId, true);
      qrRef.current = qr;

      await qr.start(
        { deviceId: { exact: chosen } },
        { fps: 10, qrbox: { width: 260, height: 260 } },
        async (decodedText) => { await stopCamera(); await handleDecoded(decodedText); },
        () => {}
      );
      setRunning(true);
    } catch (e) {
      let msg = e?.message || e?.name || String(e);
      if (/Permission|NotAllowed/i.test(msg)) msg += ' — allow camera in site settings.';
      if (/secure context|getUserMedia/i.test(msg)) msg += ' — use HTTPS (Vercel).';
      setErrorMsg(msg);
      setRunning(false);
    }
  }

  async function stopCamera() {
    try { await qrRef.current?.stop(); } catch {}
    try { await qrRef.current?.clear(); } catch {}
    setRunning(false);
  }

  async function fetchNameIfPossible(id) {
    try {
      const { data } = await supabase.from('invites').select('guest_name').eq('id', id).single();
      return data?.guest_name || 'Guest';
    } catch { return 'Guest'; }
  }

  async function handleDecoded(text) {
    const now = new Date().toLocaleString();
    const id = normalizeId(text);
    if (!id) {
      setScans(prev => [{ id: '-', name: 'Invalid QR', time: now, status: 'INVALID' }, ...prev]);
      return;
    }
    const already = seenRef.current.has(id) || scansRef.current.some(r => r.id === id);
    const name = await fetchNameIfPossible(id);
    setScans(prev => [{ id, name, time: now, status: already ? 'ALREADY' : 'OK' }, ...prev]]);
    seenRef.current.add(id);
  }

  async function manualAdd() {
    const val = manualRef.current?.value?.trim();
    if (!val) return;
    await stopCamera();
    await handleDecoded(val);
    manualRef.current.value = '';
  }

  function Dot({ status }) {
    const ok = status === 'OK';
    const already = status === 'ALREADY';
    const invalid = status === 'INVALID';
    const color = ok ? BRAND.success : already ? BRAND.warn : invalid ? BRAND.danger : BRAND.textMuted;
    const label = ok ? 'First in table' : already ? 'Already in table' : invalid ? 'Invalid' : status;
    return (
      <div style={styles.dotRow}>
        <span style={{ width: 10, height: 10, borderRadius: 999, background: color }} />
        <span>{label}</span>
      </div>
    );
  }

  return (
    <RequireRole role={['checker','admin']}>
      <div style={styles.page}>
        <div style={styles.shell}>
          {/* Header */}
          <div style={styles.headerCard}>
            <div style={styles.brandRow}>
              <div style={styles.brandBadge}>Ya Marhaba</div>
              <h1 style={styles.title}>Guest Checker</h1>
            </div>
            <p style={styles.subtitle}>Scan QR codes. First time shows a green dot; repeats show orange. Session is saved on this device.</p>
          </div>

          {/* Controls */}
          <div style={styles.controls}>
            {!cams.length && (
              <button onClick={listCameras} style={styles.buttonSecondary}>Find cameras</button>
            )}
            {cams.length > 0 && (
              <>
                <select value={deviceId} onChange={e => setDeviceId(e.target.value)} style={styles.select}>
                  {cams.map(c => (
                    <option key={c.deviceId} value={c.deviceId}>{c.label || 'Camera'}</option>
                  ))}
                </select>
                {!running ? (
                  <button onClick={startCamera} style={styles.buttonPrimary}>Start camera</button>
                ) : (
                  <button onClick={stopCamera} style={styles.buttonSecondary}>Stop camera</button>
                )}
              </>
            )}
          </div>

          {/* Reader */}
          <div id="qr-reader" style={styles.reader}>
            {!running && <span style={{ color: BRAND.textMuted, fontSize: 14 }}>Camera preview will appear here</span>}
          </div>

          {errorMsg && (
            <div style={styles.alert}>
              <b>Camera error:</b> {errorMsg}
            </div>
          )}

          {/* Manual */}
          <div style={styles.manualBox}>
            <h3 style={{ marginTop: 0, marginBottom: 8, color: BRAND.text }}>Manual add (UUID or full URL)</h3>
            <div>
              <input
                ref={manualRef}
                placeholder="550e8400-e29b-41d4-a716-446655440000  or  https://.../i/UUID"
                style={styles.input}
              />
              <button onClick={manualAdd} style={styles.addBtn}>Add to table</button>
            </div>
          </div>

          {/* Table */}
          <div style={styles.tableWrap}>
            <h3 style={{ marginTop: 0, marginBottom: 8, color: BRAND.text }}>Scans (this device)</h3>
            <div style={{ overflowX: 'auto' }}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>#</th>
                    <th style={styles.th}>Guest</th>
                    <th style={styles.th}>Time</th>
                    <th style={styles.th}>Status</th>
                    <th style={styles.th}>ID</th>
                  </tr>
                </thead>
                <tbody>
                  {scans.length === 0 ? (
                    <tr><td colSpan={5} style={{ ...styles.td, color: BRAND.textMuted }}>No scans yet</td></tr>
                  ) : (
                    scans.map((r, idx) => (
                      <tr key={`${r.id}-${idx}`} style={styles.row}>
                        <td style={styles.td}>{scans.length - idx}</td>
                        <td style={styles.td}>{r.name}</td>
                        <td style={styles.td}>{r.time}</td>
                        <td style={styles.td}><Dot status={r.status} /></td>
                        <td style={{ ...styles.td, fontFamily: 'monospace' }}>{r.id}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <p style={{ color: BRAND.textMuted, fontSize: 12, marginTop: 8 }}>
              Data is stored locally in this browser. Refreshing keeps the table; clearing site data resets it.
            </p>
          </div>
        </div>
      </div>
    </RequireRole>
  );
}
