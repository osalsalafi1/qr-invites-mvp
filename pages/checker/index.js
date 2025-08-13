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

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
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

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';

  // New: QR customization
  const [designFile, setDesignFile] = useState(null);
  const [qrX, setQrX] = useState(100);
  const [qrY, setQrY] = useState(100);
  const [qrSize, setQrSize] = useState(200);
  const [selectedFont, setSelectedFont] = useState('Tahoma'); // NEW

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data.user));
    fetchEvents();
  }, []);

  useEffect(() => {
    if (selectedEventId) loadInvites(selectedEventId);
  }, [selectedEventId]);

  async function fetchEvents() {
    const { data, error } = await supabase
      .from('events')
      .select('id,title,start_at,created_at')
      .order('created_at', { ascending: false });

    if (!error) {
      setEvents(data || []);
      if (!selectedEventId && data?.length) setSelectedEventId(data[0].id);
    }
  }

  async function loadInvites(eventId) {
    const { data } = await supabase
      .from('invites')
      .select('id,guest_name,code,status,created_at')
      .eq('event_id', eventId)
      .order('created_at', { ascending: true });
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
    if (!guests.length) return alert('Please choose a CSV with guests.');

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

  async function downloadInvitations() {
    let designImage = null;
    if (designFile) {
      designImage = await loadImage(URL.createObjectURL(designFile));
    }

    for (const iv of invites) {
      const url = `${baseUrl}/i/${iv.id}`;
      const qrDataUrl = await QRCode.toDataURL(url, { width: qrSize, margin: 0, color: { dark: '#000000', light: '#00000000' } });

      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      if (designImage) {
        canvas.width = designImage.width;
        canvas.height = designImage.height;
        ctx.drawImage(designImage, 0, 0);
      } else {
        canvas.width = 600;
        canvas.height = 800;
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }

      // Draw QR
      const qrImg = await loadImage(qrDataUrl);
      ctx.drawImage(qrImg, qrX, qrY, qrSize, qrSize);

      // Arabic text
      ctx.direction = 'rtl';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#000';

      const label = "الضيفة المكرمة";
      const guestName = iv.guest_name || "الضيف";

      ctx.font = `bold 26px "${selectedFont}", Tahoma, Arial, sans-serif`;
      ctx.fillText(label, qrX + qrSize / 2, qrY + qrSize + 10);

      ctx.font = `bold 28px "${selectedFont}", Tahoma, Arial, sans-serif`;
      ctx.fillText(guestName, qrX + qrSize / 2, qrY + qrSize + 45);

      // Download
      const outUrl = canvas.toDataURL('image/png');
      const a = document.createElement('a');
      const safeName = guestName.replace(/[\\/:*?"<>|]/g, '_');
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

        {/* Event Picker */}
        <section>
          <h3>Select event</h3>
          <select value={selectedEventId || ''} onChange={(e) => setSelectedEventId(e.target.value || null)}>
            {events.map((ev) => (
              <option key={ev.id} value={ev.id}>{ev.title}</option>
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

        {/* Upload guests */}
        <section>
          <h3>Upload guests (CSV)</h3>
          <input type="file" accept=".csv" onChange={handleCsv} />
          <button onClick={importGuests}>Import guests</button>
        </section>

        {/* Design upload */}
        <section>
          <h3>Upload invitation design</h3>
          <input type="file" accept="image/*" onChange={(e) => setDesignFile(e.target.files[0])} />
          <div>
            <label>QR X: {qrX}</label>
            <input type="range" min="0" max="1000" value={qrX} onChange={(e) => setQrX(Number(e.target.value))} />
            <label>QR Y: {qrY}</label>
            <input type="range" min="0" max="1000" value={qrY} onChange={(e) => setQrY(Number(e.target.value))} />
            <label>QR Size: {qrSize}</label>
            <input type="range" min="50" max="600" value={qrSize} onChange={(e) => setQrSize(Number(e.target.value))} />
          </div>
          <div>
            <label>Arabic Font:</label>
            <select value={selectedFont} onChange={(e) => setSelectedFont(e.target.value)}>
              <option value="Tahoma">Tahoma</option>
              <option value="Amiri">Amiri</option>
              <option value="Cairo">Cairo</option>
              <option value="Arial">Arial</option>
              <option value="Noto Naskh Arabic">Noto Naskh Arabic</option>
            </select>
          </div>
        </section>

        {/* Export */}
        <section>
          <h3>Export</h3>
          <button onClick={downloadInvitations}>Download Designed Invitations</button>
        </section>
      </div>
    </RequireRole>
  );
}
