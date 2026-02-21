'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

export default function RegisterPage() {
  const router = useRouter();
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [name, setName]         = useState('');
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');
  const [done, setDone]         = useState(false);

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setError('');
    const sb = createClient();
    const { error } = await sb.auth.signUp({
      email, password,
      options: { data: { full_name: name } },
    });
    if (error) { setError(error.message); setLoading(false); return; }
    setDone(true);
  }

  if (done) return (
    <div className="min-h-screen flex items-center justify-center bg-green-950 px-4">
      <div className="card text-center max-w-sm">
        <div className="text-4xl mb-4">📧</div>
        <h2 className="font-bold text-green-200 text-lg mb-2">Verifică emailul!</h2>
        <p className="text-green-500 text-sm">
          Am trimis un link de confirmare la <strong className="text-green-300">{email}</strong>.
          Apasă linkul pentru a activa contul, apoi poți să te autentifici.
        </p>
        <Link href="/auth/login" className="btn-primary mt-6 inline-block">
          Mergi la autentificare
        </Link>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen flex items-center justify-center bg-green-950 px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex items-center gap-2">
            <span className="text-3xl">🌿</span>
            <span className="font-bold text-xl tracking-widest text-green-300 uppercase">
              Iriga<span className="text-green-500">Pro</span>
            </span>
          </Link>
          <p className="text-green-600 text-sm mt-2">Creează cont gratuit</p>
        </div>

        <div className="card">
          <form onSubmit={handleRegister} className="flex flex-col gap-4">
            <div>
              <label className="label">Numele tău</label>
              <input value={name} onChange={e=>setName(e.target.value)}
                className="input" placeholder="Ion Popescu" />
            </div>
            <div>
              <label className="label">Email</label>
              <input type="email" value={email} onChange={e=>setEmail(e.target.value)}
                className="input" placeholder="tu@exemplu.ro" required />
            </div>
            <div>
              <label className="label">Parolă</label>
              <input type="password" value={password} onChange={e=>setPassword(e.target.value)}
                className="input" placeholder="Minim 6 caractere" minLength={6} required />
            </div>

            {error && (
              <div className="bg-red-950 border border-red-800 rounded-lg px-3 py-2 text-red-400 text-xs">
                {error}
              </div>
            )}

            <button type="submit" disabled={loading} className="btn-primary py-2.5 w-full text-center">
              {loading ? 'Se creează contul...' : 'Creează cont gratuit'}
            </button>
          </form>

          <p className="text-xs text-green-700 text-center mt-4">
            Prin înregistrare ești de acord cu Termenii de utilizare.
          </p>
        </div>

        <p className="text-center text-sm text-green-700 mt-4">
          Ai deja cont?{' '}
          <Link href="/auth/login" className="text-green-400 hover:text-green-300 font-medium">
            Autentifică-te
          </Link>
        </p>
      </div>
    </div>
  );
}
