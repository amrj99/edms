import { db } from "@workspace/db";
import { usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { hashPassword } from "./auth.js";
import { logger } from "./logger.js";

export async function seedDefaultAdmin(): Promise<void> {
  try {
    const existing = await db.select().from(usersTable).where(eq(usersTable.email, "admin@admin.com")).limit(1);
    if (existing.length > 0) {
      return; // Admin already exists
    }

    const passwordHash = await hashPassword("Admin123!");
    await db.insert(usersTable).values({
      email: "admin@admin.com",
      passwordHash,
      firstName: "System",
      lastName: "Admin",
      role: "admin",
      isActive: true,
    });

    logger.info("Default admin user created: admin@admin.com / Admin123!");
  } catch (err) {
    logger.error({ err }, "Failed to seed default admin user");
  }
}
