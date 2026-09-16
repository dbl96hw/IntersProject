import { Link } from 'react-router-dom';
import BrandBanner from '../../components/BrandBanner';
import './InternWorkspace.css';

function InternWorkspace({ name }) {
  return (
    <div className="intern-workspace">
      <BrandBanner />
      <main className="intern-workspace__main">
        <p className="intern-workspace__eyebrow">Workspace</p>
        <h1 className="intern-workspace__title" data-testid="intern-workspace-title">
          {name}
        </h1>
        <p className="intern-workspace__hint">
          This page is yours to build. Start from here.
        </p>
        <Link className="intern-workspace__back" to="/" data-testid="back-home">
          Back to landing
        </Link>
      </main>
    </div>
  );
}

export default InternWorkspace;
