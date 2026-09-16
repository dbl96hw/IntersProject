import BrandBanner from '../components/BrandBanner';
import InternNav from '../components/InternNav';
import SiteFooter from '../components/SiteFooter';
import { LANDING_TITLE } from '../constants';
import './LandingPage.css';

function LandingPage() {
  return (
    <div className="landing">
      <BrandBanner />

      <section className="landing__hero" aria-labelledby="landing-title">
        <h1 id="landing-title" className="landing__title" data-testid="landing-title">
          {LANDING_TITLE}
        </h1>
        <p className="landing__subtitle">
          Pick your name to open your workspace page.
        </p>
      </section>

      <InternNav />
      <SiteFooter />
    </div>
  );
}

export default LandingPage;
