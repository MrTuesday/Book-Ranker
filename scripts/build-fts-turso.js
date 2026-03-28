#!/usr/bin/env node
/**
 * Builds FTS5 index on Turso by inserting in batches.
 */

import { createClient } from "@libsql/client";

const tursoUrl = process.env.TURSO_DATABASE_URL ?? "libsql://book-ranker-mrtuesday.aws-eu-west-1.turso.io";
const tursoToken = process.env.TURSO_AUTH_TOKEN;

if (!tursoToken) {
  console.error("Set TURSO_AUTH_TOKEN");
  process.exit(1);
}

const client = createClient({ url: tursoUrl, authToken: tursoToken });

const BATCH_SIZE = 10000;

async function main() {
  // Check current state
  const existing = await client.execute("SELECT COUNT(*) as cnt FROM works_fts");
  const total = await client.execute("SELECT COUNT(*) as cnt FROM works");
  const existingCount = Number(existing.rows[0].cnt);
  const totalCount = Number(total.rows[0].cnt);

  console.log(`FTS: ${existingCount} / ${totalCount}`);

  if (existingCount >= totalCount) {
    console.log("FTS already complete!");
    return;
  }

  // Resume from where we left off
  let offset = existingCount;
  const startTime = Date.now();

  while (offset < totalCount) {
    await client.execute({
      sql: `INSERT INTO works_fts(key, title) SELECT key, title FROM works LIMIT ? OFFSET ?`,
      args: [BATCH_SIZE, offset],
    });

    offset += BATCH_SIZE;
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    const rate = (offset / ((Date.now() - startTime) / 1000)).toFixed(0);
    console.log(`  ${Math.min(offset, totalCount).toLocaleString()} / ${totalCount.toLocaleString()} (${((Math.min(offset, totalCount) / totalCount) * 100).toFixed(1)}%) - ${rate} rows/s - ${elapsed}s`);
  }

  console.log("FTS index complete!");
}

main().catch((err) => {
  console.error("Failed:", err.message);
  process.exit(1);
});
