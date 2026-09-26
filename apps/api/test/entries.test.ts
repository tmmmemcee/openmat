import { describe, expect, it } from "vitest";
import { app, auth, createEvent } from "./helpers.js";

const kid = (first: string, birthYear: number, gender = "boys", extra: object = {}) => ({
  firstName: first,
  lastName: "Smith",
  team: "Hawks",
  birthYear,
  gender,
  ...extra,
});

describe("entries", () => {
  it("places a wrestler in their age group from birth year", async () => {
    const { slug, directorToken, info } = await createEvent();
    const res = await app.inject({ method: "POST", url: `/api/events/${slug}/entries`, headers: auth(directorToken), payload: kid("Sam", 2018) });
    expect(res.statusCode).toBe(201);
    // Season 2027: born 2018 is 9 -> 10U.
    const division = info.divisions.find((d: { id: string }) => d.id === res.json().divisionId);
    expect(division.name).toBe("10U Boys");
  });

  it("rejects duplicates and wrestlers too old for every age group", async () => {
    const { slug, directorToken } = await createEvent();
    await app.inject({ method: "POST", url: `/api/events/${slug}/entries`, headers: auth(directorToken), payload: kid("Sam", 2018) });
    const dup = await app.inject({ method: "POST", url: `/api/events/${slug}/entries`, headers: auth(directorToken), payload: kid("sam", 2018) });
    expect(dup.statusCode).toBe(409);
    const old = await app.inject({ method: "POST", url: `/api/events/${slug}/entries`, headers: auth(directorToken), payload: kid("Max", 2010) });
    expect(old.statusCode).toBe(400);
    expect(old.json().error).toContain("No age group");
  });

  it("public registration only while open", async () => {
    const { slug, directorToken } = await createEvent();
    const closed = await app.inject({ method: "POST", url: `/api/events/${slug}/entries`, payload: kid("Sam", 2018) });
    expect(closed.statusCode).toBe(403);
    await app.inject({ method: "PATCH", url: `/api/events/${slug}`, headers: auth(directorToken), payload: { settings: { registrationOpen: true } } });
    const open = await app.inject({ method: "POST", url: `/api/events/${slug}/entries`, payload: kid("Sam", 2018) });
    expect(open.statusCode).toBe(201);
    expect(open.json()).toEqual({ id: expect.any(String), division: "10U Boys" });
  });

  it("imports good rows and reports bad ones", async () => {
    const { slug, directorToken } = await createEvent();
    const res = await app.inject({
      method: "POST",
      url: `/api/events/${slug}/entries/import`,
      headers: auth(directorToken),
      payload: { rows: [kid("A", 2018), kid("B", 2016), { firstName: "C" }, kid("A", 2018), kid("D", 2005)] },
    });
    const body = res.json();
    expect(body.created).toBe(2);
    expect(body.errors.map((e: { row: number }) => e.row)).toEqual([3, 4, 5]);
  });

  it("weigh-in records weight, and that link can't do anything else", async () => {
    const { slug, directorToken, weighInToken } = await createEvent();
    const { id } = (await app.inject({ method: "POST", url: `/api/events/${slug}/entries`, headers: auth(directorToken), payload: kid("Sam", 2018) })).json();
    const weighed = await app.inject({ method: "PATCH", url: `/api/events/${slug}/entries/${id}`, headers: auth(weighInToken), payload: { weight: 61.4 } });
    expect(weighed.json()).toMatchObject({ weight: 61.4, status: "weighed-in" });
    expect(weighed.json().weighedAt).toBeTruthy();
    const sneaky = await app.inject({ method: "PATCH", url: `/api/events/${slug}/entries/${id}`, headers: auth(weighInToken), payload: { bumpAge: 1 } });
    expect(sneaky.statusCode).toBe(403);
  });

  it("allows bumping up but never down, and only when an older group exists", async () => {
    const { slug, directorToken } = await createEvent();
    const young = (await app.inject({ method: "POST", url: `/api/events/${slug}/entries`, headers: auth(directorToken), payload: kid("Sam", 2020) })).json();
    const patch = (payload: object) => app.inject({ method: "PATCH", url: `/api/events/${slug}/entries/${young.id}`, headers: auth(directorToken), payload });
    expect((await patch({ bumpAge: 1 })).statusCode).toBe(200);
    expect((await patch({ bumpAge: -1 })).json().error).toContain("never down");
    const oldest = (await app.inject({ method: "POST", url: `/api/events/${slug}/entries`, headers: auth(directorToken), payload: kid("Max", 2015) })).json();
    const r = await app.inject({ method: "PATCH", url: `/api/events/${slug}/entries/${oldest.id}`, headers: auth(directorToken), payload: { bumpAge: 1 } });
    expect(r.json().error).toContain("no older age group");
  });
});

describe("weight class events", () => {
  const hsEvent = {
    name: "County Duals",
    startDate: "2027-01-09",
    format: "weight-classes",
    rulesetId: "nfhs-2025-26",
    divisions: [{ name: "High School Boys", gender: "boys", weightClasses: [106, 113, 120, 126], periodsSec: [120, 120, 120] }],
  };

  it("checks weigh-ins against the entered class", async () => {
    const { slug, directorToken, weighInToken } = await createEvent(hsEvent);
    const e = (await app.inject({
      method: "POST",
      url: `/api/events/${slug}/entries`,
      headers: auth(directorToken),
      payload: { firstName: "Jo", lastName: "Lee", team: "North", weightClass: "113" },
    })).json();
    const missed = await app.inject({ method: "PATCH", url: `/api/events/${slug}/entries/${e.id}`, headers: auth(weighInToken), payload: { weight: 113.6 } });
    expect(missed.json().weighIn).toMatchObject({ status: "missed-weight", suggested: { name: "120" } });
    const moved = await app.inject({ method: "PATCH", url: `/api/events/${slug}/entries/${e.id}`, headers: auth(weighInToken), payload: { weightClass: "120" } });
    expect(moved.json().weighIn).toMatchObject({ status: "ok" });
    const bad = await app.inject({ method: "PATCH", url: `/api/events/${slug}/entries/${e.id}`, headers: auth(weighInToken), payload: { weightClass: "150" } });
    expect(bad.statusCode).toBe(400);
  });
});

describe("entry photos", () => {
  /** Minimal multipart/form-data body for @fastify/multipart's req.file(). */
  function photoUpload(contentType = "image/jpeg", bytes = Buffer.from("fake-jpeg-bytes")) {
    const boundary = "----openmattest";
    const payload = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="photo.jpg"\r\nContent-Type: ${contentType}\r\n\r\n`,
      ),
      bytes,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    return { payload, headers: { "content-type": `multipart/form-data; boundary=${boundary}` } };
  }

  async function entryWithPhoto() {
    const { slug, directorToken, weighInToken } = await createEvent();
    const { id } = (
      await app.inject({ method: "POST", url: `/api/events/${slug}/entries`, headers: auth(directorToken), payload: kid("Sam", 2018) })
    ).json();
    return { slug, directorToken, weighInToken, id };
  }

  it("uploads a photo as staff, serves it publicly only with consent", async () => {
    const { slug, directorToken, id } = await entryWithPhoto();
    const up = photoUpload();
    const res = await app.inject({
      method: "POST",
      url: `/api/events/${slug}/entries/${id}/photo`,
      headers: { ...auth(directorToken), ...up.headers },
      payload: up.payload,
    });
    expect(res.statusCode).toBe(200);
    const { photoUrl, photoConsent } = res.json();
    expect(photoUrl).toMatch(/^\/uploads\/entries\/[\w-]+\.jpg$/);
    expect(photoConsent).toBe(true);
    const served = await app.inject({ url: photoUrl });
    expect(served.statusCode).toBe(200);

    // Revoke consent via PATCH (director-only) — the file must stop being served.
    const revoke = await app.inject({ method: "PATCH", url: `/api/events/${slug}/entries/${id}`, headers: auth(directorToken), payload: { photoConsent: false } });
    expect(revoke.statusCode).toBe(200);
    const denied = await app.inject({ url: photoUrl });
    expect(denied.statusCode).toBe(404);

    // Re-grant consent — the file is served again (no re-upload needed).
    const grant = await app.inject({ method: "PATCH", url: `/api/events/${slug}/entries/${id}`, headers: auth(directorToken), payload: { photoConsent: true } });
    expect(grant.statusCode).toBe(200);
    const servedAgain = await app.inject({ url: photoUrl });
    expect(servedAgain.statusCode).toBe(200);
  });

  it("rejects public uploads, bad MIME types, and weigh-in consent changes", async () => {
    const { slug, directorToken, weighInToken, id } = await entryWithPhoto();
    const anon = photoUpload();
    const noAuth = await app.inject({ method: "POST", url: `/api/events/${slug}/entries/${id}/photo`, headers: anon.headers, payload: anon.payload });
    expect(noAuth.statusCode).toBe(401);

    const bad = photoUpload("application/pdf");
    const badMime = await app.inject({ method: "POST", url: `/api/events/${slug}/entries/${id}/photo`, headers: { ...auth(directorToken), ...bad.headers }, payload: bad.payload });
    expect(badMime.statusCode).toBe(415);

    // Weigh-in staff may upload but may not touch the consent flag.
    const wi = photoUpload();
    const wiUpload = await app.inject({ method: "POST", url: `/api/events/${slug}/entries/${id}/photo`, headers: { ...auth(weighInToken), ...wi.headers }, payload: wi.payload });
    expect(wiUpload.statusCode).toBe(200);
    const wiPatch = await app.inject({ method: "PATCH", url: `/api/events/${slug}/entries/${id}`, headers: auth(weighInToken), payload: { photoConsent: true } });
    expect(wiPatch.statusCode).toBe(403);
  });

  it("deleting the photo or the entry removes the file", async () => {
    const { slug, directorToken, id } = await entryWithPhoto();
    const up = photoUpload();
    const { photoUrl } = (
      await app.inject({ method: "POST", url: `/api/events/${slug}/entries/${id}/photo`, headers: { ...auth(directorToken), ...up.headers }, payload: up.payload })
    ).json();

    const del = await app.inject({ method: "DELETE", url: `/api/events/${slug}/entries/${id}/photo`, headers: auth(directorToken) });
    expect(del.statusCode).toBe(200);
    const gone = await app.inject({ url: photoUrl });
    expect(gone.statusCode).toBe(404);

    // New upload, then delete the whole entry — cascade must remove the file.
    const up2 = photoUpload();
    const { photoUrl: url2 } = (
      await app.inject({ method: "POST", url: `/api/events/${slug}/entries/${id}/photo`, headers: { ...auth(directorToken), ...up2.headers }, payload: up2.payload })
    ).json();
    const delEntry = await app.inject({ method: "DELETE", url: `/api/events/${slug}/entries/${id}`, headers: auth(directorToken) });
    expect(delEntry.statusCode).toBe(200);
    const gone2 = await app.inject({ url: url2 });
    expect(gone2.statusCode).toBe(404);
  });

  it("re-uploading with a different extension removes the old file", async () => {
    const { slug, directorToken, id } = await entryWithPhoto();
    const jpg = photoUpload("image/jpeg");
    const first = (
      await app.inject({ method: "POST", url: `/api/events/${slug}/entries/${id}/photo`, headers: { ...auth(directorToken), ...jpg.headers }, payload: jpg.payload })
    ).json();
    const png = photoUpload("image/png");
    const second = (
      await app.inject({ method: "POST", url: `/api/events/${slug}/entries/${id}/photo`, headers: { ...auth(directorToken), ...png.headers }, payload: png.payload })
    ).json();
    expect(second.photoUrl).toMatch(/\.png$/);
    expect(first.photoUrl).not.toBe(second.photoUrl);
    const oldGone = await app.inject({ url: first.photoUrl });
    expect(oldGone.statusCode).toBe(404);
    const newServed = await app.inject({ url: second.photoUrl });
    expect(newServed.statusCode).toBe(200);
  });
});
