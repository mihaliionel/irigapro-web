import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="min-h-screen bg-green-950 flex flex-col">
      {/* Nav */}
      <nav className="border-b border-green-900 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-2xl">🌿</span>
          <span className="font-bold text-lg tracking-widest text-green-300 uppercase">
            Iriga<span className="text-green-500">Pro</span>
          </span>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/auth/login" className="btn-ghost">Autentificare</Link>
          <Link href="/auth/register" className="btn-primary">Începe gratuit</Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="flex-1 flex flex-col items-center justify-center text-center px-6 py-24 gap-8">
        <div className="inline-flex items-center gap-2 bg-green-900 border border-green-700 rounded-full px-4 py-1.5 text-xs text-green-300 font-medium mb-2">
          <span className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse-soft" />
          Simulator interactiv · Rain Bird · Hunter · Toro
        </div>

        <h1 className="text-5xl md:text-6xl font-bold text-green-100 max-w-3xl leading-tight">
          Proiectează sisteme de irigații{' '}
          <span className="text-green-400">profesionale</span>
        </h1>

        <p className="text-green-500 text-lg max-w-xl leading-relaxed">
          Desenează curtea, plasează aspersoarele, simulează irigarea și exportă
          schema tehnică — totul în browser, fără software scump.
        </p>

        <div className="flex flex-col sm:flex-row gap-3">
          <Link href="/auth/register"
            className="btn-primary px-8 py-3 text-base">
            Creează cont gratuit
          </Link>
          <Link href="/simulator/demo"
            className="btn-ghost px-8 py-3 text-base">
            Demo live →
          </Link>
        </div>

        {/* Feature grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-16 max-w-4xl w-full">
          {[
            { icon: '✏️', title: 'Orice formă', desc: 'Desenezi poligonul curții direct în browser' },
            { icon: '💧', title: '28 modele', desc: 'Rain Bird, Hunter, Toro și generice' },
            { icon: '🔧', title: 'Trasee conducte', desc: 'Calcul automat MST sau manual' },
            { icon: '☁️', title: 'Salvat în cloud', desc: 'Accesezi proiectele de pe orice device' },
          ].map(f => (
            <div key={f.title} className="card text-left hover:border-green-600 transition-colors">
              <div className="text-2xl mb-2">{f.icon}</div>
              <div className="font-semibold text-green-200 text-sm mb-1">{f.title}</div>
              <div className="text-green-600 text-xs leading-relaxed">{f.desc}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-green-900 px-6 py-4 text-center text-xs text-green-700">
        IrigaPro · Timișoara ·{' '}
        <span className="text-green-600">Gratuit până la 50k utilizatori</span>
      </footer>
    </main>
  );
}
