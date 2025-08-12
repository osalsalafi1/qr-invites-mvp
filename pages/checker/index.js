'use client';
import { useState, useRef } from 'react';
import dynamic from 'next/dynamic';
import { supabase } from '@/src/lib/supabaseClient';
import dayjs from 'dayjs';

const QrReader = dynamic(() => import('react-qr-reader'), { ssr: false });

const BRAND = {
  bg: '#3E2723',
  card: '#4E342E',
  accent: '#8D6E63',
  primary: '#6D4C41',
  danger: '#B71C1C',
  text: '#FFF',
  textMuted: '#D7CCC8',
  border: '#6D4C41',
  surface: '#5D4037',
};

export default function Checker() {
  const [scanning, setScanning] = useState(false);
  const [invites, setInvites] = useState([]);
  const [message, setMessage] = useState(null);
  const [messageType, setMessageType] = useState(null); // 'success' or 'error'
  const scannedCodesRef = useRef(new Set());

  // Counter for unique first-time scans
  const [guestCount, setGuestCount] = useState(0);

  async function handleScan(data) {
    if (!data) return;

    try {
      const code = extractCodeFromQR(data);
      if (!code) {
        setMessage('Invalid QR format!');
        setMessageType('error');
        return;
      }

      // Check if already scanned in current session
      if (scannedCodesRef.current.has(code)) {
        const existing = invites.find((i) => i.code === code);
        setMessage(`❌ Already scanned at ${existing?.time || ''}`);
        setMessageType('error');
        return;
      }

      // Lookup in DB
      const { data: invite, error } = await supabase
        .from('invites')
        .select('id,guest_name,code,status,created_at')
        .eq('code', code)
        .maybeSingle();

      if (error) throw error;

      if (!invite) {
        setMessage('❌ Invalid guest code!');
        setMessageType('error');
        return;
      }

      // If it's first check-in, update DB and UI
      const alreadyChecked = invite.status === 'CHECKED_IN';
      const now = dayjs().format('YYYY-MM-DD HH:mm:ss');

      if (!alreadyChecked) {
        await supabase
          .from('invites')
          .update({ status: 'CHECKED_IN' })
          .eq('id', invite.id);
      }

      scannedCodesRef.current.add(code);
      setInvites((prev) => [
        ...prev,
        { name: invite.guest_name, code: code, time: now, status: alreadyChecked ? 'duplicate' : 'first' },
      ]);

      if (alreadyChecked) {
        setMessage(`❌ Already scanned before at ${now}`);
        setMessageType('error');
      } else {
        setMessage(`✅ Welcome ${invite.guest_name}`);
        setMessageType('success');
        setGuestCount((count) => count + 1); // Count only first-time scans
      }
    } catch (err) {
      console.error(err);
      setMessage('Error processing QR code.');
      setMessageType('error');
    }
  }

  function extractCodeFromQR(data) {
    try {
      // Try to parse if it's a URL
      if (data.startsWith('http')) {
        const url = new URL(data);
        return url.pathname.split('/').pop();
      }
      return data.trim();
    } catch {
      return null;
    }
  }

  function handleError(err) {
    console.error(err);
    setMessage('Camera error.');
    setMessageType('error');
  }

  return (
    <div style={{ background: BRAND.bg, minHeight: '100vh', padding: 20, color: BRAND.text }}>
      <h1 style={{ textAlign: 'center', marginBottom: 20 }}>Ya Mar7aba – Checker</h1>

      {/* Counter */}
      <div style={{ textAlign: 'center', marginBottom: 10 }}>
        <h2 style={{ margin: 0 }}>Guests in hall: {guestCount}</h2>
        <p style={{ color: BRAND.textMuted, margin: 0, fontSize: 14 }}>
          Only first-time scans are counted
        </p>
      </div>

      {/* Start scanning button */}
      {!scanning && (
        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <button
            style={{
              background: BRAND.accent,
              color: '#fff',
              border: 'none',
              padding: '16px 28px',
              fontSize: 18,
              borderRadius: 12,
              cursor: 'pointer',
            }}
            onClick={() => setScanning(true)}
          >
            Start Scanning
          </button>
        </div>
      )}

      {/* QR Scanner */}
      {scanning && (
        <div style={{ maxWidth: 400, margin: '0 auto', marginBottom: 20 }}>
          <QrReader
            delay={300}
            onError={handleError}
            onScan={handleScan}
            style={{ width: '100%' }}
          />
          <div style={{ textAlign: 'center', marginTop: 10 }}>
            <button
              onClick={() => setScanning(false)}
              style={{
                background: BRAND.danger,
                color: '#fff',
                border: 'none',
                padding: '10px 18px',
                fontSize: 14,
                borderRadius: 8,
                cursor: 'pointer',
              }}
            >
              Stop Camera
            </button>
          </div>
        </div>
      )}

      {/* Message */}
      {message && (
        <div
          style={{
            textAlign: 'center',
            padding: '10px 14px',
            borderRadius: 8,
            background: messageType === 'success' ? '#2E7D32' : '#C62828',
            marginBottom: 20,
          }}
        >
          {message}
        </div>
      )}

      {/* Table */}
      <div style={{ background: BRAND.surface, padding: 10, borderRadius: 8 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', color: '#fff' }}>
          <thead>
            <tr>
              <th style={thStyle}>Name</th>
              <th style={thStyle}>Time</th>
              <th style={thStyle}>Status</th>
            </tr>
          </thead>
          <tbody>
            {invites.map((iv, idx) => (
              <tr key={idx}>
                <td style={tdStyle}>{iv.name}</td>
                <td style={tdStyle}>{iv.time}</td>
                <td style={tdStyle}>
                  <span
                    style={{
                      display: 'inline-block',
                      width: 14,
                      height: 14,
                      borderRadius: '50%',
                      background: iv.status === 'first' ? '#4CAF50' : '#FFEB3B',
                    }}
                  ></span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const thStyle = {
  textAlign: 'left',
  padding: '8px 6px',
  borderBottom: '1px solid #6D4C41',
  fontSize: 14,
};

const tdStyle = {
  padding: '8px 6px',
  borderBottom: '1px solid #6D4C41',
  fontSize: 14,
};
