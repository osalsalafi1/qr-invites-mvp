'use client';
import { useEffect, useState } from 'react';
import { supabase } from '@/src/lib/supabaseClient';

export default function RequireRole({ role, children }) {
  const [ok, setOk] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function run() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { window.location.href = '/login'; return; }
      const { data, error } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single();
      if (error) { console.error(error); window.location.href = '/login'; return; }
      if (!role || data?.role === role || (Array.isArray(role) && role.includes(data?.role))) {
        setOk(true);
      } else {
        alert('No permission for this page.');
        window.location.href = '/';
      }
      setLoading(false);
    }
    run();
  }, [role]);

  if (loading) return <div style={{padding:20}}>Loading...</div>;
  return ok ? children : null;
}
