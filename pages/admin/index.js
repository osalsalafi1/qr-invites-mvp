'use client';
import { useEffect, useState, useRef } from 'react';
import { supabase } from '@/src/lib/supabaseClient';
import RequireRole from '@/components/RequireRole';
import Papa from 'papaparse';
import QRCode from 'qrcode';

/** ---------------- Utilities ---------------- */
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

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/** Dynamically load pdf.js only if needed (for PDF design input) */
let _pdfjsLib = null;
async function ensurePdfJs() {
  if (_pdfjsLib) return _pdfjsLib;
  try {
    _pdfjsLib = await import('pdfjs-dist/legacy/build/pdf');
    // Use CDN worker to avoid bundler issues
    _pdfjsLib.GlobalWorkerOptions.workerSrc =
      `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${_pdfjsLib.version}/pdf.worker.min.js`;
    return _pdfjsLib;
  } catch (e) {
    throw new Error('PDF preview requires pdfjs-dist. Install with: npm i pdfjs-dist');
  }
}

/** Render first page of a PDF to a canvas with a target width (maintain aspect) */
async function renderPdfToCanvas(pdfUrl, targetWidth = 520) {
  const pdfjsLib = await ensurePdfJs();
  const task = pdfjsLib.getDocument(pdfUrl);
  const pdf = await task.promise;
  const page = await pdf.getPage(1);

  const vp1 = page.getViewport({ scale: 1 });
  const scale = targetWidth / vp1.width;
  const vp = page.getViewport({ scale });

  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(vp.width);
  canvas.height = Math.floor(vp.height);
  const ctx = canvas.getContext('2d');

  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  return canvas;
}

/** ---------------- Theme (same palette as checker) ---------------- */
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

/** ---------------- Component ---------------- */
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

  // Invitation design (per event) in Supabase Storage
  const [designFile, setDesignFile] = useState(null);
  const [designUrl, setDesignUrl] = useState(null);
  const [designKind, setDesignKind] = useState(null); // 'image' | 'pdf'

  // QR cfg (independent)
  const [qrCfg, setQrCfg] = useState({
    xPct: 50,
    yPct: 83,
    sizePct: 24,                // % of image width
    transparent: true,
    colorDark: '#77758e',       // NEW: QR color (dark)
    colorLight: '#0000',        // transparent by default
  });

  // Text cfg (independent)
  const [textCfg, setTextCfg] = useState({
    xPct: 50,
    yPct: 92,                   // % of image height
    sizePct: 6,                 // % of image width
    color: '#77758e',
    font: 'Madani Arabic',      // default to Madani Arabic (you should load it globally)
  });

  // Export format
  const [exportFormat, setExportFormat] = useState('PNG'); // PNG | JPG | PDF

  // Preview canvas
  const previewRef = useRef(null);

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
  const DESIGN_BUCKET = 'invitation-designs'; // Ensure this bucket exists (public)

  /** ---------- Auth ---------- */
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data.user));
  }, []);

  /** ---------- Load events on mount ---------- */
  useEffect(() => {
    fetchEvents();
  }, []);

  /** ---------- When switching events, load invites & design ---------- */
  useEffect(() => {
    if (selectedEventId) {
      loadInvites(selectedEventId);
      loadDesign(selectedEventId);
      // restore per-event placement from localStorage
      loadPlacement(selectedEventId);
    } else {
      setInvites([]);
      setDesignUrl(null);
      setDesignKind(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEventId]);

  /** ---------- Re-render preview when inputs change ---------- */
  useEffect(() => {
    renderPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [designUrl, designKind, qrCfg, textCfg]);

  /** ---------- Data ---------- */
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

  /** Find existing design: prefer PDF, then PNG/JPG */
  async function loadDesign(eventId) {
    try {
      const { data, error } = await supabase
        .storage
        .from(DESIGN_BUCKET)
        .list(`${eventId}`, { limit: 50 });

      if (error) throw error;

      const files = data || [];
      const pick = (name) => files.find(f => f.name.toLowerCase() === name);
      const pdf  = pick('design.pdf');
      const png  = pick('design.png');
      const jpg  = pick('design.jpg') || pick('design.jpeg');

      let chosen = pdf || png || jpg || files.find(f => /^design\./i.test(f.name));
      if (!chosen) {
        setDesignUrl(null);
        setDesignKind(null);
        return;
      }
      const { data: pub } = supabase
        .storage
        .from(DESIGN_BUCKET)
        .getPublicUrl(`${eventId}/${chosen.name}`);

      setDesignUrl(pub?.publicUrl || null);
      setDesignKind(chosen.name.toLowerCase().endsWith('.pdf') ? 'pdf' : 'image');
    } catch (e) {
      setDesignUrl(null);
      setDesignKind(null);
    }
  }

  /** Save & restore placement per event (localStorage) */
  function loadPlacement(eventId) {
    try {
      const raw = localStorage.getItem(`qr_cfg_${eventId}`);
      if (raw) setQrCfg(v => ({ ...v, ...JSON.parse(raw) }));
    } catch {}
    try {
      const raw2 = localStorage.getItem(`text_cfg_${eventId}`);
      if (raw2) setTextCfg(v => ({ ...v, ...JSON.parse(raw2) }));
    } catch {}
  }
  function savePlacement() {
    if (!selectedEventId) return;
    localStorage.setItem(`qr_cfg_${selectedEventId}`, JSON.stringify(qrCfg));
    localStorage.setItem(`text_cfg_${selectedEventId}`, JSON.stringify(textCfg));
    alert('Placement saved for this event.');
  }

  /** ---------- Create event ---------- */
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

  /** ---------- CSV upload ---------- */
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

  /** ---------- Upload design (image or PDF) ---------- */
  async function uploadDesign() {
    if (!designFile) return alert('Choose a design file (.pdf, .png, .jpg) first.');
    if (!selectedEventId) return alert('Select an event first.');

    const ext0 = (designFile.name.split('.').pop() || '').toLowerCase();
    const ext = ['pdf', 'png', 'jpg', 'jpeg'].includes(ext0) ? ext0 : 'png';
    const path = `${selectedEventId}/design.${ext}`;
    const contentType =
      designFile.type ||
      (ext === 'pdf' ? 'application/pdf' :
       ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/png');

    const { error } = await supabase
      .storage
      .from(DESIGN_BUCKET)
      .upload(path, designFile, { upsert: true, contentType });

    if (error) return alert(error.message);

    alert('Design uploaded');
    await loadDesign(selectedEventId);
  }

  /** ---------- Export CSV ---------- */
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

  /** ---------- Preview renderer ---------- */
  async function renderPreview() {
    const canvas = previewRef.current;
    if (!canvas || !designUrl) return;

    const ctx = canvas.getContext('2d');

    // Base canvas from image or PDF (preview width ~520px)
    let baseCanvas;
    if (designKind === 'pdf') {
      try {
        baseCanvas = await renderPdfToCanvas(designUrl, 520);
      } catch (err) {
        // Show message once
        console.error(err);
        const w = 520, h = 320;
        canvas.width = w; canvas.height = h;
        ctx.fillStyle = '#111'; ctx.fillRect(0,0,w,h);
        ctx.fillStyle = '#fff';
        ctx.font = '14px sans-serif';
        ctx.fillText('PDF preview requires pdfjs-dist', 12, 20);
        ctx.fillText('Run: npm i pdfjs-dist', 12, 40);
        return;
      }
    } else {
      const img = await loadImage(designUrl);
      const maxW = 520;
      const scale = img.width > maxW ? maxW / img.width : 1;
      baseCanvas = document.createElement('canvas');
      baseCanvas.width = Math.round(img.width * scale);
      baseCanvas.height = Math.round(img.height * scale);
      baseCanvas.getContext('2d').drawImage(img, 0, 0, baseCanvas.width, baseCanvas.height);
    }

    // Paint preview base
    canvas.width = baseCanvas.width;
    canvas.height = baseCanvas.height;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(baseCanvas, 0, 0);

    const w = canvas.width;
    const h = canvas.height;

    // ---- Draw QR overlay ----
    const qrSize = Math.round((qrCfg.sizePct / 100) * w);
    const qx = Math.round((qrCfg.xPct / 100) * w) - Math.floor(qrSize / 2);
    const qy = Math.round((qrCfg.yPct / 100) * h) - Math.floor(qrSize / 2);

    const previewQr = await QRCode.toDataURL('SAMPLE', {
      width: qrSize,
      margin: 0,
      color: { dark: qrCfg.colorDark || '#000000', light: qrCfg.transparent ? '#0000' : '#FFFFFF' },
    });
    const qrImg = await loadImage(previewQr);
    ctx.drawImage(qrImg, qx, qy, qrSize, qrSize);

    // ---- Draw Guest name overlay ----
    const tx = Math.round((textCfg.xPct / 100) * w);
    const ty = Math.round((textCfg.yPct / 100) * h);
    const fontPx = Math.max(10, Math.round((textCfg.sizePct / 100) * w));

    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.direction = 'rtl';
    ctx.fillStyle = textCfg.color || '#000';
    ctx.font = `bold ${fontPx}px "${textCfg.font}", Tahoma, Arial, sans-serif`;
    ctx.fillText('الضيف', tx, ty);
    ctx.restore();
  }

  /** ---------- Generate invitations: PNG / JPG / PDF ---------- */
  async function downloadQRCodes() {
    if (!designUrl) return alert('Upload a design first.');

    // Build a high-resolution base from the design:
    // If PDF, render wide (e.g. 2400px) for quality; if image, use original size.
    let baseCanvas;
    if (designKind === 'pdf') {
      try {
        baseCanvas = await renderPdfToCanvas(designUrl, 2400); // hi-res render
      } catch (e) {
        return alert(e.message || 'PDF render failed. Ensure pdfjs-dist is installed.');
      }
    } else {
      const img = await loadImage(designUrl);
      baseCanvas = document.createElement('canvas');
      baseCanvas.width = img.width;
      baseCanvas.height = img.height;
      baseCanvas.getContext('2d').drawImage(img, 0, 0);
    }

    const baseW = baseCanvas.width;
    const baseH = baseCanvas.height;

    // Prepare jsPDF only if needed
    let jsPDF = null;
    if (exportFormat === 'PDF') {
      try {
        const mod = await import('jspdf');
        jsPDF = mod.jsPDF;
      } catch {
        return alert('PDF export requires jspdf. Install with: npm i jspdf');
      }
    }

    // Generate per invite
    for (const iv of invites || []) {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      canvas.width = baseW;
      canvas.height = baseH;

      // Base design
      ctx.drawImage(baseCanvas, 0, 0);

      // 1) QR (color + transparent bg)
      const qrSizePx = Math.max(32, Math.floor((qrCfg.sizePct / 100) * baseW));
      const qrDataUrl = await QRCode.toDataURL(`${baseUrl}/i/${iv.id}`, {
        width: qrSizePx,
        margin: 0,
        color: {
          dark: qrCfg.colorDark || '#000000',
          light: qrCfg.transparent ? '#0000' : '#FFFFFF',
        },
      });
      const qri = await loadImage(qrDataUrl);
      const qcx = Math.floor((qrCfg.xPct / 100) * baseW);
      const qcy = Math.floor((qrCfg.yPct / 100) * baseH);
      const qx = qcx - Math.floor(qrSizePx / 2);
      const qy = qcy - Math.floor(qrSizePx / 2);
      ctx.drawImage(qri, qx, qy, qrSizePx, qrSizePx);

      // 2) Guest name (Arabic) — position/size/color independent from QR
      const guestName = (iv.guest_name && String(iv.guest_name).trim()) || 'الضيف';
      const tx = Math.floor((textCfg.xPct / 100) * baseW);
      const ty = Math.floor((textCfg.yPct / 100) * baseH);
      const fontPx = Math.max(12, Math.floor((textCfg.sizePct / 100) * baseW));
      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.direction = 'rtl';
      ctx.fillStyle = textCfg.color || '#000';
      ctx.font = `bold ${fontPx}px "${textCfg.font}", Tahoma, Arial, sans-serif`;
      ctx.fillText(guestName, tx, ty);
      ctx.restore();

      // 3) Save in selected format
      const safeName = guestName.replace(/[\\/:*?"<>|]/g, '_');
      const baseFilename = `${safeName}_${iv.code || ''}`;

      if (exportFormat === 'PNG') {
        const url = canvas.toDataURL('image/png');
        const a = document.createElement('a');
        a.href = url;
        a.download = `${baseFilename}.png`;
        a.click();
      } else if (exportFormat === 'JPG') {
        const url = canvas.toDataURL('image/jpeg', 0.92);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${baseFilename}.jpg`;
        a.click();
      } else {
        // PDF
        const pdf = new jsPDF({
          orientation: baseW > baseH ? 'l' : 'p',
          unit: 'px',
          format: [baseW, baseH],
          compress: true,
        });
        const jpegUrl = canvas.toDataURL('image/jpeg', 0.95);
        pdf.addImage(jpegUrl, 'JPEG', 0, 0, baseW, baseH);
        pdf.save(`${baseFilename}.pdf`);
      }

      // throttle downloads a bit
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 120));
    }
  }

  /** ---------------- UI ---------------- */
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
            Manage events, guests, and invitation designs
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

          {/* Row 2: Design + Preview + Controls */}
          <div style={{ display: 'grid', gap: 16, gridTemplateColumns: '1.3fr 1fr' }}>
            {/* Left: Preview + upload */}
            <section style={section}>
              <h3 style={h3}>Invitation Design & Preview</h3>

              <div style={{ marginBottom: 10 }}>
                <canvas
                  ref={previewRef}
                  style={{ width: '100%', borderRadius: 12, border: `1px solid ${BRAND.border}`, background: '#000' }}
                />
              </div>

              <div style={{ display: 'grid', gap: 12, gridTemplateColumns: '1fr 1fr' }}>
                <div style={{ gridColumn: '1 / span 2' }}>
                  <label style={label}>Upload design (PDF / PNG / JPG)</label>
                  <input
                    type="file"
                    accept="application/pdf,image/*"
                    onChange={(e) => setDesignFile(e.target.files?.[0] || null)}
                    style={{ ...input, padding: 8, background: 'transparent', border: '1px dashed ' + BRAND.inputBorder }}
                  />
                </div>
                <div>
                  <button style={btn(BRAND.accent)} onClick={uploadDesign}>Upload/Replace Design</button>
                </div>
                <div style={{ alignSelf: 'center', color: BRAND.textMuted, fontSize: 12 }}>
                  Type: <b>{designKind || '—'}</b>{' '}
                  {designUrl && (
                    <> • Stored at: <code>invitation-designs/{selectedEventId || 'eventId'}/design.*</code></>
                  )}
                </div>
              </div>
            </section>

            {/* Right: Controls */}
            <section style={section}>
              <h3 style={h3}>Placement & Style</h3>

              {/* QR Controls */}
              <div style={{ marginBottom: 14, paddingBottom: 12, borderBottom: `1px dashed ${BRAND.border}` }}>
                <h4 style={{ margin: 0, marginBottom: 10 }}>QR Code</h4>
                <div style={{ display: 'grid', gap: 10, gridTemplateColumns: '1fr 1fr' }}>
                  <div>
                    <label style={label}>Position X (%)</label>
                    <input type="range" min="0" max="100" value={qrCfg.xPct}
                      onChange={(e) => setQrCfg(v => ({ ...v, xPct: Number(e.target.value) }))}
                      style={{ width: '100%' }} />
                    <div style={{ fontSize: 12, color: BRAND.textMuted }}>{qrCfg.xPct}%</div>
                  </div>
                  <div>
                    <label style={label}>Position Y (%)</label>
                    <input type="range" min="0" max="100" value={qrCfg.yPct}
                      onChange={(e) => setQrCfg(v => ({ ...v, yPct: Number(e.target.value) }))}
                      style={{ width: '100%' }} />
                    <div style={{ fontSize: 12, color: BRAND.textMuted }}>{qrCfg.yPct}%</div>
                  </div>
                  <div>
                    <label style={label}>Size (% of width)</label>
                    <input type="range" min="5" max="50" value={qrCfg.sizePct}
                      onChange={(e) => setQrCfg(v => ({ ...v, sizePct: Number(e.target.value) }))}
                      style={{ width: '100%' }} />
                    <div style={{ fontSize: 12, color: BRAND.textMuted }}>{qrCfg.sizePct}%</div>
                  </div>
                  <div>
                    <label style={label}>QR Color</label>
                    <input type="color" value={qrCfg.colorDark}
                      onChange={(e) => setQrCfg(v => ({ ...v, colorDark: e.target.value }))}
                      style={{ width: 60, height: 36, border: 'none', background: 'transparent', cursor: 'pointer' }} />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <input
                      id="transparentBg"
                      type="checkbox"
                      checked={qrCfg.transparent}
                      onChange={(e) => setQrCfg(v => ({ ...v, transparent: e.target.checked, colorLight: e.target.checked ? '#0000' : '#FFFFFF' }))}
                    />
                    <label htmlFor="transparentBg" style={{ margin: 0 }}>Transparent QR background</label>
                  </div>
                </div>
              </div>

              {/* Text Controls */}
              <div>
                <h4 style={{ margin: 0, marginBottom: 10 }}>Guest Name Text</h4>
                <div style={{ display: 'grid', gap: 10, gridTemplateColumns: '1fr 1fr' }}>
                  <div>
                    <label style={label}>Position X (%)</label>
                    <input type="range" min="0" max="100" value={textCfg.xPct}
                      onChange={(e) => setTextCfg(v => ({ ...v, xPct: Number(e.target.value) }))}
                      style={{ width: '100%' }} />
                    <div style={{ fontSize: 12, color: BRAND.textMuted }}>{textCfg.xPct}%</div>
                  </div>
                  <div>
                    <label style={label}>Position Y (%)</label>
                    <input type="range" min="0" max="100" value={textCfg.yPct}
                      onChange={(e) => setTextCfg(v => ({ ...v, yPct: Number(e.target.value) }))}
                      style={{ width: '100%' }} />
                    <div style={{ fontSize: 12, color: BRAND.textMuted }}>{textCfg.yPct}%</div>
                  </div>
                  <div>
                    <label style={label}>Font Size (% of width)</label>
                    <input type="range" min="2" max="15" value={textCfg.sizePct}
                      onChange={(e) => setTextCfg(v => ({ ...v, sizePct: Number(e.target.value) }))}
                      style={{ width: '100%' }} />
                    <div style={{ fontSize: 12, color: BRAND.textMuted }}>{textCfg.sizePct}%</div>
                  </div>
                  <div>
                    <label style={label}>Text Color</label>
                    <input type="color" value={textCfg.color}
                      onChange={(e) => setTextCfg(v => ({ ...v, color: e.target.value }))}
                      style={{ width: 60, height: 36, border: 'none', background: 'transparent', cursor: 'pointer' }} />
                  </div>
                  <div style={{ gridColumn: '1 / span 2' }}>
                    <label style={label}>Font Family</label>
                    <input
                      value={textCfg.font}
                      onChange={(e) => setTextCfg(v => ({ ...v, font: e.target.value }))}
                      placeholder='Madani Arabic'
                      style={{ ...input }}
                    />
                    <div style={{ color: BRAND.textMuted, fontSize: 12, marginTop: 6 }}>
                      Default is <b>Madani Arabic</b>. Make sure the font is loaded globally (e.g. via _document.js). Fallback: Tahoma, Arial.
                    </div>
                  </div>
                </div>
              </div>

              {/* Save placement + Export format */}
              <div style={{ marginTop: 14, display: 'grid', gap: 10, gridTemplateColumns: '1fr 1fr' }}>
                <button style={btn(BRAND.accent)} onClick={savePlacement}>Save placement</button>
                <div>
                  <label style={{ ...label, marginBottom: 4 }}>Export format</label>
                  <select
                    value={exportFormat}
                    onChange={(e) => setExportFormat(e.target.value)}
                    style={{ ...input }}
                  >
                    <option value="PNG">PNG</option>
                    <option value="JPG">JPG</option>
                    <option value="PDF">PDF</option>
                  </select>
                </div>
              </div>
            </section>
          </div>

          {/* Row 3: Import guests + Export + Invites list */}
          <div style={{ display: 'grid', gap: 16, gridTemplateColumns: '1fr 1fr' }}>
            {/* Import guests */}
            <section style={section}>
              <h3 style={h3}>Upload guests (CSV)</h3>
              <p style={{ color: BRAND.textMuted, marginTop: 0 }}>
                Columns: <code>guest_name, guest_contact</code>
              </p>
              <input type="file" accept=".csv" onChange={handleCsv}
                     style={{ ...input, padding: 8, background: 'transparent', border: '1px dashed ' + BRAND.inputBorder }} />
              <div style={{ height: 10 }} />
              <button style={btn()} onClick={importGuests} disabled={!guests.length || !selectedEventId}>
                Import guests
              </button>
            </section>

            {/* Export & generate */}
            <section style={section}>
              <h3 style={h3}>Export</h3>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <button style={btn(BRAND.accent)} onClick={downloadCSV} disabled={!invites.length}>
                  Download CSV (links)
                </button>
                <button style={btn()} onClick={downloadQRCodes} disabled={!invites.length || !designUrl}>
                  Generate Invitations ({exportFormat})
                </button>
              </div>
            </section>
          </div>

          {/* Invites list */}
          <section style={section}>
            <h3 style={h3}>Invites</h3>
            {!selectedEventId && <p style={{ color: BRAND.textMuted }}>Select an event to view guests.</p>}
            {selectedEventId && invites.length === 0 && <p style={{ color: BRAND.textMuted }}>— no guests —</p>}
            {selectedEventId && invites.length > 0 && (
              <div style={{ maxHeight: 320, overflow: 'auto', border: `1px solid ${BRAND.border}`, borderRadius: 12 }}>
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
    </RequireRole>
  );
}

function thStyle() {
  return { textAlign: 'left', color: BRAND.textMuted, padding: '10px 12px', borderBottom: `1px solid ${BRAND.border}`, fontSize: 13 };
}
function tdStyle() {
  return { padding: '12px 10px' };
}
