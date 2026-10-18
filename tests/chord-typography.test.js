const { test } = require('node:test');
const assert = require('node:assert/strict');

test('recovered chord glyphs preserve readable notation and handle missing suffixes', async () => {
    const { getChordSegments } = await import('../../src/utils/chordTypography.js');
    const rendered = chord => getChordSegments(chord).map(segment => segment.text).join('');
    assert.equal(rendered('Fm'), 'FŒ');
    assert.equal(rendered('Bb7'), 'B¨7');
    assert.equal(rendered('Cmaj7'), 'CŒ„Š7');
    assert.equal(rendered('Cm7/Eb'), 'CŒ7/E¨');
    assert.equal(rendered('F♯7/B♭'), 'F#7/B¨');
    assert.deepEqual(getChordSegments('Fm7+'), [
        { text: 'FŒ7', fallback: false, superscript: false },
        { text: '+', fallback: true, superscript: true }
    ]);
    assert.deepEqual(getChordSegments('Csus4'), [
        { text: 'C“', fallback: false, superscript: false },
        { text: '4', fallback: true, superscript: true }
    ]);
    assert.deepEqual(getChordSegments('N.C.'), [{ text: 'N.C.', fallback: true, superscript: false }]);
    assert.deepEqual(getChordSegments('Fm7+', 'Libre Baskerville'), [
        { text: 'Fm7+', fallback: false, superscript: false }
    ]);
});

test('a single sheet font resolves legacy settings without overriding later choices', async () => {
    const { getSheetFont, getSheetFontStyles, normalizeSheetFontSettings, DEFAULT_SHEET_FONT } = await import('../../src/utils/sheetFonts.js');
    const legacy = { font_family: 'Libre Baskerville', chord_font_family: 'Pori Chords Std', show_notes: true };
    const migrated = normalizeSheetFontSettings(legacy);
    assert.deepEqual(migrated, { font_family: DEFAULT_SHEET_FONT, show_notes: true });
    assert.equal(getSheetFont(legacy), DEFAULT_SHEET_FONT);
    assert.equal(getSheetFont(null), DEFAULT_SHEET_FONT);
    assert.equal(getSheetFont({ font_family: 'Oswald' }), 'Oswald');
    assert.equal(getSheetFont({ ...migrated, font_family: 'Libre Baskerville' }), 'Libre Baskerville');
    const recovered = getSheetFontStyles(legacy);
    assert.match(recovered['--sheet-font-family'], /^"Recovered Chords Std", "Libre Baskerville"/);
    assert.match(recovered['--chord-font-family'], /^"Recovered Chords Std Chords"/);
    const libre = getSheetFontStyles({ font_family: 'Libre Baskerville' });
    assert.equal(libre['--sheet-font-family'], libre['--chord-font-family']);
    assert.equal(libre['--chord-font-weight'], 700);
    assert.deepEqual(legacy, { font_family: 'Libre Baskerville', chord_font_family: 'Pori Chords Std', show_notes: true });
});
