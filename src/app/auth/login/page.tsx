'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setError('');
    const sb = createClient();
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) { setError(error.message); setLoading(false); return; }
    router.push('/dashboard');
    router.refresh();
  }

  async function handleGoogle() {
    const sb = createClient();
    await sb.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${location.origin}/auth/callback` },
    });
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-green-950 px-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex items-center gap-2 group">
            <span className="text-3xl">🌿</span>
            <span className="font-bold text-xl tracking-widest text-green-300 group-hover:text-green-200 transition-colors uppercase">
              Iriga<span className="text-green-500">Pro</span>
            </span>
          </Link>
          <p className="text-green-600 text-sm mt-2">Autentifică-te în contul tău</p>
        </div>

        <div className="card">
          {/* Google */}
          <button onClick={handleGoogle}
            className="w-full flex items-center justify-center gap-3 bg-green-950 hover:bg-green-800
                       border border-green-800 hover:border-green-600 rounded-lg px-4 py-2.5
                       text-sm font-medium text-green-200 transition-all mb-4">
            <svg className="w-4 h-4" viewBox="0 0 24 24">
              <path fill="#EA4335" d="M5.26 9.77A7.24 7.24 0 0 1 12 4.75c1.84 0 3.5.67 4.79 1.76l3.56-3.56A12 12 0 0 0 0 12c0 1.99.49 3.86 1.35 5.52l3.91-3.75Z"/>
              <path fill="#34A853" d="M12 19.25c-2.37 0-4.47-.96-6.01-2.5L2.08 20.5A12 12 0 0 0 12 24c3.21 0 6.14-1.19 8.35-3.14l-3.77-3.27A7.24 7.24 0 0 1 12 19.25Z"/>
              <path fill="#4A90D9" d="M23.75 12c0-.88-.08-1.72-.23-2.54H12v4.8h6.6a5.63 5.63 0 0 1-2.44 3.7l3.77 3.27C22.4 19.02 23.75 15.77 23.75 12Z"/>
              <path fill="#FBBC05" d="M5.26 14.23A7.23 7.23 0 0 1 4.75 12c0-.78.14-1.54.38-2.23L1.22 6.02A12 12 0 0 0 0 12c0 1.99.49 3.86 1.35 5.52l3.91-3.29Z"/>
            </svg>
            Continuă cu Google
          </button>

          <div className="flex items-center gap-3 mb-4">
            <div className="flex-1 h-px bg-green-800" />
            <span className="text-xs text-green-700">sau cu email</span>
            <div className="flex-1 h-px bg-green-800" />
          </div>

          <form onSubmit={handleLogin} className="flex flex-col gap-4">
            <div>
              <label className="label">Email</label>
              <input type="email" value={email} onChange={e=>setEmail(e.target.value)}
                className="input" placeholder="tu@exemplu.ro" required />
            </div>
            <div>
              <label className="label">Parolă</label>
              <input type="password" value={password} onChange={e=>setPassword(e.target.value)}
                className="input" placeholder="••••••••" required />
            </div>

            {error && (
              <div className="bg-red-950 border border-red-800 rounded-lg px-3 py-2 text-red-400 text-xs">
                {error}
              </div>
            )}

            <button type="submit" disabled={loading} className="btn-primary py-2.5 w-full text-center">
              {loading ? 'Se autentifică...' : 'Autentifică-te'}
            </button>
          </form>
        </div>

        <p className="text-center text-sm text-green-700 mt-4">
          Nu ai cont?{' '}
          <Link href="/auth/register" className="text-green-400 hover:text-green-300 font-medium">
            Înregistrează-te gratuit
          </Link>
        </p>
      </div>
    </div>
  );
}
