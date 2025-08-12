'use client';
import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/src/lib/supabaseClient';
import RequireRole from '@/components/RequireRole';

const STORAGE_KEY = 'qr_checker_scans_v1';
const LANG_KEY = 'qr_checker_language';

export default function Checker() {
  const [user, setUser] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [cams, setCams] = useState([]);
  const [deviceId, setDeviceId] = useState('');
  const [running, setRunning] = useState(false);
  const [scans, setScans] = useState([]);
  const [lastStatus, setLastStatus] = useState(null); 
  const [lastTime, setLastTime] = useState(null);
  const [language, setLanguage] = useState('en'); // NEW

  const scansRef = useRef(scans);
  const seenRef = useRef(new Set());
  const qrRef = useRef(null);
  const manualRef = useRef(null);

  const translations = {
    en: {
      brand: "Ya Mar7aba - Scanner",
      findCams: "Find cameras",
      startScanner: "▶ Start Scanner",
      stopScanner: "■ Stop Scanner",
      firstScan: "✅ First Time Scan - Welcome!",
      alreadyScan: "❌ Already Scanned",
      cameraError: "Camera error:",
      manualAdd: "Manual add",
      manualPlaceholder: "UUID or QR URL",
      add: "Add",
      scansTitle: "Scans (this device)",
      noScans: "No scans yet",
      guest: "Guest",
      time: "Time",
      status: "Status",
      langSwitch: "عربي"
    },
    ar: {
      brand: "يا مرحبا - الماسح",
      findCams: "البحث عن الكاميرات",
      startScanner: "▶ بدء الماسح",
      stopScanner: "■ إيقاف الماسح",
      firstScan: "✅ أول مرة - أهلاً وسهلاً!",
      alreadyScan: "❌ تم المسح مسبقًا",
      cameraError: "خطأ في الكاميرا:",
      manualAdd: "إضافة يدويًا",
      manualPlaceholder: "المعرف أو رابط QR",
      add: "إضافة",
      scansTitle: "المسحات (هذا الجهاز)",
      noScans: "لا توجد مسحات حتى الآن",
      guest: "الضيف",
      time: "الوقت",
      status: "الحالة",
      langSwitch: "English"
    }
  };

  useEffect(() => {
    const storedLang = localStorage.getItem(LANG_KEY);
    if (storedLang) setLanguage(storedLang);

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

  function toggleLanguage() {
    const newLang = language === 'en' ? 'ar' : 'en';
    setLanguage(newLang);
    localStorage.setItem(LANG_KEY, newLang);
  }

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
    setLastTime(null);
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

    const existing = scansRef.current.find(r => r.id === id);
    const already = !!existing;
    const name = await fetchNameIfPossible(id);

    setScans(prev => [{ id, name, time: now, status: already ? 'ALREADY' : 'OK' }, ...prev]);
    seenRef.current.add(id);
    setLastStatus(already ? 'ALREADY' : 'OK');
    if (already) setLastTime(existing.time);
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
    const color = ok ? '#16a34a' : already ? '#f59e0b' : '#6b7280';
    return <span style={{ display: 'inline-block', width: 12, height: 12, borderRadius: '50%', background: color }} />;
  }

  const t = translations[language];

  return (
    <RequireRole role={['checker','admin']}>
      <div style={{ padding: 16, fontFamily: 'sans-serif', maxWidth: 820, margin: '0 auto', background: '#3E2723', color: '#fff', borderRadius: 8 }}>
        
        {/* Language Switch */}
        <div style={{ textAlign: 'right', marginBottom: 10 }}>
          <button onClick={toggleLanguage} style={{ background: '#8D6E63', color: '#fff', border: 'none', borderRadius: 4, padding: '6px 12px' }}>
            {t.langSwitch}
          </button>
        </div>

        <h1 style={{ textAlign: 'center', fontSize: 28, marginBottom: 20 }}>{t.brand}</h1>

        {/* Start/Stop Camera */}
        <div style={{ marginBottom: 12, display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
          {!cams.length && (
            <button onClick={listCameras} style={{ padding: '12px 20px', fontSize: 18, background: '#8D6E63', color: '#fff', border: 'none', borderRadius: 6 }}>{t.findCams}</button>
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
                <button onClick={startCamera} style={{ padding: '14px 28px', fontSize: 20, background: '#6D4C41', color: '#fff', border: 'none', borderRadius: 8 }}>{t.startScanner}</button>
              ) : (
                <button onClick={stopCamera} style={{ padding: '14px 28px', fontSize: 20, background: '#B71C1C', color: '#fff', border: 'none', borderRadius: 8 }}>{t.stopScanner}</button>
              )}
            </>
          )}
        </div>

        {/* Scanner Area */}
        <div id="qr-reader" style={{ width: 360, maxWidth: '100%', minHeight: 260, background: '#5D4037', margin: '0 auto', borderRadius: 8 }} />

        {/* Status Message */}
        {lastStatus === 'OK' && (
          <div style={{ background: '#2E7D32', padding: 12, marginTop: 10, borderRadius: 6, textAlign: 'center' }}>{t.firstScan}</div>
        )}
        {lastStatus === 'ALREADY' && (
          <div style={{ background: '#C62828', padding: 12, marginTop: 10, borderRadius: 6, textAlign: 'center' }}>
            {t.alreadyScan} {lastTime ? `(${lastTime})` : ''}
          </div>
        )}

        {/* Error */}
        {errorMsg && (
          <div style={{ marginTop: 10, padding: 10, background: '#FFCDD2', color: '#B71C1C', borderRadius: 6 }}>
            <b>{t.cameraError}</b> {errorMsg}
          </div>
        )}

        {/* Manual input */}
        <div style={{ marginTop: 14 }}>
          <h4>{t.manualAdd}</h4>
          <input ref={manualRef} placeholder={t.manualPlaceholder} style={{ width: 260, padding: 8, borderRadius: 6 }} />
          <button onClick={manualAdd} style={{ marginInlineStart: 8, padding: '8px 14px', background: '#8D6E63', color: '#fff', border: 'none', borderRadius: 6 }}>{t.add}</button>
        </div>

        {/* Table */}
        <div style={{ marginTop: 20 }}>
          <h3>{t.scansTitle}</h3>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', background: '#4E342E', borderRadius: 8, overflow: 'hidden' }}>
              <thead style={{ background: '#3E2723' }}>
                <tr>
                  <th style={{ padding: 8 }}>#</th>
                  <th style={{ padding: 8 }}>{t.guest}</th>
                  <th style={{ padding: 8 }}>{t.time}</th>
                  <th style={{ padding: 8 }}>{t.status}</th>
                </tr>
              </thead>
              <tbody>
                {scans.length === 0 ? (
                  <tr><td colSpan={4} style={{ padding: 12, textAlign: 'center', color: '#BCAAA4' }}>{t.noScans}</td></tr>
                ) : (
                  scans.map((r, idx) => (
                    <tr key={`${r.id}-${idx}`} style={{ borderBottom: '1px solid #6D4C41' }}>
                      <td style={{ padding: 8 }}>{scans.length - idx}</td>
                      <td style={{ padding: 8 }}>{r.name}</td>
                      <td style={{ padding: 8 }}>{r.time}</td>
                      <td style={{ padding: 8, textAlign: 'center' }}><Dot status={r.status} /></td>
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
