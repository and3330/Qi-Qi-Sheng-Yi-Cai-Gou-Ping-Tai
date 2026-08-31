import { Router, type IRouter } from "express";
import healthRouter from "./health";
import membersRouter from "./members";
import productsRouter from "./products";
import cartRouter from "./cart";
import ordersRouter from "./orders";
import catalogContentRouter from "./catalogContent";
import favoritesRouter from "./favorites";

const router: IRouter = Router();

router.use(healthRouter);
router.use(membersRouter);
router.use(productsRouter);
router.use(cartRouter);
router.use(ordersRouter);
router.use(catalogContentRouter);
router.use(favoritesRouter);

export default router;
