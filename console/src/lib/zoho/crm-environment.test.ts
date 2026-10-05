/* ZOHO_CRM_ENVIRONMENT — the CRM API origin a token is sent to (sandbox staging, Kaizen #120).
   Production: the token's api_domain on a www.zohoapis.* host, sandbox hosts refused (today's behaviour).
   Sandbox: https://sandbox.zohoapis.<same dc>, derived from the api_domain; www hosts refused as an origin. */
import { describe, expect, it } from "vitest";
import { apiDomainOf, crmApiOriginOf, crmEnvironment, expectedCrmOrgId, orgIdOfOrgResponse, serviceCredential } from "./client";

const SANDBOX = { ZOHO_CRM_ENVIRONMENT: "sandbox", ZOHO_EXPECTED_ORG_ID: "60090668120" };
const PROD = {};

describe("crmEnvironment / expectedCrmOrgId", () => {
  it("unset is production; sandbox is sandbox; anything else is refused", () => {
    expect(crmEnvironment({})).toBe("production");
    expect(crmEnvironment({ ZOHO_CRM_ENVIRONMENT: "production" })).toBe("production");
    expect(crmEnvironment({ ZOHO_CRM_ENVIRONMENT: "sandbox" })).toBe("sandbox");
    expect(() => crmEnvironment({ ZOHO_CRM_ENVIRONMENT: "staging" })).toThrow(/production" or "sandbox/);
  });
  it("expected org: required in sandbox, optional but honoured in production, digits only", () => {
    expect(expectedCrmOrgId({})).toBeNull();
    expect(expectedCrmOrgId({ ZOHO_EXPECTED_ORG_ID: "60061770791" })).toBe("60061770791");
    expect(expectedCrmOrgId(SANDBOX)).toBe("60090668120");
    expect(() => expectedCrmOrgId({ ZOHO_CRM_ENVIRONMENT: "sandbox" })).toThrow(/required/);
    expect(() => expectedCrmOrgId({ ZOHO_EXPECTED_ORG_ID: "org-1" })).toThrow(/numeric/);
  });
});

describe("crmApiOriginOf / apiDomainOf", () => {
  it("sandbox derives sandbox.zohoapis.<dc> for .in and .com (and keeps a sandbox api_domain)", () => {
    expect(crmApiOriginOf("https://www.zohoapis.in", SANDBOX)).toBe("https://sandbox.zohoapis.in");
    expect(crmApiOriginOf("https://www.zohoapis.com", SANDBOX)).toBe("https://sandbox.zohoapis.com");
    expect(crmApiOriginOf("https://www.zohoapis.com.au/", SANDBOX)).toBe("https://sandbox.zohoapis.com.au");
    expect(crmApiOriginOf("https://sandbox.zohoapis.in", SANDBOX)).toBe("https://sandbox.zohoapis.in");
  });
  it("production refuses a sandbox host", () => {
    expect(() => apiDomainOf("https://sandbox.zohoapis.in", PROD)).toThrow(/Zoho API host/);
    expect(() => crmApiOriginOf("https://sandbox.zohoapis.in", PROD)).toThrow(/Zoho API host/);
  });
  it("sandbox refuses a www host as an origin", () => {
    expect(() => apiDomainOf("https://www.zohoapis.in", SANDBOX)).toThrow(/Zoho API host/);
  });
  it("lookalikes stay refused in both modes", () => {
    for (const env of [PROD, SANDBOX]) {
      expect(() => crmApiOriginOf("https://sandbox.zohoapis.in.evil.example", env)).toThrow();
      expect(() => crmApiOriginOf("http://www.zohoapis.in", env)).toThrow();
      expect(() => crmApiOriginOf("https://www.zohoapis.in/crm", env)).toThrow();
    }
  });
  it("unset env = the old behaviour: the www api_domain as is", () => {
    expect(crmApiOriginOf("https://www.zohoapis.in", PROD)).toBe("https://www.zohoapis.in");
    expect(apiDomainOf("https://WWW.zohoapis.com", PROD)).toBe("https://www.zohoapis.com");
  });
  it("a minted credential takes the process environment's origin", () => {
    const grant = { access_token: "synthetic-never-live", api_domain: "https://www.zohoapis.in", expires_in: 3600 };
    const before = { ...process.env };
    try {
      delete process.env.ZOHO_CRM_ENVIRONMENT;
      expect(serviceCredential("audit-archive", grant, 1).apiDomain).toBe("https://www.zohoapis.in");
      process.env.ZOHO_CRM_ENVIRONMENT = "sandbox";
      expect(serviceCredential("audit-archive", grant, 1).apiDomain).toBe("https://sandbox.zohoapis.in");
    } finally {
      process.env.ZOHO_CRM_ENVIRONMENT = before.ZOHO_CRM_ENVIRONMENT;
      if (before.ZOHO_CRM_ENVIRONMENT === undefined) delete process.env.ZOHO_CRM_ENVIRONMENT;
    }
  });
});

describe("orgIdOfOrgResponse (GET /crm/v8/org)", () => {
  it("reads org[0].zgid as a string, id only when zgid is missing", () => {
    expect(orgIdOfOrgResponse({ org: [{ id: "111", zgid: "60090668120" }] })).toBe("60090668120");
    expect(orgIdOfOrgResponse({ org: [{ zgid: 60090668120 }] })).toBe("60090668120");
    expect(orgIdOfOrgResponse({ org: [{ id: "60090668120" }] })).toBe("60090668120");
    expect(orgIdOfOrgResponse({ org: [] })).toBeNull();
    expect(orgIdOfOrgResponse({ org: [{ zgid: "abc", id: "60090668120" }] })).toBeNull();
  });
});
