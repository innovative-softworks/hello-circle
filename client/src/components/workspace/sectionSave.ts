import { createContext, useContext } from "react";
import type { FormError } from "../form";

// Lets a workspace editor's SettingsSections edit in popups (2026-10-16,
// option A): the editor provides its whole-form save plus snapshot/restore,
// and which section to open (the readiness rail's "Add" links set it).
export interface SectionSave {
  /** Validates and saves the whole form; true when it saved. */
  save: () => Promise<boolean>;
  saving: boolean;
  /** Problems from the last save attempt, shown as a linked summary in the popup. */
  errors: FormError[];
  /** Changes on every failed save, to move focus to the summary. */
  focusKey?: number;
  /** True when the open popup's fields differ from when it opened. */
  isDirty?: () => boolean;
  /** Called when a popup opens (take a snapshot) / is cancelled (restore it). */
  begin?: () => void;
  cancel?: () => void;
  /** A section title, or "field:<id>" to open whichever section holds that field. */
  openKey?: string | null;
  setOpenKey?: (key: string | null) => void;
}

export const SectionSaveContext = createContext<SectionSave | null>(null);
export const useSectionSave = () => useContext(SectionSaveContext);
