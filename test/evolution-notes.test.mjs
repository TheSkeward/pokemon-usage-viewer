// describeEvolutionPath: the "what it takes" note appended wherever the UI
// says a current form came from the input mon — "from Burmy@20 (Female, in
// buildings)". Static game mechanics only (no gamestate), dex fields plus the
// hand-reviewed gender/cloak form notes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { describeEvolutionPath } from '../src/reborn/evolution-requirements.js';



test("multi-step chains sequence with 'then'; level-only runs collapse", () => {
  assert.equal(
    describeEvolutionPath('happiny', 'blissey'),
    ' (hold Oval Stone, during the day, then friendship)',
  );
  assert.equal(
    describeEvolutionPath('oddish', 'vileplume'),
    '@21 (then Leaf Stone)',
  );
  assert.equal(describeEvolutionPath('abra', 'alakazam'), '@16 (then Link Stone)');
  // Weedle -> Kakuna@7 -> Beedrill@10: the final level implies the first.
  assert.equal(describeEvolutionPath('weedle', 'beedrill'), '@10');
});

test('empty when there is nothing to explain', () => {
  assert.equal(describeEvolutionPath('lopunny', 'lopunny'), '');
  // Not an ancestor (mega forms are a slot, not an evolution).
  assert.equal(describeEvolutionPath('lopunny', 'lopunnymega'), '');
  // Wrong direction.
  assert.equal(describeEvolutionPath('raticate', 'rattata'), '');
});
