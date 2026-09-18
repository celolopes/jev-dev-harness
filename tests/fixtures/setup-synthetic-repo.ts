import fs from "node:fs";
import path from "node:path";

export function setupSyntheticRepo(targetDir: string): void {
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  const files: Record<string, string> = {
    // Auth feature
    "src/auth/jwt.ts": `
      import jwt from 'jsonwebtoken';
      export interface TokenPayload { userId: string; email: string; }
      export function generateAuthToken(payload: TokenPayload): string {
        return jwt.sign(payload, 'secret', { expiresIn: '1h' });
      }
      export function verifyAuthToken(token: string): TokenPayload {
        return jwt.verify(token, 'secret') as TokenPayload;
      }
    `,
    "src/auth/session.ts": `
      export class SessionManager {
        createSession(userId: string) { return { sessionId: '123', userId }; }
      }
    `,
    "tests/auth/jwt.test.ts": `
      import { describe, it, expect } from 'vitest';
      import { generateAuthToken, verifyAuthToken } from '../../src/auth/jwt.js';
      describe('JWT Auth', () => {
        it('generates token', () => {
          const token = generateAuthToken({ userId: 'u1', email: 'a@b.com' });
          expect(token).toBeDefined();
        });
      });
    `,

    // Billing / Stripe feature
    "src/billing/stripe.ts": `
      export class StripeGateway {
        async chargeCustomer(amount: number, currency: string) {
          return { status: 'succeeded', chargeId: 'ch_123' };
        }
      }
    `,
    "src/billing/invoice.ts": `
      export interface Invoice { id: string; total: number; }
      export function generateInvoice(id: string, total: number): Invoice {
        return { id, total };
      }
    `,

    // Database
    "src/database/schema.sql": `
      CREATE TABLE users (
        id VARCHAR(36) PRIMARY KEY,
        email VARCHAR(255) NOT NULL UNIQUE,
        password_hash VARCHAR(255) NOT NULL
      );
      CREATE TABLE orders (
        id VARCHAR(36) PRIMARY KEY,
        user_id VARCHAR(36) REFERENCES users(id),
        total_cents INT NOT NULL
      );
    `,
    "src/database/client.ts": `
      export class DatabaseClient {
        connect() { return true; }
      }
    `,

    // UI / Frontend
    "src/ui/components/Button.tsx": `
      export function Button({ label }: { label: string }) {
        return <button>{label}</button>;
      }
    `,
    "src/ui/components/Navbar.tsx": `
      export function Navbar() { return <nav>Navigation</nav>; }
    `,

    // Documentation
    "docs/architecture.md": `
      # System Architecture
      This document outlines the auth, billing, and database layout.
    `,

    // Configuration
    "config/default.json": `
      { "port": 3000, "env": "development" }
    `,

    // Special test cases: file name with spaces
    "src/utils/string helpers.ts": `
      export function capitalize(s: string): string {
        return s.charAt(0).toUpperCase() + s.slice(1);
      }
    `,

    // Secrets / Env (MUST be ignored by Stage A or redacted)
    ".env": `
      JWT_SECRET=super_secret_key_123456
      DATABASE_URL=postgres://user:mypassword@localhost:5432/mydb
    `,
    "secrets.key": `
      -----BEGIN RSA PRIVATE KEY-----
      MIIEowIBAAKCAQEA0m...
      -----END RSA PRIVATE KEY-----
    `,

    // Ignore file for the fixture
    ".jevignore": `
      temp/
      *.tmp
    `,
  };

  for (const [relPath, content] of Object.entries(files)) {
    const fullPath = path.join(targetDir, relPath);
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(fullPath, content.trim(), "utf8");
  }

  // Create a dummy binary file
  const binPath = path.join(targetDir, "assets/logo.png");
  fs.mkdirSync(path.dirname(binPath), { recursive: true });
  fs.writeFileSync(binPath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00]));

  // Create an oversized dummy file (150 KB)
  const bigPath = path.join(targetDir, "data/large_dataset.csv");
  fs.mkdirSync(path.dirname(bigPath), { recursive: true });
  fs.writeFileSync(bigPath, "col1,col2,col3\n" + "1,2,3\n".repeat(15000));
}
