/**
 * ZOHO CURRENTUSER -> CONSOLE SEAT
 *
 * M03-S05 / D52 / D53. A seat is derived only from the user authenticated by Zoho. Callers
 * cannot supply a person, role or profile. Role/profile names are checked exactly against D80 and
 * their immutable per-org ids are pinned from sanitized Zoho exports. Unknown roles, name drift,
 * profile drift and non-human Zoho user types fail closed.
 *
 * This module does not fetch or cache. The OAuth callback owns the one bounded CurrentUser request
 * and gives its decoded body to this resolver before it creates a session. A fresh sign-in therefore
 * observes a role change without a user-keyed seat cache.
 *
 * D80 has no Farm Operations role/profile, so none is guessed here. In particular, Channel Partner
 * is never treated as Farm Operations. CLAUDE.md also prohibits every Administrator token in the
 * application, so the two D80 role/profile pairs that currently use Administrator are mapped for
 * drift detection but refused for admission until the owner resolves that contradiction.
 */

export type ZohoSeat =
  | "corporate-root"
  | "business-unit-owner"
  | "digital-infrastructure"
  | "ir-manager"
  | "investor-relations"
  | "channel-partner"
  | "head-of-finance"
  | "finance-operations"
  | "compliance-audit"
  | "head-of-account-management"
  | "key-account-manager"
  | "viewer";

export type ZohoRoleName =
  | "CEO"
  | "BU Owner"
  | "Digital Infrastructure"
  | "IR Manager"
  | "Investor Relations"
  | "Channel Partner"
  | "Head of Finance"
  | "Finance Operations"
  | "Compliance and Audit"
  | "Head of Account Management"
  | "Key Account Manager"
  | "Exec";

export type ZohoProfileName =
  | "Administrator"
  | "Leadership"
  | "IR Manager"
  | "IR"
  | "Channel Partner"
  | "Finance Head"
  | "Finance Ops"
  | "Compliance & Audit"
  | "AM Head"
  | "KAM"
  | "Viewer";

interface SeatPolicy {
  readonly seat: ZohoSeat;
  readonly profile: ZohoProfileName;
  readonly administrator: boolean;
}

/** Exact applied role names from D80; profile names are the approved D78 access plan. */
export const ZOHO_SEAT_POLICIES: Readonly<Record<ZohoRoleName, SeatPolicy>> = Object.freeze({
  CEO: Object.freeze({ seat: "corporate-root", profile: "Administrator", administrator: true }),
  "BU Owner": Object.freeze({ seat: "business-unit-owner", profile: "Leadership", administrator: false }),
  "Digital Infrastructure": Object.freeze({ seat: "digital-infrastructure", profile: "Administrator", administrator: true }),
  "IR Manager": Object.freeze({ seat: "ir-manager", profile: "IR Manager", administrator: false }),
  "Investor Relations": Object.freeze({ seat: "investor-relations", profile: "IR", administrator: false }),
  "Channel Partner": Object.freeze({ seat: "channel-partner", profile: "Channel Partner", administrator: false }),
  "Head of Finance": Object.freeze({ seat: "head-of-finance", profile: "Finance Head", administrator: false }),
  "Finance Operations": Object.freeze({ seat: "finance-operations", profile: "Finance Ops", administrator: false }),
  "Compliance and Audit": Object.freeze({ seat: "compliance-audit", profile: "Compliance & Audit", administrator: false }),
  "Head of Account Management": Object.freeze({ seat: "head-of-account-management", profile: "AM Head", administrator: false }),
  "Key Account Manager": Object.freeze({ seat: "key-account-manager", profile: "KAM", administrator: false }),
  Exec: Object.freeze({ seat: "viewer", profile: "Viewer", administrator: false }),
});

export type SeatRefusalReason =
  | "malformed"
  | "foreign-org"
  | "inactive"
  | "unconfirmed"
  | "unsupported-user-type"
  | "unknown-role"
  | "role-binding-mismatch"
  | "profile-mismatch"
  | "administrator-profile";

export interface SeatedZohoUser {
  readonly userId: string;
  readonly roleId: string;
  readonly profileId: string;
  readonly seat: ZohoSeat;
}

export type SeatResolution =
  | { readonly ok: true; readonly value: SeatedZohoUser }
  | { readonly ok: false; readonly reason: SeatRefusalReason };

export interface ZohoSeatDirectory {
  readonly resolveCurrentUser: (body: unknown) => SeatResolution;
  /**
   * M03-S02: the same checks for a user looked up by id (GET /users/{id}) — to bound a grant by the
   * holder's seat and manager chain — except that an Administrator-profile seat (CEO, Digital
   * Infrastructure) is still named: it is a manager in the chain, never a sign-in. Optional so test
   * doubles that only resolve the CurrentUser stay valid; absent = fail closed.
   */
  readonly resolveDirectoryUser?: (body: unknown) => SeatResolution;
  /**
   * M03-S04-T02: the pinned role and profile (ids and exact names) a seat change writes to Zoho Users.
   * null for an Administrator-profile seat — nobody is ever moved INTO one by the console.
   */
  readonly seatWrite?: (seat: ZohoSeat) => { readonly roleId: string; readonly roleName: ZohoRoleName; readonly profileId: string; readonly profileName: ZohoProfileName } | null;
}

export interface ZohoSeatDirectoryConfig {
  /** Stable numeric prefix shared by record, user, role and profile ids in this CRM org. */
  readonly recordIdPrefix: string;
  /** Ids exported from GET /settings/roles; keys are exact D80 role names. */
  readonly roleIds: Readonly<Record<ZohoRoleName, string>>;
  /** Ids exported from GET /settings/profiles; keys are exact approved profile names. */
  readonly profileIds: Readonly<Record<ZohoProfileName, string>>;
  /** Sandbox deployments only (ZOHO_CRM_ENVIRONMENT=sandbox): users added to a Zoho sandbox carry
      type__s "Sandbox Developer User", not "Regular User". Production never sets this. */
  readonly sandbox?: boolean;
}

type Obj = Readonly<Record<string, unknown>>;
const RECORD_ID = /^\d{15,25}$/;
const RECORD_PREFIX = /^\d{6,16}$/;
const MISSING = Symbol("missing own data property");
const ROLE_NAMES = Object.freeze(Object.keys(ZOHO_SEAT_POLICIES) as ZohoRoleName[]);
const PROFILE_NAMES = Object.freeze([...new Set(ROLE_NAMES.map((name) => ZOHO_SEAT_POLICIES[name].profile))]);

function objectOf(value: unknown): Obj | null {
  try {
    return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Obj : null;
  } catch {
    // Array.isArray throws for a revoked Proxy; decoded JSON never does.
    return null;
  }
}

const own = (value: object, key: PropertyKey): boolean => Object.prototype.hasOwnProperty.call(value, key);

/** JSON.parse creates own data properties. Inherited values and accessors are never source facts. */
function ownData(value: object, key: string): unknown | typeof MISSING {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor !== undefined && own(descriptor, "value") ? descriptor.value : MISSING;
  } catch {
    // A hostile Proxy is not a decoded Zoho JSON object.
    return MISSING;
  }
}

function onlyOwnArrayItem(value: unknown): unknown | typeof MISSING {
  try {
    if (!Array.isArray(value) || ownData(value, "length") !== 1) return MISSING;
    return ownData(value, "0");
  } catch {
    // Array.isArray throws for a revoked Proxy.
    return MISSING;
  }
}

function isRoleName(value: unknown): value is ZohoRoleName {
  return typeof value === "string" && own(ZOHO_SEAT_POLICIES, value);
}

function assertPinnedIds(
  values: unknown,
  names: readonly string[],
  prefix: string,
  kind: "role" | "profile",
): Readonly<Record<string, string>> {
  const source = objectOf(values);
  if (source === null) throw new TypeError(`Zoho ${kind} ids must come from a sanitized settings export.`);
  const expected = new Set(names);
  if (Object.keys(source).length !== expected.size || Object.keys(source).some((name) => !expected.has(name))) {
    throw new TypeError(`Zoho ${kind} ids must contain exactly the approved ${kind} names.`);
  }
  const seen = new Map<string, string>();
  const pinned: Record<string, string> = {};
  for (const name of names) {
    const id = source[name];
    if (typeof id !== "string" || !RECORD_ID.test(id) || !id.startsWith(prefix)) {
      throw new TypeError(`Zoho ${kind} ids must be string ids from the configured CRM org.`);
    }
    const prior = seen.get(id);
    // One profile may intentionally serve two roles (Administrator today). Role ids may not alias.
    if (prior !== undefined && (kind === "role" || prior !== name)) {
      if (kind === "role") throw new TypeError("Zoho role ids must be unique.");
      const sameName = prior === name;
      if (!sameName) throw new TypeError("One Zoho profile id cannot name two approved profiles.");
    }
    seen.set(id, name);
    pinned[name] = id;
  }
  return Object.freeze(pinned);
}

/**
 * Builds the fail-closed directory once from sanitized, environment-specific role/profile ids.
 * It intentionally has no default ids: a missing export cannot degrade to trusting a mutable name.
 */
export function createZohoSeatDirectory(config: ZohoSeatDirectoryConfig): ZohoSeatDirectory {
  if (typeof config !== "object" || config === null || !RECORD_PREFIX.test(config.recordIdPrefix)) {
    throw new TypeError("Zoho seat recordIdPrefix must be 6–16 digits from this CRM org.");
  }
  const prefix = config.recordIdPrefix;
  const roleIds = assertPinnedIds(config.roleIds, ROLE_NAMES, prefix, "role");
  const profileIds = assertPinnedIds(config.profileIds, PROFILE_NAMES, prefix, "profile");

  function resolve(body: unknown, allowAdministrator: boolean): SeatResolution {
      const root = objectOf(body);
      const users = root === null ? MISSING : ownData(root, "users");
      const current = objectOf(onlyOwnArrayItem(users));
      if (current === null) return { ok: false, reason: "malformed" };

      const userId = ownData(current, "id");
      if (typeof userId !== "string" || !RECORD_ID.test(userId)) return { ok: false, reason: "malformed" };
      if (!userId.startsWith(prefix)) return { ok: false, reason: "foreign-org" };
      if (ownData(current, "status") !== "active") return { ok: false, reason: "inactive" };
      if (ownData(current, "confirm") !== true) return { ok: false, reason: "unconfirmed" };
      const userType = ownData(current, "type__s");
      if (userType !== "Regular User" && !(config.sandbox === true && userType === "Sandbox Developer User")) {
        return { ok: false, reason: "unsupported-user-type" };
      }

      const role = objectOf(ownData(current, "role"));
      const profile = objectOf(ownData(current, "profile"));
      const roleId = role === null ? MISSING : ownData(role, "id");
      const roleName = role === null ? MISSING : ownData(role, "name");
      const profileId = profile === null ? MISSING : ownData(profile, "id");
      const profileName = profile === null ? MISSING : ownData(profile, "name");
      if (role === null || profile === null
        || typeof roleId !== "string" || !RECORD_ID.test(roleId)
        || typeof roleName !== "string"
        || typeof profileId !== "string" || !RECORD_ID.test(profileId)
        || typeof profileName !== "string") {
        return { ok: false, reason: "malformed" };
      }
      if (!roleId.startsWith(prefix) || !profileId.startsWith(prefix)) {
        return { ok: false, reason: "foreign-org" };
      }
      if (!isRoleName(roleName)) return { ok: false, reason: "unknown-role" };

      const policy = ZOHO_SEAT_POLICIES[roleName];
      if (roleIds[roleName] !== roleId) return { ok: false, reason: "role-binding-mismatch" };
      if (profileName !== policy.profile || profileIds[policy.profile] !== profileId) {
        return { ok: false, reason: "profile-mismatch" };
      }
      if (policy.administrator && !allowAdministrator) return { ok: false, reason: "administrator-profile" };

      return {
        ok: true,
        value: Object.freeze({ userId, roleId, profileId, seat: policy.seat }),
      };
  }

  return Object.freeze({
    resolveCurrentUser: (body: unknown): SeatResolution => resolve(body, false),
    resolveDirectoryUser: (body: unknown): SeatResolution => resolve(body, true),
    seatWrite: (seat: ZohoSeat) => {
      const roleName = ROLE_NAMES.find((n) => ZOHO_SEAT_POLICIES[n].seat === seat);
      if (!roleName || ZOHO_SEAT_POLICIES[roleName].administrator) return null;
      const profileName = ZOHO_SEAT_POLICIES[roleName].profile;
      return Object.freeze({ roleId: roleIds[roleName]!, roleName, profileId: profileIds[profileName]!, profileName });
    },
  });
}
