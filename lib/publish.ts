/**
 * Publish store.
 *
 * Prefers Upstash Redis (via @upstash/redis, reading KV_REST_API_URL/TOKEN
 * or UPSTASH_REDIS_REST_URL/TOKEN — Redis.fromEnv() accepts either naming)
 * when configured. That's the one that actually survives a real Vercel
 * deploy: a serverless function's local filesystem is ephemeral, so the
 * node:sqlite fallback below only works for `npm run dev`. Same "real
 * service when configured, working local fallback otherwise" philosophy
 * already used for /api/edit (Claude, falls back to interpret()) and the
 * Mic button (OpenAI Realtime, falls back to browser speech-to-text).
 */

import { Redis } from "@upstash/redis";
import type { DatabaseSync } from "node:sqlite";
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

import { validateDocument, type SiteDocument } from "./site/schema";

const ID_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

function generateId(length = 10): string {
  const bytes = randomBytes(length);
  let id = "";
  for (let i = 0; i < length; i += 1) {
    id += ID_ALPHABET[bytes[i] % ID_ALPHABET.length];
  }
  return id;
}

function parseAndValidate(raw: string): SiteDocument | null {
  try {
    const document = JSON.parse(raw) as unknown;
    if (validateDocument(document).length > 0) return null;
    return document as SiteDocument;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------ upstash redis */

const REDIS_KEY_PREFIX = "canvas:site:";

function redisConfigured(): boolean {
  return Boolean(
    (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) ||
      (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN),
  );
}

let redisClient: Redis | undefined;
function getRedis(): Redis {
  if (!redisClient) redisClient = Redis.fromEnv();
  return redisClient;
}

async function publishToRedis(document: SiteDocument): Promise<string> {
  const redis = getRedis();
  const payload = JSON.stringify(document);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const id = generateId();
    const wasSet = await redis.set(REDIS_KEY_PREFIX + id, payload, { nx: true });
    if (wasSet) return id;
  }
  throw new Error("Could not generate a unique id for publishing.");
}

async function getFromRedis(id: string): Promise<SiteDocument | null> {
  const redis = getRedis();
  const raw = await redis.get<string>(REDIS_KEY_PREFIX + id);
  if (!raw) return null;
  return parseAndValidate(raw);
}

/* ----------------------------------------------- node:sqlite (dev fallback) */

// Imported dynamically, not statically: this branch should never even be
// touched in production (Redis is configured there), and a static import
// would load node:sqlite for every request regardless — a risk not worth
// taking against a Vercel serverless runtime's exact Node API surface.
const DB_PATH = join(process.cwd(), "data", "canvas.db");
let db: DatabaseSync | undefined;

async function getDb(): Promise<DatabaseSync> {
  if (db) return db;
  const { DatabaseSync: Database } = await import("node:sqlite");
  mkdirSync(dirname(DB_PATH), { recursive: true });
  db = new Database(DB_PATH);
  db.exec(`
    CREATE TABLE IF NOT EXISTS published_sites (
      id TEXT PRIMARY KEY,
      document TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `);
  return db;
}

async function publishToSqlite(document: SiteDocument): Promise<string> {
  const database = await getDb();
  const insert = database.prepare(
    "INSERT INTO published_sites (id, document, created_at) VALUES (?, ?, ?)",
  );
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const id = generateId();
    try {
      insert.run(id, JSON.stringify(document), Date.now());
      return id;
    } catch {
      // Primary key collision (astronomically unlikely at this id space) — retry.
    }
  }
  throw new Error("Could not generate a unique id for publishing.");
}

async function getFromSqlite(id: string): Promise<SiteDocument | null> {
  const database = await getDb();
  const row = database
    .prepare("SELECT document FROM published_sites WHERE id = ?")
    .get(id) as { document: string } | undefined;
  if (!row) return null;
  return parseAndValidate(row.document);
}

/* --------------------------------------------------------------------- api */

/** Publishes an immutable snapshot of the document and returns its id. */
export async function publishSite(document: SiteDocument): Promise<string> {
  return redisConfigured() ? publishToRedis(document) : publishToSqlite(document);
}

export async function getPublishedSite(id: string): Promise<SiteDocument | null> {
  return redisConfigured() ? getFromRedis(id) : getFromSqlite(id);
}
