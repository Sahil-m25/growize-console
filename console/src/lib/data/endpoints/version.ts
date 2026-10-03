/* The demo book's record version. A live read carries Zoho's Modified_Time on every record a guarded write goes back to
   (a lead's `mt`, a ticket's `version`, an event's `modifiedTime`, an allotment's `version`); the fixture half carries this
   one stable value in the same place, so the screen sends a version in both modes and a fixture write keeps working
   (the reducer it runs has no Modified_Time to compare). A valid Zoho datetime, so a route would accept its shape. */
export const FIXTURE_VERSION = "2026-09-01T09:00:00+05:30";
