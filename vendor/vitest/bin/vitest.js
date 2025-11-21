#!/usr/bin/env node
import { run } from "../runner.js";

run().catch((err) => {
  console.error(err?.message || err);
  process.exit(1);
});
