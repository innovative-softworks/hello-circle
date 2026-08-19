import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { fetchMyParticipation } from "./api";

interface MyStuffContextValue {
  count: number;
  refresh: () => void;
}

const MyStuffContext = createContext<MyStuffContextValue>({ count: 0, refresh: () => {} });

export function MyStuffProvider({ children }: { children: ReactNode }) {
  const [count, setCount] = useState(0);

  // Previously only counted bookings+registrations — the same games/
  // circles/programs blind spot Phase 0 fixed for the list view (see
  // MyBookings.tsx), now fixed here too via the shared unified query.
  const refresh = useCallback(() => {
    fetchMyParticipation()
      .then((items) => setCount(items.length))
      .catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return <MyStuffContext.Provider value={{ count, refresh }}>{children}</MyStuffContext.Provider>;
}

export function useMyStuff() {
  return useContext(MyStuffContext);
}
