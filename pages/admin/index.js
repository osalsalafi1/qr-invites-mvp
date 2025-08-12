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
  const [events, setEvents] = useState([]);
  const [selectedEventId, setSelectedEventId] = useState(null);
  const [guests, setGuests] = useState([]);
  const [invites, setInvites] = useState([]);
  const [title, setTitle] = useState('Wedding');
  const [venue, setVenue] = useState('Hall');
  const [startAt, setStartAt] = useState('');
  const [endAt, setEndAt] = useState('');
  const [designFile, setDesignFile] = useState(null); // NEW
  const [designUrl, setDesignUrl] = useState(null); // NEW

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data.user));
  }, []);

  useEffect(() => { fetchEvents(); }, []);
  useEffect(() => { if (selectedEventId) loadInvites(selectedEventId); loadDesign(selectedEventId); }, [selectedEventId]);

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

  async function loadDesign(eventId) {
    if (!eventId) return;
    const { data } = await supabase
      .storage
      .from('designs')
      .getPublicUrl(`${eventId}/design.png`);
    if (data?.publicUrl) setDesignUrl(data.publicUrl);
    else setDesignUrl(null);
  }

  async function createEvent() {
    if (!user) return alert('No user session');
    const { data, error } = await supabase
      .from('events')
      .insert({ title, venue, start_at: startAt || null, end_at: endAt || null, created_by: user.id })
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
    if (!designFile || !selectedEventId) return alert('Select an event and a file first.');
    const { error } = await supabase
      .storage
      .from('designs')
      .upload(`${selectedEventId}/design.png`, designFile, { upsert: true });
    if (error) return alert(error.message);
    alert('Design uploaded');
    loadDesign(selectedEventId);
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

  async function downloadQRCodes() {
    for (const iv of invites || []) {
      const qrUrl = `${baseUrl}/i/${iv.id}`;
      const qrDataUrl = await QRCode.toDataURL(qrUrl, { width: 300, margin: 2 });

      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      if (designUrl) {
        // Load design first
        const designImg = await loadImage(designUrl);
        canvas.width = designImg.width;
        canvas.height = designImg.height;
        ctx.drawImage(designImg, 0, 0);

        // Load QR and place middle bottom (up a bit)
        const qrImg = await loadImage(qrDataUrl);
        const qrSize = 250;
        const qrX = (canvas.width - qrSize) / 2;
        const qrY = canvas.height - qrSize - 80; // 80px from bottom
        ctx.drawImage(qrImg, qrX, qrY, qrSize, qrSize);
      } else {
        // fallback: plain QR
        canvas.width = 512;
        canvas.height = 612;
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, 512, 612);
        const qrImg = await loadImage(qrDataUrl);
        ctx.drawImage(qrImg, 106, 80, 300, 300);
      }

      const outUrl = canvas.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = outUrl;
      a.download = `${iv.guest_name || 'Guest'}_${iv.code || ''}.png`;
      a.click();
      await new Promise((r) => setTimeout(r, 200));
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
      <div style={{ padding: 20, fontFamily: 'sans-serif' }}>
        <h2>Admin</h2>

        {/* Event Picker */}
        <section>
          <h3>Select event</h3>
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
        </section>

        {/* Create Event */}
        <section>
          <h3>Create event</h3>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" />
          <input value={venue} onChange={(e) => setVenue(e.target.value)} placeholder="Venue" />
          <input type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} />
          <input type="datetime-local" value={endAt} onChange={(e) => setEndAt(e.target.value)} />
          <button onClick={createEvent}>Create</button>
        </section>

        {/* Upload Design */}
        <section>
          <h3>Invitation Design</h3>
          {designUrl && <img src={designUrl} alt="Design preview" style={{ maxWidth: 300 }} />}
          <input type="file" accept="image/*" onChange={(e) => setDesignFile(e.target.files?.[0])} />
          <button onClick={uploadDesign}>Upload Design</button>
        </section>

        {/* Upload guests */}
        <section>
          <h3>Upload guests (CSV)</h3>
          <input type="file" accept=".csv" onChange={handleCsv} />
          <button onClick={importGuests}>Import guests</button>
        </section>

        {/* Export */}
        <section>
          <h3>Export</h3>
          <button onClick={downloadCSV}>Download CSV</button>
          <button onClick={downloadQRCodes} style={{ marginLeft: 8 }}>
            Download QR Invitations
          </button>
        </section>
      </div>
    </RequireRole>
  );
}
