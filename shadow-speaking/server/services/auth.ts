// --- Password Hashing (PBKDF2) ---

export async function hashPassword(
  password: string,
  salt?: string
): Promise<{ hash: string; salt: string }> {
  const encoder = new TextEncoder();
  const saltBytes = salt
    ? hexToBytes(salt)
    : crypto.getRandomValues(new Uint8Array(16));

  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: saltBytes.buffer as ArrayBuffer,
      iterations: 100000,
      hash: "SHA-256",
    },
    keyMaterial,
    256
  );

  return {
    hash: bytesToHex(new Uint8Array(derivedBits)),
    salt: bytesToHex(saltBytes),
  };
}

export async function verifyPassword(
  password: string,
  storedHash: string,
  storedSalt: string
): Promise<boolean> {
  const { hash } = await hashPassword(password, storedSalt);
  // Timing-safe comparison to prevent timing attacks
  const a = new TextEncoder().encode(hash);
  const b = new TextEncoder().encode(storedHash);
  if (a.byteLength !== b.byteLength) return false;

  // crypto.subtle.timingSafeEqual is a Cloudflare Workers extension
  if (typeof (crypto.subtle as any).timingSafeEqual === "function") {
    return (crypto.subtle as any).timingSafeEqual(a, b);
  }
  // Fallback: manual constant-time compare
  const aBytes = new Uint8Array(a);
  const bBytes = new Uint8Array(b);
  let result = 0;
  for (let i = 0; i < aBytes.length; i++) {
    result |= aBytes[i] ^ bBytes[i];
  }
  return result === 0;
}

// --- Session Management ---

const SESSION_TTL = 7 * 24 * 60 * 60; // 7 days in seconds

export function generateSessionToken(): string {
  return crypto.randomUUID();
}

export async function createSession(
  kv: KVNamespace,
  userId: string
): Promise<string> {
  const token = generateSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL * 1000).toISOString();

  await kv.put(
    `session:${token}`,
    JSON.stringify({ userId, expiresAt }),
    { expirationTtl: SESSION_TTL }
  );

  return token;
}

export async function getSession(
  kv: KVNamespace,
  token: string
): Promise<{ userId: string; expiresAt: string } | null> {
  const data = await kv.get(`session:${token}`);
  if (!data) return null;

  let session: { userId: string; expiresAt: string };
  try {
    session = JSON.parse(data);
  } catch {
    // Corrupt session data — delete and return null
    await kv.delete(`session:${token}`);
    return null;
  }

  if (typeof session?.userId !== "string" || typeof session?.expiresAt !== "string") {
    await kv.delete(`session:${token}`);
    return null;
  }

  if (new Date(session.expiresAt) < new Date()) {
    await kv.delete(`session:${token}`);
    return null;
  }

  // Only renew if more than half the TTL has elapsed (reduce write amplification)
  const remaining = new Date(session.expiresAt).getTime() - Date.now();
  if (remaining < (SESSION_TTL * 1000) / 2) {
    const newExpiresAt = new Date(Date.now() + SESSION_TTL * 1000).toISOString();
    await kv.put(
      `session:${token}`,
      JSON.stringify({ userId: session.userId, expiresAt: newExpiresAt }),
      { expirationTtl: SESSION_TTL }
    );
    return { userId: session.userId, expiresAt: newExpiresAt };
  }

  return session;
}

export async function destroySession(
  kv: KVNamespace,
  token: string
): Promise<void> {
  await kv.delete(`session:${token}`);
}

// --- Login Rate Limiting ---

const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION = 15 * 60; // 15 minutes

interface LoginAttempts {
  count: number;
  lockedUntil?: string;
}

function parseLoginAttempts(data: string | null): LoginAttempts | null {
  if (!data) return null;
  try {
    const parsed = JSON.parse(data);
    if (typeof parsed?.count !== "number") return null;
    return parsed as LoginAttempts;
  } catch {
    return null;
  }
}

export async function checkLoginRateLimit(
  kv: KVNamespace,
  username: string
): Promise<{ allowed: boolean; remainingAttempts: number }> {
  const key = `login_attempts:${username}`;
  const data = await kv.get(key);
  const attempts = parseLoginAttempts(data);

  if (!attempts) {
    return { allowed: true, remainingAttempts: MAX_LOGIN_ATTEMPTS };
  }

  if (attempts.lockedUntil && new Date(attempts.lockedUntil) > new Date()) {
    return { allowed: false, remainingAttempts: 0 };
  }

  if (attempts.count >= MAX_LOGIN_ATTEMPTS) {
    return { allowed: false, remainingAttempts: 0 };
  }

  return {
    allowed: true,
    remainingAttempts: MAX_LOGIN_ATTEMPTS - attempts.count,
  };
}

export async function recordLoginAttempt(
  kv: KVNamespace,
  username: string,
  success: boolean
): Promise<void> {
  const key = `login_attempts:${username}`;

  if (success) {
    await kv.delete(key);
    return;
  }

  const data = await kv.get(key);
  const attempts = parseLoginAttempts(data) || { count: 0 };

  attempts.count += 1;

  if (attempts.count >= MAX_LOGIN_ATTEMPTS) {
    attempts.lockedUntil = new Date(
      Date.now() + LOCKOUT_DURATION * 1000
    ).toISOString();
  }

  await kv.put(key, JSON.stringify(attempts), {
    expirationTtl: LOCKOUT_DURATION,
  });
}

// --- Cookie Helpers ---

export function setSessionCookie(token: string): string {
  const maxAge = SESSION_TTL;
  return `session=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

export function clearSessionCookie(): string {
  return `session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export function getSessionTokenFromCookie(
  cookieHeader: string | null
): string | null {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(/session=([^;]+)/);
  return match ? match[1] : null;
}

// --- Utility Functions ---

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}
