import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { fetchMyBookings, fetchMyRegistrations } from "./api";

interface MyStuffContextValue {
  count: number;
  refresh: () => void;
}

const MyStuffContext = createContext<MyStuffContextValue>({ count: 0, refresh: () => {} });

export function MyStuffProvider({ children }: { children: ReactNode }) {
  const [count, setCount] = useState(0);

  const refresh = useCallback(() => {
    Promise.all([fetchMyBookings(), fetchMyRegistrations()])
      .then(([bookings, regs]) => setCount(bookings.length + regs.length))
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
