import Papa from "papaparse";

/** Spreadsheet columns we understand, with the names people actually use. */
const ALIASES: Record<string, string[]> = {
  firstName: ["first_name", "first", "firstname", "first name", "given name"],
  lastName: ["last_name", "last", "lastname", "last name", "surname", "family name"],
  team: ["team", "club", "school", "team name"],
  birthYear: ["birth_year", "birthyear", "birth year", "born", "year born", "yob", "birthdate", "birth date", "dob", "date of birth"],
  gender: ["gender", "sex", "boys/girls", "division"],
  weightClass: ["weight_class", "weight class", "class", "wt class"],
  declaredWeight: ["weight", "declared_weight", "declared weight", "approx weight", "lbs"],
  contactEmail: ["email", "e-mail", "parent email", "contact email"],
};

export const TEMPLATE_CSV =
  "first_name,last_name,team,birth_year,gender,weight_class,weight,email\n" +
  "Sam,Smith,Springfield Youth,2017,boys,,62,parent@example.com\n";

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

function parseGender(v: string): "boys" | "girls" | null {
  const s = norm(v);
  if (["b", "m", "boy", "boys", "male", "men"].includes(s)) return "boys";
  if (["g", "f", "girl", "girls", "female", "women"].includes(s)) return "girls";
  return null;
}

function parseYear(v: string): number | null {
  const m = v.match(/(19|20)\d{2}/);
  return m ? Number(m[0]) : null;
}

export interface ParsedRows {
  rows: Record<string, unknown>[];
  columns: Record<string, string | null>;
}

export async function parseWrestlerCsv(file: File): Promise<ParsedRows> {
  return parseWrestlerText(await file.text());
}

/** Columns assumed, in order, when pasted rows have no header row. */
const POSITIONAL = ["firstName", "lastName", "birthYear", "gender", "declaredWeight"];

/**
 * Spreadsheet text: a CSV file, or rows copied from Excel/Google Sheets
 * (tab separated). A header row is used when it names the columns; without
 * one, columns are taken as first name, last name, birth year, boys/girls,
 * weight.
 */
export function parseWrestlerText(text: string): ParsedRows {
  const withHeader = Papa.parse<Record<string, string>>(text.trim(), { header: true, skipEmptyLines: "greedy" });
  const headers = withHeader.meta.fields ?? [];
  const columns: Record<string, string | null> = {};
  for (const [field, names] of Object.entries(ALIASES)) {
    columns[field] = headers.find((h) => names.includes(norm(h))) ?? null;
  }
  let data = withHeader.data;
  if (!columns.firstName && !columns.lastName) {
    // No header row: read every line as data, in the POSITIONAL column order.
    const raw = Papa.parse<string[]>(text.trim(), { skipEmptyLines: "greedy" });
    data = raw.data.map((cells) => Object.fromEntries(POSITIONAL.map((key, i) => [key, cells[i] ?? ""])));
    for (const field of Object.keys(ALIASES)) columns[field] = POSITIONAL.includes(field) ? field : null;
  }
  const get = (row: Record<string, string>, field: string) => {
    const col = columns[field];
    return col ? (row[col] ?? "").trim() : "";
  };
  const rows = data.map((row) => {
    const out: Record<string, unknown> = {
      firstName: get(row, "firstName"),
      lastName: get(row, "lastName"),
      team: get(row, "team"),
    };
    const year = parseYear(get(row, "birthYear"));
    if (year) out.birthYear = year;
    const gender = parseGender(get(row, "gender"));
    if (gender) out.gender = gender;
    const wc = get(row, "weightClass").replace(/\s*(lb|lbs)$/i, "");
    if (wc) out.weightClass = wc;
    const w = Number.parseFloat(get(row, "declaredWeight"));
    if (Number.isFinite(w)) out.declaredWeight = w;
    const email = get(row, "contactEmail");
    if (email) out.contactEmail = email;
    return out;
  });
  return { rows, columns };
}
