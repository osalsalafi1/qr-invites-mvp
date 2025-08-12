'use client';
import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/src/lib/supabaseClient';
import RequireRole from '@/components/RequireRole';

export default function Checker() {
  const [user, setUser] = useState(null);
  const [result, setResult] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [cams, setCams] = useState([]);          // available cameras
  const [deviceId, setDeviceId] = useState('');  // chosen camera
  const [running, setRunning] = useState(false); // is scanner running
  const qrRef = useRef(null);                    // Html5Qrcode instance
  const manualRef = useRef(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data.user));
  }, []);

  // Ask permission & enumerate cameras (iOS needs a user gesture)
  async function listCameras() {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      s.getTracks().forEach(t => t.stop());
    } catch (_) {
      // ignored; mainly to unlock camera labels on iOS
    }
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
    setResult('');
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
          setResult('Checking...');
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

  // Robust check-in: read → decide → update → verify (proper "Already used")
  async function handleDecoded(text) {
    try {
      const url = new URL(text);
      const parts = url.pathname.split('/').filter(Boolean);
      // Expect /i/{inviteId}
      const id = parts[1] || parts[0];
      if (!id) { setResult('Unknown link'); return; }

      // 1) Read current status first
      const { data: invite, error: readErr } = await supabase
        .from('invites')
        .select('id, guest_name, status')
        .eq('id', id)
        .single();

      if (readErr || !invite) {
        setResult('Invite not found');
        return;
      }

      const name = invite.guest_name || 'Guest';
      const status = (invite.status || '').toUpperCase();

      if (status === 'CHECKED_IN') {
        setResult(`Already used: ${name}`);
        return;
      }
      if (status !== 'PENDING') {
        // Customize other statuses as needed (e.g., BLOCKED, CANCELED)
        setResult(`Cannot check in: status is ${invite.status}`);
        return;
      }

      // 2) Try to flip PENDING -> CHECKED_IN (guarded by status for atomicity)
      const { data: updated, error: updErr } = await supabase
        .from('invites')
        .update({
          status: 'CHECKED_IN',
          checked_in_at: new Date().toISOString(),
          checked_in_by: user?.id || null
        })
        .eq('id', id)
        .eq('status', 'PENDING')
        .select('id, guest_name, status');

      if (updErr) {
        setResult('Failed to check-in: ' + updErr.message); // RLS/policy errors will show here
        return;
      }

      if (!updated || updated.length === 0) {
        // Another device may have checked-in just now → re-read
        const { data: after, error: rereadErr } = await supabase
          .from('invites')
          .select('guest_name, status')
          .eq('id', id)
          .single();

        if (rereadErr || !after) {
          setResult('Invite not found after update');
          return;
        }
        if ((after.status || '').toUpperCase() === 'CHECKED_IN') {
          setResult(`Already used: ${after.guest_name || 'Guest'}`);
        } else {
          setResult(`Cannot check in: status is ${after.status}`);
        }
        return;
      }

      // 3) Success
      const row = updated[0];
      setResult(`Checked in: ${row.guest_name || 'Guest'}`);
    } catch (_e) {
      setResult('Invalid QR content');
    }
  }

  async function manualCheckin() {
    const id = manualRef.current?.value?.trim();
    if (!id) return;
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    await handleDecoded(`${origin}/i/${id}`);
  }

  return (
    <RequireRole role={['checker','admin']}>
      <div style={{ padding: 16, fontFamily: 'sans-serif' }}>
        <h2>Scanner</h2>

        {/* Camera controls */}
        <div style={{ marginBottom: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {!cams.length && (
            <button onClick={listCameras}>Find cameras</button>
          )}
          {cams.length > 0 && (
            <>
              <select
                value={deviceId}
                onChange={e => setDeviceId(e.target.value)}
                style={{ minWidth: 200 }}
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

        <div
          id="qr-reader"
          style={{ width: 320, maxWidth: '100%', minHeight: 260, background: '#f7f7f7' }}
        />

        {errorMsg && (
          <div style={{ marginTop: 10, padding: 10, background: '#ffecec', color: '#a00', border: '1px solid #f5c2c2' }}>
            <b>Camera error:</b> {errorMsg}
          </div>
        )}

        <p style={{ marginTop: 12, fontSize: 16 }}>{result}</p>
        <hr />
        <h4>Manual input (invite UUID)</h4>
        <input
          ref={manualRef}
          placeholder="550e8400-e29b-41d4-a716-446655440000"
          style={{ width: 320 }}
        />
        <button onClick={manualCheckin} style={{ marginInlineStart: 8 }}>Check-in</button>
      </div>
    </RequireRole>
  );
}
