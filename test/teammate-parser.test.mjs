// The Smogon moveset-text parser behind the teammate index: a mon's name cell
// only ever appears as the first cell after a +---- block boundary, and rows
// inside "Checks and Counters" (no colon, no %, uppercase — e.g. "Mega Scizor
// 78.90 (91.17±4.09)") must never be misread as new mons.
import test from 'node:test';
import assert from 'node:assert/strict';

const { parseTeammates } = await import('../scripts/build-teammate-index.mjs');

const SAMPLE = [
  ' +----------------------------------------+ ',
  ' | Landorus-Therian                       | ',
  ' +----------------------------------------+ ',
  ' | Raw count: 100000                      | ',
  ' | Avg. weight: 0.5                       | ',
  ' +----------------------------------------+ ',
  ' | Teammates                              | ',
  ' | Heatran +12.345%                       | ',
  ' | Tapu Koko +8.000%                      | ',
  ' +----------------------------------------+ ',
  ' | Checks and Counters                    | ',
  ' | Mega Scizor 78.90 (91.17±4.09)         | ',
  ' |	 (52.94% KOed / 47.06% switched out)   | ',
  ' +----------------------------------------+ ',
  ' +----------------------------------------+ ',
  ' | Heatran                                | ',
  ' +----------------------------------------+ ',
  ' | Raw count: 90000                       | ',
  ' +----------------------------------------+ ',
  ' | Teammates                              | ',
  ' | Landorus-Therian +12.000%              | ',
  ' +----------------------------------------+ ',
].join('\n');

test('parses teammates and raw counts per mon', () => {
  const byMon = parseTeammates(SAMPLE);
  const lando = byMon.get('landorustherian');
  assert.ok(lando);
  assert.equal(lando.rawCount, 100000);
  assert.equal(lando.teammates.get('heatran'), 12.345);
  assert.equal(lando.teammates.get('tapukoko'), 8.0);
  assert.equal(byMon.get('heatran')?.teammates.get('landorustherian'), 12.0);
});

test('Checks and Counters rows are not misread as mons', () => {
  const byMon = parseTeammates(SAMPLE);
  assert.equal(byMon.size, 2, 'exactly the two real mons');
  for (const key of byMon.keys()) {
    assert.ok(
      ['landorustherian', 'heatran'].includes(key),
      `unexpected parsed mon: ${key}`,
    );
  }
});
