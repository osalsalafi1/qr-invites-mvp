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

  // NEW: events list + selection
  const [events, setEvents] = useState([]);
  const [selectedEventId, setSelectedEventId] = useState(null);

  // CSV -> guests to insert
  const [guests, setGuests] = useState([]);

  // Invites currently loaded for the selected event
  const [invites, setInvites] = useState([]);

  const [title, setTitle] = useState('Wedding');
  const [venue, setVenue] = useState('Hall');
  const [startAt, setStartAt] = useState('');
  const [endAt, setEndAt] = useState('');

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data.user));
  }, []);

  // Fetch events on mount
  useEffect(() => {
    fetchEvents();
  }, []);

  // Whenever selected event changes, load its invites
  useEffect(() => {
    if (selectedEventId) loadInvites(selectedEventId);
  }, [selectedEventId]);

  async function fetchEvents() {
    const { data, error } = await supabase
      .from('events')
      .select('id,title,start_at,created_at')
      .order('created_at', { ascending: false });

    if (error) {
      console.error(error);
      alert('Failed to load events: ' + error.message);
      return;
    }
    setEvents(data || []);
    // Auto-select the most recent event if nothing selected yet
    if (!selectedEventId && data && data.length) {
      setSelectedEventId(data[0].id);
    }
  }

  async function loadInvites(eventId) {
    const { data, error } = await supabase
      .from('invites')
      .select('id,guest_name,code,status,created_at')
      .eq('event_id', eventId)
      .order('created_at', { ascending: true });

    if (error) {
      console.error(error);
      alert('Failed to load guests: ' + error.message);
      return;
    }
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

    if (error) {
      alert(error.message);
      return;
    }

    alert('Event created');
    // Refresh events and select the newly created one
    await fetchEvents();
    setSelectedEventId(data.id);
    setInvites([]); // clear current list until we load fresh
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
    const eid = selectedEventId;
    if (!eid) {
      alert('Please select or create an event first.');
      return;
    }
    if (!guests.length) {
      alert('Please choose a CSV with at least one guest.');
      return;
    }

    const rows = guests.map((g) => ({
      event_id: eid,
      guest_name: g.guest_name,
      guest_contact: g.guest_contact,
      code: randCode(8),
      status: 'PENDING',
    }));

    const { data, error } = await supabase.from('invites').insert(rows).select('*');
    if (error) {
      alert(error.message);
      return;
    }
    // Merge new invites with current list
    setInvites((prev) => [...(prev || []), ...(data || [])]);
    alert(`Imported ${data?.length || 0} guests`);
  }

  async function downloadCSV() {
    const head = 'guest_name,code,invite_url\n';
    const lines = (invites || []).map(
      (iv) => `${iv.guest_name},${iv.code},${baseUrl}/i/${iv.id}`
    );
    const blob = new Blob([head + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'invites.csv';
    a.click();
  }

  // UPDATED: draw name under the QR in the PNG
  async function downloadQRCodes() {
    const CANVAS_W = 512;
    const CANVAS_H = 612;
    const NAME_AREA_H = 100;

    for (const iv of invites || []) {
      const url = `${baseUrl}/i/${iv.id}`;
      const dataUrl = await QRCode.toDataURL(url, { width: 512, margin: 2 });

      const canvas = document.createElement('canvas');
      canvas.width = CANVAS_W;
      canvas.height = CANVAS_H;
      const ctx = canvas.getContext('2d');

      // White background
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

      // Draw QR image
      const img = new Image();
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = dataUrl;
      });
      ctx.drawImage(img, 0, 0, 512, 512);

      // Name text
      const name = iv.guest_name || 'Guest';
      ctx.fillStyle = '#000';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      // If you’ll print Arabic names, you can use RTL:
      // ctx.direction = 'rtl';
      let fontSize = 28;
      const maxWidth = CANVAS_W - 40;
      do {
        ctx.font = `bold ${fontSize}px Tahoma, Arial, sans-serif`;
        if (ctx.measureText(name).width <= maxWidth) break;
        fontSize -= 2;
      } while (fontSize > 14);

      ctx.fillText(name, CANVAS_W / 2, 512 + NAME_AREA_H / 2);

      // Download
      const outUrl = canvas.toDataURL('image/png');
      const a = document.createElement('a');
      const safeName = name.replace(/[\\/:*?"<>|]/g, '_');
      a.href = outUrl;
      a.download = `${safeName}_${iv.code || ''}.png`;
      a.click();

      await new Promise((r) => setTimeout(r, 200));
    }
  }

  return (
    <RequireRole role="admin">
      <div style={{ padding: 20, fontFamily: 'sans-serif' }}>
        <h2>Admin</h2>

        {/* Event Picker (NEW) */}
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
                  <option key={ev.id} value={ev.id}>
                    {ev.title}
                  </option>
                ))}
              </select>
              <button onClick={() => loadInvites(selectedEventId)} disabled={!selectedEventId}>
                Refresh guests
              </button>
              <button onClick={fetchEvents}>Refresh events</button>
            </div>
          )}
        </section>

        {/* Create event */}
        <section style={{ border: '1px solid #ddd', padding: 12, marginBottom: 16 }}>
          <h3>Create event</h3>
          <label>Title</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            style={{ display: 'block', width: '100%', marginBottom: 8 }}
          />
          <label>Venue</label>
          <input
            value={venue}
            onChange={(e) => setVenue(e.target.value)}
            style={{ display: 'block', width: '100%', marginBottom: 8 }}
          />
          <label>Start</label>
          <input
            type="datetime-local"
            value={startAt}
            onChange={(e) => setStartAt(e.target.value)}
            style={{ display: 'block', marginBottom: 8 }}
          />
          <label>End</label>
          <input
            type="datetime-local"
            value={endAt}
            onChange={(e) => setEndAt(e.target.value)}
            style={{ display: 'block', marginBottom: 8 }}
          />
          <button onClick={createEvent}>Create</button>
        </section>

        {/* Upload guests (CSV) */}
        <section style={{ border: '1px solid #ddd', padding: 12, marginBottom: 16 }}>
          <h3>Upload guests (CSV)</h3>
          <p>
            Columns: <code>guest_name, guest_contact</code>
          </p>
          <input type="file" accept=".csv" onChange={handleCsv} />
          <button onClick={importGuests} disabled={!guests.length || !selectedEventId}>
            Import guests
          </button>
        </section>

        {/* Export */}
        <section style={{ border: '1px solid #ddd', padding: 12, marginBottom: 16 }}>
          <h3>Export</h3>
          <button onClick={downloadCSV} disabled={!invites.length}>
            Download CSV (links)
          </button>
          <button onClick={downloadQRCodes} disabled={!invites.length} style={{ marginInlineStart: 8 }}>
            Download QR images
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
                  <a href={`${baseUrl}/i/${iv.id}`} target="_blank">
                    link
                  </a>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </RequireRole>
  );
}
