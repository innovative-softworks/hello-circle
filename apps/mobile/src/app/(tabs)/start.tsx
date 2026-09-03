import { Redirect } from 'expo-router';

// Never reached via a normal tab press — (tabs)/_layout.tsx's onPress
// intercepts it and opens the (modals)/start-sheet modal instead. This
// route only exists because TabTrigger requires a real href when used
// inside TabList. Safety net only, in case something ever navigates here
// directly (e.g. a stray deep link).
export default function StartScreen() {
  return <Redirect href="/" />;
}
