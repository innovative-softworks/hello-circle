import { createContext, useContext } from "react";

/** True inside an admin / partner / host workspace (WorkspaceShell). Shared
 * components (tabs, empty states, stat tiles) use it to render in the
 * workspace style; on consumer pages it is false and they stay unchanged. */
export const InWorkspaceContext = createContext(false);
export const useInWorkspace = () => useContext(InWorkspaceContext);
