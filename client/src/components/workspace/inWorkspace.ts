import { createContext, useContext } from "react";

/** True inside an admin / partner / host workspace (WorkspaceShell). Shared
 * components (tabs, empty states, stat tiles) use it to render in the
 * workspace style; on consumer pages it is false and they stay unchanged. */
export const InWorkspaceContext = createContext(false);
export const useInWorkspace = () => useContext(InWorkspaceContext);

/** The workspace page's title, so a section titled the same doesn't repeat it (2026-10-20). */
export const WorkspacePageTitleContext = createContext<string | null>(null);
export const useWorkspacePageTitle = () => useContext(WorkspacePageTitleContext);
/** The page's description (when it is plain text), to avoid repeating it. */
export const WorkspacePageSubtitleContext = createContext<string | null>(null);
export const useWorkspacePageSubtitle = () => useContext(WorkspacePageSubtitleContext);
