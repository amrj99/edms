/**
 * Standalone seed script.
 * Run with: pnpm --filter @workspace/api-server run seed
 */
import { seedDefaultAdmin } from "../lib/seed.js";

console.log("Running database seed...");

await seedDefaultAdmin();

console.log("Seed complete.");
process.exit(0);
