import { describe, it, expect, beforeEach } from "vitest";
import { useVaultStore, type VaultItem } from "./vault";

const item: VaultItem = {
  id: "i1",
  type: "login",
  name: "GitHub",
  folderId: null,
  organizationId: null,
  collectionIds: [],
  favorite: false,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

beforeEach(() => {
  useVaultStore.getState().clearVault();
  useVaultStore.setState({ searchQuery: "", selectedFolderId: null, selectedCollectionId: null });
});

describe("vault store", () => {
  it("setItems / selectItem", () => {
    const s = useVaultStore.getState();
    s.setItems([item]);
    s.selectItem("i1");
    expect(useVaultStore.getState().items).toEqual([item]);
    expect(useVaultStore.getState().selectedItemId).toBe("i1");
  });

  it("selecting a folder clears the selected item", () => {
    const s = useVaultStore.getState();
    s.selectItem("i1");
    s.selectFolder("f1");
    expect(useVaultStore.getState().selectedFolderId).toBe("f1");
    expect(useVaultStore.getState().selectedItemId).toBeNull();
  });

  it("selecting a collection clears the selected item", () => {
    const s = useVaultStore.getState();
    s.selectItem("i1");
    s.selectCollection("c1");
    expect(useVaultStore.getState().selectedCollectionId).toBe("c1");
    expect(useVaultStore.getState().selectedItemId).toBeNull();
  });

  it("markSynced records a timestamp", () => {
    const before = Date.now();
    useVaultStore.getState().markSynced();
    expect(useVaultStore.getState().lastSynced).toBeGreaterThanOrEqual(before);
  });

  it("clearVault wipes items, folders, selection, and sync state", () => {
    const s = useVaultStore.getState();
    s.setItems([item]);
    s.setFolders([{ id: "f1", name: "Work" }]);
    s.selectItem("i1");
    s.markSynced();
    s.clearVault();
    const state = useVaultStore.getState();
    expect(state.items).toEqual([]);
    expect(state.folders).toEqual([]);
    expect(state.selectedItemId).toBeNull();
    expect(state.lastSynced).toBeNull();
  });
});
