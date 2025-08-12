'use client';
import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/src/lib/supabaseClient'; // only to fetch display name (optional)
import RequireRole from '@/components/RequireRole';

const STORAGE_KEY = 'qr_checker_scans_v1'; // change if you ever want to force a fresh session

export default function Checker() {
  const [user, setUser] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [cams, setCams] = useState([]);
  const [deviceId, setDeviceId] = useState('');
  const [running, setRunning] = useState(false);
  const [scans, setScans] = useState([]); // rows: {id, name, time, status}
  const scansRef = useRef(scans);         // keep latest for handlers
  const seenRef = useRef(new Set());      // normalized IDs seen in THIS persisted session
  const qrRef = useRef(null);
  const manualRef = useRef(null);

  // Load persisted session (table + seen IDs)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed?.scans)) {
          setScans(parsed.scans);
          scansRef.current = parsed.scans;
          seenRef.current = new Set((parsed.scans || []).map(r => r.id));
        }
      }
    } catch { /* ignore corrupt storage */ }
  }, []);

  // Persist whenever scans change
  useEffect(() => {
    scansRef.current = scans;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ scans }));
    } catch { /* storage might be full or disabled */ }
  }, [scans]);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data.user)).catch(() => {});
  }, []);

  // Normalize any scanned text to a canonical ID
  function normalizeId(text) {
    try {
      const trimmed = (text || '').trim();
      const url = new URL(trimmed);
      let path = url.pathname || '';
      const parts = path.split('/').filter(Boolean);
      let id = '';
      const iIndex = parts.findIndex(x => x.toLowerCase() === 'i');
      if (iIndex >= 0 && parts[iIndex + 1]) id = parts[iIndex + 1];
      else id = parts[parts.length - 1] || '';
      id = decodeURIComponent(id).trim();
      return id.toLowerCase();
    } catch {
      return (text || '').trim().toLowerCase();
    }
  }

  async function listCameras() {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      s.getTracks().forEach(t => t.stop());
    } catch (_) {}
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
      if (!chosen) {
        setErrorMsg('No camera available. Enable camera permission and try again.');
        return;
      }

      const qr = new Html5Qrcode(mountId, true);
      qrRef.current = qr;

      await qr.start(
        { deviceId: { exact: chosen } },
        { fps: 10, qrbox: { width: 260, height: 260 } },
        async (decodedText) => {
          await stopCamera();
          await handleDecoded(decodedText);
        },
        () => {}
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

  // Decide using ONLY what's already in the persisted table for this device/session
  async function handleDecoded(text) {
    const now = new Date().toLocaleString();
    const id = normalizeId(text);

    if (!id) {
      setScans(prev => [{ id: '-', name: 'Invalid QR', time: now, status: 'INVALID' }, ...prev]);
      return;
    }

    // Check against what’s already in the table (and seenRef)
    const already = seenRef.current.has(id) || scansRef.current.some(r => r.id === id);

    // Optional: fetch display name from DB (read-only)
    const name = await fetchNameIfPossible(id);

    // Record row
    setScans(prev => [{ id, name, time: now, status: already ? 'ALREADY' : 'OK' }, ...prev]);

    // Remember this id as seen (so future scans—even after refresh—still show ALREADY)
    seenRef.current.add(id);
  }

  async function fetchNameIfPossible(id) {
    try {
      const { data } = await supabase
        .from('invites')
        .select('guest_name')
        .eq('id', id)
        .single();
      return data?.guest_name || 'Guest';
    } catch {
      return 'Guest';
    }
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
          <h4>Manual add (invite UUID or full URL)</h4>
          <input
            ref={manualRef}
            placeholder="550e8400-e29b-41d4-a716-446655440000  OR  https://.../i/UUID"
            style={{ width: 360, maxWidth: '100%' }}
          />
        <button onClick={manualAdd} style={{ marginInlineStart: 8 }}>Add to table</button>
        </div>

        {/* Session table (persisted in localStorage) */}
        <div style={{ marginTop: 20 }}>
          <h3>Scans (this device)</h3>
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
          <p style={{ color: '#6b7280', fontSize: 13, marginTop: 8 }}>
            * Data is stored locally in this browser (localStorage). Refreshing the page keeps the table;
            clearing site data will reset it.
          </p>
        </div>
      </div>
    </RequireRole>
  );
}
