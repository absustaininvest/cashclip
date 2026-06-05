import { Router, type IRouter } from "express";
import healthRouter from "./health";
import leadsRouter from "./leads";
import analyticsRouter from "./analytics";

const router: IRouter = Router();

router.use(healthRouter);
router.use(leadsRouter);
router.use(analyticsRouter);

export default router;
