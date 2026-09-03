// jest-expo has no built-in mock for expo-secure-store (a native module),
// so SecureStore calls silently no-op under Jest by default — this
// in-memory backing store makes set/get/delete round-trip correctly in
// unit tests instead.
const store = new Map();

module.exports = {
  getItemAsync: jest.fn((key) => Promise.resolve(store.has(key) ? store.get(key) : null)),
  setItemAsync: jest.fn((key, value) => {
    store.set(key, value);
    return Promise.resolve();
  }),
  deleteItemAsync: jest.fn((key) => {
    store.delete(key);
    return Promise.resolve();
  }),
};
