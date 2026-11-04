import { constants, openSync, closeSync, fstatSync, readSync, realpathSync } from "node:fs";
import { isAbsolute, resolve, posix, win32 } from "node:path";
import { X509Certificate, createPrivateKey } from "node:crypto";
import type { GoogleX509Credential } from "./google-x509-access-token";

export type GoogleRuntimeTarget = { application: "xkedule" | "xmartmenu"; projectId: string; projectNumber: string; production: boolean };
type Inspection = { subjectAltName?: string; ca: boolean; clientAuth: boolean; validFrom: number; validTo: number;
  keyMatches: boolean; certificate: Buffer; subjectToken: string };
type Dependencies = { read?: (path: string, maximum: number, privateKey: boolean) => Buffer;
  inspect?: (certificate: Buffer, privateKey: Buffer, chain?: Buffer) => Inspection; now?: () => number };
function unavailable(): never { throw new Error("Explicit renewable Google credentials are unavailable."); }
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
function only(value: unknown, fields: string[]): asserts value is Record<string, unknown> {
  if (!object(value) || Object.keys(value).some(key => !fields.includes(key))) unavailable();
}
function secureRead(path: string, maximum: number, privateKey: boolean): Buffer {
  const real = realpathSync(path), expected = resolve(path);
  if (!isAbsolute(path) || (process.platform === "win32" ? real.toLowerCase() !== expected.toLowerCase() : real !== expected)) unavailable();
  const descriptor = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0) | (constants.O_NONBLOCK || 0));
  try {
    const stat = fstatSync(descriptor);
    if (!stat.isFile() || stat.size < 1 || stat.size > maximum
      || (process.platform !== "win32" && (stat.mode & (privateKey ? 0o077 : 0o022)) !== 0)) unavailable();
    const bytes = Buffer.alloc(maximum + 1); let size = 0, count: number;
    do { count = readSync(descriptor, bytes, size, bytes.length - size, null); size += count; } while (count && size < bytes.length);
    if (!size || size > maximum) unavailable();
    return bytes.subarray(0, size);
  } finally { closeSync(descriptor); }
}
function pemCertificates(bytes: Buffer): string[] {
  const text = bytes.toString("utf8");
  const certificates = text.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g) ?? [];
  if (!certificates.length || text.replace(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g, "").trim()) unavailable();
  return certificates;
}
export function inspectGoogleX509(certificate: Buffer, privateKey: Buffer, trustChain?: Buffer): Inspection {
  const leafParts = pemCertificates(certificate);
  if (leafParts.length !== 1) unavailable();
  const leaf = new X509Certificate(leafParts[0]);
  let parts = trustChain ? pemCertificates(trustChain) : [];
  if (parts.length && new X509Certificate(parts[0]).fingerprint256 === leaf.fingerprint256) parts = parts.slice(1);
  const certificates = [leaf, ...parts.map(pem => new X509Certificate(pem))];
  if (certificates.length > 5 || new Set(certificates.map(cert => cert.fingerprint256)).size !== certificates.length) unavailable();
  for (let index = 1; index < certificates.length; index++) {
    const issuer = certificates[index], child = certificates[index - 1];
    if (!issuer.ca || !child.checkIssued(issuer) || !child.verify(issuer.publicKey)) unavailable();
  }
  return { subjectAltName: leaf.subjectAltName, ca: leaf.ca,
    clientAuth: leaf.keyUsage?.includes("1.3.6.1.5.5.7.3.2") === true,
    validFrom: Math.max(...certificates.map(cert => Date.parse(cert.validFrom))),
    validTo: Math.min(...certificates.map(cert => Date.parse(cert.validTo))),
    keyMatches: leaf.checkPrivateKey(createPrivateKey(privateKey)),
    certificate: Buffer.from([leafParts[0], ...parts].join("\n") + "\n"),
    subjectToken: JSON.stringify(certificates.map(cert => cert.raw.toString("base64"))) };
}

/** Explicit per-app/per-environment X.509 files only; never ambient ADC or JSON keys. */
export function readGoogleRuntimeAdc(target: GoogleRuntimeTarget, env: Record<string, string | undefined> = process.env,
  { read = secureRead, inspect = inspectGoogleX509, now = Date.now }: Dependencies = {}): GoogleX509Credential {
  try {
    const { application, projectId, projectNumber, production } = target;
    if (!["xkedule", "xmartmenu"].includes(application) || !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId)
      || !/^[1-9]\d{5,19}$/.test(projectNumber) || production !== (env.NODE_ENV === "production")) unavailable();
    if (!production && (projectId === "skaleclub" || projectNumber === "937861185231"
      || projectId === env.GOOGLE_AUTH_PROJECT_ID || projectNumber === env.GOOGLE_AUTH_PROJECT_NUMBER)) unavailable();
    const prefix = production ? "GOOGLE_AUTH" : "DEV_GOOGLE_AUTH";
    const selectedId = production ? env.GOOGLE_AUTH_PROJECT_ID || "skaleclub" : env.DEV_GOOGLE_AUTH_PROJECT_ID;
    const selectedNumber = production ? env.GOOGLE_AUTH_PROJECT_NUMBER || (selectedId === "skaleclub" ? "937861185231" : "") : env.DEV_GOOGLE_AUTH_PROJECT_NUMBER;
    if (projectId !== selectedId || projectNumber !== selectedNumber) unavailable();
    const base = production ? `/run/secrets/${application}-google-identity` : env.DEV_GOOGLE_AUTH_ADC_ROOT;
    if (!base || base.includes("\0") || /^[/\\]{2}/.test(base)) unavailable();
    const paths = /^[A-Za-z]:[\\/]/.test(base) ? win32 : posix;
    if (!paths.isAbsolute(base) || paths.normalize(base) !== base || (paths === posix && base.includes("\\"))) unavailable();
    if (!production && base.replaceAll("\\", "/").split("/").slice(-3).join("/") !== `${application}-google-identity/development/${projectId}`) unavailable();
    const audience = `//iam.googleapis.com/projects/${projectNumber}/locations/global/workloadIdentityPools/hetzner-${application}/providers/x509`;
    const serviceAccountEmail = `${application}-firebase-auth-reader@${projectId}.iam.gserviceaccount.com`;
    const subject = `spiffe://skale.club/apps/${application}/${production ? "production" : `development/${projectId}`}`;
    const adcFile = env[`${prefix}_ADC_FILE`];
    if (adcFile !== paths.join(base, "adc.json") || env[`${prefix}_ADC_AUDIENCE`] !== audience
      || env[`${prefix}_ADC_SERVICE_ACCOUNT`] !== serviceAccountEmail || env[`${prefix}_ADC_SUBJECT`] !== subject) unavailable();
    const path = (value: unknown): string => {
      if (typeof value !== "string" || !paths.isAbsolute(value) || value.length > 1024 || value.includes("\0")
        || paths.normalize(value) !== value || (paths === posix && value.includes("\\"))) unavailable();
      const relative = paths.relative(base, value);
      if (!relative || relative === ".." || relative.startsWith(".." + paths.sep) || paths.isAbsolute(relative)) unavailable();
      return value;
    };
    const readChecked = (file: string, maximum: number, secret = false) => {
      const bytes = read(path(file), maximum, secret);
      if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > maximum) unavailable();
      return bytes;
    };
    const adc: unknown = JSON.parse(readChecked(adcFile, 65_536).toString("utf8"));
    only(adc, ["type", "audience", "subject_token_type", "token_url", "service_account_impersonation_url", "service_account_impersonation", "credential_source", "universe_domain"]);
    if (adc.type !== "external_account" || adc.audience !== audience || adc.subject_token_type !== "urn:ietf:params:oauth:token-type:mtls"
      || adc.token_url !== "https://sts.mtls.googleapis.com/v1/token"
      || adc.service_account_impersonation_url !== `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${serviceAccountEmail}:generateAccessToken`
      || (adc.universe_domain !== undefined && adc.universe_domain !== "googleapis.com")) unavailable();
    if (adc.service_account_impersonation !== undefined) {
      only(adc.service_account_impersonation, ["token_lifetime_seconds"]);
      if (adc.service_account_impersonation.token_lifetime_seconds !== 600) unavailable();
    }
    only(adc.credential_source, ["certificate"]);
    const source = adc.credential_source.certificate;
    only(source, ["certificate_config_location", "trust_chain_path", "use_default_certificate_config"]);
    if (source.certificate_config_location !== paths.join(base, "certificate-config.json")
      || (source.use_default_certificate_config !== undefined && source.use_default_certificate_config !== false)) unavailable();
    const certificateConfig: unknown = JSON.parse(readChecked(path(source.certificate_config_location), 16_384).toString("utf8"));
    only(certificateConfig, ["version", "cert_configs"]);
    if (certificateConfig.version !== undefined && certificateConfig.version !== 1) unavailable();
    only(certificateConfig.cert_configs, ["workload"]);
    const workload = certificateConfig.cert_configs.workload;
    only(workload, ["cert_path", "key_path"]);
    const certPath = path(workload.cert_path), keyPath = path(workload.key_path);
    if (certPath !== paths.join(base, "client.crt") || keyPath !== paths.join(base, "client.key")
      || (source.trust_chain_path !== undefined && source.trust_chain_path !== paths.join(base, "trust-chain.pem"))) unavailable();
    const certificate = readChecked(certPath, 32_768), privateKey = readChecked(keyPath, 32_768, true);
    const chain = source.trust_chain_path === undefined ? undefined : readChecked(path(source.trust_chain_path), 131_072);
    const checked = inspect(certificate, privateKey, chain);
    const time = now();
    if (checked.subjectAltName !== `URI:${subject}` || checked.ca || !checked.clientAuth || !checked.keyMatches
      || !Number.isFinite(checked.validFrom) || !Number.isFinite(checked.validTo) || checked.validFrom > time || checked.validTo <= time
      || checked.validTo <= checked.validFrom) unavailable();
    return { audience, serviceAccountEmail, certificate: checked.certificate, privateKey, subjectToken: checked.subjectToken };
  } catch { return unavailable(); }
}
