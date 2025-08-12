'use client';
import { useEffect, useState } from 'react';
import { Html5QrcodeScanner } from 'html5-qrcode';

export default function Checker() {
  const [scans, setScans] = useState([]);

  // Load from localStorage on page load
  useEffect(() => {
    const saved = localStorage.getItem('guestScans');
    if (saved) {
      setScans(JSON.parse(saved));
    }
  }, []);

  // Save to localStorage whenever scans change
  useEffect(() => {
    localStorage.setItem('guestScans', JSON.stringify(scans));
  }, [scans]);

  useEffect(() => {
    const scanner = new Html5QrcodeScanner('qr-reader', { fps: 10, qrbox: 250 });

    scanner.render((decodedText) => {
      try {
        // If QR code contains "UUID|Guest Name"
        const [uuid, guestName] = decodedText.split('|');

        if (!uuid || !guestName) {
          alert('❌ Invalid QR format! Expected UUID|Name');
          return;
        }

        const exists = scans.find((item) => item.code === uuid);

        if (exists) {
          alert(`🚫 Already Used! Guest: ${exists.name}\nFirst Scanned At: ${exists.time}`);
        } else {
          const newEntry = {
            code: uuid,
            name: guestName,
            time: new Date().toLocaleString(),
          };
          setScans((prev) => [...prev, newEntry]);
          alert(`✅ Welcome, ${guestName}!`);
        }
      } catch (err) {
        console.error(err);
        alert('❌ Invalid QR code');
      }
    });

    return () => {
      scanner.clear().catch((err) => console.error('Failed to clear scanner', err));
    };
  }, [scans]);

  return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif' }}>
      <h1>QR Checker</h1>
      <div id="qr-reader" style={{ width: '320px', maxWidth: '100%' }}></div>

      <h2>Checked-in Guests</h2>
      {scans.length === 0 ? (
        <p>No guests checked in yet.</p>
      ) : (
        <table border="1" cellPadding="8" style={{ marginTop: '10px', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th>Name</th>
              <th>Time</th>
            </tr>
          </thead>
          <tbody>
            {scans.map((guest, idx) => (
              <tr key={idx}>
                <td>{guest.name}</td>
                <td>{guest.time}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
