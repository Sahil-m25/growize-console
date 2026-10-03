"use client";

/* M12-S01-W1 — a farm's DOCS: the LLP's own (project) papers and, for the holders the seat may see, their allotment papers,
   from GET /api/documents/farm/[id] (D70's scopes). Metadata only: a name, a size, a time — never a file body. */

import { fileSize, I } from "@/lib/im";
import { useApiRead } from "@/lib/data/api";
import { farmDocuments } from "@/lib/data/endpoints/documents";
import type { AttachmentLine } from "@/server/documents/attachments";
import type { ImPageProps } from "../common";
import { ReadNote } from "./ReadNote";

const Files = ({ files }: { files: readonly AttachmentLine[] }) => (
  <>{files.map(f => <div className="sm" key={f.id}>{f.name}{f.slot ? " · " + f.slot : ""}{f.size == null ? "" : " · " + fileSize(f.size)}{f.at ? " · " : ""}<span className="mono">{f.at || ""}</span>{f.by ? " · " + f.by : ""}</div>)}</>
);

export function FarmDocs({ s, me, id }: Pick<ImPageProps, "s" | "me"> & { id: string | null }) {
  const r = useApiRead(farmDocuments, { s, me }, id);
  if (r.state === "idle") return null;
  const d = r.state === "ok" ? r.data : null;
  return (
    <div className="drwsec"><p className="lbl">Documents</p>
      <ReadNote r={r} what="the farm's documents" />
      {d ? (
        <>
          {d.project.length ? <Files files={d.project} /> : <p className="sm" style={{ margin: 0 }}>No farm papers on file.</p>}
          {d.allotments.map(a => {
            const x = I(s, me, a.contactId);
            return (
              <div className="led" key={a.allotmentId} style={{ alignItems: "flex-start", marginTop: 8 }}>
                <span className="tag">Allotment</span>
                <span style={{ minWidth: 0 }}><b>{x ? x.n : a.contactId}</b>
                  {a.files ? <Files files={a.files} /> : <div className="sm">{a.count + " paper" + (a.count === 1 ? "" : "s") + " on file"}</div>}</span>
              </div>
            );
          })}
        </>) : null}
    </div>
  );
}
