'use client';
import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/src/lib/supabaseClient';
import RequireRole from '@/components/RequireRole';

/** Ya Marhaba brand */
const BRAND = {
  bg1: '#1A1410', bg2: '#211915', surface: '#2B211C', surfaceAlt: '#241C18',
  border: '#3B2E27', text: '#F5EFE8', textMuted: '#CBB8A0',
  primary: '#6B4226', primaryHover: '#7E4B2B', accent: '#B0825C',
  success: '#22C55E', warn: '#F59E0B', danger: '#EF4444',
};
const STORAGE_KEY = 'ya_marhaba_checker_scans_v3';

const Card = ({ children, style }) => (
  <div style={{
    background: `linear-gradient(180deg, ${BRAND.surface} 0%, ${BRAND.surfaceAlt} 100%)`,
    border: `1px solid ${BRAND.border}`, borderRadius: 18,
    boxShadow: '0 10px 30px rgba(0,0,0,0.35)', padding: 16, ...style,
  }}>{children}</div>
);
const Button = ({ variant='primary', children, ...props }) => {
  const base = {
    borderRadius: 12, padding: '12px 16px', fontWeight: 700, letterSpacing: '0.2px',
    cursor: 'pointer', border: `1px solid ${BRAND.border}`,
    transition: 'transform .06s ease, background .2s ease',
  };
  const variants = {
    primary: { background: BRAND.primary, color: BRAND.text },
    subtle:  { background: BRAND.surfaceAlt, color: BRAND.text },
    accent:  { background: BRAND.accent, color: BRAND.bg1 },
  };
  return (
    <button {...props}
      style={{ ...base, ...variants[variant], ...(props.style || {}) }}
      onMouseDown={(e)=>e.currentTarget.style.transform='scale(0.98)'}
      onMouseUp={(e)=>e.currentTarget.style.transform='scale(1)'}
    >{children}</button>
  );
};
const Chip = ({ color, children }) => (
  <span style={{
    display:'inline-flex',alignItems:'center',gap:6,fontSize:12,fontWeight:700,
    padding:'6px 10px',borderRadius:999,border:`1px solid ${BRAND.border}`,
    background:BRAND.surfaceAlt,color
  }}>
    <span style={{width:8,height:8,borderRadius:999,background:color,boxShadow:`0 0 0 2px ${BRAND.surfaceAlt}`}}/>
    {children}
  </span>
);

export default function Checker(){
  const [cams,setCams]=useState([]);
  const [deviceId,setDeviceId]=useState('');
  const [running,setRunning]=useState(false);
  const [errorMsg,setErrorMsg]=useState('');
  const [toast,setToast]=useState(null);
  const [scans,setScans]=useState([]); // {id,name,time,status}
  const scansRef=useRef(scans);
  const seenRef=useRef(new Set());
  const qrRef=useRef(null);
  const manualRef=useRef(null);

  // Camera Test state
  const [testActive,setTestActive]=useState(false);
  const testVideoRef=useRef(null);
  const testStreamRef=useRef(null);
  const [testMsg,setTestMsg]=useState('');

  // Load persisted table
  useEffect(()=>{
    try{
      const raw=localStorage.getItem(STORAGE_KEY);
      if(raw){
        const parsed=JSON.parse(raw);
        if(Array.isArray(parsed?.scans)){
          setScans(parsed.scans);
          scansRef.current=parsed.scans;
          seenRef.current=new Set(parsed.scans.map(r=>r.id));
        }
      }
    }catch{}
  },[]);
  useEffect(()=>{
    scansRef.current=scans;
    try{ localStorage.setItem(STORAGE_KEY, JSON.stringify({scans})); }catch{}
  },[scans]);

  // Helpers
  const normalizeId=(text)=>{
    try{
      const trimmed=(text||'').trim();
      const url=new URL(trimmed);
      const parts=(url.pathname||'').split('/').filter(Boolean);
      const atI=parts.findIndex(p=>p.toLowerCase()==='i');
      const id= atI>=0 && parts[atI+1] ? parts[atI+1] : (parts[parts.length-1]||'');
      return decodeURIComponent(id).trim().toLowerCase();
    }catch{
      return (text||'').trim().toLowerCase();
    }
  };
  async function fetchNameIfPossible(id){
    try{
      const {data}=await supabase.from('invites').select('guest_name').eq('id',id).single();
      return data?.guest_name || 'Guest';
    }catch{ return 'Guest'; }
  }

  // ---------- Camera listing (with permission prompt) ----------
  async function listCameras(){
    setErrorMsg('');
    if(typeof navigator==='undefined' || !navigator.mediaDevices){
      setErrorMsg('Camera API not available in this browser.'); return;
    }
    try{
      // prompt to unlock labels on iOS
      const s=await navigator.mediaDevices.getUserMedia({video:true,audio:false});
      s.getTracks().forEach(t=>t.stop());
    }catch(e){
      console.warn('Preview permission not granted:',e);
    }
    try{
      const devices=await navigator.mediaDevices.enumerateDevices();
      const vs=devices.filter(d=>d.kind==='videoinput');
      setCams(vs);
      if(vs.length && !deviceId){
        const back=vs.find(v=>/back|rear|environment/i.test(v.label));
        setDeviceId((back||vs[0]).deviceId);
      }
    }catch(e){
      console.error('enumerateDevices failed:',e);
      setErrorMsg('Unable to list cameras. Check browser permissions.');
    }
  }

  // ---------- Start camera (robust) ----------
  let starting=false;
  async function startCamera(){
    setErrorMsg('');
    if(starting || running) return;
    starting=true;
    try{
      if(typeof window==='undefined') throw new Error('Not in a browser context.');
      if(!window.isSecureContext) throw new Error('Use HTTPS (Vercel) to access camera.');
      const mountId='qr-reader';
      const el=document.getElementById(mountId);
      if(!el) throw new Error('#qr-reader element not found.');
      if(!navigator.mediaDevices?.getUserMedia) throw new Error('Camera API not supported.');

      // stop any test stream
      await stopTest();

      // clean old session
      try{ await qrRef.current?.stop(); }catch{}
      try{ await qrRef.current?.clear(); }catch{}

      // import lib
      let Html5Qrcode;
      try{
        const mod=await import('html5-qrcode'); Html5Qrcode=mod.Html5Qrcode;
      }catch(e){ console.error('html5-qrcode import failed',e); throw new Error('Failed to load QR scanner library.'); }

      const qr=new Html5Qrcode(mountId,true); qrRef.current=qr;

      // Try chain: exact deviceId -> facingMode env -> generic video
      const tryConfigs=[
        deviceId ? {video:{ deviceId:{ exact:deviceId }}} : null,
        {video:{ facingMode:{ exact:'environment' }}},
        {video:true},
      ].filter(Boolean);

      let started=false, lastErr=null;
      for(const cfg of tryConfigs){
        try{
          await qr.start(
            cfg.video,
            { fps: 10, qrbox: { width: 280, height: 280 } },
            async (decodedText)=>{
              try{ await stopCamera(); await handleDecoded(decodedText); }
              catch(scanErr){ console.error('decode error:',scanErr); setErrorMsg('Scanned, but processing failed.'); }
            },
            ()=>{}
          );
          started=true; break;
        }catch(e){
          console.warn('qr.start failed with cfg',cfg,e);
          lastErr=e;
        }
      }
      if(!started){
        throw new Error(lastErr?.message || 'Camera failed to start with all fallbacks.');
      }
      setRunning(true);
    }catch(e){
      console.error('startCamera error:',e);
      setErrorMsg(e?.message || 'Camera failed to start.');
      setRunning(false);
    }finally{ starting=false; }
  }

  async function stopCamera(){
    try{ await qrRef.current?.stop(); }catch{}
    try{ await qrRef.current?.clear(); }catch{}
    setRunning(false);
  }

  // ---------- Camera Test (plain getUserMedia) ----------
  async function startTest(){
    setTestMsg('');
    setErrorMsg('');
    try{
      if(!window.isSecureContext) throw new Error('Use HTTPS to access camera.');
      if(!navigator.mediaDevices?.getUserMedia) throw new Error('Camera API not supported.');
      // pick best guess
      const videoConstraints = deviceId
        ? { deviceId: { exact: deviceId } }
        : { facingMode: { exact: 'environment' } };
      const stream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints, audio: false });
      testStreamRef.current = stream;
      if(testVideoRef.current){
        testVideoRef.current.srcObject = stream;
        await testVideoRef.current.play();
      }
      setTestActive(true);
      setTestMsg('Camera Test running. If you see video, camera permissions are OK.');
    }catch(e){
      console.error('Camera Test failed:', e);
      setTestMsg('Camera Test error: ' + (e?.message || String(e)));
    }
  }
  async function stopTest(){
    try{
      testStreamRef.current?.getTracks()?.forEach(t=>t.stop());
      testStreamRef.current=null;
    }catch{}
    if(testVideoRef.current){
      testVideoRef.current.pause();
      testVideoRef.current.srcObject=null;
    }
    setTestActive(false);
  }

  // ---------- Scanning ----------
  async function handleDecoded(text){
    try{
      const now=new Date().toLocaleString();
      const id=normalizeId(text);
      if(!id){
        addRow({id:'-',name:'Invalid QR',time:now,status:'INVALID'});
        showToast('Invalid QR','danger'); return;
      }
      const duplicate = seenRef.current.has(id) || scansRef.current.some(r=>r.id===id);
      const name = await fetchNameIfPossible(id);
      addRow({id,name,time:now,status:duplicate?'ALREADY':'OK'});
      showToast(duplicate?`Already in table — ${name}`:`Checked — ${name}`, duplicate?'warn':'success');
      seenRef.current.add(id);
    }catch(e){
      console.error('handleDecoded crashed:',e);
      setErrorMsg('Invalid QR content or internal error.');
    }
  }
  function addRow(row){ setScans(prev=>[row,...prev]); }
  async function manualAdd(){
    const val=manualRef.current?.value?.trim(); if(!val) return;
    await stopCamera(); await handleDecoded(val); manualRef.current.value='';
  }

  // Toast
  function showToast(message,type='success'){
    setToast({message,type});
    setTimeout(()=>setToast(null),1600);
  }

  // UI helpers
  const StatusChip=({status})=>{
    if(status==='OK') return <Chip color={BRAND.success}>First in table</Chip>;
    if(status==='ALREADY') return <Chip color={BRAND.warn}>Already in table</Chip>;
    if(status==='INVALID') return <Chip color={BRAND.danger}>Invalid</Chip>;
    return <Chip color={BRAND.textMuted}>{status}</Chip>;
  };

  return (
    <RequireRole role={['checker','admin']}>
      <div style={{
        minHeight:'100vh',
        background:`radial-gradient(1200px 800px at 80% -10%, ${BRAND.bg2} 0%, ${BRAND.bg1} 60%)`,
        color:BRAND.text, padding:'28px 16px',
        fontFamily:'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial',
      }}>
        <div style={{maxWidth:1080, margin:'0 auto'}}>

          {/* Header */}
          <Card style={{marginBottom:16,padding:18}}>
            <div style={{display:'flex',alignItems:'center',gap:14,flexWrap:'wrap'}}>
              <div aria-hidden style={{
                width:44,height:44,borderRadius:12,
                background:`linear-gradient(180deg, ${BRAND.primary} 0%, ${BRAND.primaryHover} 100%)`,
                display:'grid',placeItems:'center',
                boxShadow:'0 8px 18px rgba(0,0,0,0.35)', border:`1px solid ${BRAND.border}`,
                fontWeight:900, letterSpacing:'0.4px'
              }}>YM</div>
              <div style={{flex:1,minWidth:240}}>
                <div style={{display:'flex',alignItems:'center',gap:10}}>
                  <span style={{
                    fontSize:12,textTransform:'uppercase',letterSpacing:'0.12em',
                    padding:'4px 10px', borderRadius:999,
                    background:BRAND.surfaceAlt, border:`1px solid ${BRAND.border}`, color:BRAND.textMuted
                  }}>Ya Marhaba</span>
                  <div style={{height:1, background:BRAND.accent, flex:1, opacity:.5}}/>
                </div>
                <h1 style={{margin:'6px 0 0', fontSize:22, fontWeight:800}}>Guest Checker</h1>
                <p style={{margin:'6px 0 0', color:BRAND.textMuted, fontSize:13}}>
                  Start camera → scan → we stop the camera and log it below. Repeat scans in this device session show “Already in table”.
                </p>
                <div style={{marginTop:8, fontSize:12, color:BRAND.accent, letterSpacing:'0.08em'}}>
                  UI build: YA-MARHABA v2025-08-12-02
                </div>
              </div>
            </div>
          </Card>

          {/* Controls & Reader */}
          <Card style={{marginBottom:16}}>
            <div style={{display:'flex',gap:10,flexWrap:'wrap',alignItems:'center'}}>
              {!cams.length && <Button variant="subtle" onClick={listCameras}>Find cameras</Button>}
              {cams.length>0 && (
                <>
                  <select value={deviceId} onChange={e=>setDeviceId(e.target.value)} style={{
                    background:BRAND.surfaceAlt,color:BRAND.text,border:`1px solid ${BRAND.border}`,
                    borderRadius:12,padding:'12px 14px',minWidth:260,outline:'none'
                  }}>
                    {cams.map(c=><option key={c.deviceId} value={c.deviceId}>{c.label || 'Camera'}</option>)}
                  </select>
                  {!running ? (
                    <Button onClick={startCamera}>▶️ Start camera</Button>
                  ) : (
                    <Button variant="subtle" onClick={stopCamera}>⏹ Stop camera</Button>
                  )}
                </>
              )}
              <div style={{marginLeft:'auto', color:BRAND.textMuted, fontSize:12}}>
                Session persists on this device (localStorage)
              </div>
            </div>

            <div id="qr-reader" style={{
              marginTop:12, border:`1px dashed ${BRAND.accent}`, borderRadius:16,
              minHeight:280, display:'grid', placeItems:'center', background:BRAND.surfaceAlt
            }}>
              {!running && (
                <div style={{textAlign:'center', color:BRAND.textMuted, lineHeight:1.5}}>
                  <div style={{fontSize:14}}>Camera preview will appear here</div>
                  <div style={{fontSize:12}}>Choose a camera and press <b>Start camera</b></div>
                </div>
              )}
            </div>

            {errorMsg && (
              <div style={{
                marginTop:10, padding:12, borderRadius:12, border:`1px solid ${BRAND.border}`,
                background:'#3a1f1a', color:BRAND.text
              }}>
                <b>Camera error:</b> {errorMsg}
              </div>
            )}
          </Card>

          {/* Camera Test */}
          <Card style={{marginBottom:16}}>
            <h3 style={{margin:0, marginBottom:10}}>Camera Test (diagnostic)</h3>
            <div style={{display:'flex', gap:10, flexWrap:'wrap', alignItems:'center'}}>
              {!testActive ? (
                <Button variant="subtle" onClick={startTest}>▶️ Start test preview</Button>
              ) : (
                <Button variant="subtle" onClick={stopTest}>⏹ Stop test</Button>
              )}
              <span style={{color:BRAND.textMuted, fontSize:12}}>
                If you can see video here, permissions & camera work.
              </span>
            </div>
            <div style={{
              marginTop:12, border:`1px dashed ${BRAND.border}`, borderRadius:12,
              minHeight:200, display:'grid', placeItems:'center', background:BRAND.surfaceAlt
            }}>
              <video ref={testVideoRef} playsInline muted style={{width:'100%', maxWidth:420, borderRadius:12}}/>
              {!testActive && <span style={{color:BRAND.textMuted, fontSize:12}}>No test stream</span>}
            </div>
            {testMsg && <div style={{marginTop:8, color:BRAND.textMuted, fontSize:12}}>{testMsg}</div>}
          </Card>

          {/* Manual Add */}
          <Card style={{marginBottom:16}}>
            <h3 style={{margin:0, marginBottom:10}}>Manual add (UUID or full URL)</h3>
            <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
              <input ref={manualRef}
                placeholder="550e8400-e29b-41d4-a716-446655440000  or  https://.../i/UUID"
                style={{
                  flex:1,minWidth:280, background:BRAND.surfaceAlt, color:BRAND.text,
                  border:`1px solid ${BRAND.border}`, borderRadius:12, padding:'12px 14px', outline:'none'
                }}
              />
              <Button variant="accent" onClick={manualAdd}>Add to table</Button>
            </div>
          </Card>

          {/* Scans Table */}
          <Card>
            <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:8}}>
              <h3 style={{margin:0}}>Scans (this device)</h3>
              <div style={{height:1, background:BRAND.border, flex:1}}/>
              <Chip color={BRAND.textMuted}>{scans.length} total</Chip>
            </div>
            <div style={{overflowX:'auto'}}>
              <table style={{width:'100%', borderCollapse:'collapse'}}>
                <thead>
                  <tr style={{background:BRAND.surfaceAlt}}>
                    <th style={thStyle()}>#</th>
                    <th style={thStyle()}>Guest</th>
                    <th style={thStyle()}>Time</th>
                    <th style={thStyle()}>Status</th>
                    <th style={thStyle()}>ID</th>
                  </tr>
                </thead>
                <tbody>
                  {scans.length===0 ? (
                    <tr>
                      <td colSpan={5} style={{...tdStyle(), color:BRAND.textMuted, textAlign:'center'}}>
                        No scans yet — try the camera or manual add.
                      </td>
                    </tr>
                  ) : (
                    scans.map((r,idx)=>(
                      <tr key={`${r.id}-${idx}`} style={{background:BRAND.surfaceAlt}}>
                        <td style={tdStyle()}>{scans.length-idx}</td>
                        <td style={tdStyle()}>{r.name}</td>
                        <td style={tdStyle()}>{r.time}</td>
                        <td style={tdStyle()}><StatusChip status={r.status}/></td>
                        <td style={{...tdStyle(), fontFamily:'ui-monospace, SFMono-Regular, Menlo, monospace'}}>{r.id}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <p style={{marginTop:10, color:BRAND.textMuted, fontSize:12}}>
              Data is stored locally in this browser. Clearing site data will reset this table.
            </p>
          </Card>
        </div>

        {/* Toast */}
        {toast && (
          <div style={{
            position:'fixed', bottom:20, left:'50%', transform:'translateX(-50%)',
            background:BRAND.surface, color:BRAND.text, border:`1px solid ${BRAND.border}`,
            borderRadius:12, padding:'10px 14px', boxShadow:'0 10px 30px rgba(0,0,0,0.35)',
            display:'flex', alignItems:'center', gap:10, zIndex:50
          }}>
            <span style={{
              width:10, height:10, borderRadius:999,
              background: toast.type==='success' ? BRAND.success : toast.type==='warn' ? BRAND.warn : BRAND.danger
            }}/>
            <span style={{fontWeight:700}}>{toast.message}</span>
          </div>
        )}
      </div>
    </RequireRole>
  );
}

function thStyle(){ return {
  textAlign:'left', color:BRAND.textMuted, padding:'10px 10px',
  borderBottom:`1px solid ${BRAND.border}`, fontSize:13, letterSpacing:'0.3px',
};}
function tdStyle(){ return {
  padding:'12px 10px', borderBottom:`1px solid ${BRAND.border}`,
};}
