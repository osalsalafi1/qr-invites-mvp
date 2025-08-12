'use client';
import { useEffect, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';

export default function Checker() {
  const [scans, setScans] = useState([]);
  const [message, setMessage] = useState({ text: '', type: '' });
  const [scanner, setScanner] = useState(null);
  const [scanning, setScanning] = useState(false);

  // Load saved data from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('yaMarhabaScans');
    if (saved) setScans(JSON.parse(saved));
  }, []);

  // Save data to localStorage
  useEffect(() => {
    localStorage.setItem('yaMarhabaScans', JSON.stringify(scans));
  }, [scans]);

  const startScanning = () => {
    if (scanner) return;

    const qrScanner = new Html5Qrcode("qr-reader");
    setScanner(qrScanner);
    setScanning(true);

    qrScanner.start(
      { facingMode: "environment" },
      { fps: 10, qrbox: 250 },
      (decodedText) => handleScan(decodedText),
      (err) => { }
    ).catch(err => {
      console.error("Unable to start scanning", err);
    });
  };

  const stopScanning = () => {
    if (scanner) {
      scanner.stop().then(() => {
        setScanning(false);
        setScanner(null);
      }).catch(err => console.error("Failed to stop scanner", err));
    }
  };

  const handleScan = (decodedText) => {
    const exists = scans.find((item) => item.code === decodedText);

    if (exists) {
      setMessage({ text: `❌ Already scanned at ${exists.time}`, type: 'error' });
    } else {
      const guestName = prompt('Enter guest name:') || 'Unknown Guest';
      const newEntry = {
        code: decodedText,
        name: guestName,
        time: new Date().toLocaleString(),
      };
      setScans((prev) => [...prev, newEntry]);
      setMessage({ text: `✅ First time check-in for ${guestName}`, type: 'success' });
    }
  };

  return (
    <div style={{
      backgroundColor: '#4B2E2B',
      color: '#fff',
      minHeight: '100vh',
      padding: '20px',
      fontFamily: 'Arial, sans-serif'
    }}>
      <h1 style={{ textAlign: 'center', marginBottom: '20px' }}>🎉 Ya Marhaba - Guest Check-In</h1>

      {/* Start/Stop button */}
      {!scanning ? (
        <button
          onClick={startScanning}
          style={{
            display: 'block',
            margin: '0 auto 20px auto',
            padding: '15px 30px',
            fontSize: '20px',
            backgroundColor: '#8B5E3C',
            color: '#fff',
            border: 'none',
            borderRadius: '10px',
            cursor: 'pointer'
          }}
        >
          📷 Start Scanning
        </button>
      ) : (
        <button
          onClick={stopScanning}
          style={{
            display: 'block',
            margin: '0 auto 20px auto',
            padding: '15px 30px',
            fontSize: '20px',
            backgroundColor: '#A93226',
            color: '#fff',
            border: 'none',
            borderRadius: '10px',
            cursor: 'pointer'
          }}
        >
          🛑 Stop Scanning
        </button>
      )}

      {/* QR Reader */}
      <div id="qr-reader" style={{ margin: 'auto', maxWidth: '400px', backgroundColor: '#fff', padding: '10px', borderRadius: '10px' }}></div>

      {/* Status message */}
      {message.text && (
        <div style={{
          marginTop: '20px',
          padding: '10px',
          borderRadius: '8px',
          textAlign: 'center',
          fontSize: '18px',
          backgroundColor: message.type === 'success' ? '#2ECC71' : '#E74C3C',
          color: '#fff'
        }}>
          {message.text}
        </div>
      )}

      {/* Table */}
      <h2 style={{ marginTop: '30px' }}>✅ Checked-in Guests</h2>
      {scans.length === 0 ? (
        <p>No guests checked in yet.</p>
      ) : (
        <table style={{
          width: '100%',
          marginTop: '10px',
          backgroundColor: '#fff',
          color: '#000',
          borderRadius: '8px',
          overflow: 'hidden'
        }}>
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
