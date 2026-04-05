import { Router } from "express";
import { db } from "@workspace/db";
import { userPreferencesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "../lib/auth.js";

const router = Router();

router.get("/preferences", requireAuth, async (req, res) => {
  const [row] = await db.select().from(userPreferencesTable)
    .where(eq(userPreferencesTable.userId, req.user!.id));
  res.json(row ?? { userId: req.user!.id, dashboardWidgets: null, dashboardLayout: null, savedFilters: null, columnPrefs: null });
});

router.put("/preferences", requireAuth, async (req, res) => {
  const { dashboardWidgets, dashboardLayout, savedFilters, columnPrefs, notificationPrefs } = req.body;
  const existing = await db.select().from(userPreferencesTable)
    .where(eq(userPreferencesTable.userId, req.user!.id));

  if (existing.length > 0) {
    const [row] = await db.update(userPreferencesTable)
      .set({
        ...(dashboardWidgets !== undefined && { dashboardWidgets }),
        ...(dashboardLayout !== undefined && { dashboardLayout }),
        ...(savedFilters !== undefined && { savedFilters }),
        ...(columnPrefs !== undefined && { columnPrefs }),
        ...(notificationPrefs !== undefined && { notificationPrefs }),
        updatedAt: new Date(),
      })
      .where(eq(userPreferencesTable.userId, req.user!.id))
      .returning();
    res.json(row);
  } else {
    const [row] = await db.insert(userPreferencesTable).values({
      userId: req.user!.id,
      organizationId: req.user!.organizationId ?? null,
      dashboardWidgets: dashboardWidgets ?? null,
      dashboardLayout: dashboardLayout ?? null,
      savedFilters: savedFilters ?? null,
      columnPrefs: columnPrefs ?? null,
      notificationPrefs: notificationPrefs ?? null,
    }).returning();
    res.status(201).json(row);
  }
});

export default router;
