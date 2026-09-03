import { clearPendingAction, getPendingAction, setPendingAction } from './pendingAction';

describe('pendingAction', () => {
  afterEach(async () => {
    await clearPendingAction();
  });

  it('returns null when nothing is set', async () => {
    expect(await getPendingAction()).toBeNull();
  });

  it('round-trips a favourite action', async () => {
    await setPendingAction({ kind: 'favourite', listingType: 'centre', listingId: 'c1', screenPath: '/(details)/centre/c1' });
    expect(await getPendingAction()).toEqual({ kind: 'favourite', listingType: 'centre', listingId: 'c1', screenPath: '/(details)/centre/c1' });
  });

  it('clears the pending action', async () => {
    await setPendingAction({ kind: 'follow', followedType: 'centre', followedId: 'c1', screenPath: '/(details)/centre/c1' });
    await clearPendingAction();
    expect(await getPendingAction()).toBeNull();
  });
});
