'use client';
import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/src/lib/supabaseClient';
import RequireRole from '@/components/RequireRole';

const STORAGE_KEY = 'qr_checker_scans_v1';

export default function Checker() {
  const [user, setUser] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [cams, setCams] = useState([]);
  const [deviceId, setDeviceId] = useState('');
  const [running, setRunning] = useState(false);
  const [scans, setScans] = useState([]);
  const [lastStatus, setLastStatus] = useState(null); // For green/red message
  const scansRef = useRef(scans);
  const seenRef = useRef(new Set());
  const qrRef = useRef(null);
  const manualRef = useRef(null);

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
    } catch {}
  }, []);

  useEffect(() => {
    scansRef.current = scans;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ scans }));
    } catch {}
  }, [scans]);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data.user)).catch(() => {});
  }, []);

  function normalizeId(text) {
    try {
      const trimmed = (text || '').trim();
      const url = new URL(trimmed);
      const parts = url.pathname.split('/').filter(Boolean);
      let id = '';
      const iIndex = parts.findIndex(x => x.toLowerCase() === 'i');
      if (iIndex >= 0 && parts[iIndex + 1]) id = parts[iIndex + 1];
      else id = parts[parts.length - 1] || '';
      return decodeURIComponent(id).trim().toLowerCase();
    } catch {
      return (text || '').trim().toLowerCase();
    }
  }

  async function listCameras() {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: true });
      s.getTracks().forEach(t => t.stop());
    } catch {}
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
    setLastStatus(null);
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
        }
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

  async function handleDecoded(text) {
    const now = new Date().toLocaleString();
    const id = normalizeId(text);

    if (!id) {
      setScans(prev => [{ id: '-', name: 'Invalid QR', time: now, status: 'INVALID' }, ...prev]);
      setLastStatus('INVALID');
      return;
    }

    const already = seenRef.current.has(id) || scansRef.current.some(r => r.id === id);
    const name = await fetchNameIfPossible(id);

    setScans(prev => [{ id, name, time: now, status: already ? 'ALREADY' : 'OK' }, ...prev]);
    seenRef.current.add(id);
    setLastStatus(already ? 'ALREADY' : 'OK');
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
      <div style={{ padding: 16, fontFamily: 'sans-serif', maxWidth: 820, margin: '0 auto', background: '#3E2723', color: '#fff', borderRadius: 8 }}>
        <h1 style={{ textAlign: 'center', fontSize: 28, marginBottom: 20 }}>Ya Mar7aba - Scanner</h1>

        {/* Start/Stop Camera */}
        <div style={{ marginBottom: 12, display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
          {!cams.length && (
            <button onClick={listCameras} style={{ padding: '12px 20px', fontSize: 18, background: '#8D6E63', color: '#fff', border: 'none', borderRadius: 6 }}>Find cameras</button>
          )}
          {cams.length > 0 && (
            <>
              <select
                value={deviceId}
                onChange={e => setDeviceId(e.target.value)}
                style={{ minWidth: 220, padding: 8, borderRadius: 6 }}
              >
                {cams.map(c => (
                  <option key={c.deviceId} value={c.deviceId}>
                    {c.label || 'Camera'}
                  </option>
                ))}
              </select>
              {!running ? (
                <button onClick={startCamera} style={{ padding: '14px 28px', fontSize: 20, background: '#6D4C41', color: '#fff', border: 'none', borderRadius: 8 }}>▶ Start Scanner</button>
              ) : (
                <button onClick={stopCamera} style={{ padding: '14px 28px', fontSize: 20, background: '#B71C1C', color: '#fff', border: 'none', borderRadius: 8 }}>■ Stop Scanner</button>
              )}
            </>
          )}
        </div>

        {/* Scanner Area */}
        <div id="qr-reader" style={{ width: 360, maxWidth: '100%', minHeight: 260, background: '#5D4037', margin: '0 auto', borderRadius: 8 }} />

        {/* Status Message */}
        {lastStatus === 'OK' && (
          <div style={{ background: '#2E7D32', padding: 12, marginTop: 10, borderRadius: 6, textAlign: 'center' }}>✅ First Time Scan - Welcome!</div>
        )}
        {lastStatus === 'ALREADY' && (
          <div style={{ background: '#C62828', padding: 12, marginTop: 10, borderRadius: 6, textAlign: 'center' }}>❌ Already Scanned</div>
        )}

        {/* Error */}
        {errorMsg && (
          <div style={{ marginTop: 10, padding: 10, background: '#FFCDD2', color: '#B71C1C', borderRadius: 6 }}>
            <b>Camera error:</b> {errorMsg}
          </div>
        )}

        {/* Manual input */}
        <div style={{ marginTop: 14 }}>
          <h4>Manual add</h4>
          <input ref={manualRef} placeholder="UUID or QR URL" style={{ width: 260, padding: 8, borderRadius: 6 }} />
          <button onClick={manualAdd} style={{ marginInlineStart: 8, padding: '8px 14px', background: '#8D6E63', color: '#fff', border: 'none', borderRadius: 6 }}>Add</button>
        </div>

        {/* Table */}
        <div style={{ marginTop: 20 }}>
          <h3>Scans (this device)</h3>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', background: '#4E342E', borderRadius: 8, overflow: 'hidden' }}>
              <thead style={{ background: '#3E2723' }}>
                <tr>
                  <th style={{ padding: 8 }}>#</th>
                  <th style={{ padding: 8 }}>Guest</th>
                  <th style={{ padding: 8 }}>Time</th>
                  <th style={{ padding: 8 }}>Status</th>
                  <th style={{ padding: 8 }}>ID</th>
                </tr>
              </thead>
              <tbody>
                {scans.length === 0 ? (
                  <tr><td colSpan={5} style={{ padding: 12, textAlign: 'center', color: '#BCAAA4' }}>No scans yet</td></tr>
                ) : (
                  scans.map((r, idx) => (
                    <tr key={`${r.id}-${idx}`} style={{ borderBottom: '1px solid #6D4C41' }}>
                      <td style={{ padding: 8 }}>{scans.length - idx}</td>
                      <td style={{ padding: 8 }}>{r.name}</td>
                      <td style={{ padding: 8 }}>{r.time}</td>
                      <td style={{ padding: 8 }}><Dot status={r.status} /></td>
                      <td style={{ padding: 8, fontFamily: 'monospace' }}>{r.id}</td>
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
