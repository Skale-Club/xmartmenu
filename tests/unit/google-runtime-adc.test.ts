import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { posix, win32 } from "node:path";
import { readGoogleRuntimeAdc, type GoogleRuntimeTarget } from "../../src/lib/auth/google-runtime-adc";

function fixture(application: GoogleRuntimeTarget["application"] = "xkedule", production = false, windows = false) {
  const target = { application, production, projectId: production ? "skaleclub" : "identity-development", projectNumber: production ? "937861185231" : "123456789012" };
  const prefix = production ? "GOOGLE_AUTH" : "DEV_GOOGLE_AUTH";
  const paths = windows ? win32 : posix;
  const base = production ? `/run/secrets/${application}-google-identity` : windows
    ? `C:\\runtime-secrets\\${application}-google-identity\\development\\${target.projectId}`.replaceAll("\\\\", "\\")
    : `/tmp/runtime-secrets/${application}-google-identity/development/${target.projectId}`;
  const audience = `//iam.googleapis.com/projects/${target.projectNumber}/locations/global/workloadIdentityPools/hetzner-${application}/providers/x509`;
  const serviceAccountEmail = `${application}-firebase-auth-reader@${target.projectId}.iam.gserviceaccount.com`;
  const subject = `spiffe://skale.club/apps/${application}/${production ? "production" : `development/${target.projectId}`}`;
  const env: Record<string, string | undefined> = { NODE_ENV: production ? "production" : "development", GOOGLE_AUTH_PROJECT_ID: "skaleclub", GOOGLE_AUTH_PROJECT_NUMBER: "937861185231",
    DEV_GOOGLE_AUTH_PROJECT_ID: target.projectId, DEV_GOOGLE_AUTH_PROJECT_NUMBER: target.projectNumber,
    DEV_GOOGLE_AUTH_ADC_ROOT: base, [`${prefix}_ADC_FILE`]: paths.join(base, "adc.json"), [`${prefix}_ADC_AUDIENCE`]: audience,
    [`${prefix}_ADC_SERVICE_ACCOUNT`]: serviceAccountEmail, [`${prefix}_ADC_SUBJECT`]: subject,
    GOOGLE_APPLICATION_CREDENTIALS: "/ambient/key-must-never-be-read.json" };
  const adc = { type: "external_account", audience, subject_token_type: "urn:ietf:params:oauth:token-type:mtls", token_url: "https://sts.mtls.googleapis.com/v1/token",
    service_account_impersonation_url: `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${serviceAccountEmail}:generateAccessToken`,
    service_account_impersonation: { token_lifetime_seconds: 600 }, credential_source: { certificate: {
      certificate_config_location: paths.join(base, "certificate-config.json"), trust_chain_path: paths.join(base, "trust-chain.pem") } } };
  const config = { version: 1, cert_configs: { workload: { cert_path: paths.join(base, "client.crt"), key_path: paths.join(base, "client.key") } } };
  const state = { reads: [] as Array<{ path: string; secret: boolean }>, inspections: 0, failure: false };
  const inspection = { subjectAltName: `URI:${subject}`, ca: false, clientAuth: true, validFrom: 1_000, validTo: 30_000, keyMatches: true,
    certificate: Buffer.from("adapter-public-certificate"), subjectToken: JSON.stringify([Buffer.from("adapter-public-der").toString("base64")]) };
  const read = (path: string, _maximum: number, secret: boolean) => {
    state.reads.push({ path, secret }); if (state.failure) throw new Error("credential-secret-never-output");
    if (path === env[`${prefix}_ADC_FILE`]) return Buffer.from(JSON.stringify(adc));
    if (path === adc.credential_source.certificate.certificate_config_location) return Buffer.from(JSON.stringify(config));
    return Buffer.from(secret ? "adapter-key-not-a-credential" : "adapter-public-material");
  };
  const inspect = () => { state.inspections++; return inspection; };
  return { target, prefix, base, paths, env, adc, config, state, inspection, run: () => readGoogleRuntimeAdc(target, env, { read, inspect, now: () => 10_000 }) };
}

describe("explicit per-application renewable X.509 credentials", () => {
  for (const application of ["xkedule", "xmartmenu"] as const) for (const production of [true, false]) {
    it(`accepts only the configured ${application} ${production ? "production" : "development"} tuple`, () => {
      const f = fixture(application, production); const result = f.run();
      assert.equal(result.audience, f.adc.audience); assert.equal(result.serviceAccountEmail, f.env[`${f.prefix}_ADC_SERVICE_ACCOUNT`]);
      assert.equal(f.state.inspections, 1); assert.equal(f.state.reads.filter(read => read.secret).length, 1);
      assert.ok(f.state.reads.every(read => read.path.startsWith(f.base)));
      assert.ok(!JSON.stringify(result).includes("ambient/key"));
    });
  }
  it("requires an explicit native Windows DEV root confined to this app/project", () => {
    const f = fixture("xkedule", false, true); assert.ok(f.run());
    assert.ok(f.state.reads.every(read => read.path.startsWith("C:\\runtime-secrets\\")));
    f.config.cert_configs.workload.key_path = "C:\\runtime-secrets\\production\\client.key";
    assert.throws(f.run, /Explicit renewable Google credentials are unavailable/);
  });
  it("never inherits production or ambient ADC when DEV config is absent or copied", () => {
    for (const field of ["ADC_FILE", "ADC_AUDIENCE", "ADC_SERVICE_ACCOUNT", "ADC_SUBJECT"] as const) {
      const f = fixture(); f.env[`GOOGLE_AUTH_${field}`] = f.env[`DEV_GOOGLE_AUTH_${field}`]; delete f.env[`DEV_GOOGLE_AUTH_${field}`];
      assert.throws(f.run); assert.equal(f.state.reads.length, 0);
    }
    const f = fixture(); delete f.env.DEV_GOOGLE_AUTH_ADC_ROOT;
    assert.throws(f.run); assert.equal(f.state.reads.length, 0);
  });
  it("rejects another application, project, environment, provider or service account before credential use", () => {
    for (const change of ["app", "project", "number", "audience", "provider", "serviceAccount", "subject"] as const) {
      const f = fixture();
      if (change === "app") f.target.application = "xmartmenu";
      if (change === "project") f.target.projectId = "skaleclub";
      if (change === "number") f.target.projectNumber = "937861185231";
      if (change === "audience") f.env.DEV_GOOGLE_AUTH_ADC_AUDIENCE = f.adc.audience.replace("hetzner-xkedule", "codex-xkedule");
      if (change === "provider") f.adc.audience = f.adc.audience.replace("/x509", "/openai");
      if (change === "serviceAccount") f.adc.service_account_impersonation_url = f.adc.service_account_impersonation_url.replace("xkedule-firebase-auth-reader", "codex-xkedule-auth-reader");
      if (change === "subject") f.env.DEV_GOOGLE_AUTH_ADC_SUBJECT = "spiffe://skale.club/apps/xkedule/production";
      assert.throws(f.run); assert.equal(f.state.inspections, 0);
    }
  });
  it("rejects keys, authorized-user credentials, URL/executable/file sources and unknown fields", () => {
    for (const kind of ["service_account", "authorized_user", "private_key", "refresh_token", "url", "file", "executable", "default", "token_url", "lifetime"] as const) {
      const f = fixture();
      if (["service_account", "authorized_user"].includes(kind)) f.adc.type = kind;
      else if (kind === "token_url") f.adc.token_url = "https://sts.googleapis.com/v1/token";
      else if (kind === "lifetime") f.adc.service_account_impersonation.token_lifetime_seconds = 3600;
      else if (["private_key", "refresh_token"].includes(kind)) Object.assign(f.adc, { [kind]: "credential-secret-never-output" });
      else if (kind === "default") Object.assign(f.adc.credential_source.certificate, { use_default_certificate_config: true });
      else Object.assign(f.adc.credential_source, { [kind]: "credential-secret-never-output" });
      assert.throws(f.run, error => error instanceof Error && !error.message.includes("secret")); assert.equal(f.state.inspections, 0);
    }
  });
  it("confines every certificate/key/config path and rejects traversal or production mounts in DEV", () => {
    for (const path of ["/run/secrets/xkedule-google-identity/client.key", "/tmp/runtime-secrets/xkedule-google-identity/development/identity-development/../client.key",
      "/tmp/runtime-secrets/xkedule-google-identity/development/identity-development//client.key", "https://attacker.example/key", "relative.key"]) {
      const f = fixture(); f.config.cert_configs.workload.key_path = path; assert.throws(f.run); assert.equal(f.state.inspections, 0);
    }
    const f = fixture("xkedule", false, true); f.env.DEV_GOOGLE_AUTH_ADC_ROOT = "\\\\host\\share\\xkedule-google-identity\\development\\identity-development";
    assert.throws(f.run); assert.equal(f.state.reads.length, 0);
  });
  it("requires a unique exact SAN URI, active client leaf, valid dates and matching private key", () => {
    for (const change of ["san", "duplicate", "missing", "ca", "clientAuth", "future", "expired", "key"] as const) {
      const f = fixture();
      if (change === "san") f.inspection.subjectAltName = "URI:spiffe://skale.club/apps/xkedule/production";
      if (change === "duplicate") f.inspection.subjectAltName += ", URI:spiffe://other/subject";
      if (change === "missing") f.inspection.subjectAltName = "";
      if (change === "ca") f.inspection.ca = true;
      if (change === "clientAuth") f.inspection.clientAuth = false;
      if (change === "future") f.inspection.validFrom = 20_000;
      if (change === "expired") f.inspection.validTo = 9_000;
      if (change === "key") f.inspection.keyMatches = false;
      assert.throws(f.run);
    }
  });
  it("re-reads credentials each time and sanitizes filesystem/key failures without output", () => {
    const f = fixture(); f.run(); f.inspection.keyMatches = false; assert.throws(f.run);
    assert.equal(f.state.inspections, 2);
    f.state.failure = true;
    assert.throws(f.run, error => error instanceof Error && !error.message.includes("credential-secret"));
  });
});
