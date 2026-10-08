/* Test signing (sandbox only, server/zoho-sign/fake.ts): when the send panel's prefill says the deployment signs with the
   fake (ZOHO_SIGN_MODE=fake), this marker sits on the panel so nobody takes a test send for a real one. Nothing is emailed
   and nothing reaches Zoho Sign; the tester marks it signed with POST /api/test/sign/complete. */

export function TestSigningMark({ on }: { on: boolean | undefined }) {
  if (!on) return null;
  return (
    <div className="note warn" role="note" data-testid="test-signing-mark" style={{ marginBottom: 12 }}>
      <b>Test signing (sandbox).</b> Nothing is emailed and nothing goes to Zoho Sign; a tester marks it signed.
    </div>
  );
}
