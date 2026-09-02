import { hash, verify } from "@node-rs/argon2";

/** Argon2id with OWASP-recommended baseline parameters. */
const ARGON2_OPTIONS = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
};

export async function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

export function validatePasswordStrength(password: string): string | null {
  if (password.length < 12) return "Password must have at least 12 characters.";
  if (password.length > 1024) return "Password is too long.";
  if (!/[a-z]/i.test(password) || !/\d/.test(password))
    return "Password must contain letters and digits.";
  return null;
}
