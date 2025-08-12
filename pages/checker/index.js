'use client';
import { useEffect, useRef, useState } from 'react';

// Accepts NAME|UUID, URL, raw UUID, or JSON {name, uuid|code|id}
function extractUuid(s = '') {
  const m = String(s).match(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}/);
  return m ? m[0].toLowerCase() : '';
}
function parsePayload(rawText = '') {
  const raw = rawText.trim();
  if (!raw) return null;

  // 1) JSON: { name, uuid|code|id }
  try {
    const obj = JSON.parse(raw);
    const name = (obj.name || obj.guest || obj.guest_name || '').toString().trim();
    const codeCandidate = (obj.uuid || obj.code || obj.id || '').toString().trim();
    const code = extractUuid(codeCandidate);
    if (code) return { name: name || 'Guest', code };
  } catch (_) {}

  // 2) NAME|UUID
  const pipeIdx = raw.indexOf('|');
  if (pipeIdx !== -1) {
    const left = raw.slice(0, pipeIdx).trim();
    const right = raw.slice(pipeIdx + 1).trim();
    const code = extractUuid(right) || extractUuid(left); // tolerate reversed order just in case
    const name = code === extractUuid(left) ? right : left;
    if (code) return { name: name || 'Guest', code };
  }

  // 3) URL: use segment after /i/ or last segment
  try {
    const u = new URL(raw);
    const parts = u.pathname.split('/').filter(Boolean);
    const i = parts.findIndex(p => p.toLowerCase() === 'i');
    let candidate = i >= 0 ? parts[i + 1] : parts[parts.length - 1];
    candidate = decodeURIComponent(candidate || '');
    const code = extractUuid(candidate);
    if (code) return { name: 'Guest', code };
  } catch (_) {}

  // 4) Raw UUID
  const code = extractUuid(raw);
  if (code) return { name: 'Guest', code };

  return null;
}

export default function Checker() {
  const [scans, setScans] = useState([]); // [{code,name,time}]
  const [message, setMessage] = useState({ text: '', type: '' }); // success | error
  const [scanning, setScanning] = useState(false);

  const scannerRef = useRef(null);
  const lastCodeRef = useRef('');
  const lastAtRef = useRef(0);
  const DEDUP_MS = 1200;

  // Load/save table
  useEffect(() => {
    try {
      const saved = localStorage.getItem('yaMarhabaScans');
      if (saved) setScans(JSON.parse(saved));
    } catch {}
  }, []);
  useEffect(() => {
    try { localStorage.setItem('yaMarhabaScans', JSON.stringify(scans)); } catch {}
  }, [scans]);

  async function startScanning() {
    if (scanning) return;
    try {
      const { Html5Qrcode } = await import('html5-qrcode');
      const qr = new Html5Qrcode('qr-reader');
      scannerRef.current = qr;
      setScanning(true);

      await qr.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: 280 },
        async (decodedText) => {
          const parsed = parsePayload(decodedText);
          if (!parsed) {
            setMessage({ text: '❌ Invalid QR format (accepted: NAME|UUID, URL, UUID, or JSON)', type: 'error' });
            return;
          }
          const { code, name } = parsed;

          // de-dup rapid repeats of same code
          const now = Date.now();
          if (code === lastCodeRef.current && (now - lastAtRef.current) < DEDUP_MS) return;
          lastCodeRef.current = code; lastAtRef.current = now;

          const exists = scans.find((row) => row.code === code);
          if (exists) {
            setMessage({ text: `❌ Already scanned at ${exists.time}`, type: 'error' });
          } else {
            const row = { code, name: name || 'Guest', time: new Date().toLocaleString() };
            setScans(prev => [row, ...prev]);
            setMessage({ text: `✅ First time check-in for ${row.name}`, type: 'success' });
          }
        },
        () => {} // ignore frame decode errors
      );
    } catch (e) {
      console.error(e);
      setMessage({ text: `❌ Unable to start camera: ${e?.message || e}`, type: 'error' });
      setScanning(false);
    }
  }

  async function stopScanning() {
    try { await scannerRef.current?.stop(); } catch {}
    // small delay to let video detach
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    try { await scannerRef.current?.clear(); } catch {}
    scannerRef.current = null;
    setScanning(false);
  }

  return (
    <div style={{
      background: 'linear-gradient(135deg,#211915,#1A1410)',
      color: '#F5EFE8',
      minHeight: '100vh',
      padding: '20px',
      fontFamily: 'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial'
    }}>
      <div style={{maxWidth: 900, margin: '0 auto'}}>
        <header style={{display:'flex',alignItems:'center',gap:12, marginBottom:16}}>
          <div style={{
            width:44,height:44,borderRadius:12,
            background:'linear-gradient(180deg,#6B4226,#7E4B2B)',
            display:'grid',placeItems:'center', fontWeight:900, border:'1px solid #3B2E27'
          }}>YM</div>
          <div>
            <div style={{fontSize:12,letterSpacing:'.12em',opacity:.8}}>YA MARHABA</div>
            <h1 style={{margin:'4px 0 0',fontSize:22,fontWeight:800}}>Guest Check-In</h1>
          </div>
          <div style={{marginLeft:'auto'}}>
            {!scanning ? (
              <button onClick={startScanning} style={{
                padding:'14px 18px', fontSize:18, fontWeight:800, borderRadius:12,
                background:'#B0825C', color:'#1A1410', border:'1px solid #3B2E27', cursor:'pointer'
              }}>📷 Start scanning</button>
            ) : (
              <button onClick={stopScanning} style={{
                padding:'14px 18px', fontSize:18, fontWeight:800, borderRadius:12,
                background:'#A93226', color:'#fff', border:'1px solid #3B2E27', cursor:'pointer'
              }}>⏸ Pause</button>
            )}
          </div>
        </header>

        <section style={{background:'#241C18', border:'1px solid #3B2E27', borderRadius:16, padding:14}}>
          <div id="qr-reader" style={{
            margin:'0 auto', maxWidth:420, minHeight:280, background:'#2B211C',
            borderRadius:12, border:'1px dashed #B0825C', display:'grid', placeItems:'center'
          }}>
            {!scanning && <div style={{opacity:.7}}>Press “Start scanning” and allow camera</div>}
          </div>

          {message.text && (
            <div style={{
              marginTop:12, padding:12, borderRadius:12,
              background: message.type === 'success' ? '#1f3d2a' : '#3a1f1a',
              border: '1px solid #3B2E27', fontWeight:700
            }}>
              {message.text}
            </div>
          )}
        </section>

        <section style={{marginTop:16, background:'#241C18', border:'1px solid #3B2E27', borderRadius:16, padding:14}}>
          <div style={{display:'flex',alignItems:'center',gap:8, marginBottom:8}}>
            <h3 style={{margin:0}}>Checked-in (this device)</h3>
            <div style={{height:1, background:'#3B2E27', flex:1}}/>
            <span style={{fontSize:12,opacity:.7}}>{scans.length} total</span>
          </div>

          <div style={{overflowX:'auto'}}>
            <table style={{width:'100%', borderCollapse:'collapse'}}>
              <thead>
                <tr style={{background:'#2B211C', color:'#CBB8A0'}}>
                  <th style={th()}>#</th>
                  <th style={th()}>Guest</th>
                  <th style={th()}>Time</th>
                  <th style={th()}>Status</th>
                  <th style={th()}>Code</th>
                </tr>
              </thead>
              <tbody>
                {scans.length === 0 ? (
                  <tr><td colSpan={5} style={{...td(), textAlign:'center', opacity:.7}}>No scans yet.</td></tr>
                ) : (
                  scans.map((g, idx) => (
                    <tr key={`${g.code}-${idx}`} style={{background:'#2B211C', color:'#F5EFE8'}}>
                      <td style={td()}>{scans.length - idx}</td>
                      <td style={td()}>{g.name}</td>
                      <td style={td()}>{g.time}</td>
                      <td style={td()}>
                        <span style={{
                          display:'inline-block', width:10, height:10, borderRadius:999, background:'#22C55E',
                          boxShadow:'0 0 0 2px #241C18', verticalAlign:'middle', marginRight:6
                        }}/> First time
                      </td>
                      <td style={{...td(), fontFamily:'ui-monospace, SFMono-Regular, Menlo, monospace'}}>{g.code}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <p style={{marginTop:8, fontSize:12, opacity:.7}}>
            Saved in this browser (localStorage). Clearing site data resets this table.
          </p>
        </section>
      </div>
    </div>
  );
}

function th(){ return { textAlign:'left', padding:'10px 10px', borderBottom:'1px solid #3B2E27', fontSize:13, letterSpacing:'0.3px' }; }
function td(){ return { padding:'10px 10px', borderBottom:'1px solid #3B2E27' }; }
