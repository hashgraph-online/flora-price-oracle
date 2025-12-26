import Dashboard from '../components/dashboard';

export const dynamic = 'force-dynamic';

export default function Home() {
  const apiBase = process.env.NEXT_PUBLIC_FLORA_API_BASE || '/api';
  return <Dashboard apiBase={apiBase} />;
}
