import { db } from "@workspace/db";
import { usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { hashPassword } from "./auth.js";
import { logger } from "./logger.js";

interface AdminUser {
  email: string;
  firstName: string;
  lastName: string;
  password: string;
  role: "admin" | "system_owner";
}

const DEFAULT_ADMINS: AdminUser[] = [
  {
    email: "admin@admin.com",
    firstName: "AdminTest",
    lastName: "Admin",
    password: "Admin123!",
    role: "admin",
  },
  {
    email: "owner@system.com",
    firstName: "System",
    lastName: "Owner",
    password: "Owner123!",
    role: "system_owner",
  },
];

export async function seedDefaultAdmin(): Promise<void> {
  try {
    for (const admin of DEFAULT_ADMINS) {
      const existing = await db
        .select()
        .from(usersTable)
        .where(eq(usersTable.email, admin.email))
        .limit(1);

      if (existing.length > 0) {
        const user = existing[0];
        const updates: Record<string, unknown> = { role: admin.role, isActive: true, updatedAt: new Date() };
        // Re-hash if using legacy SHA-256 hash (not starting with $2b)
        if (!user.passwordHash.startsWith("$2")) {
          updates.passwordHash = await hashPassword(admin.password);
          logger.info({ email: admin.email }, "Admin password upgraded from SHA-256 to bcrypt");
        }
        await db.update(usersTable).set(updates as any).where(eq(usersTable.email, admin.email));
        continue;
      }

      const passwordHash = await hashPassword(admin.password);
      await db.insert(usersTable).values({
        email: admin.email,
        passwordHash,
        firstName: admin.firstName,
        lastName: admin.lastName,
        role: admin.role,
        isActive: true,
      });

      logger.info({ email: admin.email }, `Admin user created: ${admin.email}`);
    }

    logger.info("Admin users ready");
    logger.info("  admin@admin.com  / Admin123!");
    logger.info("  owner@system.com / Owner123!");
  } catch (err) {
    logger.error({ err }, "Failed to seed admin users");
  }
}
