/* ── selectors — every read the console makes, as pure functions ────────────────────────────
   One import for a page: `import { rag, nextUp, todayList } from "@/lib/selectors";`

   The rule for every function here: it computes, it never writes. Where the prototype's function
   both decided and mutated, only the decision is in this directory and the mutation is an action on
   the store — see each file's header for the pairs.

   Anything that needs more than one of the prototype's globals takes `Ctx` first (`ctx.ts`);
   anything that needs exactly one takes that global first. The frozen clock is `ctx.NOW`, or a
   trailing `NOW: Date`. Nothing in here calls `new Date()`; `lib/format.ts`'s `nowT` is the one
   place in the port that reads the wall clock.
   ────────────────────────────────────────────────────────────────────────────────────────── */

export * from "./ctx";
export * from "./access";
export * from "./leads";
export * from "./ladder";
export * from "./paper";
export * from "./claims";
export * from "./finance";
export * from "./plan";
export * from "./numbers";
export * from "./activity";
