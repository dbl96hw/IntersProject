import { useEffect, useState } from 'react';
import BrandBanner from '../components/BrandBanner';
import SiteFooter from '../components/SiteFooter';
import { API_BASE_URL, BACKEND_STATUS, HEALTH_PATH, LANDING_SUBTITLE, LANDING_TITLE } from '../constants';
import './LandingPage.css';

function LandingPage() {
  const [status, setStatus] = useState(BACKEND_STATUS.CHECKING);

  useEffect(() => {
    fetch(`${API_BASE_URL}${HEALTH_PATH}`)
      .then((res) => {
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        return res.json();
      })
      .then((data) => setStatus(data.healthy ? BACKEND_STATUS.UP : BACKEND_STATUS.UNHEALTHY))
      .catch(() => setStatus(BACKEND_STATUS.UNREACHABLE));
  }, []);

  return (
    <div className="landing">
      <BrandBanner />

      <section className="landing__hero" aria-labelledby="landing-title">
        <h1 id="landing-title" className="landing__title" data-testid="landing-title">
          {LANDING_TITLE}
        </h1>
        <p className="landing__subtitle">{LANDING_SUBTITLE}</p>
        <p className="landing__status" data-testid="health-status">
          {status}
        </p>
      </section>

      <SiteFooter />
    </div>
  );
}

export default LandingPage;
