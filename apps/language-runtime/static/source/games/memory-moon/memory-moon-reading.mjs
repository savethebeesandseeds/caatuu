/** Readings are authored presentation metadata, never inferred from Hanzi. */
export function validateMoonTargetReading(reading, surface, { required = false } = {}) {
  const fail = () => { throw new TypeError('Memory Moon targetReading needs complete, aligned authored pinyin with preview status.'); };
  if (reading === undefined && !required) return null;
  if (!reading || reading.system !== 'pinyin' || reading.status !== 'machine-assisted-preview'
      || !Array.isArray(reading.tokens) || !reading.tokens.length || reading.tokens.length > 200) fail();
  const text = String(surface ?? '').normalize('NFC');
  let cursor = 0;
  for (const token of reading.tokens) {
    if (typeof token?.surface !== 'string' || !/^\p{Script=Han}+$/u.test(token.surface)
        || !Array.isArray(token.units) || token.units.length !== Array.from(token.surface).length) fail();
    const start = text.indexOf(token.surface, cursor);
    if (start < cursor || /\p{Script=Han}/u.test(text.slice(cursor, start))) fail();
    if (token.units.some(unit => typeof unit?.surface !== 'string'
        || !/^\p{Script=Han}$/u.test(unit.surface) || typeof unit.notation !== 'string'
        || !/^[\p{Script=Latin}\p{M}]+[1-5]?$/u.test(unit.notation))
        || token.units.map(unit => unit.surface).join('') !== token.surface) fail();
    cursor = start + token.surface.length;
  }
  if (/\p{Script=Han}/u.test(text.slice(cursor))) fail();
  return reading;
}
