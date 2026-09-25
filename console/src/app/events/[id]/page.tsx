import { EventPage } from "@/features/events";

/* Next 15 hands route params as a promise; the URL is the source of truth for which event this is,
   and the store's EVID is mirrored from it by the shell. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <EventPage id={decodeURIComponent(id)} />;
}
