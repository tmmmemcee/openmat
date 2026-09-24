import { boolean, index, integer, jsonb, pgTable, real, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

/**
 * How the event forms brackets:
 *   - "madison": youth scratch weights, grouped by weight within age divisions
 *   - "weight-classes": official weight classes (high school, USAW kids nationals style)
 */
export type EventFormat = "madison" | "weight-classes";

export interface EventSettings {
  mats: number;
  /** Grouping options for Madison events. */
  grouping: { targetSize: number; minSize: number; maxSize: number; maxSpreadPct: number; spreadFloor: number };
  /** Minutes between a wrestler's bouts. */
  restMin: number;
  /** Anyone with the public link can register while this is on. */
  registrationOpen: boolean;
}

export const events = pgTable(
  "events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Short public id used in links, e.g. "k7m2qx". */
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    startDate: text("start_date").notNull(), // YYYY-MM-DD, in the event's local time
    location: text("location").notNull().default(""),
    format: text("format").$type<EventFormat>().notNull(),
    rulesetId: text("ruleset_id").notNull(),
    /** Season year used for age divisions (e.g. 2026 for the 2025-26 season). */
    seasonYear: integer("season_year").notNull(),
    settings: jsonb("settings").$type<EventSettings>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("events_slug_idx").on(t.slug)],
);

export type StaffRole = "director" | "weigh-in" | "table";

/** Secret links for staff. Lookups go by the token's hash. */
export const accessLinks = pgTable(
  "access_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    role: text("role").$type<StaffRole>().notNull(),
    /** For table links: which mat (1-based). */
    mat: integer("mat"),
    tokenHash: text("token_hash").notNull(),
    /**
     * Staff (weigh-in/table) tokens are kept so the director can copy those
     * links again from the dashboard. The director's own token is never stored.
     */
    token: text("token"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("access_links_token_idx").on(t.tokenHash), index("access_links_event_idx").on(t.eventId)],
);

/**
 * A division is an age group + gender (+ optional weight class set), e.g.
 * "10U Boys" or "High School Girls".
 */
export const divisions = pgTable(
  "divisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** Age division name ("10U") for Madison events; null when age doesn't matter (high school). */
    ageDivision: text("age_division"),
    /** Oldest age allowed, as of the season year. */
    maxAge: integer("max_age"),
    gender: text("gender").$type<"boys" | "girls" | "mixed">().notNull(),
    /** Official weight class limits, lightest first (weight-classes events). */
    weightClasses: jsonb("weight_classes").$type<number[]>(),
    /** How many classes above their natural one a wrestler may enter. */
    maxClassesUp: integer("max_classes_up").notNull().default(1),
    /** Regulation periods in seconds, e.g. [60, 60, 60]. */
    periodsSec: jsonb("periods_sec").$type<number[]>().notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [index("divisions_event_idx").on(t.eventId)],
);

export type EntryStatus = "registered" | "weighed-in" | "scratched";

/** A wrestler entered in an event. */
export const entries = pgTable(
  "entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    divisionId: uuid("division_id")
      .notNull()
      .references(() => divisions.id, { onDelete: "restrict" }),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    team: text("team").notNull().default(""),
    birthYear: integer("birth_year"),
    /** Weight given at registration. */
    declaredWeight: real("declared_weight"),
    /** Official weigh-in weight. */
    weight: real("weight"),
    weighedAt: timestamp("weighed_at", { withTimezone: true }),
    /** Weight class entered (weight-classes events), e.g. "113". */
    weightClass: text("weight_class"),
    /** Wrestle-up overrides (never down). */
    bumpAge: integer("bump_age").notNull().default(0),
    bumpWeight: integer("bump_weight").notNull().default(0),
    /** Parent/coach agreed to wrestling outside the normal rules. */
    consent: boolean("consent").notNull().default(false),
    status: text("status").$type<EntryStatus>().notNull().default("registered"),
    contactEmail: text("contact_email"),
    notes: text("notes").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("entries_event_idx").on(t.eventId)],
);

/** A Madison group (pool) of wrestlers. */
export const groups = pgTable(
  "groups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    /** Division the group wrestles in (after any age bump-ups). */
    divisionId: uuid("division_id")
      .notNull()
      .references(() => divisions.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    /** Locked groups are kept when grouping is re-run. */
    locked: boolean("locked").notNull().default(false),
  },
  (t) => [index("groups_event_idx").on(t.eventId)],
);

export const groupMembers = pgTable(
  "group_members",
  {
    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    entryId: uuid("entry_id")
      .notNull()
      .references(() => entries.id, { onDelete: "cascade" }),
  },
  (t) => [uniqueIndex("group_members_entry_idx").on(t.entryId), index("group_members_group_idx").on(t.groupId)],
);
