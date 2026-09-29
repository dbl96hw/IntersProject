import hatchworksBanner from '../assets/hatchworks-banner.png';
import './BrandBanner.css';

function BrandBanner() {
  return (
    <section className="brand-banner" aria-label="HatchWorks AI">
      <img
        className="brand-banner__logo"
        src={hatchworksBanner}
        alt="HatchWorks AI"
        data-testid="brand-banner"
      />
    </section>
  );
}

export default BrandBanner;
