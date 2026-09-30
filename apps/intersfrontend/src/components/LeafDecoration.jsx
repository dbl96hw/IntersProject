import { LEAF_PATH } from '../constants';
import './LeafDecoration.css';

const LEAVES = [
  { transform: 'translate(106 12) rotate(165)', variant: 'green' },
  { transform: 'translate(96 25) rotate(65)', variant: 'brown' },
  { transform: 'translate(87 40) rotate(170)', variant: 'green' },
  { transform: 'translate(79 55) rotate(75)', variant: 'green' },
  { transform: 'translate(70 70) rotate(120)', variant: 'brown' },
];

function LeafDecoration({ position = 'top-right' }) {
  return (
    <svg
      className={`leaf-decoration leaf-decoration--${position}`}
      viewBox="0 0 120 120"
      aria-hidden="true"
      focusable="false"
    >
      <path className="leaf-decoration__stem" d="M120 0C100 18 84 38 70 70" />
      {LEAVES.map((leaf) => (
        <path
          key={leaf.transform}
          className={`leaf-decoration__leaf leaf-decoration__leaf--${leaf.variant}`}
          d={LEAF_PATH}
          transform={leaf.transform}
        />
      ))}
    </svg>
  );
}

export default LeafDecoration;
