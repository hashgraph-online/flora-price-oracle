import { Pool } from "pg";
import type { ConsensusEntry } from "../consumer/types.js";
import crypto from "crypto";
import { Logger } from "@hashgraphonline/standards-sdk";

const logger = Logger.getInstance({ module: "flora-db" });

const pool = new Pool({
  host: process.env.PGHOST || process.env.POSTGRES_HOST || "localhost",
  port: Number(process.env.PGPORT || 5432),
  user: process.env.PGUSER || "flora",
  password: process.env.PGPASSWORD || "flora",
  database: process.env.PGDATABASE || "flora",
});

pool.on("error", (error: unknown) => {
  logger.error("Postgres pool error", error);
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

export const initDb = async (): Promise<void> => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS consensus_entries (
      epoch INTEGER PRIMARY KEY,
      state_hash TEXT NOT NULL,
      price DOUBLE PRECISION NOT NULL,
      timestamp TEXT NOT NULL,
      participants JSONB NOT NULL,
      sources JSONB NOT NULL,
      hcs_message TEXT,
      consensus_timestamp TEXT,
      sequence_number INTEGER
    );
  `);

  await pool.query(`ALTER TABLE consensus_entries ADD COLUMN IF NOT EXISTS hcs_message TEXT;`);
  await pool.query(`ALTER TABLE consensus_entries ADD COLUMN IF NOT EXISTS consensus_timestamp TEXT;`);
  await pool.query(`ALTER TABLE consensus_entries ADD COLUMN IF NOT EXISTS sequence_number INTEGER;`);
};

export const setState = async (key: string, value: string): Promise<void> => {
  await pool.query(
    `
    INSERT INTO app_state(key, value)
    VALUES ($1, $2)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
  `,
    [key, value],
  );
};

export const getState = async (key: string): Promise<string | null> => {
  const res = await pool.query(`SELECT value FROM app_state WHERE key = $1`, [key]);
  return res.rows[0]?.value ?? null;
};

const petalKeyPrefix = "petal_private_key_";
const encPrefix = "enc:v1:";

const getEncryptionKey = (): Buffer => {
  const explicit = process.env.PETAL_KEY_SECRET?.trim();
  if (explicit) {
    const tryHex = Buffer.from(explicit, "hex");
    if (tryHex.length === 32) return tryHex;
    const tryB64 = Buffer.from(explicit, "base64");
    if (tryB64.length === 32) return tryB64;
    return crypto.createHash("sha256").update(explicit).digest();
  }
  const fallback =
    process.env.HEDERA_PRIVATE_KEY?.trim() ??
    process.env.PGPASSWORD?.trim();
  if (!fallback) {
    throw new Error("Set PETAL_KEY_SECRET, HEDERA_PRIVATE_KEY, or PGPASSWORD to derive encryption key");
  }
  return crypto.createHash("sha256").update(fallback).digest();
};

const encryptValue = (plain: string): string => {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${encPrefix}${iv.toString("base64")}:${ciphertext.toString("base64")}:${tag.toString("base64")}`;
};

const decryptValue = (stored: string): string => {
  if (!stored.startsWith(encPrefix)) return stored;
  const key = getEncryptionKey();
  const [, payload] = stored.split(encPrefix);
  const [ivB64, ctB64, tagB64] = payload.split(":");
  if (!ivB64 || !ctB64 || !tagB64) {
    throw new Error("Encrypted value malformed");
  }
  const iv = Buffer.from(ivB64, "base64");
  const ciphertext = Buffer.from(ctB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plain.toString("utf8");
};

export const setSecureState = async (key: string, value: string): Promise<void> => {
  if (!key.startsWith(petalKeyPrefix)) {
    await setState(key, value);
    return;
  }
  const encrypted = encryptValue(value);
  await setState(key, encrypted);
};

export const getSecureState = async (key: string): Promise<string | null> => {
  const raw = await getState(key);
  if (raw === null) return null;
  if (!raw.startsWith(encPrefix) && !key.startsWith(petalKeyPrefix)) {
    return raw;
  }
  return decryptValue(raw);
};

export const saveConsensusEntry = async (entry: ConsensusEntry): Promise<void> => {
  await pool.query(
    `
    INSERT INTO consensus_entries(epoch, state_hash, price, timestamp, participants, sources, hcs_message, consensus_timestamp, sequence_number)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    ON CONFLICT (epoch) DO UPDATE
    SET state_hash = EXCLUDED.state_hash,
        price = EXCLUDED.price,
        timestamp = EXCLUDED.timestamp,
        participants = EXCLUDED.participants,
        sources = EXCLUDED.sources,
        hcs_message = EXCLUDED.hcs_message,
        consensus_timestamp = EXCLUDED.consensus_timestamp,
        sequence_number = EXCLUDED.sequence_number;
  `,
    [
      entry.epoch,
      entry.stateHash,
      entry.price,
      entry.timestamp,
      JSON.stringify(entry.participants),
      JSON.stringify(entry.sources),
      entry.hcsMessage ?? null,
      entry.consensusTimestamp ?? null,
      entry.sequenceNumber ?? null,
    ],
  );
};

export const deleteState = async (key: string): Promise<void> => {
  await pool.query(`DELETE FROM app_state WHERE key = $1`, [key]);
};

export const loadConsensusHistory = async (): Promise<ConsensusEntry[]> => {
  const res = await pool.query(
    `
      SELECT epoch, state_hash, price, timestamp, participants, sources, hcs_message, consensus_timestamp, sequence_number
      FROM consensus_entries
      ORDER BY epoch ASC;
    `,
  );
  const rows = Array.isArray(res.rows) ? res.rows : [];
  return rows.flatMap((row) => {
    if (!isRecord(row)) {
      return [];
    }
    const record = row;
    const stateHash = typeof record.state_hash === "string" ? record.state_hash : undefined;
    const timestamp = typeof record.timestamp === "string" ? record.timestamp : undefined;
    if (!stateHash || !timestamp) {
      return [];
    }
    const participants = Array.isArray(record.participants) ? record.participants : [];
    const sources = Array.isArray(record.sources) ? record.sources : [];
    return [
      {
        epoch: Number(record.epoch ?? 0),
        stateHash,
        price: Number(record.price ?? 0),
        timestamp,
        participants,
        sources,
        hcsMessage: typeof record.hcs_message === "string" ? record.hcs_message : undefined,
        consensusTimestamp:
          typeof record.consensus_timestamp === "string" ? record.consensus_timestamp : undefined,
        sequenceNumber: typeof record.sequence_number === "number" ? record.sequence_number : undefined,
      },
    ];
  });
};
