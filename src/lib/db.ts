import initSqlJs, { Database } from 'sql.js';
import fs from 'fs';
import path from 'path';

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../data/naijaplant.db');

let db: Database;
let SQL: Awaited<ReturnType<typeof initSqlJs>>;

export async function getDb(): Promise<Database> {
  if (db) return db;

  SQL = await initSqlJs();

  // Ensure data dir exists
  const dir = path.dirname(DB_PATH);
  fs.mkdirSync(dir, { recursive: true });

  // Load existing DB or create new
  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
    await createSchema(db);
    console.log('📦 Database created');
  }

  return db;
}

// Save DB to disk (call after writes)
export function saveDb(): void {
  if (!db) return;
  const data = db.export();
  const buffer = Buffer.from(data);
  const dir = path.dirname(DB_PATH);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(DB_PATH, buffer);
}

async function createSchema(db: Database): Promise<void> {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      status TEXT NOT NULL DEFAULT 'active',
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS plants (
      id TEXT PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      botanicalName TEXT NOT NULL,
      description TEXT NOT NULL,
      uses TEXT NOT NULL DEFAULT '[]',
      traditionalUses TEXT NOT NULL DEFAULT '[]',
      family TEXT NOT NULL,
      precautions TEXT NOT NULL DEFAULT '',
      region TEXT NOT NULL DEFAULT '[]',
      imageUrl TEXT,
      yorubaName TEXT,
      hausaName TEXT,
      igboName TEXT,
      partsUsed TEXT DEFAULT '[]',
      preparationMethods TEXT DEFAULT '[]',
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS uploads (
      id TEXT PRIMARY KEY,
      userId TEXT,
      imagePath TEXT NOT NULL,
      predictedPlant TEXT,
      confidence REAL,
      isGuest INTEGER NOT NULL DEFAULT 0,
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS model_records (
      id TEXT PRIMARY KEY,
      filename TEXT NOT NULL,
      version TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'archive',
      accuracy REAL,
      numClasses INTEGER NOT NULL DEFAULT 15,
      fileSize INTEGER,
      filePath TEXT NOT NULL,
      uploadedBy TEXT,
      uploadedAt TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS activity_logs (
      id TEXT PRIMARY KEY,
      userId TEXT,
      action TEXT NOT NULL,
      details TEXT,
      timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_uploads_userId ON uploads(userId);
    CREATE INDEX IF NOT EXISTS idx_uploads_createdAt ON uploads(createdAt DESC);
    CREATE INDEX IF NOT EXISTS idx_activity_userId ON activity_logs(userId);
  `);
}

// ── Query helpers ──────────────────────────────────────────────────

export function queryAll<T = Record<string, unknown>>(sql: string, params: unknown[] = []): T[] {
  const stmt = db.prepare(sql);
  stmt.bind(params as Parameters<typeof stmt.bind>[0]);
  const rows: T[] = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject() as T);
  }
  stmt.free();
  return rows;
}

export function queryOne<T = Record<string, unknown>>(sql: string, params: unknown[] = []): T | null {
  const rows = queryAll<T>(sql, params);
  return rows[0] ?? null;
}

export function execute(sql: string, params: unknown[] = []): void {
  const stmt = db.prepare(sql);
  stmt.run(params as Parameters<typeof stmt.run>[0]);
  stmt.free();
  saveDb();
}

export function count(sql: string, params: unknown[] = []): number {
  const row = queryOne<{ count: number }>(sql, params);
  return row?.count ?? 0;
}
