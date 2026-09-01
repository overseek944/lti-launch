import { exportJWK, generateKeyPair, importJWK, type JWK, type KeyLike } from "jose";
import type { Bindings } from "../types.js";

/**
 * The tool's signing key.
 *
 * RS256 because that is what LTI 1.3 platforms expect; several will not accept
 * an EC key. The key is generated once, stored, and published at
 * /.well-known/jwks.json so the platform can verify our client assertions.
 */
const ALG = "RS256";

export interface ToolKey {
  kid: string;
  publicJwk: JWK;
  privateKey: KeyLike;
}

export async function ensureKey(env: Bindings): Promise<ToolKey> {
  const existing = await env.DB.prepare(
    "SELECT kid, public_jwk, private_jwk FROM tool_keys WHERE active = 1 ORDER BY created_at DESC LIMIT 1",
  ).first<{ kid: string; public_jwk: string; private_jwk: string }>();

  if (existing) {
    const privateJwk = JSON.parse(existing.private_jwk) as JWK;
    return {
      kid: existing.kid,
      publicJwk: JSON.parse(existing.public_jwk) as JWK,
      privateKey: (await importJWK(privateJwk, ALG)) as KeyLike,
    };
  }

  const { publicKey, privateKey } = await generateKeyPair(ALG, { extractable: true });
  const publicJwk = await exportJWK(publicKey);
  const privateJwk = await exportJWK(privateKey);
  const kid = crypto.randomUUID();

  publicJwk.kid = kid;
  publicJwk.alg = ALG;
  publicJwk.use = "sig";
  privateJwk.kid = kid;
  privateJwk.alg = ALG;

  await env.DB.prepare(
    "INSERT INTO tool_keys (kid, public_jwk, private_jwk, active, created_at) VALUES (?, ?, ?, 1, ?)",
  )
    .bind(kid, JSON.stringify(publicJwk), JSON.stringify(privateJwk), new Date().toISOString())
    .run();

  return { kid, publicJwk, privateKey: privateKey as KeyLike };
}

export async function publicJwks(env: Bindings): Promise<{ keys: JWK[] }> {
  const rows = await env.DB.prepare(
    "SELECT public_jwk FROM tool_keys WHERE active = 1",
  ).all<{ public_jwk: string }>();
  const results: { public_jwk: string }[] = rows.results ?? [];
  // Publishing every active key, not just the newest, is what makes rotation
  // possible without invalidating assertions already in flight.
  return { keys: results.map((row) => JSON.parse(row.public_jwk) as JWK) };
}
