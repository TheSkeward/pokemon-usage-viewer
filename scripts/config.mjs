/**
 * @type {!Object<string, {label: string, formatOrder: !Array<string>,
 *     cutoffPriority: !Array<number>, defaultBrowserFormat: string}>}
 */
export const FAMILY_CONFIGS = {
  singles: {
    label: 'Singles',
    formatOrder: [
      'gen7anythinggoes',
      'gen7ubers',
      'gen7ou',
      'gen7uu',
      'gen7ru',
      'gen7nu',
      'gen7pu',
      'gen7zu',
      'gen7nfe',
      'gen7lc',
    ],
    cutoffPriority: [1760, 1630, 1500, 0],
    defaultBrowserFormat: 'gen7anythinggoes',
  },
  doubles: {
    label: 'Doubles',
    formatOrder: [
      'gen7doublesubers',
      'gen7doublesou',
      'gen7doublesuu',
    ],
    cutoffPriority: [1825, 1760, 1695, 1630, 1500, 0],
    defaultBrowserFormat: 'gen7doublesou',
  },
};

/** @type {!Array<{id: string, label: string, family: string}>} */
export const REAL_FORMATS = [
  { id: 'gen7anythinggoes', label: 'Gen 7 AG', family: 'singles' },
  { id: 'gen7ubers', label: 'Gen 7 Ubers', family: 'singles' },
  { id: 'gen7ou', label: 'Gen 7 OU', family: 'singles' },
  { id: 'gen7uu', label: 'Gen 7 UU', family: 'singles' },
  { id: 'gen7ru', label: 'Gen 7 RU', family: 'singles' },
  { id: 'gen7nu', label: 'Gen 7 NU', family: 'singles' },
  { id: 'gen7pu', label: 'Gen 7 PU', family: 'singles' },
  { id: 'gen7zu', label: 'Gen 7 ZU', family: 'singles' },
  { id: 'gen7nfe', label: 'Gen 7 NFE', family: 'singles' },
  { id: 'gen7lc', label: 'Gen 7 LC', family: 'singles' },
  { id: 'gen7doublesubers', label: 'Gen 7 Doubles Ubers', family: 'doubles' },
  { id: 'gen7doublesou', label: 'Gen 7 DOU', family: 'doubles' },
  { id: 'gen7doublesuu', label: 'Gen 7 DUU', family: 'doubles' },
];

/**
 * @type {!Array<{id: string, label: string, family: string,
 *     fallbackOrder: !Array<string>}>}
 */
export const SYNTHETIC_FORMATS = [
  {
    id: 'gen7best',
    label: 'Gen 7 Best Available',
    family: 'singles',
    fallbackOrder: FAMILY_CONFIGS.singles.formatOrder,
  },
];

/** Singles format ids, strongest tier first. @type {!Array<string>} */
export const FORMAT_POWER_ORDER = FAMILY_CONFIGS.singles.formatOrder;
/** Union of both families' cutoff priorities. @type {!Array<number>} */
export const CUTOFF_PRIORITY = [
  ...new Set([
    ...FAMILY_CONFIGS.singles.cutoffPriority,
    ...FAMILY_CONFIGS.doubles.cutoffPriority,
  ]),
];

/**
 * Cutoff used for browser datasets: 0 is the unfiltered baseline. @type
 * {number}
 */
export const DEFAULT_RATING = 0;
/** @type {string} */
export const STATS_ROOT = 'https://www.smogon.com/stats';
