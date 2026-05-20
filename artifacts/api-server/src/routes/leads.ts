import { Router, type Request, type Response } from "express";
import { db, leads, insertLeadSchema } from "@workspace/db";
import { count, desc, eq, and, ne } from "drizzle-orm";
import { adminMiddleware, type AuthRequest } from "../auth";
import { sendContactNotification } from "../lib/email";
import { publicLeadRateLimiter } from "../lib/publicLeadRateLimit";

const router = Router();

router.post("/leads", publicLeadRateLimiter, async (req: Request, res: Response) => {
  try {
    const parsed = insertLeadSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid input", details: parsed.error.issues });
      return;
    }

    const [lead] = await db.insert(leads).values(parsed.data).returning();
    res.status(201).json({ success: true, id: lead.id });

    // Only notify admin on the first submission from this email address.
    // Repeated submissions (same email) are stored in the DB but silently
    // suppressed to prevent attacker-driven inbox flooding via form abuse.
    const [{ value: priorCount }] = await db
      .select({ value: count() })
      .from(leads)
      .where(and(eq(leads.email, parsed.data.email), ne(leads.id, lead.id)));

    if (priorCount === 0) {
      sendContactNotification({
        name: parsed.data.name ?? "Unknown",
        email: parsed.data.email,
        message: parsed.data.message ?? "(no message)",
        type: parsed.data.type ?? undefined,
      }).catch((err) => req.log.error({ err }, "Failed to send contact notification email"));
    } else {
      req.log.info(
        { email: parsed.data.email, leadId: lead.id },
        "Suppressed duplicate admin notification for repeat lead email",
      );
    }
    return;
  } catch (err: any) {
    req.log.error({ err }, "Failed to create lead");
    res.status(500).json({ error: "Failed to submit" });
  }
});

router.get("/leads", adminMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const type = req.query.type as string | undefined;
    const query = type
      ? db.select().from(leads).where(eq(leads.type, type)).orderBy(desc(leads.createdAt))
      : db.select().from(leads).orderBy(desc(leads.createdAt));

    const results = await query;
    res.json(results);
  } catch (err: any) {
    req.log.error({ err }, "Failed to fetch leads");
    res.status(500).json({ error: "Failed to fetch leads" });
  }
});

export default router;
