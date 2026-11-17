CREATE TABLE "ai_actions" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"tool" text NOT NULL,
	"args" jsonb NOT NULL,
	"result_summary" text NOT NULL,
	"status" text NOT NULL,
	"target_type" text,
	"target_id" integer,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_actions_status_check" CHECK ("ai_actions"."status" IN ('ok','denied','error'))
);
--> statement-breakpoint
ALTER TABLE "ai_actions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "ai_customer_drafts" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"summary" text NOT NULL,
	"created_by" text DEFAULT 'ai' NOT NULL,
	"confirmed_by" integer,
	"confirmed_at" timestamp with time zone,
	"result_customer_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_customer_drafts_status_check" CHECK ("ai_customer_drafts"."status" IN ('pending','confirmed','rejected'))
);
--> statement-breakpoint
ALTER TABLE "ai_customer_drafts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "ai_draft_documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"doc_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"summary" text NOT NULL,
	"created_by" text DEFAULT 'ai' NOT NULL,
	"confirmed_by" integer,
	"confirmed_at" timestamp with time zone,
	"result_document_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_draft_documents_status_check" CHECK ("ai_draft_documents"."status" IN ('pending','confirmed','rejected')),
	CONSTRAINT "ai_draft_documents_doc_type_check" CHECK ("ai_draft_documents"."doc_type" IN ('receipt','payment','quotation','payment_request','sales_invoice'))
);
--> statement-breakpoint
ALTER TABLE "ai_draft_documents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "departments" (
	"tenant_id" integer DEFAULT (current_setting('app.tenant_id'::text))::integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"parent_id" integer,
	"manager_id" integer,
	"cost_center" text,
	"budget_income" numeric(14, 2) DEFAULT '0' NOT NULL,
	"budget_expense" numeric(14, 2) DEFAULT '0' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "account_recovery_profiles" (
	"user_id" integer PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"recovery_email" text NOT NULL,
	"recovery_email_verified_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "account_recovery_tokens" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"tenant_id" integer NOT NULL,
	"purpose" text NOT NULL,
	"binding_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employees" (
	"tenant_id" integer DEFAULT (current_setting('app.tenant_id'::text))::integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"employee_id" text NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"department_id" integer,
	"designation" text,
	"status" text DEFAULT 'Active' NOT NULL,
	"date_of_joining" text NOT NULL,
	"salary" numeric(12, 2),
	"health_insurance_dependents" integer DEFAULT 0 NOT NULL,
	"pension_self_rate" integer DEFAULT 0 NOT NULL,
	"shift_type_id" integer,
	"grade_id" integer,
	"geofence_exempt" boolean DEFAULT false NOT NULL,
	"resignation_date" text,
	"birth_date" text,
	"emergency_contact" text,
	"emergency_phone" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attendance" (
	"tenant_id" integer DEFAULT (current_setting('app.tenant_id'::text))::integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"employee_id" integer NOT NULL,
	"date" text NOT NULL,
	"status" text NOT NULL,
	"check_in" text,
	"check_out" text,
	"working_hours" numeric(5, 2),
	"late_minutes" integer DEFAULT 0 NOT NULL,
	"early_leave_minutes" integer DEFAULT 0 NOT NULL,
	"overtime_hours" numeric(5, 2) DEFAULT '0' NOT NULL,
	"shift_type_id" integer,
	"check_in_location" text,
	"check_out_location" text,
	"check_in_location_name" text,
	"check_out_location_name" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clock_in_locations" (
	"tenant_id" integer DEFAULT (current_setting('app.tenant_id'::text))::integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"latitude" numeric(10, 7) NOT NULL,
	"longitude" numeric(10, 7) NOT NULL,
	"radius_meters" integer DEFAULT 300 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leaves" (
	"tenant_id" integer DEFAULT (current_setting('app.tenant_id'::text))::integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"employee_id" integer NOT NULL,
	"leave_type" text NOT NULL,
	"from_date" text NOT NULL,
	"to_date" text NOT NULL,
	"total_days" numeric(5, 1) NOT NULL,
	"reason" text,
	"status" text DEFAULT 'Pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"tenant_id" integer DEFAULT (current_setting('app.tenant_id'::text))::integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"customer_code" text,
	"name" text NOT NULL,
	"short_name" text,
	"email" text,
	"phone" text,
	"mobile" text,
	"contact_person" text,
	"sales_person" text,
	"address" text,
	"city" text,
	"country" text,
	"tax_id" text,
	"payment_term_id" integer,
	"credit_limit" numeric(14, 2),
	"category" text DEFAULT '一般客戶',
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"tenant_id" integer DEFAULT (current_setting('app.tenant_id'::text))::integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"supplier_code" text,
	"name" text NOT NULL,
	"short_name" text,
	"email" text,
	"phone" text,
	"mobile" text,
	"contact_person" text,
	"address" text,
	"city" text,
	"country" text,
	"tax_id" text,
	"payment_term_id" integer,
	"category" text DEFAULT '一般供應商',
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "items" (
	"tenant_id" integer DEFAULT (current_setting('app.tenant_id'::text))::integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"item_code" text NOT NULL,
	"item_name" text NOT NULL,
	"item_group" text,
	"item_type" text,
	"description" text,
	"specification" text,
	"unit" text DEFAULT 'Nos' NOT NULL,
	"selling_price" numeric(12, 2) DEFAULT '0' NOT NULL,
	"buying_price" numeric(12, 2) DEFAULT '0' NOT NULL,
	"total_cost" numeric(12, 2) DEFAULT '0',
	"material_cost" numeric(12, 2) DEFAULT '0',
	"expense_cost" numeric(12, 2) DEFAULT '0',
	"outsourcing_cost" numeric(12, 2) DEFAULT '0',
	"labor_cost" numeric(12, 2) DEFAULT '0',
	"internal_price" numeric(12, 2) DEFAULT '0',
	"wholesale_price" numeric(12, 2) DEFAULT '0',
	"retail_price" numeric(12, 2) DEFAULT '0',
	"svip_price" numeric(12, 2) DEFAULT '0',
	"peer_price" numeric(12, 2) DEFAULT '0',
	"dealer_price" numeric(12, 2) DEFAULT '0',
	"supplier_name" text,
	"summary" text,
	"moving_avg_cost" numeric(14, 4) DEFAULT '0' NOT NULL,
	"current_stock" numeric(12, 2) DEFAULT '0' NOT NULL,
	"reorder_level" numeric(12, 2) DEFAULT '0' NOT NULL,
	"is_virtual" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'Active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "item_categories" (
	"tenant_id" integer DEFAULT (current_setting('app.tenant_id'::text))::integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "item_types" (
	"tenant_id" integer DEFAULT (current_setting('app.tenant_id'::text))::integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"label" text,
	"color_class" text,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "warehouses" (
	"tenant_id" integer DEFAULT (current_setting('app.tenant_id'::text))::integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"location" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"subcontractor_supplier_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_entries" (
	"tenant_id" integer DEFAULT (current_setting('app.tenant_id'::text))::integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"entry_type" text NOT NULL,
	"item_id" integer NOT NULL,
	"warehouse_id" integer NOT NULL,
	"quantity" numeric(12, 2) NOT NULL,
	"rate" numeric(12, 2) NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"remarks" text,
	"source" text,
	"project_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales_orders" (
	"tenant_id" integer DEFAULT (current_setting('app.tenant_id'::text))::integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"order_number" text NOT NULL,
	"customer_id" integer NOT NULL,
	"salesperson_id" integer,
	"order_date" text NOT NULL,
	"delivery_date" text,
	"status" text DEFAULT 'Draft' NOT NULL,
	"total_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"department_id" integer,
	"project_id" integer,
	"order_source" text,
	"quotation_id" integer,
	"template_id" integer,
	"extra_fields" jsonb DEFAULT '{}'::jsonb,
	"label" text,
	"handler_id" integer,
	"class_weeks" integer,
	"course_start_date" text,
	"course_end_date" text,
	"case_time" text,
	"teacher_code" text,
	"teacher_fee_per_session" numeric(10, 2),
	"teacher_material_fee_method" text,
	"course_period" text,
	"warehouse_code" text,
	"transaction_type" text,
	"date_details" text,
	"remarks" text,
	"invoice_tax_id" text,
	"invoice_title" text,
	"journal_entry_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchase_orders" (
	"tenant_id" integer DEFAULT (current_setting('app.tenant_id'::text))::integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"order_number" text NOT NULL,
	"supplier_id" integer NOT NULL,
	"order_date" text NOT NULL,
	"expected_date" text,
	"status" text DEFAULT 'Draft' NOT NULL,
	"total_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"currency" text DEFAULT 'TWD' NOT NULL,
	"exchange_rate" numeric(12, 6) DEFAULT '1' NOT NULL,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"template_id" integer,
	"extra_fields" jsonb DEFAULT '{}'::jsonb,
	"department_id" integer,
	"project_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"tenant_id" integer DEFAULT (current_setting('app.tenant_id'::text))::integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"phone" text,
	"company" text,
	"source" text,
	"status" text DEFAULT 'New' NOT NULL,
	"estimated_value" numeric(14, 2),
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opportunities" (
	"tenant_id" integer DEFAULT (current_setting('app.tenant_id'::text))::integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"customer_id" integer,
	"status" text DEFAULT 'Open' NOT NULL,
	"stage" text DEFAULT 'Prospecting' NOT NULL,
	"expected_value" numeric(14, 2) DEFAULT '0' NOT NULL,
	"probability" numeric(5, 2) DEFAULT '0' NOT NULL,
	"expected_close_date" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"tenant_id" integer DEFAULT (current_setting('app.tenant_id'::text))::integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"department_id" integer,
	"parent_id" integer,
	"name" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'Open' NOT NULL,
	"priority" text DEFAULT 'Medium' NOT NULL,
	"start_date" text,
	"end_date" text,
	"progress" numeric(5, 2) DEFAULT '0' NOT NULL,
	"budget_income" numeric(14, 2) DEFAULT '0' NOT NULL,
	"budget_expense" numeric(14, 2) DEFAULT '0' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"tenant_id" integer DEFAULT (current_setting('app.tenant_id'::text))::integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"project_id" integer,
	"assigned_to" integer,
	"status" text DEFAULT 'Open' NOT NULL,
	"priority" text DEFAULT 'Medium' NOT NULL,
	"due_date" text,
	"task_group" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "accounts" (
	"tenant_id" integer DEFAULT (current_setting('app.tenant_id'::text))::integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"account_number" text NOT NULL,
	"account_name" text NOT NULL,
	"account_type" text NOT NULL,
	"parent_account_id" integer,
	"balance" numeric(14, 2) DEFAULT '0' NOT NULL,
	"is_group" boolean DEFAULT false NOT NULL,
	"cash_flow_category" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "journal_entries" (
	"tenant_id" integer DEFAULT (current_setting('app.tenant_id'::text))::integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"entry_number" text NOT NULL,
	"entry_date" text NOT NULL,
	"description" text,
	"total_debit" numeric(14, 2) DEFAULT '0' NOT NULL,
	"total_credit" numeric(14, 2) DEFAULT '0' NOT NULL,
	"status" text DEFAULT 'Draft' NOT NULL,
	"lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"project_id" integer,
	"department_id" integer,
	"is_internal_transfer" boolean DEFAULT false NOT NULL,
	"transfer_from_department_id" integer,
	"transfer_to_department_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"tenant_id" integer DEFAULT (current_setting('app.tenant_id'::text))::integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"invoice_number" text NOT NULL,
	"invoice_type" text NOT NULL,
	"customer_id" integer,
	"supplier_id" integer,
	"sales_order_id" integer,
	"delivery_note_id" integer,
	"purchase_order_id" integer,
	"project_id" integer,
	"purchase_receipt_id" integer,
	"subcontract_order_id" integer,
	"invoice_date" text NOT NULL,
	"due_date" text,
	"payment_term_id" integer,
	"payment_schedule" jsonb,
	"status" text DEFAULT 'Draft' NOT NULL,
	"total_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"paid_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"outstanding_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"currency" text DEFAULT 'TWD' NOT NULL,
	"exchange_rate" numeric(12, 6) DEFAULT '1' NOT NULL,
	"tax_type" text DEFAULT 'unclassified' NOT NULL,
	"tax_rate" numeric(5, 2) DEFAULT '5' NOT NULL,
	"net_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"tax_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"gov_invoice_number" text,
	"journal_entry_id" integer,
	"write_off_journal_entry_id" integer,
	"write_off_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"write_off_date" text,
	"write_off_reason" text,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ecpay_invoice_number" text,
	"ecpay_issue_key" text,
	"ecpay_random_number" text,
	"ecpay_invoice_date" text,
	"ecpay_invoice_type" text,
	"ecpay_carrier_type" text,
	"ecpay_carrier_num" text,
	"ecpay_love_code" text,
	"ecpay_tax_id" text,
	"ecpay_company_title" text,
	"ecpay_buyer_name" text,
	"ecpay_buyer_email" text,
	"ecpay_buyer_phone" text,
	"ecpay_buyer_addr" text,
	"ecpay_voided_at" timestamp with time zone,
	"ecpay_void_requested_at" timestamp with time zone,
	"ecpay_void_reason" text,
	"ecpay_response" jsonb,
	"ecpay_status" text,
	"ecpay_last_synced_at" timestamp with time zone,
	"ecpay_last_sync_response" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ecpay_invoice_allowances" (
	"tenant_id" integer DEFAULT (current_setting('app.tenant_id'::text))::integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"invoice_id" integer NOT NULL,
	"idempotency_key" text NOT NULL,
	"allowance_number" text,
	"allowance_date" text NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"items" jsonb NOT NULL,
	"reason" text NOT NULL,
	"notify_type" text DEFAULT 'N' NOT NULL,
	"status" text DEFAULT 'Pending' NOT NULL,
	"void_reason" text,
	"void_requested_at" timestamp with time zone,
	"voided_at" timestamp with time zone,
	"ecpay_response" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ecpay_invoice_issue_requests" (
	"tenant_id" integer DEFAULT (current_setting('app.tenant_id'::text))::integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"sales_order_id" integer NOT NULL,
	"invoice_id" integer,
	"idempotency_key" text NOT NULL,
	"relate_number" text NOT NULL,
	"payload_hash" text NOT NULL,
	"request_payload" jsonb NOT NULL,
	"status" text DEFAULT 'Pending' NOT NULL,
	"ecpay_invoice_number" text,
	"ecpay_invoice_date" text,
	"ecpay_random_number" text,
	"ecpay_response" jsonb,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "activities" (
	"tenant_id" integer DEFAULT (current_setting('app.tenant_id'::text))::integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"module" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "designations" (
	"tenant_id" integer DEFAULT (current_setting('app.tenant_id'::text))::integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"department_id" integer,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "grades" (
	"tenant_id" integer DEFAULT (current_setting('app.tenant_id'::text))::integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"level" integer NOT NULL,
	"min_salary" numeric(15, 2),
	"max_salary" numeric(15, 2),
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_users" (
	"tenant_id" integer DEFAULT 1 NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"password_hash" text NOT NULL,
	"display_name" text NOT NULL,
	"role" text DEFAULT 'admin' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"employee_id" integer,
	"home_shortcuts" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_sessions" (
	"sid" varchar PRIMARY KEY NOT NULL,
	"sess" json NOT NULL,
	"expire" timestamp (6) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "insurance_brackets" (
	"id" serial PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"level" integer NOT NULL,
	"min_salary" integer NOT NULL,
	"max_salary" integer,
	"insured_amount" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shift_types" (
	"tenant_id" integer DEFAULT (current_setting('app.tenant_id'::text))::integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"start_time" text NOT NULL,
	"end_time" text NOT NULL,
	"break_start" text,
	"break_end" text,
	"working_hours" text DEFAULT '8' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "salary_slips" (
	"tenant_id" integer DEFAULT (current_setting('app.tenant_id'::text))::integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"employee_id" integer NOT NULL,
	"year" integer NOT NULL,
	"month" integer NOT NULL,
	"project_id" integer,
	"base_salary" integer NOT NULL,
	"overtime_pay" integer DEFAULT 0 NOT NULL,
	"other_allowances" integer DEFAULT 0 NOT NULL,
	"components" jsonb,
	"other_deductions" integer DEFAULT 0 NOT NULL,
	"attendance_deduction" integer DEFAULT 0 NOT NULL,
	"attendance_summary" jsonb,
	"gross_salary" integer NOT NULL,
	"labor_insurance_bracket" integer NOT NULL,
	"labor_insurance_employee" integer NOT NULL,
	"labor_insurance_employer" integer NOT NULL,
	"health_insurance_bracket" integer NOT NULL,
	"health_insurance_dependents" integer DEFAULT 0 NOT NULL,
	"health_insurance_employee" integer NOT NULL,
	"health_insurance_employer" integer NOT NULL,
	"pension_bracket" integer NOT NULL,
	"pension_employer" integer NOT NULL,
	"pension_employee_self_rate" integer DEFAULT 0 NOT NULL,
	"pension_employee_self" integer DEFAULT 0 NOT NULL,
	"total_deductions" integer NOT NULL,
	"net_salary" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payroll_settings" (
	"tenant_id" integer DEFAULT (current_setting('app.tenant_id'::text))::integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"monthly_divisor" integer DEFAULT 240 NOT NULL,
	"ot_rate1" numeric(4, 2) DEFAULT '1.34' NOT NULL,
	"ot_rate2" numeric(4, 2) DEFAULT '1.67' NOT NULL,
	"ot_threshold_hours" numeric(4, 1) DEFAULT '2' NOT NULL,
	"late_deduction_enabled" boolean DEFAULT false NOT NULL,
	"absence_deduction_enabled" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vouchers" (
	"tenant_id" integer DEFAULT (current_setting('app.tenant_id'::text))::integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"voucher_number" text NOT NULL,
	"voucher_type" text NOT NULL,
	"voucher_date" text NOT NULL,
	"description" text,
	"total_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"status" text DEFAULT '草稿' NOT NULL,
	"project_id" integer,
	"department_id" integer,
	"customer_id" integer,
	"supplier_id" integer,
	"employee_id" integer,
	"journal_entry_id" integer,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "accounting_settings" (
	"tenant_id" integer DEFAULT (current_setting('app.tenant_id'::text))::integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"lock_date" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer DEFAULT (current_setting('app.tenant_id'::text))::integer NOT NULL,
	"doc_type" text NOT NULL,
	"doc_id" integer NOT NULL,
	"recipient" text NOT NULL,
	"subject" text NOT NULL,
	"status" text NOT NULL,
	"error" text,
	"trigger" text DEFAULT 'manual' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_settings" (
	"tenant_id" integer PRIMARY KEY DEFAULT (current_setting('app.tenant_id'::text))::integer NOT NULL,
	"sender_name" text DEFAULT '' NOT NULL,
	"reply_to" text,
	"bank_info" text DEFAULT '' NOT NULL,
	"auto_send_invoice" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoice_settlements" (
	"tenant_id" integer DEFAULT (current_setting('app.tenant_id'::text))::integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"voucher_id" integer,
	"payment_request_id" integer,
	"invoice_id" integer NOT NULL,
	"amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"remarks" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"tenant_id" integer DEFAULT 1 NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"key_name" text NOT NULL,
	"api_key" text NOT NULL,
	"secret_hash" text NOT NULL,
	"project_id" integer,
	"permissions" text DEFAULT 'read' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_used_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_keys_api_key_unique" UNIQUE("api_key")
);
--> statement-breakpoint
CREATE TABLE "quotations" (
	"tenant_id" integer DEFAULT (current_setting('app.tenant_id'::text))::integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"quotation_number" text NOT NULL,
	"customer_id" integer,
	"customer_name" text,
	"quotation_date" text NOT NULL,
	"valid_until" text,
	"status" text DEFAULT 'Draft' NOT NULL,
	"total_amount" numeric(15, 2) DEFAULT '0' NOT NULL,
	"tax_amount" numeric(15, 2) DEFAULT '0' NOT NULL,
	"tax_included" boolean DEFAULT false NOT NULL,
	"grand_total" numeric(15, 2) DEFAULT '0' NOT NULL,
	"currency" text DEFAULT 'TWD' NOT NULL,
	"exchange_rate" numeric(12, 6) DEFAULT '1' NOT NULL,
	"template" text DEFAULT '校園',
	"template_id" integer,
	"extra_fields" jsonb DEFAULT '{}'::jsonb,
	"notes" text,
	"terms" text,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"brand_id" integer,
	"title" text,
	"quoter_name" text,
	"quoter_phone" text,
	"department_id" integer,
	"project_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quotation_templates" (
	"tenant_id" integer DEFAULT (current_setting('app.tenant_id'::text))::integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"category" text NOT NULL,
	"terms" text,
	"notes" text,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "delivery_notes" (
	"tenant_id" integer DEFAULT (current_setting('app.tenant_id'::text))::integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"note_number" text NOT NULL,
	"sales_order_id" integer,
	"customer_id" integer NOT NULL,
	"warehouse_id" integer,
	"delivery_date" text NOT NULL,
	"status" text DEFAULT 'Draft' NOT NULL,
	"total_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"remarks" text,
	"department_id" integer,
	"project_id" integer,
	"cogs_journal_entry_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchase_receipts" (
	"tenant_id" integer DEFAULT (current_setting('app.tenant_id'::text))::integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"receipt_number" text NOT NULL,
	"purchase_order_id" integer,
	"supplier_id" integer NOT NULL,
	"warehouse_id" integer,
	"receipt_date" text NOT NULL,
	"status" text DEFAULT 'Draft' NOT NULL,
	"total_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"remarks" text,
	"extra_fields" jsonb DEFAULT '{}'::jsonb,
	"department_id" integer,
	"project_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales_returns" (
	"tenant_id" integer DEFAULT (current_setting('app.tenant_id'::text))::integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"return_number" text NOT NULL,
	"delivery_note_id" integer,
	"customer_id" integer NOT NULL,
	"warehouse_id" integer,
	"return_date" text NOT NULL,
	"reason" text,
	"status" text DEFAULT 'Draft' NOT NULL,
	"total_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"remarks" text,
	"department_id" integer,
	"project_id" integer,
	"credit_note_invoice_id" integer,
	"reverse_delivery_note_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchase_returns" (
	"tenant_id" integer DEFAULT (current_setting('app.tenant_id'::text))::integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"return_number" text NOT NULL,
	"purchase_receipt_id" integer,
	"supplier_id" integer NOT NULL,
	"warehouse_id" integer,
	"return_date" text NOT NULL,
	"reason" text,
	"status" text DEFAULT 'Draft' NOT NULL,
	"total_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"remarks" text,
	"department_id" integer,
	"project_id" integer,
	"debit_note_invoice_id" integer,
	"reverse_receipt_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_requests" (
	"tenant_id" integer DEFAULT (current_setting('app.tenant_id'::text))::integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"request_number" text NOT NULL,
	"invoice_id" integer,
	"party_type" text NOT NULL,
	"customer_id" integer,
	"supplier_id" integer,
	"request_date" text NOT NULL,
	"due_date" text,
	"amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"status" text DEFAULT 'Draft' NOT NULL,
	"payment_method" text,
	"bank_account" text,
	"remarks" text,
	"requested_by" text,
	"metadata" jsonb,
	"department_id" integer,
	"project_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "price_list_items" (
	"tenant_id" integer DEFAULT (current_setting('app.tenant_id'::text))::integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"price_list_id" integer NOT NULL,
	"item_id" integer NOT NULL,
	"price" numeric(14, 2) DEFAULT '0' NOT NULL,
	"min_quantity" numeric(12, 2) DEFAULT '1' NOT NULL,
	"valid_from" text,
	"valid_to" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "price_lists" (
	"tenant_id" integer DEFAULT (current_setting('app.tenant_id'::text))::integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"currency" text DEFAULT 'TWD' NOT NULL,
	"customer_group" text,
	"is_active" text DEFAULT 'Y' NOT NULL,
	"remarks" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "asset_categories" (
	"tenant_id" integer DEFAULT (current_setting('app.tenant_id'::text))::integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"depreciation_method" text DEFAULT 'straight-line' NOT NULL,
	"default_useful_life_years" integer DEFAULT 5 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assets" (
	"tenant_id" integer DEFAULT (current_setting('app.tenant_id'::text))::integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"asset_number" text NOT NULL,
	"name" text NOT NULL,
	"category_id" integer NOT NULL,
	"status" text DEFAULT 'Draft' NOT NULL,
	"purchase_date" text NOT NULL,
	"purchase_cost" numeric(14, 2) NOT NULL,
	"depreciation_method" text DEFAULT 'straight-line' NOT NULL,
	"useful_life_years" integer NOT NULL,
	"salvage_value" numeric(14, 2) DEFAULT '0' NOT NULL,
	"current_value" numeric(14, 2) NOT NULL,
	"accumulated_depreciation" numeric(14, 2) DEFAULT '0' NOT NULL,
	"department_id" integer,
	"assigned_to" integer,
	"location" text,
	"serial_number" text,
	"warranty_expiry" text,
	"disposal_date" text,
	"disposal_amount" numeric(14, 2),
	"remarks" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "asset_depreciation_entries" (
	"tenant_id" integer DEFAULT (current_setting('app.tenant_id'::text))::integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"asset_id" integer NOT NULL,
	"depreciation_date" text NOT NULL,
	"depreciation_amount" numeric(14, 2) NOT NULL,
	"accumulated_amount" numeric(14, 2) NOT NULL,
	"book_value" numeric(14, 2) NOT NULL,
	"period" text NOT NULL,
	"journal_entry_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "asset_maintenance" (
	"tenant_id" integer DEFAULT (current_setting('app.tenant_id'::text))::integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"asset_id" integer NOT NULL,
	"maintenance_type" text NOT NULL,
	"description" text,
	"scheduled_date" text NOT NULL,
	"completed_date" text,
	"cost" numeric(14, 2) DEFAULT '0' NOT NULL,
	"vendor" text,
	"status" text DEFAULT 'Scheduled' NOT NULL,
	"remarks" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "asset_movements" (
	"tenant_id" integer DEFAULT (current_setting('app.tenant_id'::text))::integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"asset_id" integer NOT NULL,
	"from_department_id" integer,
	"to_department_id" integer,
	"from_location" text,
	"to_location" text,
	"movement_date" text NOT NULL,
	"reason" text,
	"performed_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "asset_value_adjustments" (
	"tenant_id" integer DEFAULT (current_setting('app.tenant_id'::text))::integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"asset_id" integer NOT NULL,
	"adjustment_date" text NOT NULL,
	"previous_value" numeric(14, 2) NOT NULL,
	"new_value" numeric(14, 2) NOT NULL,
	"adjustment_amount" numeric(14, 2) NOT NULL,
	"reason" text NOT NULL,
	"journal_entry_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workstations" (
	"tenant_id" integer DEFAULT (current_setting('app.tenant_id'::text))::integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"production_capacity" integer DEFAULT 1 NOT NULL,
	"hour_rate" numeric(12, 2) DEFAULT '0' NOT NULL,
	"status" text DEFAULT 'Active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bom_items" (
	"tenant_id" integer DEFAULT (current_setting('app.tenant_id'::text))::integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"bom_id" integer NOT NULL,
	"item_id" integer NOT NULL,
	"quantity" numeric(12, 4) NOT NULL,
	"unit" text DEFAULT 'Nos' NOT NULL,
	"rate" numeric(12, 2) DEFAULT '0' NOT NULL,
	"amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"parent_bom_item_id" integer,
	"level" integer DEFAULT 0 NOT NULL,
	"remarks" text
);
--> statement-breakpoint
CREATE TABLE "boms" (
	"tenant_id" integer DEFAULT (current_setting('app.tenant_id'::text))::integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"bom_number" text NOT NULL,
	"item_id" integer NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"quantity" numeric(12, 2) DEFAULT '1' NOT NULL,
	"unit" text DEFAULT 'Nos' NOT NULL,
	"status" text DEFAULT 'Draft' NOT NULL,
	"remarks" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_order_items" (
	"tenant_id" integer DEFAULT (current_setting('app.tenant_id'::text))::integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"work_order_id" integer NOT NULL,
	"item_id" integer NOT NULL,
	"required_quantity" numeric(12, 4) NOT NULL,
	"issued_quantity" numeric(12, 4) DEFAULT '0' NOT NULL,
	"unit" text DEFAULT 'Nos' NOT NULL,
	"is_virtual" boolean
);
--> statement-breakpoint
CREATE TABLE "work_orders" (
	"tenant_id" integer DEFAULT (current_setting('app.tenant_id'::text))::integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"work_order_number" text NOT NULL,
	"bom_id" integer NOT NULL,
	"item_id" integer NOT NULL,
	"sales_order_id" integer,
	"planned_quantity" numeric(12, 2) NOT NULL,
	"completed_quantity" numeric(12, 2) DEFAULT '0' NOT NULL,
	"conversion_cost" numeric(14, 2) DEFAULT '0' NOT NULL,
	"status" text DEFAULT 'Draft' NOT NULL,
	"priority" text DEFAULT 'Medium' NOT NULL,
	"planned_start_date" text,
	"planned_end_date" text,
	"actual_start_date" text,
	"actual_end_date" text,
	"remarks" text,
	"item_is_virtual" boolean,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_cards" (
	"tenant_id" integer DEFAULT (current_setting('app.tenant_id'::text))::integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"job_card_number" text NOT NULL,
	"work_order_id" integer NOT NULL,
	"workstation_id" integer,
	"operation_name" text NOT NULL,
	"sequence_no" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'Open' NOT NULL,
	"planned_quantity" numeric(12, 2) NOT NULL,
	"completed_quantity" numeric(12, 2) DEFAULT '0' NOT NULL,
	"start_time" text,
	"end_time" text,
	"total_hours" numeric(8, 2) DEFAULT '0' NOT NULL,
	"cost_applied" boolean DEFAULT false NOT NULL,
	"remarks" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quality_inspection_templates" (
	"tenant_id" integer DEFAULT (current_setting('app.tenant_id'::text))::integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"inspection_type" text DEFAULT 'Incoming' NOT NULL,
	"item_id" integer,
	"criteria" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"remarks" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quality_inspections" (
	"tenant_id" integer DEFAULT (current_setting('app.tenant_id'::text))::integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"inspection_number" text NOT NULL,
	"template_id" integer,
	"inspection_type" text DEFAULT 'Incoming' NOT NULL,
	"item_id" integer,
	"reference_type" text,
	"reference_id" integer,
	"inspected_quantity" integer DEFAULT 0 NOT NULL,
	"accepted_quantity" integer DEFAULT 0 NOT NULL,
	"rejected_quantity" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'Draft' NOT NULL,
	"result" text,
	"inspector_name" text,
	"inspection_date" text NOT NULL,
	"results" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"remarks" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "non_conformance_reports" (
	"tenant_id" integer DEFAULT (current_setting('app.tenant_id'::text))::integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"report_number" text NOT NULL,
	"title" text NOT NULL,
	"item_id" integer,
	"reference_type" text,
	"reference_id" integer,
	"severity" text DEFAULT 'Minor' NOT NULL,
	"status" text DEFAULT 'Open' NOT NULL,
	"description" text NOT NULL,
	"root_cause" text,
	"corrective_action" text,
	"reported_by" text,
	"report_date" text NOT NULL,
	"closed_date" text,
	"remarks" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "capa_actions" (
	"tenant_id" integer DEFAULT (current_setting('app.tenant_id'::text))::integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"capa_number" text NOT NULL,
	"title" text NOT NULL,
	"type" text DEFAULT 'Corrective' NOT NULL,
	"non_conformance_id" integer,
	"status" text DEFAULT 'Open' NOT NULL,
	"priority" text DEFAULT 'Medium' NOT NULL,
	"description" text NOT NULL,
	"assigned_to" text,
	"due_date" text,
	"completed_date" text,
	"verification_result" text,
	"remarks" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sla_definitions" (
	"tenant_id" integer DEFAULT (current_setting('app.tenant_id'::text))::integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"priority" text DEFAULT 'Medium' NOT NULL,
	"response_time_hours" integer DEFAULT 4 NOT NULL,
	"resolution_time_hours" integer DEFAULT 24 NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "support_tickets" (
	"tenant_id" integer DEFAULT (current_setting('app.tenant_id'::text))::integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"ticket_number" text NOT NULL,
	"subject" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'Open' NOT NULL,
	"priority" text DEFAULT 'Medium' NOT NULL,
	"category_id" integer,
	"customer_id" integer,
	"assigned_to" integer,
	"sla_id" integer,
	"response_deadline" timestamp with time zone,
	"resolution_deadline" timestamp with time zone,
	"first_response_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"resolution" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ticket_categories" (
	"tenant_id" integer DEFAULT (current_setting('app.tenant_id'::text))::integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"parent_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kb_articles" (
	"tenant_id" integer DEFAULT (current_setting('app.tenant_id'::text))::integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"content" text,
	"category_id" integer,
	"status" text DEFAULT 'Draft' NOT NULL,
	"author_id" integer,
	"tags" text,
	"view_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kb_categories" (
	"tenant_id" integer DEFAULT (current_setting('app.tenant_id'::text))::integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contracts" (
	"tenant_id" integer DEFAULT (current_setting('app.tenant_id'::text))::integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"contract_number" text NOT NULL,
	"title" text NOT NULL,
	"party_type" text DEFAULT 'Customer' NOT NULL,
	"customer_id" integer,
	"supplier_id" integer,
	"status" text DEFAULT 'Draft' NOT NULL,
	"start_date" date,
	"end_date" date,
	"contract_value" numeric(14, 2),
	"terms" text,
	"description" text,
	"renewal_date" date,
	"auto_renew" text DEFAULT 'No',
	"contact_person" text,
	"employee_id" integer,
	"teacher_id" integer,
	"contract_type" text,
	"pay_basis" text,
	"signed_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bank_reconciliation_entries" (
	"tenant_id" integer DEFAULT (current_setting('app.tenant_id'::text))::integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"statement_id" integer NOT NULL,
	"transaction_date" date NOT NULL,
	"description" text,
	"debit" numeric(14, 2) DEFAULT '0',
	"credit" numeric(14, 2) DEFAULT '0',
	"balance" numeric(14, 2) DEFAULT '0',
	"reference" text,
	"matched_voucher_id" integer,
	"match_status" text DEFAULT 'Unmatched' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bank_statements" (
	"tenant_id" integer DEFAULT (current_setting('app.tenant_id'::text))::integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"bank_name" text NOT NULL,
	"account_number" text,
	"statement_date" date NOT NULL,
	"opening_balance" numeric(14, 2) DEFAULT '0' NOT NULL,
	"closing_balance" numeric(14, 2) DEFAULT '0' NOT NULL,
	"status" text DEFAULT 'Pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approval_requests" (
	"tenant_id" integer DEFAULT (current_setting('app.tenant_id'::text))::integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"workflow_id" integer,
	"document_type" text NOT NULL,
	"document_id" integer NOT NULL,
	"document_number" text,
	"requested_by" text NOT NULL,
	"current_step" integer DEFAULT 1 NOT NULL,
	"total_steps" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'Pending' NOT NULL,
	"approvers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"comments" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approval_workflows" (
	"tenant_id" integer DEFAULT (current_setting('app.tenant_id'::text))::integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"module" text NOT NULL,
	"document_type" text NOT NULL,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_active" text DEFAULT 'Yes' NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"tenant_id" integer DEFAULT (current_setting('app.tenant_id'::text))::integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"message" text NOT NULL,
	"type" text DEFAULT 'info' NOT NULL,
	"module" text,
	"document_type" text,
	"document_id" integer,
	"recipient" text,
	"is_read" text DEFAULT 'No' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attachments" (
	"tenant_id" integer DEFAULT (current_setting('app.tenant_id'::text))::integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"file_number" text NOT NULL,
	"file_name" text NOT NULL,
	"file_type" text,
	"file_size" integer,
	"file_path" text NOT NULL,
	"module" text NOT NULL,
	"document_type" text NOT NULL,
	"document_id" integer NOT NULL,
	"uploaded_by" text,
	"description" text,
	"tags" text,
	"status" text DEFAULT 'Active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "print_templates" (
	"tenant_id" integer DEFAULT (current_setting('app.tenant_id'::text))::integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"module" text NOT NULL,
	"document_type" text NOT NULL,
	"format" text DEFAULT 'A4' NOT NULL,
	"orientation" text DEFAULT 'portrait' NOT NULL,
	"header_html" text,
	"body_html" text,
	"footer_html" text,
	"css_styles" text,
	"layout" jsonb,
	"is_default" text DEFAULT 'No' NOT NULL,
	"status" text DEFAULT 'Active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"tenant_id" integer DEFAULT (current_setting('app.tenant_id'::text))::integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"action" text NOT NULL,
	"module" text NOT NULL,
	"document_type" text,
	"document_id" integer,
	"document_number" text,
	"user_id" text,
	"user_name" text,
	"ip_address" text,
	"old_values" jsonb,
	"new_values" jsonb,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calendar_events" (
	"tenant_id" integer DEFAULT (current_setting('app.tenant_id'::text))::integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"event_type" text DEFAULT 'General' NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date,
	"start_time" text,
	"end_time" text,
	"all_day" text DEFAULT 'Yes' NOT NULL,
	"location" text,
	"module" text,
	"document_type" text,
	"document_id" integer,
	"color" text DEFAULT '#3b82f6',
	"assigned_to" text,
	"reminder" text,
	"status" text DEFAULT 'Active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "currencies" (
	"tenant_id" integer DEFAULT (current_setting('app.tenant_id'::text))::integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"symbol" text NOT NULL,
	"is_base" text DEFAULT 'No' NOT NULL,
	"is_active" text DEFAULT 'Yes' NOT NULL,
	"decimal_places" text DEFAULT '2' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exchange_rates" (
	"tenant_id" integer DEFAULT (current_setting('app.tenant_id'::text))::integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"from_currency" text NOT NULL,
	"to_currency" text NOT NULL,
	"rate" numeric(14, 6) NOT NULL,
	"effective_date" date NOT NULL,
	"source" text DEFAULT 'Manual',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "teachers" (
	"tenant_id" integer DEFAULT (current_setting('app.tenant_id'::text))::integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"teacher_id" text NOT NULL,
	"name" text NOT NULL,
	"position" text,
	"phone" text,
	"email" text,
	"skills" text,
	"address" text,
	"registered_address" text,
	"id_number" text,
	"date_of_birth" text,
	"bank_name" text,
	"bank_account_name" text,
	"bank_account_number" text,
	"bank_branch" text,
	"other_positions" text,
	"referrer" text,
	"teaching_experience" text,
	"preferred_area" text,
	"notes" text,
	"status" text DEFAULT 'Active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "receivable_payable_entries" (
	"tenant_id" integer DEFAULT (current_setting('app.tenant_id'::text))::integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"entry_type" text NOT NULL,
	"entry_date" date NOT NULL,
	"entry_number" text,
	"transaction_type" text,
	"debt_number" text,
	"passbook_code" text,
	"party_name" text,
	"customer_id" integer,
	"supplier_id" integer,
	"account_name" text,
	"account_id" integer,
	"department_id" integer,
	"project_id" integer,
	"description" text,
	"increase_amount" numeric DEFAULT '0',
	"decrease_amount" numeric DEFAULT '0',
	"balance" numeric DEFAULT '0',
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "order_templates" (
	"tenant_id" integer DEFAULT (current_setting('app.tenant_id'::text))::integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"business_type" text NOT NULL,
	"project_id" integer,
	"description" text,
	"field_schema" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"default_values" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_registrants" (
	"tenant_id" integer DEFAULT (current_setting('app.tenant_id'::text))::integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"sales_order_id" integer NOT NULL,
	"name" text NOT NULL,
	"contact_info" text,
	"age" text,
	"grade" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "menu_permissions" (
	"tenant_id" integer DEFAULT (current_setting('app.tenant_id'::text))::integer NOT NULL,
	"path" text NOT NULL,
	"roles" text[] DEFAULT '{}' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "menu_permissions_tenant_id_path_pk" PRIMARY KEY("tenant_id","path")
);
--> statement-breakpoint
CREATE TABLE "brands" (
	"tenant_id" integer DEFAULT (current_setting('app.tenant_id'::text))::integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"tax_id" text,
	"address" text,
	"contact_person" text,
	"tel" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"delta" integer NOT NULL,
	"balance_after" integer NOT NULL,
	"reason" text NOT NULL,
	"stripe_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"company_code" text,
	"status" text DEFAULT 'trialing' NOT NULL,
	"is_exempt" boolean DEFAULT false NOT NULL,
	"trial_ends_at" timestamp with time zone,
	"stripe_customer_id" text,
	"stripe_subscription_id" text,
	"ai_credits" integer DEFAULT 10 NOT NULL,
	"contact_email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leave_grants" (
	"tenant_id" integer DEFAULT (current_setting('app.tenant_id'::text))::integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"employee_id" integer NOT NULL,
	"leave_type" text DEFAULT 'Annual Leave' NOT NULL,
	"period_start" text NOT NULL,
	"period_end" text NOT NULL,
	"days" numeric(5, 1) NOT NULL,
	"source" text DEFAULT 'auto' NOT NULL,
	"note" text,
	"created_by" text,
	"settled_at" timestamp with time zone,
	"settled_days" numeric(5, 1),
	"settled_amount" numeric(12, 2),
	"settled_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_fees" (
	"tenant_id" integer DEFAULT (current_setting('app.tenant_id'::text))::integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"fee_number" text NOT NULL,
	"payee_type" text NOT NULL,
	"teacher_id" integer,
	"employee_id" integer,
	"payee_name" text NOT NULL,
	"sales_order_id" integer,
	"project_id" integer NOT NULL,
	"department_id" integer,
	"service_date" text NOT NULL,
	"description" text,
	"hours" numeric(8, 2),
	"rate" numeric(12, 2),
	"amount" numeric(12, 2) NOT NULL,
	"income_type" text DEFAULT '50' NOT NULL,
	"withholding_tax" numeric(12, 2) DEFAULT '0' NOT NULL,
	"nhi_supplement" numeric(12, 2) DEFAULT '0' NOT NULL,
	"net_amount" numeric(12, 2) NOT NULL,
	"status" text DEFAULT 'Confirmed' NOT NULL,
	"paid_date" text,
	"journal_entry_id" integer,
	"payment_journal_entry_id" integer,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employee_salary_components" (
	"tenant_id" integer DEFAULT (current_setting('app.tenant_id'::text))::integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"employee_id" integer NOT NULL,
	"component_id" integer NOT NULL,
	"amount" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "salary_components" (
	"tenant_id" integer DEFAULT (current_setting('app.tenant_id'::text))::integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'earning' NOT NULL,
	"default_amount" integer DEFAULT 0 NOT NULL,
	"insurable" boolean DEFAULT true NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_terms" (
	"tenant_id" integer DEFAULT (current_setting('app.tenant_id'::text))::integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"installments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_counts" (
	"tenant_id" integer DEFAULT (current_setting('app.tenant_id'::text))::integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"count_number" text NOT NULL,
	"warehouse_id" integer NOT NULL,
	"count_date" text NOT NULL,
	"basis" text DEFAULT 'warehouse' NOT NULL,
	"project_id" integer NOT NULL,
	"status" text DEFAULT 'Draft' NOT NULL,
	"lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"remarks" text,
	"created_by" text,
	"posted_by" text,
	"posted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "timesheets" (
	"tenant_id" integer DEFAULT (current_setting('app.tenant_id'::text))::integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"employee_id" integer NOT NULL,
	"work_date" text NOT NULL,
	"project_id" integer NOT NULL,
	"task_id" integer,
	"work_order_id" integer,
	"hours" numeric(6, 2) NOT NULL,
	"hourly_cost" numeric(12, 2) DEFAULT '0' NOT NULL,
	"cost_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"description" text,
	"status" text DEFAULT 'Submitted' NOT NULL,
	"approved_by" text,
	"cost_applied" boolean DEFAULT false NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "budgets" (
	"tenant_id" integer DEFAULT (current_setting('app.tenant_id'::text))::integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"fiscal_year" integer NOT NULL,
	"account_id" integer NOT NULL,
	"month" integer NOT NULL,
	"amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dunning_logs" (
	"tenant_id" integer DEFAULT (current_setting('app.tenant_id'::text))::integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"invoice_id" integer NOT NULL,
	"customer_id" integer,
	"level" integer DEFAULT 1 NOT NULL,
	"dunned_date" text NOT NULL,
	"channel" text DEFAULT 'phone' NOT NULL,
	"overdue_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"note" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "material_requests" (
	"tenant_id" integer DEFAULT (current_setting('app.tenant_id'::text))::integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"request_number" text NOT NULL,
	"request_date" text NOT NULL,
	"needed_by" text,
	"requester_name" text NOT NULL,
	"project_id" integer NOT NULL,
	"department_id" integer,
	"status" text DEFAULT 'Submitted' NOT NULL,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reason" text,
	"reviewed_by" text,
	"review_note" text,
	"purchase_order_id" integer,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recurring_invoices" (
	"tenant_id" integer DEFAULT (current_setting('app.tenant_id'::text))::integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"invoice_type" text DEFAULT 'Sales' NOT NULL,
	"customer_id" integer,
	"supplier_id" integer,
	"project_id" integer NOT NULL,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tax_type" text DEFAULT 'taxable' NOT NULL,
	"frequency" text DEFAULT 'monthly' NOT NULL,
	"next_run_date" text NOT NULL,
	"end_date" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_run_date" text,
	"last_invoice_id" integer,
	"run_count" integer DEFAULT 0 NOT NULL,
	"note" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subcontract_orders" (
	"tenant_id" integer DEFAULT (current_setting('app.tenant_id'::text))::integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"order_number" text NOT NULL,
	"supplier_id" integer NOT NULL,
	"item_id" integer NOT NULL,
	"bom_id" integer,
	"project_id" integer NOT NULL,
	"quantity" numeric(12, 2) NOT NULL,
	"received_quantity" numeric(12, 2) DEFAULT '0' NOT NULL,
	"unit_fee" numeric(12, 2) DEFAULT '0' NOT NULL,
	"taxable" boolean DEFAULT true NOT NULL,
	"vendor_warehouse_id" integer NOT NULL,
	"status" text DEFAULT 'Open' NOT NULL,
	"order_date" text NOT NULL,
	"expected_date" text,
	"remarks" text,
	"materials" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"material_cost" numeric(14, 2) DEFAULT '0' NOT NULL,
	"fee_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"loss_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integration_events" (
	"tenant_id" integer DEFAULT (current_setting('app.tenant_id'::text))::integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"source_id" integer NOT NULL,
	"kind" text NOT NULL,
	"external_id" text NOT NULL,
	"occurred_at" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"error" text,
	"result" jsonb,
	"attempts" integer DEFAULT 0 NOT NULL,
	"amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"summary" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"processed_by" text
);
--> statement-breakpoint
CREATE TABLE "integration_item_maps" (
	"tenant_id" integer DEFAULT (current_setting('app.tenant_id'::text))::integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"source_id" integer NOT NULL,
	"external_sku" text NOT NULL,
	"external_name" text,
	"item_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integration_mappings" (
	"tenant_id" integer DEFAULT (current_setting('app.tenant_id'::text))::integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"source_id" integer NOT NULL,
	"external_type" text NOT NULL,
	"label" text,
	"project_id" integer,
	"department_id" integer,
	"revenue_account_id" integer,
	"expense_account_id" integer,
	"default_item_id" integer,
	"template_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integration_sources" (
	"tenant_id" integer DEFAULT (current_setting('app.tenant_id'::text))::integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"api_key_id" integer,
	"default_project_id" integer,
	"default_department_id" integer,
	"default_cash_account_id" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stored_value_ledger" (
	"tenant_id" integer DEFAULT (current_setting('app.tenant_id'::text))::integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"source_id" integer NOT NULL,
	"customer_id" integer NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"entry_type" text NOT NULL,
	"event_id" integer,
	"entry_date" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "channel_payouts" (
	"tenant_id" integer DEFAULT (current_setting('app.tenant_id'::text))::integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"payout_number" text NOT NULL,
	"channel_id" integer NOT NULL,
	"payout_date" text NOT NULL,
	"bank_account_id" integer NOT NULL,
	"gross_amount" numeric(14, 2) NOT NULL,
	"fee_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"extra_fee" numeric(14, 2) DEFAULT '0' NOT NULL,
	"bank_amount" numeric(14, 2) NOT NULL,
	"line_count" integer DEFAULT 0 NOT NULL,
	"reference" text,
	"note" text,
	"journal_entry_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'Posted' NOT NULL,
	"created_by" text,
	"voided_by" text,
	"voided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "channel_receivables" (
	"tenant_id" integer DEFAULT (current_setting('app.tenant_id'::text))::integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"channel_id" integer NOT NULL,
	"kind" text DEFAULT 'order' NOT NULL,
	"source_id" integer,
	"event_id" integer,
	"sales_order_id" integer,
	"order_number" text,
	"external_ref" text NOT NULL,
	"entry_date" text NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"expected_fee" numeric(14, 2),
	"project_id" integer,
	"department_id" integer,
	"payout_id" integer,
	"settled_fee" numeric(14, 2),
	"settled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_channels" (
	"tenant_id" integer DEFAULT (current_setting('app.tenant_id'::text))::integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"methods" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"receivable_account_id" integer NOT NULL,
	"fee_account_id" integer,
	"bank_account_id" integer,
	"start_date" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "legacy_documents" (
	"tenant_id" integer DEFAULT (current_setting('app.tenant_id'::text))::integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"source" text DEFAULT 'ecount' NOT NULL,
	"doc_type" text NOT NULL,
	"doc_number" text NOT NULL,
	"doc_date" text,
	"party_name" text,
	"project_name" text,
	"staff_name" text,
	"total" numeric(16, 2),
	"line_count" integer DEFAULT 0 NOT NULL,
	"search_text" text,
	"lines" json DEFAULT '[]'::json NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenant_integrations" (
	"tenant_id" integer DEFAULT (current_setting('app.tenant_id'::text))::integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"secret_cipher" text,
	"secret_hint" text,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "advances" (
	"tenant_id" integer DEFAULT (current_setting('app.tenant_id'::text))::integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"advance_number" text NOT NULL,
	"party_type" text NOT NULL,
	"employee_id" integer,
	"party_name" text NOT NULL,
	"kind" text NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"tax_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"repaid_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"entry_date" text NOT NULL,
	"description" text,
	"project_id" integer,
	"department_id" integer,
	"counter_account_id" integer NOT NULL,
	"liability_account_id" integer NOT NULL,
	"status" text DEFAULT 'Open' NOT NULL,
	"journal_entry_id" integer,
	"repayments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rfqs" (
	"tenant_id" integer DEFAULT (current_setting('app.tenant_id'::text))::integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"rfq_number" text NOT NULL,
	"rfq_date" text NOT NULL,
	"due_date" text,
	"title" text,
	"status" text DEFAULT 'Open' NOT NULL,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"quotes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"project_id" integer,
	"department_id" integer,
	"awarded_supplier_id" integer,
	"purchase_order_id" integer,
	"notes" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "change_requests" (
	"tenant_id" integer DEFAULT (current_setting('app.tenant_id'::text))::integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"request_number" text NOT NULL,
	"kind" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" integer,
	"target_number" text,
	"title" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"original" jsonb,
	"reason" text DEFAULT '' NOT NULL,
	"requested_by" text NOT NULL,
	"requested_role" text,
	"status" text DEFAULT 'Pending' NOT NULL,
	"result" text,
	"applied_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account_recovery_profiles" ADD CONSTRAINT "account_recovery_profiles_user_id_admin_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "admin_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_recovery_tokens" ADD CONSTRAINT "account_recovery_tokens_user_id_admin_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "admin_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leaves" ADD CONSTRAINT "leaves_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_entries" ADD CONSTRAINT "stock_entries_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_entries" ADD CONSTRAINT "stock_entries_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_salesperson_id_employees_id_fk" FOREIGN KEY ("salesperson_id") REFERENCES "employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_quotation_id_quotations_id_fk" FOREIGN KEY ("quotation_id") REFERENCES "quotations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_template_id_order_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "order_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_handler_id_employees_id_fk" FOREIGN KEY ("handler_id") REFERENCES "employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_template_id_order_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "order_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assigned_to_employees_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_sales_order_id_sales_orders_id_fk" FOREIGN KEY ("sales_order_id") REFERENCES "sales_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_delivery_note_id_delivery_notes_id_fk" FOREIGN KEY ("delivery_note_id") REFERENCES "delivery_notes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_purchase_order_id_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_purchase_receipt_id_purchase_receipts_id_fk" FOREIGN KEY ("purchase_receipt_id") REFERENCES "purchase_receipts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ecpay_invoice_allowances" ADD CONSTRAINT "ecpay_invoice_allowances_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ecpay_invoice_issue_requests" ADD CONSTRAINT "ecpay_invoice_issue_requests_sales_order_id_sales_orders_id_fk" FOREIGN KEY ("sales_order_id") REFERENCES "sales_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ecpay_invoice_issue_requests" ADD CONSTRAINT "ecpay_invoice_issue_requests_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "designations" ADD CONSTRAINT "designations_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_users" ADD CONSTRAINT "admin_users_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salary_slips" ADD CONSTRAINT "salary_slips_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_settlements" ADD CONSTRAINT "invoice_settlements_voucher_id_vouchers_id_fk" FOREIGN KEY ("voucher_id") REFERENCES "vouchers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_settlements" ADD CONSTRAINT "invoice_settlements_payment_request_id_payment_requests_id_fk" FOREIGN KEY ("payment_request_id") REFERENCES "payment_requests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_settlements" ADD CONSTRAINT "invoice_settlements_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_template_id_order_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "order_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_notes" ADD CONSTRAINT "delivery_notes_sales_order_id_sales_orders_id_fk" FOREIGN KEY ("sales_order_id") REFERENCES "sales_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_notes" ADD CONSTRAINT "delivery_notes_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_notes" ADD CONSTRAINT "delivery_notes_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_notes" ADD CONSTRAINT "delivery_notes_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_notes" ADD CONSTRAINT "delivery_notes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_receipts" ADD CONSTRAINT "purchase_receipts_purchase_order_id_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_receipts" ADD CONSTRAINT "purchase_receipts_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_receipts" ADD CONSTRAINT "purchase_receipts_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_receipts" ADD CONSTRAINT "purchase_receipts_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_receipts" ADD CONSTRAINT "purchase_receipts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_delivery_note_id_delivery_notes_id_fk" FOREIGN KEY ("delivery_note_id") REFERENCES "delivery_notes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_purchase_receipt_id_purchase_receipts_id_fk" FOREIGN KEY ("purchase_receipt_id") REFERENCES "purchase_receipts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_list_items" ADD CONSTRAINT "price_list_items_price_list_id_price_lists_id_fk" FOREIGN KEY ("price_list_id") REFERENCES "price_lists"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_list_items" ADD CONSTRAINT "price_list_items_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_category_id_asset_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "asset_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_assigned_to_employees_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_depreciation_entries" ADD CONSTRAINT "asset_depreciation_entries_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_depreciation_entries" ADD CONSTRAINT "asset_depreciation_entries_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_maintenance" ADD CONSTRAINT "asset_maintenance_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_movements" ADD CONSTRAINT "asset_movements_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_movements" ADD CONSTRAINT "asset_movements_from_department_id_departments_id_fk" FOREIGN KEY ("from_department_id") REFERENCES "departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_movements" ADD CONSTRAINT "asset_movements_to_department_id_departments_id_fk" FOREIGN KEY ("to_department_id") REFERENCES "departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_value_adjustments" ADD CONSTRAINT "asset_value_adjustments_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_value_adjustments" ADD CONSTRAINT "asset_value_adjustments_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bom_items" ADD CONSTRAINT "bom_items_bom_id_boms_id_fk" FOREIGN KEY ("bom_id") REFERENCES "boms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bom_items" ADD CONSTRAINT "bom_items_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boms" ADD CONSTRAINT "boms_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_items" ADD CONSTRAINT "work_order_items_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_items" ADD CONSTRAINT "work_order_items_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_bom_id_boms_id_fk" FOREIGN KEY ("bom_id") REFERENCES "boms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_sales_order_id_sales_orders_id_fk" FOREIGN KEY ("sales_order_id") REFERENCES "sales_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_cards" ADD CONSTRAINT "job_cards_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_cards" ADD CONSTRAINT "job_cards_workstation_id_workstations_id_fk" FOREIGN KEY ("workstation_id") REFERENCES "workstations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_inspection_templates" ADD CONSTRAINT "quality_inspection_templates_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_inspections" ADD CONSTRAINT "quality_inspections_template_id_quality_inspection_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "quality_inspection_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_inspections" ADD CONSTRAINT "quality_inspections_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "non_conformance_reports" ADD CONSTRAINT "non_conformance_reports_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capa_actions" ADD CONSTRAINT "capa_actions_non_conformance_id_non_conformance_reports_id_fk" FOREIGN KEY ("non_conformance_id") REFERENCES "non_conformance_reports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_templates" ADD CONSTRAINT "order_templates_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_registrants" ADD CONSTRAINT "order_registrants_sales_order_id_sales_orders_id_fk" FOREIGN KEY ("sales_order_id") REFERENCES "sales_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_grants" ADD CONSTRAINT "leave_grants_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_actions_tenant_created_idx" ON "ai_actions" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_customer_drafts_tenant_created_idx" ON "ai_customer_drafts" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_drafts_tenant_created_idx" ON "ai_draft_documents" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "account_recovery_tokens_user_purpose" ON "account_recovery_tokens" USING btree ("tenant_id","user_id","purpose");--> statement-breakpoint
CREATE UNIQUE INDEX "employees_employee_id_unique" ON "employees" USING btree ("tenant_id","employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "employees_email_unique" ON "employees" USING btree ("tenant_id","email");--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_emp_date_uniq" ON "attendance" USING btree ("tenant_id","employee_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "items_item_code_unique" ON "items" USING btree ("tenant_id","item_code");--> statement-breakpoint
CREATE UNIQUE INDEX "item_categories_name_unique" ON "item_categories" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "item_types_name_unique" ON "item_types" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_orders_order_number_unique" ON "sales_orders" USING btree ("tenant_id","order_number");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_orders_order_number_unique" ON "purchase_orders" USING btree ("tenant_id","order_number");--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_account_number_unique" ON "accounts" USING btree ("tenant_id","account_number");--> statement-breakpoint
CREATE UNIQUE INDEX "journal_entries_entry_number_unique" ON "journal_entries" USING btree ("tenant_id","entry_number");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_invoice_number_unique" ON "invoices" USING btree ("tenant_id","invoice_number");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_ecpay_issue_key_unique" ON "invoices" USING btree ("tenant_id","ecpay_issue_key");--> statement-breakpoint
CREATE UNIQUE INDEX "ecpay_allowances_idempotency_unique" ON "ecpay_invoice_allowances" USING btree ("tenant_id","invoice_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "ecpay_allowances_number_unique" ON "ecpay_invoice_allowances" USING btree ("tenant_id","allowance_number");--> statement-breakpoint
CREATE INDEX "ecpay_allowances_invoice_idx" ON "ecpay_invoice_allowances" USING btree ("tenant_id","invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ecpay_invoice_issue_requests_tenant_key_unique" ON "ecpay_invoice_issue_requests" USING btree ("tenant_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "ecpay_invoice_issue_requests_relate_number_unique" ON "ecpay_invoice_issue_requests" USING btree ("relate_number");--> statement-breakpoint
CREATE INDEX "ecpay_invoice_issue_requests_order_idx" ON "ecpay_invoice_issue_requests" USING btree ("tenant_id","sales_order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "admin_users_tenant_username_unique" ON "admin_users" USING btree ("tenant_id","username");--> statement-breakpoint
CREATE UNIQUE INDEX "admin_users_employee_id_unique" ON "admin_users" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "IDX_user_sessions_expire" ON "user_sessions" USING btree ("expire");--> statement-breakpoint
CREATE UNIQUE INDEX "salary_slips_emp_ym_uniq" ON "salary_slips" USING btree ("tenant_id","employee_id","year","month");--> statement-breakpoint
CREATE UNIQUE INDEX "vouchers_voucher_number_unique" ON "vouchers" USING btree ("tenant_id","voucher_number");--> statement-breakpoint
CREATE UNIQUE INDEX "quotations_quotation_number_unique" ON "quotations" USING btree ("tenant_id","quotation_number");--> statement-breakpoint
CREATE UNIQUE INDEX "quotation_templates_category_unique" ON "quotation_templates" USING btree ("tenant_id","category");--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_notes_note_number_unique" ON "delivery_notes" USING btree ("tenant_id","note_number");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_receipts_receipt_number_unique" ON "purchase_receipts" USING btree ("tenant_id","receipt_number");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_returns_return_number_unique" ON "sales_returns" USING btree ("tenant_id","return_number");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_returns_return_number_unique" ON "purchase_returns" USING btree ("tenant_id","return_number");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_requests_request_number_unique" ON "payment_requests" USING btree ("tenant_id","request_number");--> statement-breakpoint
CREATE UNIQUE INDEX "price_lists_name_unique" ON "price_lists" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "asset_categories_name_unique" ON "asset_categories" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "assets_asset_number_unique" ON "assets" USING btree ("tenant_id","asset_number");--> statement-breakpoint
CREATE UNIQUE INDEX "boms_bom_number_unique" ON "boms" USING btree ("tenant_id","bom_number");--> statement-breakpoint
CREATE UNIQUE INDEX "work_orders_work_order_number_unique" ON "work_orders" USING btree ("tenant_id","work_order_number");--> statement-breakpoint
CREATE UNIQUE INDEX "job_cards_job_card_number_unique" ON "job_cards" USING btree ("tenant_id","job_card_number");--> statement-breakpoint
CREATE UNIQUE INDEX "quality_inspections_inspection_number_unique" ON "quality_inspections" USING btree ("tenant_id","inspection_number");--> statement-breakpoint
CREATE UNIQUE INDEX "non_conformance_reports_report_number_unique" ON "non_conformance_reports" USING btree ("tenant_id","report_number");--> statement-breakpoint
CREATE UNIQUE INDEX "capa_actions_capa_number_unique" ON "capa_actions" USING btree ("tenant_id","capa_number");--> statement-breakpoint
CREATE UNIQUE INDEX "support_tickets_ticket_number_unique" ON "support_tickets" USING btree ("tenant_id","ticket_number");--> statement-breakpoint
CREATE UNIQUE INDEX "contracts_contract_number_unique" ON "contracts" USING btree ("tenant_id","contract_number");--> statement-breakpoint
CREATE UNIQUE INDEX "currencies_code_unique" ON "currencies" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "teachers_teacher_id_unique" ON "teachers" USING btree ("tenant_id","teacher_id");--> statement-breakpoint
CREATE UNIQUE INDEX "credit_tx_stripe_ref_unique" ON "credit_transactions" USING btree ("stripe_ref") WHERE "credit_transactions"."stripe_ref" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "tenants_company_code_unique" ON "tenants" USING btree ("company_code");--> statement-breakpoint
CREATE INDEX "leave_grants_employee_idx" ON "leave_grants" USING btree ("tenant_id","employee_id","period_start");--> statement-breakpoint
CREATE UNIQUE INDEX "service_fees_number_unique" ON "service_fees" USING btree ("tenant_id","fee_number");--> statement-breakpoint
CREATE INDEX "service_fees_order_idx" ON "service_fees" USING btree ("tenant_id","sales_order_id");--> statement-breakpoint
CREATE INDEX "service_fees_date_idx" ON "service_fees" USING btree ("tenant_id","service_date");--> statement-breakpoint
CREATE UNIQUE INDEX "employee_salary_components_unique" ON "employee_salary_components" USING btree ("tenant_id","employee_id","component_id");--> statement-breakpoint
CREATE INDEX "employee_salary_components_emp_idx" ON "employee_salary_components" USING btree ("tenant_id","employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "salary_components_name_unique" ON "salary_components" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_terms_name_unique" ON "payment_terms" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_counts_number_unique" ON "stock_counts" USING btree ("tenant_id","count_number");--> statement-breakpoint
CREATE INDEX "timesheets_emp_date_idx" ON "timesheets" USING btree ("tenant_id","employee_id","work_date");--> statement-breakpoint
CREATE INDEX "timesheets_project_idx" ON "timesheets" USING btree ("tenant_id","project_id");--> statement-breakpoint
CREATE INDEX "timesheets_work_order_idx" ON "timesheets" USING btree ("tenant_id","work_order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "budgets_year_account_month_unique" ON "budgets" USING btree ("tenant_id","fiscal_year","account_id","month");--> statement-breakpoint
CREATE INDEX "dunning_logs_invoice_idx" ON "dunning_logs" USING btree ("tenant_id","invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "material_requests_number_unique" ON "material_requests" USING btree ("tenant_id","request_number");--> statement-breakpoint
CREATE UNIQUE INDEX "subcontract_orders_number_unique" ON "subcontract_orders" USING btree ("tenant_id","order_number");--> statement-breakpoint
CREATE INDEX "subcontract_orders_supplier_idx" ON "subcontract_orders" USING btree ("tenant_id","supplier_id");--> statement-breakpoint
CREATE UNIQUE INDEX "integration_events_unique" ON "integration_events" USING btree ("tenant_id","source_id","kind","external_id");--> statement-breakpoint
CREATE INDEX "integration_events_status_idx" ON "integration_events" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "integration_item_maps_unique" ON "integration_item_maps" USING btree ("tenant_id","source_id","external_sku");--> statement-breakpoint
CREATE UNIQUE INDEX "integration_mappings_unique" ON "integration_mappings" USING btree ("tenant_id","source_id","external_type");--> statement-breakpoint
CREATE UNIQUE INDEX "integration_sources_code_unique" ON "integration_sources" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE INDEX "stored_value_ledger_customer_idx" ON "stored_value_ledger" USING btree ("tenant_id","source_id","customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "channel_payouts_number_unique" ON "channel_payouts" USING btree ("tenant_id","payout_number");--> statement-breakpoint
CREATE INDEX "channel_payouts_channel_idx" ON "channel_payouts" USING btree ("tenant_id","channel_id");--> statement-breakpoint
CREATE INDEX "channel_receivables_open_idx" ON "channel_receivables" USING btree ("tenant_id","channel_id","payout_id");--> statement-breakpoint
CREATE INDEX "channel_receivables_ref_idx" ON "channel_receivables" USING btree ("tenant_id","channel_id","external_ref");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_channels_code_unique" ON "payment_channels" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "legacy_documents_unique" ON "legacy_documents" USING btree ("tenant_id","source","doc_type","doc_number");--> statement-breakpoint
CREATE INDEX "legacy_documents_type_date_idx" ON "legacy_documents" USING btree ("tenant_id","doc_type","doc_date");--> statement-breakpoint
CREATE INDEX "legacy_documents_party_idx" ON "legacy_documents" USING btree ("tenant_id","party_name");--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_integrations_provider_unique" ON "tenant_integrations" USING btree ("tenant_id","provider");--> statement-breakpoint
CREATE UNIQUE INDEX "advances_number_unique" ON "advances" USING btree ("tenant_id","advance_number");--> statement-breakpoint
CREATE INDEX "advances_party_idx" ON "advances" USING btree ("tenant_id","party_type","party_name");--> statement-breakpoint
CREATE UNIQUE INDEX "rfqs_number_unique" ON "rfqs" USING btree ("tenant_id","rfq_number");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "ai_actions" AS PERMISSIVE FOR ALL TO public USING ("ai_actions"."tenant_id" = (current_setting('app.tenant_id'::text))::integer) WITH CHECK ("ai_actions"."tenant_id" = (current_setting('app.tenant_id'::text))::integer);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "ai_customer_drafts" AS PERMISSIVE FOR ALL TO public USING ("ai_customer_drafts"."tenant_id" = (current_setting('app.tenant_id'::text))::integer) WITH CHECK ("ai_customer_drafts"."tenant_id" = (current_setting('app.tenant_id'::text))::integer);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "ai_draft_documents" AS PERMISSIVE FOR ALL TO public USING ("ai_draft_documents"."tenant_id" = (current_setting('app.tenant_id'::text))::integer) WITH CHECK ("ai_draft_documents"."tenant_id" = (current_setting('app.tenant_id'::text))::integer);