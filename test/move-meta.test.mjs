import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getMoveMeta,
  getMoveMetaById,
  hydrateLegalMove,
} from '../src/move-meta.js';

test('typed Hidden Power keeps its elemental type in every name/id form', () => {
  const variants = [
    ['Hidden Power Grass', 'Grass'],
    ['Hidden Power [Grass]', 'Grass'],
    ['hiddenpowergrass', 'Grass'],
    ['Hidden Power [Fire]', 'Fire'],
  ];

  for (const [name, type] of variants) {
    const meta = getMoveMeta(name);
    assert.equal(meta.type, type, name);
    assert.equal(meta.category, 'Special', name);
    assert.equal(meta.basePower, 60, name);
  }
  assert.equal(getMoveMetaById('hiddenpowerfire').type, 'Fire');
  assert.equal(
    hydrateLegalMove({ id: 'hiddenpowergrass', sources: {} }).type,
    'Grass',
  );
});
