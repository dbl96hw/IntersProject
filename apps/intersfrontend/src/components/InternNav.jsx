import { Link } from 'react-router-dom';
import { INTERNS } from '../constants';
import './InternNav.css';

function InternNav() {
  return (
    <nav className="intern-nav" aria-label="Intern pages">
      <ul className="intern-nav__list">
        {INTERNS.map((intern, index) => (
          <li key={intern.id} style={{ '--delay': `${0.12 + index * 0.06}s` }}>
            <Link
              className="intern-nav__button"
              to={intern.path}
              data-testid={`intern-link-${intern.id}`}
            >
              {intern.name}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export default InternNav;
