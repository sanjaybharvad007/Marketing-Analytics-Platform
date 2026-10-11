import { describe, expect, it } from "vitest";
import { csvCell, csvResponse, rounded, toCsv } from "./csv";

describe("csvCell", () => {
  it("leaves plain values alone", () => {
    expect(csvCell("tents")).toBe("tents");
    expect(csvCell(42)).toBe("42");
    expect(csvCell(0.0653)).toBe("0.0653");
    expect(csvCell(true)).toBe("true");
  });

  it("writes missing and non-finite values as empty", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
    expect(csvCell(Number.NaN)).toBe("");
    expect(csvCell(Number.POSITIVE_INFINITY)).toBe("");
  });

  it("quotes commas, quotes and line breaks", () => {
    expect(csvCell("hiking boots, waterproof")).toBe('"hiking boots, waterproof"');
    expect(csvCell('the "best" tent')).toBe('"the ""best"" tent"');
    expect(csvCell("line one\nline two")).toBe('"line one\nline two"');
  });

  it("neutralises spreadsheet formulas in text but not negative numbers", () => {
    expect(csvCell('=HYPERLINK("http://x")')).toBe('"\'=HYPERLINK(""http://x"")"');
    expect(csvCell("+1 555 0100")).toBe("'+1 555 0100");
    expect(csvCell("@import")).toBe("'@import");
    expect(csvCell("-in stock")).toBe("'-in stock");
    expect(csvCell(-12.5)).toBe("-12.5");
  });
});

describe("toCsv", () => {
  it("writes a header and CRLF-terminated rows", () => {
    const csv = toCsv(
      [
        {
          header: "query",
          value: (row: { query: string; clicks: number; ctr: number | null }) => row.query,
        },
        { header: "clicks", value: (row) => row.clicks },
        { header: "ctr", value: (row) => rounded(row.ctr, 4) },
      ],
      [
        { query: "tents, 2 person", clicks: 12, ctr: 0.06534 },
        { query: "boots", clicks: 0, ctr: null },
      ],
    );
    expect(csv).toBe('query,clicks,ctr\r\n"tents, 2 person",12,0.0653\r\nboots,0,\r\n');
  });

  it("writes only the header for no rows", () => {
    expect(toCsv([{ header: "a", value: () => 1 }], [])).toBe("a\r\n");
  });
});

describe("csvResponse", () => {
  it("sets download headers and a safe file name", async () => {
    const response = csvResponse('seo "queries" 2026/05.csv', "a\r\n");
    expect(response.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("Content-Disposition")).toBe(
      'attachment; filename="seo-queries-2026-05.csv"',
    );
    expect(await response.text()).toBe("a\r\n");
  });
});

it("rounds for export and keeps nulls", () => {
  expect(rounded(8.7549, 2)).toBe(8.75);
  expect(rounded(null, 2)).toBeNull();
  expect(rounded(undefined, 2)).toBeNull();
});
