import { bigserial, boolean, index, integer, jsonb, pgTable, real, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

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
    /** Venue, e.g. "Central High School gym". */
    location: text("location").notNull().default(""),
    city: text("city").notNull().default(""),
    /** Two-letter state/province code, for the tournament list filters. */
    state: text("state").notNull().default(""),
    /** IANA time zone of the venue, e.g. "America/Chicago", for times in alerts. */
    timezone: text("timezone").notNull().default("America/Chicago"),
    /** When wrestling starts, "HH:MM" local time. */
    startTime: text("start_time"),
    /** Shown in the public tournament list. */
    listed: boolean("listed").notNull().default(true),
    /**
     * Goes up on every change to the tournament's structure (entries, brackets,
     * schedule, results). Cached views are rebuilt when it changes.
     */
    version: integer("version").notNull().default(0),
    /** Goes up on live-only changes (scoring taps, the match clock): scores refresh, brackets don't rebuild. */
    liveVersion: integer("live_version").notNull().default(0),
    /** A try-it-out copy from the home page's live demo; never listed, deleted after a day. */
    isDemo: boolean("is_demo").notNull().default(false),
    /** Where to send a new director link if it's lost. Never shown publicly. */
    directorEmail: text("director_email"),
    format: text("format").$type<EventFormat>().notNull(),
    rulesetId: text("ruleset_id").notNull(),
    /** Season year used for age divisions (e.g. 2026 for the 2025-26 season). */
    seasonYear: integer("season_year").notNull(),
    settings: jsonb("settings").$type<EventSettings>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("events_slug_idx").on(t.slug), index("events_listing_idx").on(t.listed, t.startDate)],
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
    /** Seed within their bracket (weight class or group); null = unseeded, drawn randomly. */
    seed: integer("seed"),
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

export type BracketFormat = "round-robin" | "double-elim" | "single-elim";

export interface BracketOptions {
  /** Double elim: places wrestled for. */
  places?: 4 | 6 | 8;
  trueSecond?: boolean;
  /** Single elim. */
  thirdPlace?: boolean;
}

/** One bracket: a Madison group, or one weight class in a division. */
export const brackets = pgTable(
  "brackets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    divisionId: uuid("division_id")
      .notNull()
      .references(() => divisions.id, { onDelete: "cascade" }),
    /** Madison group this bracket was made from. */
    groupId: uuid("group_id").references(() => groups.id, { onDelete: "set null" }),
    /** Weight class this bracket is for (weight-classes events). */
    weightClass: text("weight_class"),
    /** Display name, e.g. "10U Boys · Group 3" or "High School Boys · 113". */
    name: text("name").notNull(),
    format: text("format").$type<BracketFormat>().notNull(),
    options: jsonb("options").$type<BracketOptions>().notNull().default({}),
    /** Elimination: bracket size (power of 2). */
    size: integer("size"),
    /** Entry ids by seed (index 0 = seed 1); null = bye. Round robin: the pool, in order. */
    draw: jsonb("draw").$type<(string | null)[]>().notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("brackets_event_idx").on(t.eventId)],
);

export interface BoutClock {
  period: number;
  remainingSec: number;
  running: boolean;
  at: string;
}

export interface BoutResult {
  winner: "A" | "B";
  winType: string;
  score: { A: number; B: number };
  summary: string;
  teamPoints: number;
  classificationPoints?: [number, number];
}

/**
 * A bout. For round robins the wrestlers are fixed (entryA/entryB). For
 * elimination brackets they're worked out from the draw and earlier results
 * each time (so corrections flow through), and entryA/entryB are filled in
 * when the bout is wrestled, to record who actually wrestled.
 */
export const bouts = pgTable(
  "bouts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    bracketId: uuid("bracket_id")
      .notNull()
      .references(() => brackets.id, { onDelete: "cascade" }),
    /** Bout id within its bracket: "W1-2", "L3-1", "P3" (elimination) or "1", "2"... (round robin). */
    key: text("key").notNull(),
    round: integer("round").notNull(),
    entryA: uuid("entry_a").references(() => entries.id, { onDelete: "set null" }),
    entryB: uuid("entry_b").references(() => entries.id, { onDelete: "set null" }),
    mat: integer("mat"),
    /** Position in the mat's queue. */
    matOrder: integer("mat_order"),
    boutNumber: text("bout_number"),
    /** Planned start, minutes after the event's start time. */
    plannedStartMin: integer("planned_start_min"),
    durationMin: real("duration_min").notNull(),
    /** Bouts (ids) that must finish, plus rest, before this one. */
    after: jsonb("after").$type<{ boutId: string; restMin: number }[]>().notNull().default([]),
    startedAt: timestamp("started_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    /** Match clock as last reported by the table, for live views. `at` is server time. */
    clock: jsonb("clock").$type<BoutClock>(),
    winnerEntryId: uuid("winner_entry_id").references(() => entries.id, { onDelete: "set null" }),
    result: jsonb("result").$type<BoutResult>(),
  },
  (t) => [
    index("bouts_event_idx").on(t.eventId),
    uniqueIndex("bouts_bracket_key_idx").on(t.bracketId, t.key),
    index("bouts_mat_idx").on(t.eventId, t.mat, t.matOrder),
  ],
);

/** Scoring log, append-only. Ids come from the device so retries are safe. */
export const boutEvents = pgTable(
  "bout_events",
  {
    id: text("id").primaryKey(),
    /** Order the events were saved in. */
    seq: bigserial("seq", { mode: "number" }).notNull(),
    boutId: uuid("bout_id")
      .notNull()
      .references(() => bouts.id, { onDelete: "cascade" }),
    /** The event as the scoring engine reads it (score, penalty, void...). */
    data: jsonb("data").$type<Record<string, unknown>>().notNull(),
    /** Who entered it: "director" or "table:3". */
    by: text("by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("bout_events_bout_idx").on(t.boutId, t.seq)],
);

/** Small server-wide settings, e.g. the web push (VAPID) keys. */
export const serverSettings = pgTable("server_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<unknown>().notNull(),
});

export interface PushSubscriptionJson {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/** Someone following a wrestler or a team, with where to send alerts. No account needed. */
export const follows = pgTable(
  "follows",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    entryId: uuid("entry_id").references(() => entries.id, { onDelete: "cascade" }),
    /** Follow everyone on this team instead of one wrestler. */
    team: text("team"),
    channel: text("channel").$type<"push" | "email">().notNull(),
    subscription: jsonb("subscription").$type<PushSubscriptionJson>(),
    email: text("email"),
    /** Proves the device that created the follow when it unfollows. */
    secret: text("secret").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("follows_event_idx").on(t.eventId)],
);

/** Alerts already sent, so each goes out once. */
export const notificationLog = pgTable(
  "notification_log",
  {
    followId: uuid("follow_id")
      .notNull()
      .references(() => follows.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("notification_log_key_idx").on(t.followId, t.key)],
);
