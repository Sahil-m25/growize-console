// Retired by D107 (M19-S13): the one Jev CLI is `node jev/cli.mjs context|triage|decide|rulings|decisions-audit|build-audit|calibrate`.
// This wrapper only forwards, so an older prompt that still says `node autopilot/jev.mjs …` keeps working.
import { main } from "../jev/cli.mjs";
process.exitCode = await main(process.argv.slice(2));
