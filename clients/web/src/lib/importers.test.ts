// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import {
  detectFormat,
  parseLastPassCsv,
  parse1PasswordCsv,
  parseGenericCsv,
  parseKeePassXml,
  parseCsvRow,
  parseImportFile,
} from "./importers";

describe("detectFormat", () => {
  it("detects KeePass by .xml extension", () => {
    expect(detectFormat("<KeePassFile/>", "export.xml")).toBe("keepass");
  });

  it("detects Bitwarden JSON", () => {
    expect(detectFormat('{"encrypted":false,"items":[]}', "export.json")).toBe("bitwarden");
  });

  it("classifies JSON with an items array as bitwarden (even 1Password-shaped)", () => {
    // Note: the 1Password branch in detectFormat is unreachable — the
    // bitwarden check ('"items" in parsed') runs first and matches any JSON
    // that has an items array. This test documents the current behavior.
    expect(detectFormat('{"items":[{"trashed":false}]}', "1p.json")).toBe("bitwarden");
  });

  it("falls back to bitwarden for unparseable JSON", () => {
    expect(detectFormat("{{{", "broken.json")).toBe("bitwarden");
  });

  it("detects LastPass CSV by grouping/extra headers", () => {
    expect(detectFormat("url,username,password,totp,extra,name,grouping,fav\n", "lp.csv")).toBe("lastpass");
  });

  it("detects 1Password CSV by uuid/totp_secret headers", () => {
    expect(detectFormat("uuid,title,username,password\n", "1p.csv")).toBe("1password");
  });

  it("falls back to generic csv for unknown CSV headers", () => {
    expect(detectFormat("name,username,password\n", "my.csv")).toBe("csv");
  });

  it("defaults to bitwarden for unknown extensions", () => {
    expect(detectFormat("whatever", "file.txt")).toBe("bitwarden");
  });
});

describe("parseCsvRow", () => {
  it("splits simple rows", () => {
    expect(parseCsvRow("a,b,c")).toEqual(["a", "b", "c"]);
  });

  it("handles quoted fields with commas", () => {
    expect(parseCsvRow('a,"b,c",d')).toEqual(["a", "b,c", "d"]);
  });

  it("handles escaped quotes", () => {
    expect(parseCsvRow('"say ""hi""",b')).toEqual(['say "hi"', "b"]);
  });

  it("handles empty fields", () => {
    expect(parseCsvRow("a,,c,")).toEqual(["a", "", "c", ""]);
  });
});

describe("parseLastPassCsv", () => {
  const HEADER = "url,username,password,totp,extra,name,grouping,fav";

  it("parses a login row", () => {
    const items = parseLastPassCsv(
      `${HEADER}\nhttps://github.com,octocat,hunter2,SECRET,my note,GitHub,Work,1`,
    );
    expect(items).toEqual([
      {
        type: 1,
        name: "GitHub",
        favorite: true,
        login: {
          username: "octocat",
          password: "hunter2",
          totp: "SECRET",
          uris: [{ uri: "https://github.com", match: null }],
        },
        notes: "my note",
      },
    ]);
  });

  it("maps http://sn rows to secure notes", () => {
    const items = parseLastPassCsv(`${HEADER}\nhttp://sn,,,,note body,My Note,,0`);
    expect(items).toEqual([
      { type: 2, name: "My Note", notes: "note body", secureNote: { type: 0 } },
    ]);
  });

  it("returns empty for header-only or empty input", () => {
    expect(parseLastPassCsv(HEADER)).toEqual([]);
    expect(parseLastPassCsv("")).toEqual([]);
  });

  it("skips blank lines", () => {
    const items = parseLastPassCsv(`${HEADER}\n\nhttps://a.com,u,p,,,A,,0\n\n`);
    expect(items).toHaveLength(1);
  });
});

describe("parse1PasswordCsv", () => {
  it("parses title/username/password/otpauth/urls/notes", () => {
    const items = parse1PasswordCsv(
      "Title,Username,Password,OTPAuth,URLs,Notes\nGitHub,octocat,hunter2,otpauth://x,https://github.com,a note",
    );
    expect(items).toEqual([
      {
        type: 1,
        name: "GitHub",
        login: {
          username: "octocat",
          password: "hunter2",
          totp: "otpauth://x",
          uris: [{ uri: "https://github.com", match: null }],
        },
        notes: "a note",
      },
    ]);
  });

  it("uses 'Untitled' when title missing", () => {
    const items = parse1PasswordCsv("Title,Username,Password\n,u,p");
    expect(items[0].name).toBe("Untitled");
  });
});

describe("parseGenericCsv", () => {
  it("parses NadSafe export format (round-trip with buildExportCsv)", () => {
    const items = parseGenericCsv(
      "name,username,password,totp,url,notes\nGitHub,octocat,hunter2,,https://github.com,",
    );
    expect(items).toEqual([
      {
        type: 1,
        name: "GitHub",
        login: {
          username: "octocat",
          password: "hunter2",
          totp: null,
          uris: [{ uri: "https://github.com", match: null }],
        },
        notes: null,
      },
    ]);
  });

  it("falls back to email column for username", () => {
    const items = parseGenericCsv("name,email,password\nSite,me@example.com,pw");
    expect(items[0].login?.username).toBe("me@example.com");
  });
});

describe("parseKeePassXml", () => {
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<KeePassFile><Root><Group>
  <Entry>
    <String><Key>Title</Key><Value>GitHub</Value></String>
    <String><Key>UserName</Key><Value>octocat</Value></String>
    <String><Key>Password</Key><Value>hunter2</Value></String>
    <String><Key>URL</Key><Value>https://github.com</Value></String>
    <String><Key>Notes</Key><Value>work</Value></String>
    <String><Key>TimeOtp-Secret-Base32</Key><Value>JBSWY3DP</Value></String>
  </Entry>
  <Entry>
    <String><Key>Notes</Key><Value>no title, no username — skipped</Value></String>
  </Entry>
</Group></Root></KeePassFile>`;

  it("parses entries with TOTP from plugin field", () => {
    const items = parseKeePassXml(xml);
    expect(items).toHaveLength(1);
    expect(items[0]).toEqual({
      type: 1,
      name: "GitHub",
      login: {
        username: "octocat",
        password: "hunter2",
        totp: "JBSWY3DP",
        uris: [{ uri: "https://github.com", match: null }],
      },
      notes: "work",
    });
  });

  it("returns empty for XML without entries", () => {
    expect(parseKeePassXml("<KeePassFile><Root/></KeePassFile>")).toEqual([]);
  });
});

describe("parseImportFile", () => {
  it("routes lastpass csv to the LastPass parser", () => {
    const { format, items } = parseImportFile(
      "url,username,password,totp,extra,name,grouping,fav\nhttps://a.com,u,p,,,A,,0",
      "lastpass.csv",
    );
    expect(format).toBe("lastpass");
    expect(items).toHaveLength(1);
  });

  it("returns empty items for bitwarden (handled by importBitwardenJson)", () => {
    const { format, items } = parseImportFile('{"encrypted":false,"items":[]}', "bw.json");
    expect(format).toBe("bitwarden");
    expect(items).toEqual([]);
  });
});
