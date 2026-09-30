/* The Investors side's half of the wiring kit: the book its fixture halves project from, and how a
   fixture write runs the reducer action it replaces and answers as the route would. */

import { imReducer, type ImAction, type ImState } from "@/lib/im";
import { fail, ok, type ApiErr, type ApiResult } from "../api";

/** What an Investors-side fixture half reads: the Investors book and who is signed in (ImPageProps' s and me). */
export type ImBook = { s: ImState; me: string };
export type ImDispatch = (a: ImAction) => void;

/** Run the reducer action a wired write replaces (fixture mode). The reducer's refusal or question is
 *  still shown by its own in-page note; the caller gets it back as the route's 422 / 428. */
export function imFixtureWrite<T>({ s, me }: ImBook, dispatch: ImDispatch, a: ImAction, data: T): ApiResult<T> {
  /* peeked from the book with no note up, so any note in the answer is this write's own */
  const n = imReducer({ ...s, ui: { ...s.ui, NOTE: null, PENDING: null } }, me, a).ui.NOTE;
  dispatch(a);
  if (n) return n.kind === "ask" ? fail(428, "confirm", n.msg) : fail(422, "refused", n.msg);
  return ok(data);
}

/** A live refusal lands in the same in-page note the reducer's refusals use. */
export const imLiveError = (dispatch: ImDispatch, e: ApiErr): void => dispatch({ type: "note", msg: e.error });
