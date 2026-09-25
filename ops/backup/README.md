# Backup

The target is S3 with Object Lock in a **separate** AWS account (D14). A VPS or NAS is at most a third
copy, never a second live system.

- **Records:** Zoho Bulk Read, nightly, written to S3 under `zoho/<org>/<date>/`.
- **Attachments:** hashed nightly (the hash is cheap); the objects themselves are fetched in the
  quarterly drill, which is also what proves the fetch still works.
- **Supabase:** point-in-time recovery on the platform, plus a nightly logical dump to the same bucket.
- **The exit:** this bucket is the answer to "what if Zoho ends the relationship". It is not a
  disaster-recovery detail, it is the thing that makes the platform choice reversible.

Scripts land here. Nothing in this folder writes to anything but S3.
