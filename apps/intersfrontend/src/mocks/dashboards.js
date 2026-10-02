/**
 * Mock data for the use case 4 frontend. Rows follow the data engine's
 * candidate contract (`GET /candidates`) so swapping in the real API later is a small change.
 */

// Values and reasons are modeled on data/synthetic/uc4/trial_recommendations_synthetic.csv.
const CANDIDATE_TEMPLATES = [
  {
    mean_yield_t_ha: 11.05,
    n_trials: 5,
    n_fail: 0,
    colour: 'GREEN',
    reason: 'yield meets threshold; moisture meets threshold; disease score acceptable; genomic value favourable',
  },
  {
    mean_yield_t_ha: 10.08,
    n_trials: 5,
    n_fail: 1,
    colour: 'AMBER',
    reason: 'yield meets threshold; disease score acceptable; genomic value below target',
  },
  {
    mean_yield_t_ha: 8.34,
    n_trials: 6,
    n_fail: 4,
    colour: 'RED',
    reason: 'yield below target; moisture meets threshold; disease risk elevated; genomic value below target',
  },
  {
    mean_yield_t_ha: 13.42,
    n_trials: 6,
    n_fail: 0,
    colour: 'GREEN',
    reason:
      'yield meets threshold; moisture meets threshold; disease score acceptable; genomic value favourable; strongest performer across every location and season in this batch, recommended for advancement to the next stage',
  },
  {
    mean_yield_t_ha: 11.23,
    n_trials: 4,
    n_fail: 1,
    colour: 'AMBER',
    reason:
      'yield meets threshold; moisture above target; disease score acceptable; genomic value favourable; retest recommended at LOC-03 because an unusually wet harvest window skewed the moisture readings',
  },
  {
    mean_yield_t_ha: 6.04,
    n_trials: 5,
    n_fail: 3,
    colour: 'RED',
    reason: 'fails in 3 of 5 trials',
  },
  {
    mean_yield_t_ha: 10.79,
    n_trials: 3,
    n_fail: 0,
    colour: 'GREEN',
    reason: 'yield meets threshold; disease score acceptable',
  },
  {
    mean_yield_t_ha: 9.41,
    n_trials: 5,
    n_fail: 2,
    colour: 'AMBER',
    reason: 'yield meets threshold; moisture above target; disease risk elevated',
  },
  {
    mean_yield_t_ha: 5.52,
    n_trials: 4,
    n_fail: 4,
    colour: 'RED',
    reason:
      'yield below target; moisture meets threshold; disease score acceptable; genomic value below target; consistently underperforms the check varieties and showed lodging in two of four plots',
  },
  {
    mean_yield_t_ha: 12.63,
    n_trials: 4,
    n_fail: 0,
    colour: 'GREEN',
    reason: 'yield meets threshold; moisture meets threshold; disease score acceptable',
  },
];

const CROPS = {
  MAIZE: { code: 'MZ', name: 'Maize', yieldFactor: 1 },
  WHEAT: { code: 'WH', name: 'Wheat', yieldFactor: 0.7 },
  SOYBEAN: { code: 'SB', name: 'Soybean', yieldFactor: 0.3 },
  SUNFLOWER: { code: 'SF', name: 'Sunflower', yieldFactor: 0.28 },
};

function formatCandidateId(cropCode, number) {
  return `SYN-${cropCode}-${String(number).padStart(5, '0')}`;
}

// Rotating the templates by `templateOffset` keeps each dashboard's rows in a different order.
function buildCandidates({ crop, firstNumber, count, templateOffset }) {
  return Array.from({ length: count }, (_, index) => {
    const template = CANDIDATE_TEMPLATES[(index + templateOffset) % CANDIDATE_TEMPLATES.length];

    return {
      candidate_id: formatCandidateId(crop.code, firstNumber + index),
      crop: crop.name,
      mean_yield_t_ha: Number((template.mean_yield_t_ha * crop.yieldFactor).toFixed(2)),
      n_trials: template.n_trials,
      n_fail: template.n_fail,
      colour: template.colour,
      engine_colour: template.colour,
      reason: template.reason,
      overridden: false,
      override: null,
    };
  });
}

export const RECENT_DASHBOARDS = [
  {
    id: 'dashboard-maize-2026',
    title: 'Maize trials 2026',
    fileNames: ['trial_recommendations_2026.csv', 'genomics_maize.xlsx'],
    candidates: buildCandidates({ crop: CROPS.MAIZE, firstNumber: 1, count: 10, templateOffset: 0 }),
  },
  {
    id: 'dashboard-wheat-spring',
    title: 'Wheat spring batch',
    fileNames: ['wheat_spring_trials.csv'],
    candidates: buildCandidates({ crop: CROPS.WHEAT, firstNumber: 101, count: 9, templateOffset: 3 }),
  },
  {
    id: 'dashboard-soybean-loc03',
    title: 'Soybean LOC-03 review',
    fileNames: ['soybean_loc03.xlsx', 'lab_report_loc03.pdf'],
    candidates: buildCandidates({ crop: CROPS.SOYBEAN, firstNumber: 201, count: 8, templateOffset: 5 }),
  },
  {
    id: 'dashboard-sunflower-2025',
    title: 'Sunflower 2025 season',
    fileNames: ['sunflower_2025.csv', 'observations_2025.csv', 'field_notes.docx'],
    candidates: buildCandidates({ crop: CROPS.SUNFLOWER, firstNumber: 301, count: 9, templateOffset: 7 }),
  },
  {
    id: 'dashboard-maize-loc01',
    title: 'Maize LOC-01 rerun',
    fileNames: ['maize_loc01_rerun.csv'],
    candidates: buildCandidates({ crop: CROPS.MAIZE, firstNumber: 401, count: 8, templateOffset: 2 }),
  },
];

function buildDashboardTitle(fileNames) {
  const firstName = fileNames[0].replace(/\.[^.]+$/, '');

  if (fileNames.length === 1) {
    return firstName;
  }

  return `${firstName} + ${fileNames.length - 1} more`;
}

export function createMockDashboard(fileNames) {
  const createdAt = Date.now();

  return {
    id: `dashboard-${createdAt}`,
    title: buildDashboardTitle(fileNames),
    fileNames,
    candidates: buildCandidates({
      crop: CROPS.MAIZE,
      firstNumber: 901,
      count: 10,
      templateOffset: createdAt % CANDIDATE_TEMPLATES.length,
    }),
  };
}
