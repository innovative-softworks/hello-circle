import { mapNotificationPath } from './notificationPath';

describe('mapNotificationPath', () => {
  it('maps a centre path', () => {
    expect(mapNotificationPath('/centres/abc123')).toBe('/(details)/centre/abc123');
  });
  it('maps a club path', () => {
    expect(mapNotificationPath('/clubs/abc123')).toBe('/(details)/club/abc123');
  });
  it('maps a game path', () => {
    expect(mapNotificationPath('/games/abc123')).toBe('/(details)/game/abc123');
  });
  it('maps a circle path', () => {
    expect(mapNotificationPath('/circles/abc123')).toBe('/(details)/circle/abc123');
  });
  it('maps a booking path to My Life (kind unknown from path alone)', () => {
    expect(mapNotificationPath('/bookings?ref=HB-123')).toBe('/(tabs)/my-life');
  });
  it('returns null for a provider path (no mobile equivalent)', () => {
    expect(mapNotificationPath('/provider/abc123')).toBeNull();
  });
  it('returns null for a host path (no mobile equivalent)', () => {
    expect(mapNotificationPath('/host/abc123')).toBeNull();
  });
  it('returns null for an unrecognized path', () => {
    expect(mapNotificationPath('/something-else')).toBeNull();
  });
  it('returns null for an undefined/null path', () => {
    expect(mapNotificationPath(undefined)).toBeNull();
    expect(mapNotificationPath(null)).toBeNull();
  });
});
