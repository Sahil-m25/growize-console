# D71 — Documents are uploaded from the console, never from the Zoho UI

**Date:** 25 Sep 2026 · **Decided by:** owner (question 8)

## Decision
Staff upload files in the console, and the console's server streams each file to Zoho (zero copy, D45):
- **Free attachments:** `POST /crm/v8/{module}/{id}/Attachments`. Scope: `ZohoCRM.modules.attachments.CREATE`. One file per call.
- **Typed slots** (for example "Signed NDA" or "Allocation letter"):
  1. `POST /crm/v8/files` (ZFS). Up to 10 files per call, 20 MB each. Scope: `ZohoCRM.Files.CREATE`.
  2. Write the returned file id into a file-upload field on the Contact, allotment or LLP.

## How the upload is handled
- The uploader's own token is used, so Zoho records who uploaded.
- File types are checked against an allowlist and limited to 20 MB.
- The server checks before the upload that the uploader can open the target record.
- Nothing is kept outside Zoho after the upload.

## Limits to watch
- Attachments count against the org's file storage.
- The slot list must be agreed (OD8).
- Creating file-upload fields is a Zoho write (AP2).

Sources: [Upload an Attachment API](https://www.zoho.com/crm/developer/docs/api/v8/upload-attachment.html) · [Upload Files to ZFS](https://www.zoho.com/crm/developer/docs/api/v8/upload-files-to-zfs.html)
