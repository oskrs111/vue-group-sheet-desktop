const { test } = require('node:test');
const assert = require('node:assert/strict');

test('compass placement keeps chord groups intact and respects the twelve-column grid', async () => {
    const { getCompassPlacement } = await import('../../src/utils/scoreLayout.js');
    assert.deepEqual(getCompassPlacement(1, 28, 600), { span: 1, scale: 1 });
    // Two half-note chords such as Fm and Fm7+ need more than two columns.
    assert.deepEqual(getCompassPlacement(2, 104, 645), { span: 3, scale: 1 });
    assert.deepEqual(getCompassPlacement(9, 300, 900), { span: 9, scale: 1 });
    assert.deepEqual(getCompassPlacement(2, 104, 360), { span: 4, scale: 1 });
    // An exceptionally dense compass occupies the full row and fits as one group.
    const dense = getCompassPlacement(20, 1200, 600);
    assert.equal(dense.span, 12);
    assert.equal(dense.scale * 1200 + 12, 600);
    assert.deepEqual(getCompassPlacement(2, 104, 0), { span: 2, scale: 1 });
});

test('consecutive explicit breaks share a marker without losing original compass indices', async () => {
    const { getBreakGroups } = await import('../../src/utils/scoreLayout.js');
    const groups = getBreakGroups(['S', 'S', 'C', 'S', 'F', 'S', 'S'].map(chord => ({ chords: [{ chord }] })));
    assert.deepEqual(groups[0], [0, 1]);
    assert.equal(groups[0], groups[1]);
    assert.equal(groups[2], undefined);
    assert.deepEqual(groups[3], [3]);
    assert.deepEqual(groups[5], [5, 6]);
    assert.equal(groups[5], groups[6]);
    assert.deepEqual(getBreakGroups([]), []);
});
