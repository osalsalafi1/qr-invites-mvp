'use client';
import { useEffect, useState } from 'react';
import { Html5QrcodeScanner } from 'html5-qrcode';

export default function Checker() {
  const [scans, setScans] = useState([]);

  // Load saved data from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('yaMarhabaScans');
    if (saved) {
      setScans(JSON.parse(saved));
    }
  }, []);

  // Save to localStorage whenever scans change
  useEffect(() => {
    localStorage.setItem('yaMarhabaScans', JSON.stringify(scans));
  }, [scans]);

  useEffect(() => {
    const scanner = new Html5QrcodeScanner('qr-reader', { fps: 10, qrbox: 250 });

    scanner.render((decodedText) => {
      const exists = scans.find((item) => item.code === decodedText);

      if (exists) {
        alert(`🚫 Already Used: ${decodedText}`);
      } else {
        const guestName = prompt('Enter guest name:') || 'Unknown Guest';
        const newEntry = {
          code: decodedText,
          name: guestName,
          time: new Date().toLocaleString(),
        };
        setScans((prev) => [...prev, newEntry]);
      }
    });

    return () => {
      scanner.clear().catch((err) => console.error('Failed to clear scanner', err));
    };
  }, [scans]);

  return (
    <div style={{
      backgroundColor: '#4B2E2B', // dark brown
      color: '#fff',
      minHeight: '100vh',
      padding: '20px',
      fontFamily: 'Arial, sans-serif'
    }}>
      <h1 style={{ textAlign: 'center', marginBottom: '20px' }}>🎉 Ya Marhaba - Guest Check-In</h1>
      
      <div id="qr-reader" style={{ margin: 'auto', maxWidth: '400px', backgroundColor: '#fff', padding: '10px', borderRadius: '10px' }}></div>

      <h2 style={{ marginTop: '30px' }}>✅ Checked-in Guests</h2>
      {scans.length === 0 ? (
        <p>No guests checked in yet.</p>
      ) : (
        <table style={{ width: '100%', marginTop: '10px', backgroundColor: '#fff', color: '#000', borderRadius: '8px', overflow: 'hidden' }}>
          <thead style={{ backgroundColor: '#3E2723', color: '#fff' }}>
            <tr>
              <th>Name</th>
              <th>Time</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {scans.map((guest, idx) => (
              <tr key={idx}>
                <td>{guest.name}</td>
                <td>{guest.time}</td>
                <td style={{ textAlign: 'center' }}>
                  <span style={{
                    display: 'inline-block',
                    width: '12px',
                    height: '12px',
                    backgroundColor: 'green',
                    borderRadius: '50%'
                  }}></span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
