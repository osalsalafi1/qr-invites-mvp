'use client';
import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/src/lib/supabaseClient';
import RequireRole from '@/components/RequireRole';

export default function Checker() {
  const [result, setResult] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [user, setUser] = useState(null);
  const manualRef = useRef(null);
  const qrRef = useRef(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data.user));
  }, []);

  useEffect(() => {
    let stopped = false;

    async function start() {
      console.log('Starting scanner init…');
      try {
        setErrorMsg('');
        const mod = await import('html5-qrcode');
        const Html5Qrcode = mod.Html5Qrcode;

        const mountId = 'qr-reader';
        const mountEl = document.getElementById(mountId);
        if (!mountEl) return;

        try { await qrRef.current?.stop(); } catch (_) {}
        try { await qrRef.current?.clear(); } catch (_) {}

        const qr = new Html5Qrcode(mountId, true);
        qrRef.current = qr;

        const config = { fps: 10, qrbox: { width: 250, height: 250 } };

        await qr.start(
          { facingMode: 'environment' },
          config,
          async (decodedText) => {
            if (stopped) return;
            setResult('Checking...');
            await handleDecoded(decodedText);
          },
          () => {}
        );
      } catch (e) {
        console.error('Camera init failed RAW:', e);
        let msg = e?.message || e?.name || String(e);
        if (msg.includes('Permission') || msg.includes('NotAllowedError')) {
          msg += ' — Check Chrome site permissions (Camera: Allow) and macOS Camera privacy.';
        }
        if (msg.includes('secure context') || msg.includes('getUserMedia')) {
          msg += ' — On phones use HTTPS (ngrok/Vercel). On laptop, localhost is OK.';
        }
        setErrorMsg(msg);
      }
    }

    if (typeof window !== 'undefined') start();

    return () => {
      stopped = true;
      (async () => {
        try { await qrRef.current?.stop(); } catch (_) {}
        try { await qrRef.current?.clear(); } catch (_) {}
      })();
    };
  }, []);

  async function handleDecoded(text) {
    try {
      const url = new URL(text);
      const parts = url.pathname.split('/').filter(Boolean);
      const id = parts[1] || parts[0];
      if (!id) { setResult('Unknown link'); return; }

      const { error } = await supabase.from('invites')
        .update({
          status: 'CHECKED_IN',
          checked_in_at: new Date().toISOString(),
          checked_in_by: user?.id || null
        })
        .eq('id', id)
        .eq('status', 'PENDING');

      if (error) { setResult('Failed: ' + error.message); return; }

      const { data } = await supabase.from('invites')
        .select('guest_name,status')
        .eq('id', id)
        .single();

      if (!data) { setResult('Invite not found'); return; }
      if (data.status !== 'CHECKED_IN') { setResult('Already used'); return; }

      setResult(`Checked in: ${data.guest_name}`);
    } catch {
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
      <div style={{ padding: 20, fontFamily: 'sans-serif' }}>
        <h2>Scanner</h2>
        <div id="qr-reader" style={{ width: 320, maxWidth: '100%', minHeight: 240, background: '#f7f7f7' }} />
        {errorMsg && (
          <div style={{ marginTop: 10, padding: 10, background: '#ffecec', color: '#a00', border: '1px solid #f5c2c2' }}>
            <b>Camera error:</b> {errorMsg}
          </div>
        )}
        <p style={{ marginTop: 12, fontSize: 16 }}>{result}</p>
        <hr />
        <h4>Manual input (invite UUID)</h4>
        <input ref={manualRef} placeholder="550e8400-e29b-41d4-a716-446655440000" style={{ width: 320 }} />
        <button onClick={manualCheckin} style={{ marginInlineStart: 8 }}>Check-in</button>
      </div>
    </RequireRole>
  );
}
