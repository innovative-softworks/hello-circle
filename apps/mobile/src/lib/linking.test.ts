import { parseDeepLink } from './linking';

describe('parseDeepLink', () => {
  it('extracts the token from a verify deep link', () => {
    const result = parseDeepLink('hellocircle://verify?token=abc123');
    expect(result).toEqual({ path: 'verify', params: { token: 'abc123' } });
  });

  it('returns null for a link with no path', () => {
    const result = parseDeepLink('hellocircle://');
    expect(result).toBeNull();
  });
});
