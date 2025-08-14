'use client';
import { useEffect, useState, useRef } from 'react';
import { supabase } from '@/src/lib/supabaseClient';
import RequireRole from '@/components/RequireRole';
import Papa from 'papaparse';
import QRCode from 'qrcode';

function randCode(len = 8) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

// ---- Theme ----
const BRAND = {
  bg: '#3E2723',
  card: '#4E342E',
  surface: '#5D4037',
  accent: '#8D6E63',
  primary: '#6D4C41',
  danger: '#B71C1C',
  text: '#FFF',
  textMuted: '#D7CCC8',
  border: '#6D4C41',
  inputBg: '#5D4037',
  inputBorder: '#795548',
};

const btn = (bg = BRAND.primary) => ({
  background: bg,
  color: '#fff',
  border: 'none',
  borderRadius: 10,
  padding: '12px 18px',
  fontSize: 16,
  cursor: 'pointer',
});
const input = {
  width: '100%',
  padding: '10px 12px',
  background: BRAND.inputBg,
  border: `1px solid ${BRAND.inputBorder}`,
  borderRadius: 10,
  color: BRAND.text,
  outline: 'none',
};
const label = { display: 'block', marginBottom: 6, color: BRAND.textMuted, fontSize: 13 };
const section = {
  background: BRAND.card,
  border: `1px solid ${BRAND.border}`,
  borderRadius: 16,
  padding: 16,
};
const h3 = { margin: 0, marginBottom: 12, fontSize: 18, fontWeight: 700 };

export default function Admin() {
  const [user, setUser] = useState(null);
  const [events, setEvents] = useState([]);
  const [selectedEventId, setSelectedEventId] = useState(null);
  const [guests, setGuests] = useState([]);
  const [invites, setInvites] = useState([]);
  const [title, setTitle] = useState('Wedding');
  const [venue, setVenue] = useState('Hall');
  const [startAt, setStartAt] = useState('');
  const [endAt, setEndAt] = useState('');
  const [designFile, setDesignFile] = useState(null);
  const [designUrl, setDesignUrl] = useState(null);

  // Added font to QR config
  const [qrCfg, setQrCfg] = useState({ xPct: 50, yPct: 85, sizePct: 25, transparent: true, font: 'Tahoma' });

  const previewRef = useRef(null);
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
  const DESIGN_BUCKET = 'invitation-designs';

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data.user));
  }, []);

  useEffect(() => { fetchEvents(); }, []);

  useEffect(() => {
    if (selectedEventId) {
      loadInvites(selectedEventId);
      loadDesign(selectedEventId);
      loadQrCfg(selectedEventId);
    } else {
      setInvites([]);
      setDesignUrl(null);
    }
  }, [selectedEventId]);

  async function fetchEvents() {
    const { data, error } = await supabase.from('events').select('id,title,start_at,created_at').order('created_at', { ascending: false });
    if (error) return alert('Failed to load events: ' + error.message);
    setEvents(data || []);
    if (!selectedEventId && data?.length) setSelectedEventId(data[0].id);
  }

  async function loadInvites(eventId) {
    const { data, error } = await supabase.from('invites').select('id,guest_name,code,status,created_at').eq('event_id', eventId).order('created_at', { ascending: true });
    if (error) return alert('Failed to load guests: ' + error.message);
    setInvites(data || []);
  }

  async function loadDesign(eventId) {
    const { data } = await supabase.storage.from(DESIGN_BUCKET).getPublicUrl(`${eventId}/design.png`);
    setDesignUrl(data?.publicUrl || null);
  }

  function loadQrCfg(eventId) {
    try {
      const raw = localStorage.getItem(`qr_cfg_${eventId}`);
      if (raw) setQrCfg(prev => ({ ...prev, ...JSON.parse(raw) }));
    } catch {}
  }
  function saveQrCfg() {
    if (!selectedEventId) return;
    localStorage.setItem(`qr_cfg_${selectedEventId}`, JSON.stringify(qrCfg));
    alert('QR placement & font saved for this event.');
  }

  async function createEvent() {
    if (!user) return alert('No user session');
    const { data, error } = await supabase.from('events').insert({
      title, venue, start_at: startAt || null, end_at: endAt || null, created_by: user.id
    }).select('id').single();
    if (error) return alert(error.message);
    await fetchEvents();
    setSelectedEventId(data.id);
    setInvites([]);
  }

  function handleCsv(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (res) => {
        const rows = (res.data || [])
          .map(r => ({ guest_name: (r.guest_name || r.name || '').trim(), guest_contact: (r.guest_contact || r.phone || r.email || '').trim() }))
          .filter(r => r.guest_name);
        setGuests(rows);
      }
    });
  }

  async function importGuests() {
    if (!selectedEventId) return alert('Please select or create an event first.');
    if (!guests.length) return alert('Please choose a CSV with at least one guest.');
    const rows = guests.map(g => ({ event_id: selectedEventId, guest_name: g.guest_name, guest_contact: g.guest_contact, code: randCode(8), status: 'PENDING' }));
    const { data, error } = await supabase.from('invites').insert(rows).select('*');
    if (error) return alert(error.message);
    setInvites(prev => [...(prev || []), ...(data || [])]);
  }

  async function uploadDesign() {
    if (!designFile) return alert('Choose a design image first.');
    if (!selectedEventId) return alert('Select an event first.');
    const path = `${selectedEventId}/design.png`;
    const { error } = await supabase.storage.from(DESIGN_BUCKET).upload(path, designFile, { upsert: true, contentType: designFile.type || 'image/png' });
    if (error) return alert(error.message);
    await loadDesign(selectedEventId);
  }

  async function downloadCSV() {
    const head = 'guest_name,code,invite_url\n';
    const lines = (invites || []).map(iv => `${csvSafe(iv.guest_name)},${csvSafe(iv.code)},${baseUrl}/i/${iv.id}`);
    const blob = new Blob([head + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'invites.csv';
    a.click();
  }

  function csvSafe(s = '') {
    const t = String(s ?? '');
    return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  }

  useEffect(() => { renderPreview(); }, [designUrl, qrCfg, selectedEventId]);

  async function renderPreview() {
    const canvas = previewRef.current;
    if (!canvas || !designUrl) return;
    const ctx = canvas.getContext('2d');
    const img = await loadImage(designUrl);
    const scale = img.width > 520 ? 520 / img.width : 1;
    const w = Math.round(img.width * scale);
    const h = Math.round(img.height * scale);
    canvas.width = w;
    canvas.height = h;
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);

    const qrSize = Math.round((qrCfg.sizePct / 100) * w);
    const cx = Math.round((qrCfg.xPct / 100) * w);
    const cy = Math.round((qrCfg.yPct / 100) * h);
    const x = cx - Math.floor(qrSize / 2);
    const y = cy - Math.floor(qrSize / 2);

    ctx.strokeStyle = '#00E676';
    ctx.fillStyle = 'rgba(0, 230, 118, 0.15)';
    ctx.fillRect(x, y, qrSize, qrSize);
    ctx.strokeRect(x, y, qrSize, qrSize);

    const previewQr = await QRCode.toDataURL('SAMPLE', { width: qrSize, margin: 0, color: { dark: '#000000', light: qrCfg.transparent ? '#0000' : '#FFFFFF' } });
    const qrImg = await loadImage(previewQr);
    ctx.drawImage(qrImg, x, y, qrSize, qrSize);

    const guestName = 'الضيفة المكرمة\nالضيف';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.direction = 'rtl';
    ctx.fillStyle = '#000';
    ctx.font = `bold ${Math.max(14, Math.floor(qrSize * 0.18))}px ${qrCfg.font}, Arial, sans-serif`;
    ctx.fillText(guestName, cx, y + qrSize + Math.round(qrSize * 0.08));
  }

  async function downloadQRCodes() {
    if (!designUrl) return alert('Upload a design first.');
    const designImg = await loadImage(designUrl);
    for (const iv of invites || []) {
      const qrUrl = `${baseUrl}/i/${iv.id}`;
      const guestName = `الضيفة المكرمة\n${iv.guest_name || 'الضيف'}`;
      const qrSizePx = Math.floor((qrCfg.sizePct / 100) * designImg.width);
      const qrDataUrl = await QRCode.toDataURL(qrUrl, { width: qrSizePx, margin: 0, color: { dark: '#000000', light: qrCfg.transparent ? '#0000' : '#FFFFFF' } });
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      canvas.width = designImg.width;
      canvas.height = designImg.height;
      ctx.drawImage(designImg, 0, 0);

      const cx = Math.floor((qrCfg.xPct / 100) * designImg.width);
      const cy = Math.floor((qrCfg.yPct / 100) * designImg.height);
      const x = cx - Math.floor(qrSizePx / 2);
      const y = cy - Math.floor(qrSizePx / 2);

      const qrImg = await loadImage(qrDataUrl);
      ctx.drawImage(qrImg, x, y, qrSizePx, qrSizePx);

      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.direction = 'rtl';
      ctx.fillStyle = '#000';
      ctx.font = `bold ${Math.max(14, Math.floor(qrSizePx * 0.18))}px ${qrCfg.font}, Arial, sans-serif`;
      ctx.fillText(guestName, cx, y + qrSizePx + Math.round(qrSizePx * 0.08));

      const outUrl = canvas.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = outUrl;
      a.download = `${iv.guest_name || 'guest'}_${iv.code}.png`;
      a.click();
      await new Promise(r => setTimeout(r, 120));
    }
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  return (
    <RequireRole role="admin">
      <div style={{ minHeight: '100vh', background: BRAND.bg, color: BRAND.text, padding: 16 }}>
        <header style={{ textAlign: 'center', marginBottom: 18 }}>
          <h1>Ya Mar7aba – Admin</h1>
        </header>
        <div style={{ maxWidth: 1000, margin: '0 auto', display: 'grid', gap: 16 }}>
          {/* Invitation Design */}
          <section style={section}>
            <h3 style={h3}>Invitation Design & QR Placement</h3>
            {designUrl && (
              <>
                <canvas ref={previewRef} style={{ width: '100%', borderRadius: 12 }} />
                <label style={label}>Font</label>
                <select value={qrCfg.font} onChange={(e) => setQrCfg(v => ({ ...v, font: e.target.value }))} style={{ ...input, maxWidth: 200 }}>
                  <option value="Tahoma">Tahoma</option>
                  <option value="Arial">Arial</option>
                  <option value="Cairo">Cairo</option>
                  <option value="Amiri">Amiri</option>
                  <option value="Times New Roman">Times New Roman</option>
                </select>
                <button style={btn(BRAND.accent)} onClick={saveQrCfg}>Save QR placement</button>
              </>
            )}
            <input type="file" accept="image/*" onChange={(e) => setDesignFile(e.target.files?.[0] || null)} />
            <button style={btn(BRAND.accent)} onClick={uploadDesign}>Upload/Replace Design</button>
          </section>
          <button style={btn()} onClick={downloadQRCodes}>Generate Invitations</button>
        </div>
      </div>
    </RequireRole>
  );
}
