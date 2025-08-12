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
  const DESIGN_BUCKET = 'invitation-designs'; // <— make sure this bucket exists

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
    // design stored as: invitation-designs/{eventId}/design.png
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

    // Always store as PNG path; Supabase will upsert/replace
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
        // Use uploaded design
        const designImg = await loadImage(designUrl);
        canvas.width = designImg.width;
        canvas.height = designImg.height;
        ctx.drawImage(designImg, 0, 0);

        // Draw QR centered near bottom (slightly up)
        const qrImg = await loadImage(qrDataUrl);
        const qrSize = Math.floor(Math.min(canvas.width, canvas.height) * 0.25); // ~25% of shortest side
        const qrX = Math.floor((canvas.width - qrSize) / 2);
        const qrY = Math.floor(canvas.height - qrSize - (canvas.height * 0.08)); // ~8% up from bottom
        ctx.drawImage(qrImg, qrX, qrY, qrSize, qrSize);
      } else {
        // Fallback: plain sheet with QR + name text
        const CANVAS_W = 512, CANVAS_H = 612;
        canvas.width = CANVAS_W; canvas.height = CANVAS_H;
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

        const qrImg = await loadImage(qrDataUrl);
        const qrSize = 360, qrX = (CANVAS_W - qrSize) / 2, qrY = 80;
        ctx.drawImage(qrImg, qrX, qrY, qrSize, qrSize);

        // Name under QR
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
      img.crossOrigin = 'anonymous'; // allow public CDN
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  return (
    <RequireRole role="admin">
      <div style={{ padding: 20, fontFamily: 'sans-serif' }}>
        <h2>Admin</h2>

        {/* Event Picker */}
        <section style={{ border: '1px solid #ddd', padding: 12, marginBottom: 16 }}>
          <h3>Select event</h3>
          {events.length === 0 && <p>No events yet. Create one below.</p>}
          {events.length > 0 && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <select
                value={selectedEventId || ''}
                onChange={(e) => setSelectedEventId(e.target.value || null)}
              >
                {events.map((ev) => (
                  <option key={ev.id} value={ev.id}>{ev.title}</option>
                ))}
              </select>
              <button onClick={() => selectedEventId && loadInvites(selectedEventId)}>Refresh guests</button>
              <button onClick={fetchEvents}>Refresh events</button>
            </div>
          )}
        </section>

        {/* Create Event */}
        <section style={{ border: '1px solid #ddd', padding: 12, marginBottom: 16 }}>
          <h3>Create event</h3>
          <label>Title</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} style={{ display: 'block', width: '100%', marginBottom: 8 }} />
          <label>Venue</label>
          <input value={venue} onChange={(e) => setVenue(e.target.value)} style={{ display: 'block', width: '100%', marginBottom: 8 }} />
          <label>Start</label>
          <input type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} style={{ display: 'block', marginBottom: 8 }} />
          <label>End</label>
          <input type="datetime-local" value={endAt} onChange={(e) => setEndAt(e.target.value)} style={{ display: 'block', marginBottom: 8 }} />
          <button onClick={createEvent}>Create</button>
        </section>

        {/* Invitation Design Upload */}
        <section style={{ border: '1px solid #ddd', padding: 12, marginBottom: 16 }}>
          <h3>Invitation Design</h3>
          {designUrl && <div><img src={designUrl} alt="Design preview" style={{ maxWidth: 320, border: '1px solid #eee' }} /></div>}
          <input type="file" accept="image/*" onChange={(e) => setDesignFile(e.target.files?.[0] || null)} />
          <button onClick={uploadDesign} style={{ marginLeft: 8 }}>Upload Design</button>
          <p style={{ color: '#666', fontSize: 12, marginTop: 6 }}>
            Stored at: <code>{DESIGN_BUCKET}/{selectedEventId || 'eventId'}/design.png</code>
          </p>
        </section>

        {/* Upload guests (CSV) */}
        <section style={{ border: '1px solid #ddd', padding: 12, marginBottom: 16 }}>
          <h3>Upload guests (CSV)</h3>
          <p>Columns: <code>guest_name, guest_contact</code></p>
          <input type="file" accept=".csv" onChange={handleCsv} />
          <button onClick={importGuests} disabled={!guests.length || !selectedEventId} style={{ marginLeft: 8 }}>
            Import guests
          </button>
        </section>

        {/* Export */}
        <section style={{ border: '1px solid #ddd', padding: 12, marginBottom: 16 }}>
          <h3>Export</h3>
          <button onClick={downloadCSV} disabled={!invites.length}>Download CSV (links)</button>
          <button onClick={downloadQRCodes} disabled={!invites.length} style={{ marginInlineStart: 8 }}>
            Download QR Invitations
          </button>
        </section>

        {/* Invites list */}
        <section style={{ border: '1px solid #ddd', padding: 12 }}>
          <h3>Invites</h3>
          {!selectedEventId && <p>Select an event to view guests.</p>}
          {selectedEventId && invites.length === 0 && <p>— no guests —</p>}
          {selectedEventId && invites.length > 0 && (
            <ul>
              {invites.map((iv) => (
                <li key={iv.id}>
                  {iv.guest_name} — {iv.code} — {iv.status} —{' '}
                  <a href={`${baseUrl}/i/${iv.id}`} target="_blank" rel="noreferrer">link</a>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </RequireRole>
  );
}
