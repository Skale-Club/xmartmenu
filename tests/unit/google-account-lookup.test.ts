import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { createGoogleAccountLookup } from "../../src/lib/auth/google-account-lookup";

const identity = { projectId: "identity-development", subject: "exact-user" };
describe("single shared Google liveness deadline", () => {
  it("shares the credential deadline with the exact UID lookup and sanitized bounded response", async () => {
    let credentialSignal: AbortSignal | undefined;
    const lookup = createGoogleAccountLookup(async (input, signal) => { assert.deepEqual(input, identity); credentialSignal = signal; return "opaque-access"; },
      async (url, init) => {
        assert.equal(url, `https://identitytoolkit.googleapis.com/v1/projects/${identity.projectId}/accounts:lookup`);
        assert.equal(init?.signal, credentialSignal); assert.equal(init?.redirect, "error"); assert.equal(init?.cache, "no-store");
        assert.deepEqual(JSON.parse(String(init?.body)), { localId: [identity.subject] });
        return Response.json({ users: [{ localId: identity.subject, validSince: "123" }] });
      });
    assert.deepEqual(await lookup(identity), { disabled: false, validSince: 123 }); assert.equal(credentialSignal?.aborted, true);
  });
  it("aborts credential work on the shared total deadline and never starts the lookup", async () => {
    let requestCalls = 0, observedAbort = false;
    const lookup = createGoogleAccountLookup((_identity, signal) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => { observedAbort = true; reject(new Error("provider-secret")); }, { once: true });
    }), async () => { requestCalls++; throw new Error(); }, 10);
    await assert.rejects(lookup(identity), /Identity provider account status unavailable/);
    assert.equal(observedAbort, true); assert.equal(requestCalls, 0);
  });
  it("does not restart the budget for the final API response", async () => {
    let observedAbort = false;
    const lookup = createGoogleAccountLookup(async () => "opaque-access", async (_url, options) => new Promise((_resolve, reject) => {
      options!.signal!.addEventListener("abort", () => { observedAbort = true; reject(new Error("provider-secret")); }, { once: true });
    }), 10);
    await assert.rejects(lookup(identity), /Identity provider account status unavailable/); assert.equal(observedAbort, true);
  });
  it("rejects oversized bodies even when cancellation never settles", async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(65_537)); }, cancel() { cancelled = true; return new Promise(() => {}); } });
    const lookup = createGoogleAccountLookup(async () => "opaque-access", async () => new Response(stream), 100);
    await assert.rejects(lookup(identity), /Identity provider account status unavailable/); assert.equal(cancelled, true);
  });
  it("refuses ambiguous/other-subject/malformed accounts, redirects and raw provider failures", async () => {
    for (const body of [{ users: [] }, { users: [{ localId: "different" }] }, { users: [{ localId: identity.subject }, { localId: identity.subject }] },
      { users: [{ localId: identity.subject, disabled: "false" }] }, { users: [{ localId: identity.subject, validSince: "1e3" }] },
      { users: [{ localId: identity.subject, tenantId: "other-tenant" }] }]) {
      await assert.rejects(createGoogleAccountLookup(async () => "opaque-access", async () => Response.json(body))(identity), /Identity provider account status unavailable/);
    }
    await assert.rejects(createGoogleAccountLookup(async () => { throw new Error("provider-secret"); })(identity), error => error instanceof Error && !error.message.includes("secret"));
    await assert.rejects(createGoogleAccountLookup(async () => "opaque-access", async () => new Response("provider-secret", { status: 302 }))(identity));
  });
});
