import { describe, it, expect } from "vitest";
import { buildExportJson, buildExportCsv } from "./export";
import type { VaultItem, Folder } from "../stores/vault";

function loginItem(overrides: Partial<VaultItem> = {}): VaultItem {
  return {
    id: "item-1",
    type: "login",
    name: "GitHub",
    folderId: null,
    collectionIds: [],
    favorite: false,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    login: {
      username: "octocat",
      password: "hunter2",
      uris: ["https://github.com"],
      totp: null,
    },
    ...overrides,
  };
}

describe("buildExportJson", () => {
  it("produces Bitwarden-compatible structure", () => {
    const folders: Folder[] = [{ id: "f1", name: "Work" }];
    const data = JSON.parse(buildExportJson([loginItem()], folders));

    expect(data.encrypted).toBe(false);
    expect(data.folders).toEqual([{ id: "f1", name: "Work" }]);
    expect(data.items).toHaveLength(1);

    const item = data.items[0];
    expect(item.type).toBe(1); // login
    expect(item.name).toBe("GitHub");
    expect(item.login).toEqual({
      username: "octocat",
      password: "hunter2",
      totp: null,
      uris: [{ uri: "https://github.com", match: null }],
    });
  });

  it("maps item types to Bitwarden numeric types", () => {
    const items: VaultItem[] = [
      loginItem({ id: "1", type: "login" }),
      loginItem({ id: "2", type: "note", login: undefined, note: { content: "n" } }),
      loginItem({ id: "3", type: "card", login: undefined }),
      loginItem({ id: "4", type: "identity", login: undefined }),
    ];
    const data = JSON.parse(buildExportJson(items, []));
    expect(data.items.map((i: { type: number }) => i.type)).toEqual([1, 2, 3, 4]);
  });

  it("adds secureNote marker for notes and maps content to notes field", () => {
    const note = loginItem({ type: "note", login: undefined, note: { content: "the text" } });
    const data = JSON.parse(buildExportJson([note], []));
    expect(data.items[0].secureNote).toEqual({ type: 0 });
    expect(data.items[0].notes).toBe("the text");
  });

  it("exports card fields, mapping empty strings to null", () => {
    const card = loginItem({
      type: "card",
      login: undefined,
      card: { cardholderName: "J Doe", brand: "", number: "4111", expMonth: "12", expYear: "2030", code: "" },
    });
    const data = JSON.parse(buildExportJson([card], []));
    expect(data.items[0].card).toEqual({
      cardholderName: "J Doe",
      brand: null,
      number: "4111",
      expMonth: "12",
      expYear: "2030",
      code: null,
    });
  });

  it("preserves folder assignment and favorite flag", () => {
    const item = loginItem({ folderId: "f9", favorite: true });
    const data = JSON.parse(buildExportJson([item], []));
    expect(data.items[0].folderId).toBe("f9");
    expect(data.items[0].favorite).toBe(true);
  });
});

describe("buildExportCsv", () => {
  it("includes only login items", () => {
    const items = [
      loginItem(),
      loginItem({ id: "2", type: "note", login: undefined, note: { content: "x" } }),
    ];
    const csv = buildExportCsv(items);
    const lines = csv.split("\n");
    expect(lines[0]).toBe("name,username,password,totp,url,notes");
    expect(lines).toHaveLength(2); // header + 1 login
  });

  it("emits plain row for simple values", () => {
    const csv = buildExportCsv([loginItem()]);
    expect(csv.split("\n")[1]).toBe("GitHub,octocat,hunter2,,https://github.com,");
  });

  it("escapes commas, quotes, and newlines", () => {
    const item = loginItem({
      name: 'Acme, Inc "prod"',
      login: { username: "u", password: "a,b", uris: [], totp: null },
      note: { content: "line1\nline2" },
    });
    const row = buildExportCsv([item]).split("\n").slice(1).join("\n");
    expect(row).toContain('"Acme, Inc ""prod"""');
    expect(row).toContain('"a,b"');
    expect(row).toContain('"line1\nline2"');
  });

  it("header only when vault has no login items", () => {
    expect(buildExportCsv([])).toBe("name,username,password,totp,url,notes");
  });
});
