'use client';
import { useEffect, useState, useRef } from 'react';
import { supabase } from '@/src/lib/supabaseClient';
import RequireRole from '@/components/RequireRole';
import Papa from 'papaparse';
import QRCode from 'qrcode';
import { jsPDF } from 'jspdf';
import { PDFDocument } from 'pdf-lib';

/** ---------- Utilities ---------- */

function randCode(len = 8) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

function csvSafe(s = '') {
  const t = String(s ?? '');
  return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/** Renders Arabic text to a transparent canvas -> DataURL PNG (for PDF embedding) */
async function renderTextToDataURL({ text, font = 'Madani Arabic', color = '#77758e', fontPx = 48 }) {
  // Ensure the font is loaded (if available via @font-face)
  try {
    if (document?.fonts?.load) {
      await document.fonts.load(`bold ${fontPx}px "${font}"`);
    }
  } catch {}
  const pad = Math.max(8, Math.round(fontPx * 0.3));
  const tmp = document.createElement('canvas');
  const ctx = tmp.getContext('2d');
  ctx.direction = 'rtl';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `bold ${fontPx}px "${font}", "Cairo", "Amiri", "Noto Naskh Arabic", Tahoma, Arial, sans-serif`;

  // Measure
  const metrics = ctx.measureText(text || '');
  const w = Math.max(2, Math.ceil(metrics.width) + pad * 2);
  const h = Math.max(2, Math.ceil(fontPx * 1.6) + pad * 2);
  tmp.width = w;
  tmp.height = h;

  // Re-set font after resize
  const ctx2 = tmp.getContext('2d');
  ctx2.direction = 'rtl';
  ctx2.textAlign = 'center';
  ctx2.textBaseline = 'middle';
  ctx2.font = `bold ${fontPx}px "${font}", "Cairo", "Amiri", "Noto Naskh Arabic", Tahoma, Arial, sans-serif`;
  ctx2.fillStyle = color;
  ctx2.shadowColor = 'rgba(0,0,0,0.12)';
  ctx2.shadowBlur = Math.round(fontPx * 0.06);
  ctx2.shadowOffsetY = Math.round(fontPx * 0.04);
  ctx2.fillText(text || '', w / 2, h / 2);

  return { dataUrl: tmp.toDataURL('image/png'), w, h };
}

/** ---------- Theme ---------- */

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

function thStyle() {
  return { textAlign: 'left', color: BRAND.textMuted, padding: '10px 12px', borderBottom: `1px solid ${BRAND.border}`, fontSize: 13 };
}
function tdStyle() {
  return { padding: '12px 10px' };
}

/** ---------- Page ---------- */

export default function Admin() {
  const [user, setUser] = useState(null);

  // Events + selection
  const [events, setEvents] = useState([]);
  const [selectedEventId, setSelectedEventId] = useState(null);

  // CSV -> guests to insert
  const [guests, setGuests] = useState([]);

  // Invites for the selected event
  const [invites, setInvites] = useState([]);

  // Event form
  const [title, setTitle] = useState('Wedding');
  const [venue, setVenue] = useState('Hall');
  const [startAt, setStartAt] = useState('');
  const [endAt, setEndAt] = useState('');

  // Invitation design in Supabase Storage
  const DESIGN_BUCKET = 'invitation-designs'; // must exist & be public-read
  const [designMeta, setDesignMeta] = useState(null);
  // designMeta: { type: 'image'|'pdf', url: string, path: string, ext: string }

  // QR config (center x/y as %, size as % of width)
  const [qrCfg, setQrCfg] = useState({
    xPct: 50, yPct: 85, sizePct: 25,
    transparent: true,
    color: '#77758e',
  });

  // Text config (center x/y %, size % of width, color, font)
  const [textCfg, setTextCfg] = useState({
    xPct: 50, yPct: 92, sizePct: 6,
    color: '#77758e',
    font: 'Madani Arabic',
  });

  const previewRef = useRef(null);
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';

  /** ------ Auth & initial load ------ */
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data.user));
  }, []);

  useEffect(() => { fetchEvents(); }, []);

  useEffect(() => {
    if (selectedEventId) {
      loadInvites(selectedEventId);
      discoverDesign(selectedEventId);
      loadCfgs(selectedEventId);
    } else {
      setInvites([]);
      setDesignMeta(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEventId]);

  /** ------ Events / Invites ------ */

  async function fetchEvents() {
    const { data, error } = await supabase
      .from('events')
      .select('id,title,start_at,created_at')
      .order('created_at', { ascending: false });

    if (error) return alert('Failed to load events: ' + error.message);
    setEvents(data || []);
    if (!selectedEventId && data?.length) setSelectedEventId(data[0].id);
  }

  async function loadInvites(eventId) {
    const { data, error } = await supabase
      .from('invites')
      .select('id,guest_name,code,status,created_at')
      .eq('event_id', eventId)
      .order('created_at', { ascending: true });

    if (error) return alert('Failed to load guests: ' + error.message);
    setInvites(data || []);
  }

  async function createEvent() {
    if (!user) return alert('No user session');
    const { data, error } = await supabase
      .from('events')
      .insert({
        title,
        venue,
        start_at: startAt || null,
        end_at: endAt || null,
        created_by: user.id,
      })
      .select('id')
      .single();

    if (error) return alert(error.message);
    alert('Event created');
    await fetchEvents();
    setSelectedEventId(data.id);
    setInvites([]);
  }

  /** ------ Guests CSV ------ */

  function handleCsv(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (res) => {
        const rows = (res.data || [])
          .map((r) => ({
            guest_name: (r.guest_name || r.name || '').trim(),
            guest_contact: (r.guest_contact || r.phone || r.email || '').trim(),
          }))
          .filter((r) => r.guest_name);
        setGuests(rows);
      },
    });
  }

  async function importGuests() {
    if (!selectedEventId) return alert('Please select or create an event first.');
    if (!guests.length) return alert('Please choose a CSV with at least one guest.');

    const rows = guests.map((g) => ({
      event_id: selectedEventId,
      guest_name: g.guest_name,
      guest_contact: g.guest_contact,
      code: randCode(8),
      status: 'PENDING',
    }));

    const { data, error } = await supabase.from('invites').insert(rows).select('*');
    if (error) return alert(error.message);

    setInvites((prev) => [...(prev || []), ...(data || [])]);
    alert(`Imported ${data?.length || 0} guests`);
  }

  async function downloadCSV() {
    const head = 'guest_name,code,invite_url\n';
    const lines = (invites || []).map(
      (iv) => `${csvSafe(iv.guest_name)},${csvSafe(iv.code)},${baseUrl}/i/${iv.id}`
    );
    const blob = new Blob([head + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'invites.csv';
    a.click();
  }

  /** ------ Design upload / discovery ------ */

  function saveDesignMetaLocal(eventId, meta) {
    localStorage.setItem(`design_meta_${eventId}`, JSON.stringify(meta));
  }
  function loadDesignMetaLocal(eventId) {
    try {
      const raw = localStorage.getItem(`design_meta_${eventId}`);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }

  async function discoverDesign(eventId) {
    // First try local meta (fast & reliable if you uploaded from this browser)
    const meta = loadDesignMetaLocal(eventId);
    if (meta?.url && meta?.type) {
      setDesignMeta(meta);
      return;
    }
    // Otherwise, list bucket to detect design file (design.*)
    const { data, error } = await supabase.storage.from(DESIGN_BUCKET).list(`${eventId}`, { limit: 50 });
    if (error) {
      console.error(error);
      setDesignMeta(null);
      return;
    }
    const file = (data || []).find(f => /^design\.(png|jpg|jpeg|pdf)$/i.test(f.name));
    if (!file) { setDesignMeta(null); return; }
    const ext = file.name.split('.').pop().toLowerCase();
    const path = `${eventId}/${file.name}`;
    const { data: pub } = supabase.storage.from(DESIGN_BUCKET).getPublicUrl(path);
    const type = ext === 'pdf' ? 'pdf' : 'image';
    const detected = { type, url: pub?.publicUrl, path, ext };
    setDesignMeta(detected);
    saveDesignMetaLocal(eventId, detected);
  }

  async function uploadDesign(e) {
    const file = e?.target?.files?.[0];
    if (!file) return alert('Choose a design file first.');
    if (!selectedEventId) return alert('Select an event first.');

    const isPDF = /pdf$/i.test(file.type) || /\.pdf$/i.test(file.name);
    const ext = isPDF ? 'pdf' : (file.name.split('.').pop().toLowerCase() || 'png');
    const path = `${selectedEventId}/design.${ext}`;

    const { error } = await supabase
      .storage
      .from(DESIGN_BUCKET)
      .upload(path, file, { upsert: true, contentType: file.type || (isPDF ? 'application/pdf' : 'image/png') });

    if (error) return alert(error.message);

    const { data: pub } = supabase.storage.from(DESIGN_BUCKET).getPublicUrl(path);
    const meta = { type: isPDF ? 'pdf' : 'image', url: pub?.publicUrl, path, ext };
    setDesignMeta(meta);
    saveDesignMetaLocal(selectedEventId, meta);
    alert('Design uploaded');
  }

  /** ------ Save/Load config ------ */
  function loadCfgs(eventId) {
    try {
      const qraw = localStorage.getItem(`qr_cfg_${eventId}`); 
      if (qraw) setQrCfg(v => ({ ...v, ...JSON.parse(qraw) }));
      const traw = localStorage.getItem(`text_cfg_${eventId}`);
      if (traw) setTextCfg(v => ({ ...v, ...JSON.parse(traw) }));
    } catch {}
  }

  function saveCfgs() {
    if (!selectedEventId) return;
    localStorage.setItem(`qr_cfg_${selectedEventId}`, JSON.stringify(qrCfg));
    localStorage.setItem(`text_cfg_${selectedEventId}`, JSON.stringify(textCfg));
    alert('Saved positions/colors/fonts for this event.');
  }

  function resetCfgs() {
    setQrCfg({ xPct: 50, yPct: 85, sizePct: 25, transparent: true, color: '#77758e' });
    setTextCfg({ xPct: 50, yPct: 92, sizePct: 6, color: '#77758e', font: 'Madani Arabic' });
  }

  /** ------ Preview (image only; PDF shows guidance) ------ */
  useEffect(() => {
    renderPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [designMeta, qrCfg, textCfg, selectedEventId]);

  async function renderPreview() {
    const canvas = previewRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (!designMeta?.url) {
      canvas.width = 520; canvas.height = 300;
      ctx.fillStyle = '#000';
      ctx.fillRect(0,0,canvas.width,canvas.height);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 18px Arial';
      ctx.fillText('Upload a design to preview', 20, 40);
      return;
    }

    if (designMeta.type === 'image') {
      const img = await loadImage(designMeta.url);
      const maxW = 520;
      const scale = img.width > maxW ? maxW / img.width : 1;
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      canvas.width = w; canvas.height = h;
      ctx.drawImage(img, 0, 0, w, h);

      // Draw QR overlay box
      const qrSize = Math.round((qrCfg.sizePct / 100) * w);
      const qcx = Math.round((qrCfg.xPct / 100) * w);
      const qcy = Math.round((qrCfg.yPct / 100) * h);
      const qx = qcx - Math.floor(qrSize / 2);
      const qy = qcy - Math.floor(qrSize / 2);

      ctx.save();
      ctx.strokeStyle = '#00E676';
      ctx.lineWidth = 2;
      ctx.fillStyle = 'rgba(0, 230, 118, 0.12)';
      ctx.fillRect(qx, qy, qrSize, qrSize);
      ctx.strokeRect(qx, qy, qrSize, qrSize);

      // Simulated QR color box
      ctx.strokeStyle = qrCfg.color || '#77758e';
      ctx.strokeRect(qx + 8, qy + 8, qrSize - 16, qrSize - 16);
      ctx.restore();

      // Text overlay marker (center point)
      const tx = Math.round((textCfg.xPct / 100) * w);
      const ty = Math.round((textCfg.yPct / 100) * h);
      ctx.save();
      ctx.fillStyle = textCfg.color || '#77758e';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      try { await document.fonts.load(`bold ${Math.round((textCfg.sizePct/100)*w)}px "${textCfg.font}"`); } catch {}
      ctx.font = `bold ${Math.max(12, Math.round((textCfg.sizePct/100)*w))}px "${textCfg.font}", "Cairo", "Amiri", "Noto Naskh Arabic", Tahoma, Arial, sans-serif`;
      ctx.direction = 'rtl';
      ctx.fillText('اسم الضيف', tx, ty);
      ctx.restore();
    } else {
      // PDF preview guidance
      canvas.width = 520; canvas.height = 320;
      ctx.fillStyle = '#111'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#eee';
      ctx.font = 'bold 16px Arial';
      ctx.fillText('PDF design loaded (preview simplified)', 16, 34);

      // Show relative boxes
      const w = canvas.width, h = canvas.height;
      const qrSize = Math.round((qrCfg.sizePct / 100) * w);
      const qcx = Math.round((qrCfg.xPct / 100) * w);
      const qcy = Math.round((qrCfg.yPct / 100) * h);
      const qx = qcx - Math.floor(qrSize / 2);
      const qy = qcy - Math.floor(qrSize / 2);

      ctx.save();
      ctx.strokeStyle = '#00E676'; ctx.lineWidth = 2;
      ctx.fillStyle = 'rgba(0, 230, 118, 0.12)';
      ctx.fillRect(qx, qy, qrSize, qrSize);
      ctx.strokeRect(qx, qy, qrSize, qrSize);
      ctx.restore();

      const tx = Math.round((textCfg.xPct / 100) * w);
      const ty = Math.round((textCfg.yPct / 100) * h);
      ctx.save();
      ctx.fillStyle = textCfg.color || '#77758e';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `bold ${Math.max(12, Math.round((textCfg.sizePct/100)*w))}px "${textCfg.font}", Arial, sans-serif`;
      ctx.direction = 'rtl';
      ctx.fillText('اسم الضيف', tx, ty);
      ctx.restore();

      ctx.fillStyle = '#bbb';
      ctx.font = '13px Arial';
      ctx.fillText('Exports will render on top of the original PDF at full quality.', 16, canvas.height - 16);
    }
  }

  /** ------ Exports ------ */

  function inviteUrl(iv) {
    return `${baseUrl}/i/${iv.id}`;
  }

  // Image design: draw base image + QR + text on canvas
  async function renderInviteToCanvas(img, iv) {
    const url = inviteUrl(iv);
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    canvas.width = img.width;
    canvas.height = img.height;

    // Draw background
    ctx.drawImage(img, 0, 0);

    // QR
    const qrSizePx = Math.floor((qrCfg.sizePct / 100) * canvas.width);
    const qrDataUrl = await QRCode.toDataURL(url, {
      width: qrSizePx,
      margin: 0,
      color: { dark: qrCfg.color || '#77758e', light: qrCfg.transparent ? '#0000' : '#FFFFFF' },
    });
    const qrImg = await loadImage(qrDataUrl);
    const qcx = Math.floor((qrCfg.xPct / 100) * canvas.width);
    const qcy = Math.floor((qrCfg.yPct / 100) * canvas.height);
    ctx.drawImage(qrImg, qcx - qrSizePx / 2, qcy - qrSizePx / 2, qrSizePx, qrSizePx);

    // Text
    const name = (iv.guest_name || '').trim() || 'الضيف';
    const fontPx = Math.max(10, Math.round((textCfg.sizePct / 100) * canvas.width));
    try { await document.fonts.load(`bold ${fontPx}px "${textCfg.font}"`); } catch {}
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.direction = 'rtl';
    ctx.fillStyle = textCfg.color || '#77758e';
    ctx.font = `bold ${fontPx}px "${textCfg.font}", "Cairo","Amiri","Noto Naskh Arabic",Tahoma,Arial,sans-serif`;
    const tcx = Math.floor((textCfg.xPct / 100) * canvas.width);
    const tcy = Math.floor((textCfg.yPct / 100) * canvas.height);
    ctx.shadowColor = 'rgba(0,0,0,0.14)';
    ctx.shadowBlur = Math.round(fontPx * 0.06);
    ctx.shadowOffsetY = Math.round(fontPx * 0.04);
    ctx.fillText(name, tcx, tcy);

    return canvas;
  }

  // PDF design: draw on top of original PDF page using pdf-lib
  async function renderInviteToPdfBytesPDFDesign(designPdfBytes, iv) {
    const url = inviteUrl(iv);
    const srcDoc = await PDFDocument.load(designPdfBytes);
    const outDoc = await PDFDocument.create();
    const [page] = await outDoc.copyPages(srcDoc, [0]);
    outDoc.addPage(page);

    const pageW = page.getWidth();
    const pageH = page.getHeight();

    // QR
    const qrW = (qrCfg.sizePct / 100) * pageW;
    const qrPx = Math.max(64, Math.round(qrW)); // render PNG at close resolution
    const qrDataUrl = await QRCode.toDataURL(url, {
      width: qrPx,
      margin: 0,
      color: { dark: qrCfg.color || '#77758e', light: qrCfg.transparent ? '#0000' : '#FFFFFF' },
    });
    const qrBytes = await (await fetch(qrDataUrl)).arrayBuffer();
    const qrImg = await outDoc.embedPng(qrBytes);
    const qcx = (qrCfg.xPct / 100) * pageW;
    const qcyTop = (qrCfg.yPct / 100) * pageH;
    const qcyBottom = pageH - qcyTop;
    page.drawImage(qrImg, {
      x: qcx - qrW / 2,
      y: qcyBottom - qrW / 2,
      width: qrW,
      height: qrW,
    });

    // Text as image (Arabic shaping safe)
    const name = (iv.guest_name || '').trim() || 'الضيف';
    const fontPx = Math.max(10, Math.round((textCfg.sizePct / 100) * pageW));
    const { dataUrl: txtPng, w: txtWpx, h: txtHpx } = await renderTextToDataURL({
      text: name,
      font: textCfg.font || 'Madani Arabic',
      color: textCfg.color || '#77758e',
      fontPx,
    });
    const txtBytes = await (await fetch(txtPng)).arrayBuffer();
    const txtImg = await outDoc.embedPng(txtBytes);

    const tcx = (textCfg.xPct / 100) * pageW;
    const tcyTop = (textCfg.yPct / 100) * pageH;
    const tcyBottom = pageH - tcyTop;
    const drawW = txtWpx; // 1 px ≈ 1 pt
    const drawH = txtHpx;

    page.drawImage(txtImg, {
      x: tcx - drawW / 2,
      y: tcyBottom - drawH / 2,
      width: drawW,
      height: drawH,
    });

    return await outDoc.save();
  }

  /** Export helpers */

  async function exportPNGs() {
    if (!designMeta || designMeta.type !== 'image') return;
    const img = await loadImage(designMeta.url);
    for (const iv of invites || []) {
      const canvas = await renderInviteToCanvas(img, iv);
      const a = document.createElement('a');
      a.href = canvas.toDataURL('image/png');
      a.download = `${(iv.guest_name || 'guest').replace(/[\\/:*?"<>|]/g, '_')}_${iv.code || ''}.png`;
      a.click();
      await sleep(120);
    }
  }

  async function exportJPGs() {
    if (!designMeta || designMeta.type !== 'image') return;
    const img = await loadImage(designMeta.url);
    for (const iv of invites || []) {
      const canvas = await renderInviteToCanvas(img, iv);
      const a = document.createElement('a');
      a.href = canvas.toDataURL('image/jpeg', 0.92);
      a.download = `${(iv.guest_name || 'guest').replace(/[\\/:*?"<>|]/g, '_')}_${iv.code || ''}.jpg`;
      a.click();
      await sleep(120);
    }
  }

  async function exportPDFs() {
    if (!designMeta) return;

    if (designMeta.type === 'image') {
      // Build PDF from image canvas (jsPDF)
      const img = await loadImage(designMeta.url);
      for (const iv of invites || []) {
        const canvas = await renderInviteToCanvas(img, iv);
        // points
        const w = canvas.width, h = canvas.height;
        const doc = new jsPDF({ unit: 'pt', format: [w, h] });
        const dataUrl = canvas.toDataURL('image/png');
        doc.addImage(dataUrl, 'PNG', 0, 0, w, h);
        doc.save(`${(iv.guest_name || 'guest').replace(/[\\/:*?"<>|]/g, '_')}_${iv.code || ''}.pdf`);
        await sleep(120);
      }
    } else {
      // High quality: draw over original PDF using pdf-lib
      const bytes = await (await fetch(designMeta.url)).arrayBuffer();
      for (const iv of invites || []) {
        const outBytes = await renderInviteToPdfBytesPDFDesign(bytes, iv);
        const blob = new Blob([outBytes], { type: 'application/pdf' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${(iv.guest_name || 'guest').replace(/[\\/:*?"<>|]/g, '_')}_${iv.code || ''}.pdf`;
        a.click();
        await sleep(120);
      }
    }
  }

  /** ---------- UI ---------- */

  return (
    <RequireRole role="admin">
      <div style={{
        minHeight: '100vh',
        background: BRAND.bg,
        color: BRAND.text,
        fontFamily: 'sans-serif',
        padding: 16,
      }}>
        <header style={{ textAlign: 'center', marginBottom: 18 }}>
          <h1 style={{ margin: 0, fontSize: 28 }}>Ya Mar7aba – Admin</h1>
          <p style={{ margin: 0, color: BRAND.textMuted, fontSize: 13 }}>
            Manage events, guests, and high‑quality invitations (Image/PDF)
          </p>
        </header>

        <div style={{ maxWidth: 1100, margin: '0 auto', display: 'grid', gap: 16, gridTemplateColumns: '1fr' }}>
          {/* Row 1: Event picker + Create event */}
          <div style={{ display: 'grid', gap: 16, gridTemplateColumns: '1fr 1fr' }}>
            {/* Event Picker */}
            <section style={section}>
              <h3 style={h3}>Select event</h3>
              {events.length === 0 && <p style={{ color: BRAND.textMuted }}>No events yet. Create one on the right.</p>}
              {events.length > 0 && (
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <select
                    value={selectedEventId || ''}
                    onChange={(e) => setSelectedEventId(e.target.value || null)}
                    style={{ ...input, maxWidth: 380 }}
                  >
                    {events.map((ev) => (
                      <option key={ev.id} value={ev.id}>{ev.title}</option>
                    ))}
                  </select>
                  <button style={btn(BRAND.accent)} onClick={() => selectedEventId && loadInvites(selectedEventId)}>Refresh guests</button>
                  <button style={btn(BRAND.accent)} onClick={fetchEvents}>Refresh events</button>
                </div>
              )}
            </section>

            {/* Create Event */}
            <section style={section}>
              <h3 style={h3}>Create event</h3>
              <label style={label}>Title</label>
              <input style={input} value={title} onChange={(e) => setTitle(e.target.value)} />
              <div style={{ height: 10 }} />
              <label style={label}>Venue</label>
              <input style={input} value={venue} onChange={(e) => setVenue(e.target.value)} />
              <div style={{ height: 10 }} />
              <label style={label}>Start</label>
              <input style={input} type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} />
              <div style={{ height: 10 }} />
              <label style={label}>End</label>
              <input style={input} type="datetime-local" value={endAt} onChange={(e) => setEndAt(e.target.value)} />
              <div style={{ height: 14 }} />
              <button style={btn()} onClick={createEvent}>Create</button>
            </section>
          </div>

          {/* Row 2: Invitation Design + Placement */}
          <div style={{ display: 'grid', gap: 16, gridTemplateColumns: '1.3fr 1fr' }}>
            {/* Invitation Design + Preview */}
            <section style={section}>
              <h3 style={h3}>Invitation Design & Live Preview</h3>

              <div style={{ marginBottom: 10 }}>
                <canvas ref={previewRef} style={{ width: '100%', borderRadius: 12, border: `1px solid ${BRAND.border}`, background: '#000' }} />
              </div>

              <div style={{ display: 'grid', gap: 12, gridTemplateColumns: '1fr 1fr' }}>
                <div>
                  <label style={label}>Upload design (PNG/JPG or PDF)</label>
                  <input
                    type="file"
                    accept="image/*,application/pdf"
                    onChange={uploadDesign}
                    style={{ ...input, padding: 8, background: 'transparent', border: '1px dashed ' + BRAND.inputBorder }}
                  />
                  <p style={{ color: BRAND.textMuted, fontSize: 12, marginTop: 8 }}>
                    Stored at: <code>invitation-designs/{selectedEventId || 'eventId'}/design.(png|jpg|pdf)</code><br />
                    {designMeta?.type ? `Detected: ${designMeta.type.toUpperCase()}` : 'No design detected'}
                  </p>
                </div>
                <div>
                  <label style={label}>Quick actions</label>
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    <button style={btn(BRAND.accent)} onClick={saveCfgs}>Save positions/colors/fonts</button>
                    <button style={btn(BRAND.danger)} onClick={resetCfgs}>Reset positions</button>
                  </div>
                </div>
              </div>
            </section>

            {/* Placement Controls */}
            <section style={section}>
              <h3 style={h3}>Placement & Style</h3>

              <div style={{ display: 'grid', gap: 16 }}>
                {/* QR Controls */}
                <div style={{ border: `1px dashed ${BRAND.inputBorder}`, borderRadius: 12, padding: 12 }}>
                  <h4 style={{ margin: 0, marginBottom: 10 }}>QR</h4>
                  <div style={{ display: 'grid', gap: 12, gridTemplateColumns: '1fr 1fr' }}>
                    <div>
                      <label style={label}>X (%)</label>
                      <input type="range" min="0" max="100" value={qrCfg.xPct}
                             onChange={e => setQrCfg(v => ({ ...v, xPct: Number(e.target.value) }))} style={{ width: '100%' }} />
                      <div style={{ color: BRAND.textMuted, fontSize: 12 }}>{qrCfg.xPct}%</div>
                    </div>
                    <div>
                      <label style={label}>Y (%)</label>
                      <input type="range" min="0" max="100" value={qrCfg.yPct}
                             onChange={e => setQrCfg(v => ({ ...v, yPct: Number(e.target.value) }))} style={{ width: '100%' }} />
                      <div style={{ color: BRAND.textMuted, fontSize: 12 }}>{qrCfg.yPct}%</div>
                    </div>
                    <div>
                      <label style={label}>Size (% of width)</label>
                      <input type="range" min="5" max="50" value={qrCfg.sizePct}
                             onChange={e => setQrCfg(v => ({ ...v, sizePct: Number(e.target.value) }))} style={{ width: '100%' }} />
                      <div style={{ color: BRAND.textMuted, fontSize: 12 }}>{qrCfg.sizePct}%</div>
                    </div>
                    <div>
                      <label style={label}>QR color</label>
                      <input type="color" value={qrCfg.color}
                             onChange={e => setQrCfg(v => ({ ...v, color: e.target.value }))} />
                      <span style={{ marginInlineStart: 8, color: BRAND.textMuted, fontSize: 12 }}>{qrCfg.color}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <input id="qrTransparent" type="checkbox" checked={qrCfg.transparent}
                             onChange={e => setQrCfg(v => ({ ...v, transparent: e.target.checked }))} />
                      <label htmlFor="qrTransparent" style={{ margin: 0 }}>Transparent QR background</label>
                    </div>
                  </div>
                </div>

                {/* Text Controls */}
                <div style={{ border: `1px dashed ${BRAND.inputBorder}`, borderRadius: 12, padding: 12 }}>
                  <h4 style={{ margin: 0, marginBottom: 10 }}>Guest name (Arabic)</h4>
                  <div style={{ display: 'grid', gap: 12, gridTemplateColumns: '1fr 1fr' }}>
                    <div>
                      <label style={label}>X (%)</label>
                      <input type="range" min="0" max="100" value={textCfg.xPct}
                             onChange={e => setTextCfg(v => ({ ...v, xPct: Number(e.target.value) }))} style={{ width: '100%' }} />
                      <div style={{ color: BRAND.textMuted, fontSize: 12 }}>{textCfg.xPct}%</div>
                    </div>
                    <div>
                      <label style={label}>Y (%)</label>
                      <input type="range" min="0" max="100" value={textCfg.yPct}
                             onChange={e => setTextCfg(v => ({ ...v, yPct: Number(e.target.value) }))} style={{ width: '100%' }} />
                      <div style={{ color: BRAND.textMuted, fontSize: 12 }}>{textCfg.yPct}%</div>
                    </div>
                    <div>
                      <label style={label}>Font size (% of width)</label>
                      <input type="range" min="2" max="20" value={textCfg.sizePct}
                             onChange={e => setTextCfg(v => ({ ...v, sizePct: Number(e.target.value) }))} style={{ width: '100%' }} />
                      <div style={{ color: BRAND.textMuted, fontSize: 12 }}>{textCfg.sizePct}%</div>
                    </div>
                    <div>
                      <label style={label}>Text color</label>
                      <input type="color" value={textCfg.color}
                             onChange={e => setTextCfg(v => ({ ...v, color: e.target.value }))} />
                      <span style={{ marginInlineStart: 8, color: BRAND.textMuted, fontSize: 12 }}>{textCfg.color}</span>
                    </div>
                    <div>
                      <label style={label}>Arabic Font</label>
                      <select
                        value={textCfg.font}
                        onChange={e => setTextCfg(v => ({ ...v, font: e.target.value }))}
                        style={{ ...input, maxWidth: 260 }}
                      >
                        <option value="Madani Arabic">Madani Arabic</option>
                        <option value="Cairo">Cairo</option>
                        <option value="Amiri">Amiri</option>
                        <option value="Noto Naskh Arabic">Noto Naskh Arabic</option>
                        <option value="Tahoma">Tahoma</option>
                        <option value="Arial">Arial</option>
                      </select>
                    </div>
                  </div>
                </div>
              </div>

              <div style={{ height: 12 }} />
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <button style={btn(BRAND.accent)} onClick={saveCfgs}>Save positions/colors/fonts</button>
                <button style={btn(BRAND.danger)} onClick={resetCfgs}>Reset positions</button>
              </div>
            </section>
          </div>

          {/* Row 3: Export + Invites list */}
          <div style={{ display: 'grid', gap: 16, gridTemplateColumns: '1fr 1fr' }}>
            {/* Export */}
            <section style={section}>
              <h3 style={h3}>Export</h3>
              <p style={{ color: BRAND.textMuted, marginTop: 0 }}>
                {designMeta?.type === 'pdf'
                  ? 'Design is PDF → use "Download PDFs" for maximum quality.'
                  : 'Design is Image → you can export PNG, JPG, or PDF.'}
              </p>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <button
                  style={btn(BRAND.accent)}
                  onClick={downloadCSV}
                  disabled={!invites.length}
                >
                  Download CSV (links)
                </button>
                <button
                  style={btn()}
                  onClick={exportPNGs}
                  disabled={!invites.length || !designMeta || designMeta.type !== 'image'}
                >
                  Download PNGs
                </button>
                <button
                  style={btn()}
                  onClick={exportJPGs}
                  disabled={!invites.length || !designMeta || designMeta.type !== 'image'}
                >
                  Download JPGs
                </button>
                <button
                  style={btn()}
                  onClick={exportPDFs}
                  disabled={!invites.length || !designMeta}
                >
                  Download PDFs
                </button>
              </div>
            </section>

            {/* Invites list */}
            <section style={section}>
              <h3 style={h3}>Invites</h3>
              {!selectedEventId && <p style={{ color: BRAND.textMuted }}>Select an event to view guests.</p>}
              {selectedEventId && invites.length === 0 && <p style={{ color: BRAND.textMuted }}>— no guests —</p>}
              {selectedEventId && invites.length > 0 && (
                <div style={{ maxHeight: 360, overflow: 'auto', border: `1px solid ${BRAND.border}`, borderRadius: 12 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', background: BRAND.surface }}>
                    <thead>
                      <tr style={{ background: BRAND.bg }}>
                        <th style={thStyle()}>Name</th>
                        <th style={thStyle()}>Code</th>
                        <th style={thStyle()}>Status</th>
                        <th style={thStyle()}>Link</th>
                      </tr>
                    </thead>
                    <tbody>
                      {invites.map((iv) => (
                        <tr key={iv.id} style={{ borderBottom: `1px solid ${BRAND.border}` }}>
                          <td style={tdStyle()}>{iv.guest_name}</td>
                          <td style={tdStyle()}>{iv.code}</td>
                          <td style={tdStyle()}>{iv.status}</td>
                          <td style={tdStyle()}>
                            <a href={`${baseUrl}/i/${iv.id}`} target="_blank" rel="noreferrer" style={{ color: '#BBDEFB' }}>
                              open
                            </a>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
        </div>
      </div>
    </RequireRole>
  );
}
