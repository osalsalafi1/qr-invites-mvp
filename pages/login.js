'use client';
import { useState } from 'react';
import { supabase } from '@/src/lib/supabaseClient';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  async function signIn(e) {
    e.preventDefault();
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) { alert(error.message); return; }
    const { data: profile } = await supabase.from('profiles').select('role').eq('id', data.user.id).single();
    if (profile?.role === 'admin') window.location.href = '/admin';
    else window.location.href = '/checker';
  }

  async function signUp(e) {
    e.preventDefault();
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) { alert(error.message); return; }
    alert('Account created. Ask admin to set your role (admin/checker) in profiles.');
  }

  return (
    <div style={{maxWidth:420, margin:'40px auto', fontFamily:'sans-serif'}}>
      <h2>Login</h2>
      <form onSubmit={signIn}>
        <label>Email</label>
        <input type="email" value={email} onChange={e=>setEmail(e.target.value)} required style={{display:'block', width:'100%', marginBottom:8}}/>
        <label>Password</label>
        <input type="password" value={password} onChange={e=>setPassword(e.target.value)} required style={{display:'block', width:'100%', marginBottom:12}}/>
        <button type="submit">Sign In</button>
      </form>
      <hr style={{margin:'20px 0'}}/>
      <h4>First time?</h4>
      <form onSubmit={signUp}>
        <label>Email</label>
        <input type="email" value={email} onChange={e=>setEmail(e.target.value)} required style={{display:'block', width:'100%', marginBottom:8}}/>
        <label>Password</label>
        <input type="password" value={password} onChange={e=>setPassword(e.target.value)} required style={{display:'block', width:'100%', marginBottom:12}}/>
        <button type="submit">Sign Up</button>
      </form>
    </div>
  );
}
