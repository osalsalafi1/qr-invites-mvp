'use client';
import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/src/lib/supabaseClient'; // only used to fetch guest_name (optional)
import RequireRole from '@/components/RequireRole';

export default function Checker() {
  const [user, setUser] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [cams, setCams] = useState([]);          // available cameras
  const [deviceId, setDeviceId] = useState('');  // chosen camera
  const [running, setRunning] = useState(false); // is scanner running
  const [scans, setScans] = useState([]);        // table rows: {id, name, time, status}
  const seenRef = useRef(new Set());             // session memory of scanned IDs
  const qrRef = useRef(null);                    // Html5Qrcode instance
  const manualRef = useRef(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data.user)).catch(() => {});
  }, []);

  // Ask permission & enumerate cameras (iOS needs a user gesture)
  async function listCameras() {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      s.getTracks().forEach(t => t.stop());
    } catch (_) { /* just to unlock labels / permission prompt */ }
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

      // cleanup previous session
      try { await qrRef.current?.stop(); } catch {}
      try { await qrRef.current?.clear(); } catch {}

      if (!deviceId) await listCameras();
      const chosen = deviceId || cams[0]?.deviceId;
      if (!chosen) {
        setErrorMsg('No camera available. Enable camera permission and try again.');
        return;
      }

      const qr = new Html5Qrcode(mountId, /* verbose */ true);
      qrRef.current = qr;

      await qr.start(
        { deviceId: { exact: chosen } },
        { fps: 10, qrbox: { width: 260, height: 260 } },
        async (decodedText) => {
          await stopCamera();        // stop immediately after 1 decode
          await handleDecoded(decodedText);
        },
        () => {} // ignore continuous scan failures
      );
      setRunning(true);
    } catch (e) {
      let msg = e?.message || e?.name || String(e);
      if (/Permission|NotAllowed/i.test(msg)) msg += ' — allow camera in browser/site settings.';
      if (/secure context|getUserMedia/i.test(msg)) msg += ' — must use HTTPS (Vercel is OK).';
      setErrorMsg(msg);
      setRunning(false);
    }
  }

  async function stopCamera() {
    try { await qrRef.current?.stop(); } catch {}
    try { await qrRef.current?.clear(); } catch {}
    setRunning(false);
  }

  // Parse /i/{inviteId}. Returns {id} or null
  function extractIdFromText(text) {
    try {
      const url = new URL(text);
      const parts = url.pathname.split('/').filter(Boolean);
      const id = parts[1] || parts[0];
      return id || null;
    } catch {
      // Not a URL? Maybe the raw text is the UUID itself
      const maybe = (text || '').trim();
      return maybe || null;
    }
  }

  // Session-based decision:
  // If id already in table → "ALREADY"
  // Else → "OK" and remember it
  async function handleDecoded(text) {
    const now = new Date().toLocaleString();
    const id = extractIdFromText(text);

    if (!id) {
      setScans(prev => [{ id: '-', name: 'Invalid QR', time: now, status: 'INVALID' }, ...prev]);
      return;
    }

    if (seenRef.current.has(id)) {
      // Already scanned in this session
      // We only display; no DB update
      const name = await fetchNameIfPossible(id);
      setScans(prev => [{ id, name, time: now, status: 'ALREADY' }, ...prev]);
      return;
    }

    // First time in this session
    seenRef.current.add(id);
    const name = await fetchNameIfPossible(id);
    setScans(prev => [{ id, name, time: now, status: 'OK' }, ...prev]);
  }

  // Optional: fetch guest name from DB for nicer display.
  async function fetchNameIfPossible(id) {
    try {
      const { data, error } = await supabase
        .from('invites')
        .select('guest_name')
        .eq('id', id)
        .single();
      if (error || !data) return 'Guest';
      return data.guest_name || 'Guest';
    } catch {
      return 'Guest';
    }
  }

  async function manualCheckin() {
    const id = manualRef.current?.value?.trim();
    if (!id) return;
    await stopCamera();
    await handleDecoded(id);
  }

  // Status dot
  function Dot({ status }) {
    const ok = status === 'OK';
    const already = status === 'ALREADY';
    const invalid = status === 'INVALID';
    const color = ok ? '#16a34a' : already ? '#f59e0b' : invalid ? '#ef4444' : '#6b7280';
    const label =
      ok ? 'First in table' :
      already ? 'Already in table' :
      invalid ? 'Invalid' :
      status;
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ width: 10, height: 10, borderRadius: 999, background: color }} />
        <span>{label}</span>
      </div>
    );
  }

  return (
    <RequireRole role={['checker','admin']}>
      <div style={{ padding: 16, fontFamily: 'sans-serif', maxWidth: 820, margin: '0 auto' }}>
        <h2>Scanner</h2>

        {/* Camera controls */}
        <div style={{ marginBottom: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {!cams.length && (
            <button onClick={listCameras}>Find cameras</button>
          )}
          {cams.length > 0 && (
            <>
              <select
                value={deviceId}
                onChange={e => setDeviceId(e.target.value)}
                style={{ minWidth: 220 }}
              >
                {cams.map(c => (
                  <option key={c.deviceId} value={c.deviceId}>
                    {c.label || 'Camera'}
                  </option>
                ))}
              </select>
              {!running ? (
                <button onClick={startCamera}>Start camera</button>
              ) : (
                <button onClick={stopCamera}>Stop camera</button>
              )}
            </>
          )}
        </div>

        <div id="qr-reader" style={{ width: 360, maxWidth: '100%', minHeight: 260, background: '#f7f7f7' }} />

        {errorMsg && (
          <div style={{ marginTop: 10, padding: 10, background: '#ffecec', color: '#a00', border: '1px solid #f5c2c2' }}>
            <b>Camera error:</b> {errorMsg}
          </div>
        )}

        {/* Manual input */}
        <div style={{ marginTop: 14 }}>
          <h4>Manual input (invite UUID or full URL)</h4>
          <input
            ref={manualRef}
            placeholder="550e8400-e29b-41d4-a716-446655440000  OR  https://.../i/UUID"
            style={{ width: 360, maxWidth: '100%' }}
          />
          <button onClick={manualCheckin} style={{ marginInlineStart: 8 }}>
            Add to table
          </button>
        </div>

        {/* Scan results table (session-based) */}
        <div style={{ marginTop: 20 }}>
          <h3>Scans (this session)</h3>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '1px solid #e5e7eb' }}>
                  <th style={{ padding: '8px 6px' }}>#</th>
                  <th style={{ padding: '8px 6px' }}>Guest</th>
                  <th style={{ padding: '8px 6px' }}>Time</th>
                  <th style={{ padding: '8px 6px' }}>Status</th>
                  <th style={{ padding: '8px 6px' }}>ID</th>
                </tr>
              </thead>
              <tbody>
                {scans.length === 0 ? (
                  <tr><td colSpan={5} style={{ padding: 12, color: '#6b7280' }}>No scans yet</td></tr>
                ) : (
                  scans.map((r, idx) => (
                    <tr key={`${r.id}-${idx}`} style={{ borderBottom: '1px solid #f3f4f6' }}>
                      <td style={{ padding: '8px 6px' }}>{scans.length - idx}</td>
                      <td style={{ padding: '8px 6px' }}>{r.name}</td>
                      <td style={{ padding: '8px 6px' }}>{r.time}</td>
                      <td style={{ padding: '8px 6px' }}><Dot status={r.status} /></td>
                      <td style={{ padding: '8px 6px', fontFamily: 'monospace' }}>{r.id}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </RequireRole>
  );
}
