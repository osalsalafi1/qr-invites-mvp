'use client';
import { useEffect, useState } from 'react';
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

// ---- Theme (same palette as checker) ----
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

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
  const DESIGN_BUCKET = 'invitation-designs'; // make sure this bucket exists

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data.user));
  }, []);

  useEffect(() => { fetchEvents(); }, []);
  useEffect(() => {
    if (selectedEventId) {
      loadInvites(selectedEventId);
      loadDesign(selectedEventId);
    } else {
      setInvites([]);
      setDesignUrl(null);
    }
  }, [selectedEventId]);

  async function fetchEvents() {
    const { data, error } = await supabase
      .from('events')
      .select('id,title,start_at,created_at')
      .order('created_at', { ascending: false });

    if (error) {
      alert('Failed to load events: ' + error.message);
      return;
    }
    setEvents(data || []);
    if (!selectedEventId && data?.length) setSelectedEventId(data[0].id);
  }

  async function loadInvites(eventId) {
    const { data, error } = await supabase
      .from('invites')
      .select('id,guest_name,code,status,created_at')
      .eq('event_id', eventId)
      .order('created_at', { ascending: true });

    if (error) {
      alert('Failed to load guests: ' + error.message);
      return;
    }
    setInvites(data || []);
  }

  async function loadDesign(eventId) {
    const { data } = await supabase
      .storage
      .from(DESIGN_BUCKET)
      .getPublicUrl(`${eventId}/design.png`);
    setDesignUrl(data?.publicUrl || null);
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

  async function uploadDesign() {
    if (!designFile) return alert('Choose a design image first.');
    if (!selectedEventId) return alert('Select an event first.');

    const path = `${selectedEventId}/design.png`;
    const { error } = await supabase
      .storage
      .from(DESIGN_BUCKET)
      .upload(path, designFile, { upsert: true, contentType: designFile.type || 'image/png' });

    if (error) return alert(error.message);

    alert('Design uploaded');
    await loadDesign(selectedEventId);
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

  function csvSafe(s = '') {
    const t = String(s ?? '');
    return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  }

  async function downloadQRCodes() {
    for (const iv of invites || []) {
      const qrUrl = `${baseUrl}/i/${iv.id}`;
      const qrDataUrl = await QRCode.toDataURL(qrUrl, { width: 720, margin: 1 });

      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      if (designUrl) {
        const designImg = await loadImage(designUrl);
        canvas.width = designImg.width;
        canvas.height = designImg.height;
        ctx.drawImage(designImg, 0, 0);

        // QR centered near bottom (slightly up)
        const qrImg = await loadImage(qrDataUrl);
        const qrSize = Math.floor(Math.min(canvas.width, canvas.height) * 0.25);
        const qrX = Math.floor((canvas.width - qrSize) / 2);
        const qrY = Math.floor(canvas.height - qrSize - (canvas.height * 0.08));
        ctx.drawImage(qrImg, qrX, qrY, qrSize, qrSize);
      } else {
        // fallback: white background + QR + name
        const CANVAS_W = 512, CANVAS_H = 612;
        canvas.width = CANVAS_W; canvas.height = CANVAS_H;
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

        const qrImg = await loadImage(qrDataUrl);
        const qrSize = 360, qrX = (CANVAS_W - qrSize) / 2, qrY = 80;
        ctx.drawImage(qrImg, qrX, qrY, qrSize, qrSize);

        const name = iv.guest_name || 'Guest';
        ctx.fillStyle = '#000';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        let fontSize = 28;
        const maxWidth = CANVAS_W - 40;
        do {
          ctx.font = `bold ${fontSize}px Tahoma, Arial, sans-serif`;
          if (ctx.measureText(name).width <= maxWidth) break;
          fontSize -= 2;
        } while (fontSize > 14);
        ctx.fillText(name, CANVAS_W / 2, 512 + 50);
      }

      const outUrl = canvas.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = outUrl;
      a.download = `${(iv.guest_name || 'Guest').replace(/[\\/:*?"<>|]/g, '_')}_${iv.code || ''}.png`;
      a.click();

      await new Promise((r) => setTimeout(r, 150));
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

  // ---------- UI ----------
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
          <p style={{ margin: 0, color: BRAND.textMuted, fontSize: 13 }}>Manage events, guests, and invitation designs</p>
        </header>

        <div style={{ maxWidth: 1000, margin: '0 auto', display: 'grid', gap: 16, gridTemplateColumns: '1fr' }}>
          {/* Row 1: Event picker + Create event */}
          <div style={{ display: 'grid', gap: 16, gridTemplateColumns: '1fr 1fr' }}>
            {/* Event Picker */}
            <section style={section}>
              <h3 style={h3}>Select event</h3>
              {events.length === 0 && <p style={{ color: BRAND.textMuted }}>No events yet. Create one on the right.</p>}
              {events.length > 0 && (
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
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

          {/* Row 2: Invitation Design + Upload guests */}
          <div style={{ display: 'grid', gap: 16, gridTemplateColumns: '1fr 1fr' }}>
            {/* Invitation Design */}
            <section style={section}>
              <h3 style={h3}>Invitation Design</h3>
              {designUrl && (
                <div style={{ marginBottom: 10 }}>
                  <img src={designUrl} alt="Design preview" style={{ maxWidth: '100%', borderRadius: 12, border: `1px solid ${BRAND.border}` }} />
                </div>
              )}
              <input type="file" accept="image/*" onChange={(e) => setDesignFile(e.target.files?.[0] || null)}
                     style={{ ...input, padding: 8, background: 'transparent', border: '1px dashed ' + BRAND.inputBorder }} />
              <div style={{ height: 10 }} />
              <button style={btn(BRAND.accent)} onClick={uploadDesign}>Upload Design</button>
              <p style={{ color: BRAND.textMuted, fontSize: 12, marginTop: 8 }}>
                Stored at: <code>invitation-designs/{selectedEventId || 'eventId'}/design.png</code>
              </p>
            </section>

            {/* Upload guests */}
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
          </div>

          {/* Row 3: Export + Invites list */}
          <div style={{ display: 'grid', gap: 16, gridTemplateColumns: '1fr 1fr' }}>
            {/* Export */}
            <section style={section}>
              <h3 style={h3}>Export</h3>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <button style={btn(BRAND.accent)} onClick={downloadCSV} disabled={!invites.length}>
                  Download CSV (links)
                </button>
                <button style={btn()} onClick={downloadQRCodes} disabled={!invites.length}>
                  Download QR Invitations
                </button>
              </div>
            </section>

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
