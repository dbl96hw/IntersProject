import { DASHBOARD_TEXT } from '../constants';
import './IngestionList.css';

// "used (genomics, 3 rows)" or "not used"; the engine's message, if any, follows.
function detailOf(item) {
  if (!item.accepted) {
    return DASHBOARD_TEXT.FILE_NOT_USED;
  }
  const parts = [item.source, Number.isInteger(item.rows) ? `${item.rows} ${DASHBOARD_TEXT.ROWS}` : null].filter(Boolean);
  return parts.length > 0 ? `${DASHBOARD_TEXT.FILE_USED} (${parts.join(', ')})` : DASHBOARD_TEXT.FILE_USED;
}

// One line per uploaded file (or table inside a file), straight from analysis.ingestion:
// what the engine used, and why it did not use the rest (off-topic, unknown layout, ...).
function IngestionList({ ingestion = [] }) {
  if (!Array.isArray(ingestion) || ingestion.length === 0) {
    return null;
  }
  return (
    <section className="ingestion-list" data-testid="ingestion-list" aria-label={DASHBOARD_TEXT.FILES_TITLE}>
      <h2 className="ingestion-list__title">{DASHBOARD_TEXT.FILES_TITLE}</h2>
      <ul>
        {ingestion.map((item, index) => (
          <li
            key={`${item.file}-${index}`}
            className={item.accepted ? 'ingestion-list__item' : 'ingestion-list__item ingestion-list__item--rejected'}
            data-testid={`ingestion-item-${index}`}
          >
            <strong>{item.file}</strong>: {detailOf(item)}
            {item.message ? ` - ${item.message}` : ''}
          </li>
        ))}
      </ul>
    </section>
  );
}

export default IngestionList;
