import { create } from "zustand";

export type ItemType = "login" | "note" | "card" | "identity";

export interface VaultItem {
  id: string;
  type: ItemType;
  name: string;
  folderId: string | null;
  collectionIds: string[];
  favorite: boolean;
  createdAt: string;
  updatedAt: string;
  // Decrypted fields (null when vault is locked)
  login?: {
    username: string;
    password: string;
    uris: string[];
    totp: string | null;
  };
  note?: { content: string };
  card?: {
    cardholderName: string;
    brand: string;
    number: string;
    expMonth: string;
    expYear: string;
    code: string;
  };
}

export interface Folder {
  id: string;
  name: string;
}

export interface Collection {
  id: string;
  organizationId: string;
  name: string;
  readOnly: boolean;
  hidePasswords: boolean;
  manage: boolean;
}

interface VaultState {
  items: VaultItem[];
  folders: Folder[];
  collections: Collection[];
  selectedItemId: string | null;
  searchQuery: string;
  selectedFolderId: string | null;
  selectedCollectionId: string | null;
  lastSynced: number | null;
  isSyncing: boolean;

  // Actions
  setItems: (items: VaultItem[]) => void;
  setFolders: (folders: Folder[]) => void;
  setCollections: (collections: Collection[]) => void;
  selectItem: (id: string | null) => void;
  setSearchQuery: (q: string) => void;
  selectFolder: (id: string | null) => void;
  selectCollection: (id: string | null) => void;
  setSyncing: (v: boolean) => void;
  markSynced: () => void;
  clearVault: () => void;
}

export const useVaultStore = create<VaultState>()((set) => ({
  items: [],
  folders: [],
  collections: [],
  selectedItemId: null,
  searchQuery: "",
  selectedFolderId: null,
  selectedCollectionId: null,
  lastSynced: null,
  isSyncing: false,

  setItems: (items) => set({ items }),
  setFolders: (folders) => set({ folders }),
  setCollections: (collections) => set({ collections }),
  selectItem: (selectedItemId) => set({ selectedItemId }),
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  selectFolder: (selectedFolderId) => set({ selectedFolderId, selectedItemId: null }),
  selectCollection: (selectedCollectionId) =>
    set({ selectedCollectionId, selectedItemId: null }),
  setSyncing: (isSyncing) => set({ isSyncing }),
  markSynced: () => set({ lastSynced: Date.now() }),
  clearVault: () =>
    set({
      items: [],
      folders: [],
      collections: [],
      selectedItemId: null,
      lastSynced: null,
    }),
}));
