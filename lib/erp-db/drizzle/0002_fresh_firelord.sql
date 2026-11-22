CREATE TABLE "ui_layouts" (
	"tenant_id" integer DEFAULT (current_setting('app.tenant_id'::text))::integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"layout_key" text NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "voucher_templates" (
	"tenant_id" integer DEFAULT (current_setting('app.tenant_id'::text))::integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"voucher_type" text NOT NULL,
	"description" text,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "remarks" text;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "handler_id" integer;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "warehouse_id" integer;--> statement-breakpoint
ALTER TABLE "vouchers" ADD COLUMN "template_id" integer;--> statement-breakpoint
ALTER TABLE "vouchers" ADD COLUMN "extra_fields" jsonb;--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "user_id" integer;--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "agent_config" jsonb;--> statement-breakpoint
ALTER TABLE "delivery_notes" ADD COLUMN "handler_id" integer;--> statement-breakpoint
ALTER TABLE "delivery_notes" ADD COLUMN "contact_info" text;--> statement-breakpoint
ALTER TABLE "delivery_notes" ADD COLUMN "shipping_address" text;--> statement-breakpoint
ALTER TABLE "purchase_receipts" ADD COLUMN "handler_id" integer;--> statement-breakpoint
ALTER TABLE "work_orders" ADD COLUMN "customer_id" integer;--> statement-breakpoint
ALTER TABLE "work_orders" ADD COLUMN "handler_id" integer;--> statement-breakpoint
CREATE UNIQUE INDEX "ui_layouts_key_unique" ON "ui_layouts" USING btree ("tenant_id","layout_key");--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_handler_id_employees_id_fk" FOREIGN KEY ("handler_id") REFERENCES "employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_user_id_admin_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "admin_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_notes" ADD CONSTRAINT "delivery_notes_handler_id_employees_id_fk" FOREIGN KEY ("handler_id") REFERENCES "employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_receipts" ADD CONSTRAINT "purchase_receipts_handler_id_employees_id_fk" FOREIGN KEY ("handler_id") REFERENCES "employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_handler_id_employees_id_fk" FOREIGN KEY ("handler_id") REFERENCES "employees"("id") ON DELETE no action ON UPDATE no action;