import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import membersRouter from "./members";
import productsRouter from "./products";
import cartRouter from "./cart";
import ordersRouter from "./orders";
import catalogContentRouter from "./catalogContent";
import favoritesRouter from "./favorites";
import adminRouter from "./admin";
import adminProductsRouter from "./adminProducts";
import adminPurchasingRouter from "./adminPurchasing";
import adminOrdersRouter from "./adminOrders";
import walletRouter from "./wallet";
import adminWalletsRouter from "./adminWallets";
import adminProfitSharingRouter from "./adminProfitSharing";
import adminFinanceRouter from "./adminFinance";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(membersRouter);
router.use(productsRouter);
router.use(cartRouter);
router.use(ordersRouter);
router.use(catalogContentRouter);
router.use(favoritesRouter);
router.use(adminRouter);
router.use(adminProductsRouter);
router.use(adminPurchasingRouter);
router.use(adminOrdersRouter);
router.use(walletRouter);
router.use(adminWalletsRouter);
router.use(adminProfitSharingRouter);
router.use(adminFinanceRouter);

export default router;
