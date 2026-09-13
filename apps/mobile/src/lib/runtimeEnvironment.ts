import Constants, { ExecutionEnvironment } from 'expo-constants';

// @react-native-firebase/* modules crash immediately in Expo Go — merely
// `require()`-ing one triggers native module registration, and Metro treats
// a failed module factory as a permanent, dev-visible fault (shows the red
// screen) even when the caller wraps the require in try/catch. The only
// real fix is to never attempt the require at all in this environment.
// `StoreClient` also covers a custom `expo-dev-client` build, which this
// project doesn't use — if that ever changes, a dev client with Firebase
// actually linked natively would need a more specific check here.
export function isExpoGo(): boolean {
  return Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
}
