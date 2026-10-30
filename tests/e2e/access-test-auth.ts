import crypto from "node:crypto";
import type { BrowserContext } from "@playwright/test";

export const TEST_ACCESS_TEAM_DOMAIN = "english-sense-test.cloudflareaccess.com";
export const TEST_ACCESS_ISSUER = `https://${TEST_ACCESS_TEAM_DOMAIN}`;
export const TEST_ACCESS_AUD = "test-access-aud-english-sense";
export const TEST_ACCESS_OWNER_EMAIL = "owner@example.com";
export const TEST_ACCESS_OWNER_SUB = "sub-owner-kang-pd";
export const TEST_ACCESS_OWNER_ID = "kang-pd";

export const TEST_ACCESS_PUBLIC_JWK = {
  kty: "RSA",
  n: "plHkyVRChiWs7MgmjCRHZrvEspLDpn8Z3c2JQsaLi9a1m_dRjLB2Gw-SB8olUX4z-KbC_zpnOwo8L9Cuo1DAbVGG25pMODmqY6JOFwXhl6EgdevHJQ7N9GdLphjqhYROSQpqKObERWT_2140PxhhjII7l4rLxwgycKsQx34UIncPo3obZDpctxawefFBpUjTL8rH_tNk8Necrqwq4VJ4fnglmT-rJoC9cVNUsmJAWuYdHIY_f4_390TFvl4FEuq7Q6S3cvNhm3AR-TbaAOz7UTXzTcotvoLNcquLt0qD_26dLX40uF54hQaGk6XoFsXDtZZj0k9rPblPQw67Q2quHw",
  e: "AQAB",
  kid: "e2e-test-key-1",
  alg: "RS256",
  use: "sig",
} as const;

const TEST_ACCESS_PRIVATE_JWK = {
  kty: "RSA",
  n: "plHkyVRChiWs7MgmjCRHZrvEspLDpn8Z3c2JQsaLi9a1m_dRjLB2Gw-SB8olUX4z-KbC_zpnOwo8L9Cuo1DAbVGG25pMODmqY6JOFwXhl6EgdevHJQ7N9GdLphjqhYROSQpqKObERWT_2140PxhhjII7l4rLxwgycKsQx34UIncPo3obZDpctxawefFBpUjTL8rH_tNk8Necrqwq4VJ4fnglmT-rJoC9cVNUsmJAWuYdHIY_f4_390TFvl4FEuq7Q6S3cvNhm3AR-TbaAOz7UTXzTcotvoLNcquLt0qD_26dLX40uF54hQaGk6XoFsXDtZZj0k9rPblPQw67Q2quHw",
  e: "AQAB",
  d: "DFjJrF0qH8LzPpQF3I3Nk9BTo_1mMy7TUOvIXqHWS9gcHPXJYtwvYFyRttdTBDo4tHhOGIa8PB315Yd54huFYCLXE-gKns_qbha8nP6YRoU1H4aUfulFm85WnNV-Wia-GF5YDteWxsoJKRP_ZUGzmCvg2E6lnbhmOjFQ1REZ1eG0fG6Y8rx_ftFBposV8PJo-vf5z5ZxqX_pkVTvcfxt0AkMsLgi69MDL47gLAT__WmmvolYx7qgSnn0a3cEXm6dHLR3P_Rm9aO3WZHkHUAFgzBtEK2un-D6I_wSABaCRq0eZyRBtegzvvjt3cMDkEAB5WCd8Z2mOcu8QVNIxCuk9Q",
  p: "2AtPshXz7bhpX-LJSSzVlBDnVVPNMxGbpmEM3MIhHxHIWPk5lJqUPeIqwrwe4Dm2oP4aEMK8hYS7l2ys_WJ_k0m-XjaiwamL9TSbKzd6Jmoe2o5qodQ7GX2l6cZfEBYtYEsIEUYkDBaiEHSdg_OwETlmnqJ2SS1WIwK7Rqxm_rM",
  q: "xRReSoqLUS_oBY6-AW56WpyWtLyRZxTd1z7EGzeWmUnOvrO2Xymtz5-_bOW9lSFae9rI7uFo6z8SA2LiOo6Kqe_fLV-EjjFL4uO-8gANFn1qw9Uk-7WunahPXH5Hs3KUDBEbymyBkKrwWT_qyx2yRBi6MZ9RCKApdveNSaD_yOU",
  dp: "poEJOfo7VhITfGffs_rO3F-uuo9sjZhben4_mIAxYK2m2BO0Mfh0mcEOLakorq0sOKW91v8OpmSm40xJgruAETb7dcbr5w_RoviZQlRuWt7cypqKShC0P7Abx7EwIMjGzfjlzdJeA8cJvl7x6vlLz-qKUWZqfXlocnEvfodulYs",
  dq: "gMjAnSFPzOvrSMZwb2sMVW4CJXUb5yqBlQiVCdwXc3ABxCiXwjPwOr7_TmAKtQson8rmhwORljiOwtu5Td6bylTPmEzUyD56gnek7WsPImUugW4lTr74rlmwEpcKr77t87yyVmL1f93UVd4oxjZPqaQm-ApN378ZmX5HO5gTzek",
  qi: "auUSh6eIDP8dq0wz6oidJvjUKZMlEBi2O5-bD65NzdE9tW_wOLcnysDCQLUbcDmdMukYp2w5riafaYxu_S5-q3smCnUFuXZk_9Ly0VY6DonnOYf0Fazv62xFBm8F8j1Ke2IU69k38n0GySsB72PqOmEfGIYo6YZAzVcKrsYsbn0",
  kid: "e2e-test-key-1",
  alg: "RS256",
  use: "sig",
} as const;

const privateKeyObject = crypto.createPrivateKey({ key: TEST_ACCESS_PRIVATE_JWK, format: "jwk" });

function encodeBase64Url(value: Buffer | string): string {
  const buf = typeof value === "string" ? Buffer.from(value, "utf8") : value;
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function signTestAccessJwt(overrides: Record<string, unknown> = {}): string {
  const nowSec = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT", kid: TEST_ACCESS_PUBLIC_JWK.kid };
  const payload = {
    iss: TEST_ACCESS_ISSUER,
    aud: [TEST_ACCESS_AUD],
    email: TEST_ACCESS_OWNER_EMAIL,
    sub: TEST_ACCESS_OWNER_SUB,
    iat: nowSec - 10,
    nbf: nowSec - 10,
    exp: nowSec + 3600,
    ...overrides,
  };
  const signingInput = `${encodeBase64Url(JSON.stringify(header))}.${encodeBase64Url(JSON.stringify(payload))}`;
  const signature = crypto.sign("RSA-SHA256", Buffer.from(signingInput, "utf8"), privateKeyObject);
  return `${signingInput}.${encodeBase64Url(signature)}`;
}

export async function authenticateOwnerContext(
  context: BrowserContext,
  baseURL = "http://127.0.0.1:8787",
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const token = signTestAccessJwt(overrides);
  const url = new URL(baseURL);
  await context.addCookies([
    {
      name: "CF_Authorization",
      value: token,
      domain: url.hostname,
      path: "/",
      httpOnly: false,
      secure: false,
      sameSite: "Lax",
    },
  ]);
  return token;
}

export function wranglerTestAccessArgs(): string {
  const jwkJson = JSON.stringify({ keys: [TEST_ACCESS_PUBLIC_JWK] }).replace(/'/g, "'\\''");
  return [
    `--var CF_ACCESS_TEAM_DOMAIN:${TEST_ACCESS_TEAM_DOMAIN}`,
    `--var CF_ACCESS_AUD:${TEST_ACCESS_AUD}`,
    `--var CF_ACCESS_ALLOWED_EMAILS:${TEST_ACCESS_OWNER_EMAIL}`,
    `--var CF_ACCESS_OWNER_ID:${TEST_ACCESS_OWNER_ID}`,
    `--var 'CF_ACCESS_PUBLIC_KEY_JWK:${jwkJson}'`,
  ].join(" ");
}
