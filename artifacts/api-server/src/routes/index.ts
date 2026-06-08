import { Router, type IRouter } from "express";
import healthRouter from "./health";
import leadsRouter from "./leads";
import analyticsRouter from "./analytics";
import tiktokRouter from "./tiktok";

const router: IRouter = Router();

router.use(healthRouter);
router.use(leadsRouter);
router.use(analyticsRouter);
router.use(tiktokRouter);

export default router;
