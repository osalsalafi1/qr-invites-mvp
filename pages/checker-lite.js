'use client';
import { useEffect, useRef, useState } from 'react';

// Crash-proof minimal scanner using the library's built-in UI.
// No Supabase, no RequireRole — just to prove the scanner works.

export default function CheckerLite() {
  const [error, setError] = useState('');
  const [rows, setRows] = useState([]); // {id, time}
  const rowsRef = useRef([]);
  const scannerRef = useRef(null);

  // Accept full URLs or raw UUIDs
  const normalizeId = (text) => {
    try {
      const u = new URL((text || '').trim());
      const parts = u.pathname.split('/').filter(Boolean);
      const i = parts.findIndex(p => p.toLowerCase() === 'i');
      const id = (i >= 0 && parts[i + 1]) ? parts[i + 1] : parts[parts.length - 1];
      return (id || '').trim().toLowerCase();
    } catch {
      return (text || '').trim().toLowerCase();
    }
  };

  useEffect(() => {
    let disposed = false;

    async function start() {
      try {
        const mod = await import('html5-qrcode'); // make sure 2.3.8 is installed
        const { Html5QrcodeScanner } = mod;

        // Library-managed widget → avoids all removeChild/play() races
        const config = { fps: 10, qrbox: { width: 280, height: 280 } };
        scannerRef.current = new Html5QrcodeScanner('qr-root', config, /*verbose*/ false);

        const onSuccess = (decodedText /*, decodedResult */) => {
          const id = normalizeId(decodedText);
          const time = new Date().toLocaleString();
          rowsRef.current = [{ id, time }, ...rowsRef.current];
          setRows(rowsRef.current.slice(0, 200));
          // keep scanning (old behavior)
        };

        const onFailure = () => { /* ignore frame decode errors */ };

        scannerRef.current.render(onSuccess, onFailure);
      } catch (e) {
        console.error(e);
        if (!disposed) setError(e?.message || String(e));
      }
    }

    start();
    return () => { disposed = true; /* do not call clear(); let page unload handle it */ };
  }, []);

  return (
    <div style={{
      minHeight:'100vh', padding:'20px',
      background:'linear-gradient(135deg,#211915,#1A1410)',
      color:'#F5EFE8', fontFamily:'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial'
    }}>
      <h2 style={{marginTop:0}}>Ya Marhaba — Checker (Lite)</h2>
      <p style={{marginTop:0, opacity:.8}}>
        Built-in scanner UI. Camera stays on; each scan is logged below.
      </p>

      {error && (
        <div style={{
          background:'#3a1f1a', border:'1px solid #3B2E27',
          borderRadius:12, padding:12, marginBottom:12
        }}>
          <b>Error:</b> {error}
        </div>
      )}

      {/* The library mounts its own UI here. Do NOT remove/clear this div manually. */}
      <div id="qr-root" />

      <div style={{marginTop:16, padding:16, border:'1px solid #3B2E27', borderRadius:12, background:'#241C18'}}>
        <h3 style={{marginTop:0}}>Scans (this session)</h3>
        {rows.length === 0 ? (
          <div style={{opacity:.7}}>No scans yet.</div>
        ) : (
          <table style={{width:'100%', borderCollapse:'collapse'}}>
            <thead>
              <tr style={{opacity:.8}}>
                <th style={{textAlign:'left', padding:'8px'}}>#</th>
                <th style={{textAlign:'left', padding:'8px'}}>ID</th>
                <th style={{textAlign:'left', padding:'8px'}}>Time</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={`${r.id}-${i}`}>
                  <td style={{padding:'8px', borderTop:'1px solid #3B2E27'}}>{rows.length - i}</td>
                  <td style={{padding:'8px', borderTop:'1px solid #3B2E27', fontFamily:'ui-monospace, SFMono-Regular, Menlo, monospace'}}>{r.id}</td>
                  <td style={{padding:'8px', borderTop:'1px solid #3B2E27'}}>{r.time}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
