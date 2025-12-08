import Dashboard from '../components/dashboard';

export default function Home() {
  const apiBase = process.env.NEXT_PUBLIC_FLORA_API_BASE || 'http://flora-consumer:3000';
  return <Dashboard apiBase={apiBase} />;
}
