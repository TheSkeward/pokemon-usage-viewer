import test from 'node:test';
import assert from 'node:assert/strict';

await import('./helpers/harness.mjs');
const {
  getAvailableRebornMoves,
  getPreferredRebornMoveSource,
  loadRebornLegalMoveData,
} = await import('../src/reborn/legal-moves.js');
const { REBORN_TUTOR_OPTIONS } = await import(
  '../src/reborn/progression-options.js',
);

test('preferred taught route is TM, then tutor, then relearner', () => {
  const source = (kind) => ({ kind, label: kind });
  assert.equal(
    getPreferredRebornMoveSource({
      availableSources: [
        source('relearner'),
        source('tutor'),
        source('tm'),
      ],
    }).kind,
    'tm',
  );
  assert.equal(
    getPreferredRebornMoveSource({
      availableSources: [source('relearner'), source('tutor')],
    }).kind,
    'tutor',
  );
});

test('Scolipede Iron Defense prefers its tutor over the relearner', async () => {
  const legalMoveData = await loadRebornLegalMoveData('scolipede');
  const tutorId = REBORN_TUTOR_OPTIONS.find(
    (option) => option.move === 'Iron Defense',
  )?.id;
  assert.ok(tutorId, 'Iron Defense tutor option exists');

  const move = getAvailableRebornMoves(legalMoveData, {
    levelCap: '50',
    moveRelearnerUnlocked: true,
    availableTutorMoveIds: [tutorId],
  }).find((entry) => entry.id === 'irondefense');

  assert.deepEqual(
    new Set(move.availableSources.map((source) => source.kind)),
    new Set(['relearner', 'tutor']),
  );
  assert.equal(getPreferredRebornMoveSource(move).kind, 'tutor');
});
