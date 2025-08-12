'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { supabase } from '@/src/lib/supabaseClient';

export default function InvitePage() {
  const router = useRouter();
  const { id } = router.query;
  const [user, setUser] = useState(null);
  const [name, setName] = useState(null);

  useEffect(()=>{
    supabase.auth.getUser().then(async ({data})=>{
      setUser(data.user);
      if (data.user && id) {
        const { data: iv } = await supabase.from('invites').select('guest_name,status').eq('id', id).single();
        setName(iv?.guest_name || null);
      }
    });
  }, [id]);

  return (
    <div style={{padding:20, fontFamily:'sans-serif'}}>
      <h2>Invite</h2>
      {!user && (
        <>
          <p>Please show this screen to reception to scan.</p>
          <p style={{color:'#888'}}>Opening this page does not check you in.</p>
        </>
      )}
      {user && (
        <>
          <p>Hi staff. Use the <a href="/checker">Scanner page</a> to check-in.</p>
          {name && <p>Guest: <b>{name}</b></p>}
        </>
      )}
    </div>
  );
}
