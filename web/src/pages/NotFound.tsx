import { Link } from 'react-router';
import { Empty } from '../components/ui.tsx';

export function NotFound() {
  return (
    <main className="page page-narrow">
      <div className="card">
        <Empty icon="compass" title="Page not found">
          The page you’re looking for doesn’t exist. <Link to="/">Go home</Link>
        </Empty>
      </div>
    </main>
  );
}
