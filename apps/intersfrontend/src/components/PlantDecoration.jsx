import { LEAF_PATH } from '../constants';
import './PlantDecoration.css';

// Each plant is a stem with leaves placed along it; leaf angles are negative so they point upward.
const PLANTS = [
  {
    stem: 'M40 150C38 120 44 96 54 72',
    leaves: [
      { transform: 'translate(41 128) rotate(-150) scale(1.1)', variant: 'green' },
      { transform: 'translate(43 112) rotate(-30) scale(1.1)', variant: 'brown' },
      { transform: 'translate(47 94) rotate(-155)', variant: 'green' },
      { transform: 'translate(52 78) rotate(-40) scale(0.9)', variant: 'green' },
      { transform: 'translate(54 72) rotate(-80) scale(0.9)', variant: 'brown' },
    ],
  },
  {
    stem: 'M88 150C88 142 91 134 97 128',
    leaves: [
      { transform: 'translate(89 143) rotate(-155) scale(0.7)', variant: 'green' },
      { transform: 'translate(92 136) rotate(-30) scale(0.7)', variant: 'green' },
      { transform: 'translate(97 128) rotate(-90) scale(0.7)', variant: 'brown' },
    ],
  },
  {
    stem: 'M130 150C128 132 130 116 134 102',
    leaves: [
      { transform: 'translate(129 135) rotate(-160)', variant: 'green' },
      { transform: 'translate(130 122) rotate(-25)', variant: 'brown' },
    ],
    fruit: { cx: 136, cy: 94, rx: 8, ry: 11 },
  },
  {
    stem: 'M170 150C171 143 168 136 163 130',
    leaves: [
      { transform: 'translate(170 144) rotate(-25) scale(0.7)', variant: 'green' },
      { transform: 'translate(168 137) rotate(-155) scale(0.7)', variant: 'green' },
      { transform: 'translate(163 130) rotate(-90) scale(0.7)', variant: 'brown' },
    ],
  },
  {
    stem: 'M215 150C219 126 214 104 204 84',
    leaves: [
      { transform: 'translate(217 132) rotate(-25) scale(1.1)', variant: 'green' },
      { transform: 'translate(215 116) rotate(-155) scale(1.1)', variant: 'brown' },
      { transform: 'translate(211 100) rotate(-30)', variant: 'green' },
      { transform: 'translate(206 88) rotate(-150) scale(0.9)', variant: 'green' },
      { transform: 'translate(204 84) rotate(-100) scale(0.9)', variant: 'brown' },
    ],
  },
];

function PlantDecoration() {
  return (
    <svg
      className="plant-decoration"
      viewBox="0 0 260 150"
      preserveAspectRatio="xMidYMax meet"
      aria-hidden="true"
      focusable="false"
      data-testid="plant-decoration"
    >
      {PLANTS.map((plant) => (
        <g key={plant.stem}>
          <path className="plant-decoration__stem" d={plant.stem} />
          {plant.leaves.map((leaf) => (
            <path
              key={leaf.transform}
              className={`plant-decoration__leaf plant-decoration__leaf--${leaf.variant}`}
              d={LEAF_PATH}
              transform={leaf.transform}
            />
          ))}
          {plant.fruit && (
            <ellipse
              className="plant-decoration__fruit"
              cx={plant.fruit.cx}
              cy={plant.fruit.cy}
              rx={plant.fruit.rx}
              ry={plant.fruit.ry}
            />
          )}
        </g>
      ))}
    </svg>
  );
}

export default PlantDecoration;
