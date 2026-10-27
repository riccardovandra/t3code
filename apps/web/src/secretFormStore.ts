import { create } from "zustand";

/**
 * Which threads have the /secret form open, and the key names it was opened
 * with. Values stay in the form's own state and are never stored here.
 */
interface SecretFormStoreState {
  readonly byThreadKey: Record<string, { readonly names: ReadonlyArray<string> }>;
  readonly open: (threadKey: string, names: ReadonlyArray<string>) => void;
  readonly close: (threadKey: string) => void;
}

export const useSecretFormStore = create<SecretFormStoreState>((set) => ({
  byThreadKey: {},
  // Opening an already open form adds the new names to it instead of resetting it.
  open: (threadKey, names) =>
    set((state) => {
      const current = state.byThreadKey[threadKey]?.names ?? [];
      return {
        byThreadKey: {
          ...state.byThreadKey,
          [threadKey]: { names: [...new Set([...current, ...names])] },
        },
      };
    }),
  close: (threadKey) =>
    set((state) => {
      if (!(threadKey in state.byThreadKey)) return state;
      const { [threadKey]: _closed, ...rest } = state.byThreadKey;
      return { byThreadKey: rest };
    }),
}));
