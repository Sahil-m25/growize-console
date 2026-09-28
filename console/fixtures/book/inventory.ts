/**
 * SELLABLE INVENTORY. Ports `ref/03-app.js` lines 665-669.
 *
 * The manual's hardest control: "No unit can be reserved or allocated twice", and "the commercial
 * team must not sell inventory that cannot be delivered". Released is what the farm interface has
 * confirmed as deliverable; everything else is computed.
 */

import type { Inventory } from "../../src/domain/types";

export const INV: Inventory = {total:208, released:96, by:"harsha", at:"21 Aug 10:40",
             src:"Farm interface — blocks A and B confirmed deliverable"};
