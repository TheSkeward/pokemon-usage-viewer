import path from 'node:path';

/** @type {string} */
export const DATA_ROOT = path.resolve('site-data', 'data');
/** @type {string} */
export const OUT_ROOT = path.join(DATA_ROOT, 'set-index');

/** @type {!Array<string>} */
export const FAMILIES = ['singles', 'doubles'];

/** Source families per build family: own family first, the other as fallback. */
export const FALLBACK_FAMILY_ORDER = {
  singles: ['singles', 'doubles'],
  doubles: ['doubles', 'singles'],
};

/** Placeholder rows in Smogon moveset sections, dropped from aggregation. */
export const HIDDEN_ENTRY_KEYS = new Set(['other', 'nothing']);

/** Usage percent below which a set entry is a trace, not signal. @type {number} */
export const MIN_MEANINGFUL_SET_ENTRY_USAGE_PERCENT = 0.1;
