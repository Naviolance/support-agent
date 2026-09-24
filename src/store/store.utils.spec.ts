import {
  escapeLike,
  normalizeOrderNumber,
  phoneMatchKey,
} from './store.utils.js';

describe('phoneMatchKey', () => {
  it('gives the same key for every way of writing one number', () => {
    const formats = [
      '+237 6 99 00 00 00',
      '699000000',
      '237699000000',
      '(+237) 699-000-000',
    ];
    for (const phone of formats) {
      expect(phoneMatchKey(phone)).toBe('699000000');
    }
  });

  it('refuses numbers with fewer than 9 digits', () => {
    expect(phoneMatchKey('99 00 00')).toBeNull();
    expect(phoneMatchKey('')).toBeNull();
  });
});

describe('normalizeOrderNumber', () => {
  it('trims and upper-cases', () => {
    expect(normalizeOrderNumber('  ord-20260920-k3f9qz ')).toBe(
      'ORD-20260920-K3F9QZ',
    );
  });
});

describe('escapeLike', () => {
  it('escapes LIKE wildcards so they match literally', () => {
    expect(escapeLike('BD-50_X')).toBe('BD-50\\_X');
    expect(escapeLike('100%')).toBe('100\\%');
    expect(escapeLike('a\\b')).toBe('a\\\\b');
  });
});
