/* What the rest of the app imports from the shell.

   A page agent needs three things from here: the route table (so a link is built rather than
   typed), the drawer registry (so a page's own drawer bodies exist by the time somebody opens
   one), and — occasionally — the rail's arithmetic, when a screen wants to print the same number
   its own badge shows. */

/* Leaf modules first: a feature drawer evaluated inside the Shell chain must find these already bound (B-05). */
export { registerDrawer, drawerDef, registeredKinds } from "./drawers/registry";
export type { DrawerDef, DrawerProps } from "./drawers/registry";
export { PATHS, PARENT, parentOf, pathOf, viewOf, type View } from "./routes";
export {
  SUBSCOPES,
  count,
  landSafe,
  mayReach,
  navFor,
  navHot,
  navOwns,
  navTip,
  scopeBreach,
  scopeCount,
  scopedRow,
  type NavItem,
} from "./nav";
export { useDocked } from "./useDocked";
export { Shell } from "./Shell";
