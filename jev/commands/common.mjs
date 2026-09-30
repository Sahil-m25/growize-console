// Shared bits for the jev/cli.mjs commands.
import fs from "node:fs"; import path from "node:path";
import { jev, ROOT } from "../client.mjs";
export { jev, ROOT };
export const P = (...p) => path.join(ROOT, ...p);
export const readJSON = (f, d) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return d; } };
export const flag = (argv, k) => argv.includes(k);
export const opt = (argv, k, d) => { const i = argv.indexOf(k); return i > -1 ? argv[i + 1] : d; };
export const spent = () => `Jev calls ${jev.stats.calls} (cached ${jev.stats.cached}), input tokens ${jev.stats.input_tokens}`;
