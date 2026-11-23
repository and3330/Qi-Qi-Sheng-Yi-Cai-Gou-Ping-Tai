// 由 scripts/build-admin-api-catalog.mjs 產生，請勿手改。
export interface AdminEndpoint {
  method: string; path: string; summary: string; tag: string;
  parameters?: Array<{ name: string; in: string; required: boolean; type?: unknown; enum?: unknown; description?: string }>;
  body?: unknown;
}
export const ADMIN_API_CATALOG = [
 {
  "method": "GET",
  "path": "/admin/ai-credits",
  "summary": "AI 點數餘額、價格與異動紀錄",
  "tag": "admin-mcp"
 },
 {
  "method": "POST",
  "path": "/admin/ai-credits/checkout",
  "summary": "建立刷卡儲值結帳頁",
  "tag": "admin-mcp",
  "body": {
   "type": "object",
   "required": [
    "packs"
   ],
   "properties": {
    "packs": {
     "type": "integer"
    }
   }
  }
 },
 {
  "method": "POST",
  "path": "/admin/ai-credits/confirm",
  "summary": "付款後確認入帳（可重複呼叫，不會重複加點）",
  "tag": "admin-mcp",
  "body": {
   "type": "object",
   "required": [
    "sessionId"
   ],
   "properties": {
    "sessionId": {
     "type": "string"
    }
   }
  }
 },
 {
  "method": "POST",
  "path": "/admin/ai-index/rebuild",
  "summary": "全量重建 AI 知識庫索引（僅系統管理員）",
  "tag": "assistant"
 },
 {
  "method": "GET",
  "path": "/admin/ai-knowledge",
  "summary": "AI 客服知識庫列表（限管理員與營運）",
  "tag": "admin"
 },
 {
  "method": "POST",
  "path": "/admin/ai-knowledge",
  "summary": "新增 AI 客服知識（限管理員與營運）",
  "tag": "admin",
  "body": {
   "type": "object",
   "required": [
    "title",
    "category",
    "content"
   ],
   "properties": {
    "title": {
     "type": "string",
     "minLength": 1,
     "maxLength": 200
    },
    "category": {
     "type": "string",
     "minLength": 1,
     "maxLength": 100
    },
    "content": {
     "type": "string",
     "minLength": 1,
     "maxLength": 12000
    },
    "isActive": {
     "type": "boolean",
     "default": true
    }
   }
  }
 },
 {
  "method": "DELETE",
  "path": "/admin/ai-knowledge/:id",
  "summary": "刪除 AI 客服知識（限管理員與營運）",
  "tag": "admin",
  "parameters": [
   {
    "name": "id",
    "in": "path",
    "required": true,
    "type": "integer"
   }
  ]
 },
 {
  "method": "PATCH",
  "path": "/admin/ai-knowledge/:id",
  "summary": "編輯或停用 AI 客服知識（限管理員與營運）",
  "tag": "admin",
  "parameters": [
   {
    "name": "id",
    "in": "path",
    "required": true,
    "type": "integer"
   }
  ],
  "body": {
   "type": "object",
   "properties": {
    "title": {
     "type": "string",
     "minLength": 1,
     "maxLength": 200
    },
    "category": {
     "type": "string",
     "minLength": 1,
     "maxLength": 100
    },
    "content": {
     "type": "string",
     "minLength": 1,
     "maxLength": 12000
    },
    "isActive": {
     "type": "boolean"
    }
   }
  }
 },
 {
  "method": "GET",
  "path": "/admin/announcements",
  "summary": "內容管理：公告列表（限管理員）",
  "tag": "admin",
  "parameters": [
   {
    "name": "status",
    "in": "query",
    "required": false,
    "type": "string",
    "enum": [
     "draft",
     "review",
     "published",
     "archived"
    ]
   }
  ]
 },
 {
  "method": "POST",
  "path": "/admin/announcements",
  "summary": "內容管理：建立公告（限管理員）",
  "tag": "admin",
  "body": {
   "type": "object",
   "required": [
    "title",
    "category"
   ],
   "properties": {
    "title": {
     "type": "string",
     "minLength": 1,
     "maxLength": 200
    },
    "category": {
     "type": "string",
     "minLength": 1,
     "maxLength": 50
    },
    "content": {
     "type": [
      "string",
      "null"
     ]
    },
    "imageUrl": {
     "type": [
      "string",
      "null"
     ],
     "maxLength": 500
    },
    "status": {
     "type": "string",
     "enum": [
      "draft",
      "review",
      "published",
      "archived"
     ]
    }
   }
  }
 },
 {
  "method": "DELETE",
  "path": "/admin/announcements/:id",
  "summary": "內容管理：刪除公告（限管理員）",
  "tag": "admin",
  "parameters": [
   {
    "name": "id",
    "in": "path",
    "required": true,
    "type": "integer"
   }
  ]
 },
 {
  "method": "PATCH",
  "path": "/admin/announcements/:id",
  "summary": "內容管理：編輯／審核／上下架公告（限管理員）",
  "tag": "admin",
  "parameters": [
   {
    "name": "id",
    "in": "path",
    "required": true,
    "type": "integer"
   }
  ],
  "body": {
   "type": "object",
   "properties": {
    "title": {
     "type": "string",
     "minLength": 1,
     "maxLength": 200
    },
    "category": {
     "type": "string",
     "minLength": 1,
     "maxLength": 50
    },
    "content": {
     "type": [
      "string",
      "null"
     ]
    },
    "imageUrl": {
     "type": [
      "string",
      "null"
     ],
     "maxLength": 500
    },
    "status": {
     "type": "string",
     "enum": [
      "draft",
      "review",
      "published",
      "archived"
     ]
    }
   }
  }
 },
 {
  "method": "GET",
  "path": "/admin/articles",
  "summary": "內容管理：文章／FAQ 列表（限管理員）",
  "tag": "admin",
  "parameters": [
   {
    "name": "status",
    "in": "query",
    "required": false,
    "type": "string",
    "enum": [
     "draft",
     "review",
     "published",
     "archived"
    ]
   }
  ]
 },
 {
  "method": "POST",
  "path": "/admin/articles",
  "summary": "內容管理：建立文章／FAQ（限管理員）",
  "tag": "admin",
  "body": {
   "type": "object",
   "required": [
    "kind",
    "title",
    "category"
   ],
   "properties": {
    "kind": {
     "type": "string",
     "enum": [
      "article",
      "faq"
     ]
    },
    "title": {
     "type": "string",
     "minLength": 1,
     "maxLength": 200
    },
    "category": {
     "type": "string",
     "minLength": 1,
     "maxLength": 50
    },
    "summary": {
     "type": [
      "string",
      "null"
     ],
     "maxLength": 500
    },
    "content": {
     "type": [
      "string",
      "null"
     ]
    },
    "imageUrl": {
     "type": [
      "string",
      "null"
     ],
     "maxLength": 500
    },
    "status": {
     "type": "string",
     "enum": [
      "draft",
      "review",
      "published",
      "archived"
     ]
    }
   }
  }
 },
 {
  "method": "DELETE",
  "path": "/admin/articles/:id",
  "summary": "內容管理：刪除文章（限管理員）",
  "tag": "admin",
  "parameters": [
   {
    "name": "id",
    "in": "path",
    "required": true,
    "type": "integer"
   }
  ]
 },
 {
  "method": "PATCH",
  "path": "/admin/articles/:id",
  "summary": "內容管理：編輯／審核／上下架文章（限管理員）",
  "tag": "admin",
  "parameters": [
   {
    "name": "id",
    "in": "path",
    "required": true,
    "type": "integer"
   }
  ],
  "body": {
   "type": "object",
   "properties": {
    "kind": {
     "type": "string",
     "enum": [
      "article",
      "faq"
     ]
    },
    "title": {
     "type": "string",
     "minLength": 1,
     "maxLength": 200
    },
    "category": {
     "type": "string",
     "minLength": 1,
     "maxLength": 50
    },
    "summary": {
     "type": [
      "string",
      "null"
     ],
     "maxLength": 500
    },
    "content": {
     "type": [
      "string",
      "null"
     ]
    },
    "imageUrl": {
     "type": [
      "string",
      "null"
     ],
     "maxLength": 500
    },
    "status": {
     "type": "string",
     "enum": [
      "draft",
      "review",
      "published",
      "archived"
     ]
    }
   }
  }
 },
 {
  "method": "GET",
  "path": "/admin/assistant/conversations",
  "summary": "AI 行政助理對話列表",
  "tag": "assistant"
 },
 {
  "method": "POST",
  "path": "/admin/assistant/conversations",
  "summary": "建立 AI 行政助理對話",
  "tag": "assistant",
  "body": {
   "type": "object",
   "properties": {
    "title": {
     "type": "string"
    }
   }
  }
 },
 {
  "method": "POST",
  "path": "/admin/assistant/conversations/:id/actions/:actionId/confirm",
  "summary": "管理者明確確認待執行的 AI 操作",
  "tag": "assistant",
  "parameters": [
   {
    "name": "id",
    "in": "path",
    "required": true,
    "type": "integer"
   },
   {
    "name": "actionId",
    "in": "path",
    "required": true,
    "type": "integer"
   }
  ]
 },
 {
  "method": "GET",
  "path": "/admin/assistant/conversations/:id/messages",
  "summary": "對話歷史訊息",
  "tag": "assistant",
  "parameters": [
   {
    "name": "id",
    "in": "path",
    "required": true,
    "type": "integer"
   }
  ]
 },
 {
  "method": "POST",
  "path": "/admin/assistant/conversations/:id/messages",
  "summary": "送出訊息給 AI 行政助理",
  "tag": "assistant",
  "parameters": [
   {
    "name": "id",
    "in": "path",
    "required": true,
    "type": "integer"
   }
  ],
  "body": {
   "type": "object",
   "required": [
    "content"
   ],
   "properties": {
    "content": {
     "type": "string",
     "minLength": 1,
     "maxLength": 4000
    }
   }
  }
 },
 {
  "method": "POST",
  "path": "/admin/cmo/chat",
  "summary": "",
  "tag": ""
 },
 {
  "method": "GET",
  "path": "/admin/cmo/goals",
  "summary": "KPI 目標列表（僅系統管理員）",
  "tag": "admin"
 },
 {
  "method": "POST",
  "path": "/admin/cmo/goals",
  "summary": "建立 KPI 目標",
  "tag": "admin",
  "body": {
   "type": "object",
   "required": [
    "metric",
    "label",
    "targetValue",
    "startDate",
    "endDate"
   ],
   "properties": {
    "metric": {
     "type": "string"
    },
    "label": {
     "type": "string",
     "minLength": 1
    },
    "targetValue": {
     "type": "number"
    },
    "unit": {
     "type": "string"
    },
    "period": {
     "type": "string"
    },
    "priority": {
     "type": "string"
    },
    "startDate": {
     "type": "string"
    },
    "endDate": {
     "type": "string"
    }
   }
  }
 },
 {
  "method": "DELETE",
  "path": "/admin/cmo/goals/:id",
  "summary": "刪除 KPI 目標",
  "tag": "admin",
  "parameters": [
   {
    "name": "id",
    "in": "path",
    "required": true,
    "type": "string"
   }
  ]
 },
 {
  "method": "PUT",
  "path": "/admin/cmo/goals/:id",
  "summary": "更新 KPI 目標",
  "tag": "admin",
  "parameters": [
   {
    "name": "id",
    "in": "path",
    "required": true,
    "type": "string"
   }
  ],
  "body": {
   "type": "object",
   "properties": {
    "metric": {
     "type": "string"
    },
    "label": {
     "type": "string",
     "minLength": 1
    },
    "targetValue": {
     "type": "number"
    },
    "unit": {
     "type": "string"
    },
    "period": {
     "type": "string"
    },
    "priority": {
     "type": "string"
    },
    "startDate": {
     "type": "string"
    },
    "endDate": {
     "type": "string"
    },
    "isActive": {
     "type": "boolean"
    }
   }
  }
 },
 {
  "method": "POST",
  "path": "/admin/cmo/goals/refresh",
  "summary": "立即重算所有 KPI 進度",
  "tag": "admin"
 },
 {
  "method": "GET",
  "path": "/admin/cmo/reports",
  "summary": "營運報告列表",
  "tag": "admin"
 },
 {
  "method": "GET",
  "path": "/admin/cmo/reports/:id",
  "summary": "營運報告詳情",
  "tag": "admin",
  "parameters": [
   {
    "name": "id",
    "in": "path",
    "required": true,
    "type": "string"
   }
  ]
 },
 {
  "method": "POST",
  "path": "/admin/cmo/reports/generate",
  "summary": "手動觸發生成今日營運報告",
  "tag": "admin"
 },
 {
  "method": "GET",
  "path": "/admin/cmo/snapshots",
  "summary": "近日數據快照",
  "tag": "admin",
  "parameters": [
   {
    "name": "days",
    "in": "query",
    "required": false,
    "type": "integer"
   }
  ]
 },
 {
  "method": "GET",
  "path": "/admin/commission-report",
  "summary": "佣金報表（縣市／醫院／科室彙總＋明細，限管理員）",
  "tag": "admin",
  "parameters": [
   {
    "name": "from",
    "in": "query",
    "required": false,
    "type": "string"
   },
   {
    "name": "to",
    "in": "query",
    "required": false,
    "type": "string"
   },
   {
    "name": "institutionId",
    "in": "query",
    "required": false,
    "type": "integer"
   }
  ]
 },
 {
  "method": "GET",
  "path": "/admin/content-revisions",
  "summary": "內容管理：版本紀錄（限管理員）",
  "tag": "admin",
  "parameters": [
   {
    "name": "entityKind",
    "in": "query",
    "required": true,
    "type": "string",
    "enum": [
     "article",
     "announcement"
    ]
   },
   {
    "name": "entityId",
    "in": "query",
    "required": true,
    "type": "integer"
   }
  ]
 },
 {
  "method": "GET",
  "path": "/admin/content-revisions/:id/comparison",
  "summary": "內容管理：比較指定版本與目前內容（限管理員）",
  "tag": "admin",
  "parameters": [
   {
    "name": "id",
    "in": "path",
    "required": true,
    "type": "integer"
   }
  ]
 },
 {
  "method": "POST",
  "path": "/admin/content-revisions/:id/restore",
  "summary": "內容管理：還原指定版本並建立新版本紀錄（限管理員）",
  "tag": "admin",
  "parameters": [
   {
    "name": "id",
    "in": "path",
    "required": true,
    "type": "integer"
   }
  ]
 },
 {
  "method": "GET",
  "path": "/admin/expenses",
  "summary": "支出紀錄列表（限管理員）",
  "tag": "admin",
  "parameters": [
   {
    "name": "from",
    "in": "query",
    "required": false,
    "type": "string"
   },
   {
    "name": "to",
    "in": "query",
    "required": false,
    "type": "string"
   },
   {
    "name": "category",
    "in": "query",
    "required": false,
    "type": "string",
    "enum": [
     "purchase",
     "operating",
     "logistics",
     "marketing",
     "other"
    ]
   }
  ]
 },
 {
  "method": "POST",
  "path": "/admin/expenses",
  "summary": "登錄支出（限管理員）",
  "tag": "admin",
  "body": {
   "type": "object",
   "required": [
    "category",
    "title",
    "amount"
   ],
   "properties": {
    "category": {
     "type": "string",
     "enum": [
      "purchase",
      "operating",
      "logistics",
      "marketing",
      "other"
     ]
    },
    "title": {
     "type": "string",
     "minLength": 1,
     "maxLength": 200
    },
    "amount": {
     "type": "integer",
     "minimum": 1
    },
    "note": {
     "type": [
      "string",
      "null"
     ],
     "maxLength": 500
    },
    "spentAt": {
     "type": [
      "string",
      "null"
     ],
     "format": "date"
    }
   }
  }
 },
 {
  "method": "DELETE",
  "path": "/admin/expenses/:id",
  "summary": "刪除支出紀錄（限管理員）",
  "tag": "admin",
  "parameters": [
   {
    "name": "id",
    "in": "path",
    "required": true,
    "type": "integer"
   }
  ]
 },
 {
  "method": "GET",
  "path": "/admin/finance/ledger",
  "summary": "收支流水（訂單收入自動納入，限管理員）",
  "tag": "admin",
  "parameters": [
   {
    "name": "from",
    "in": "query",
    "required": false,
    "type": "string"
   },
   {
    "name": "to",
    "in": "query",
    "required": false,
    "type": "string"
   },
   {
    "name": "kind",
    "in": "query",
    "required": false,
    "type": "string",
    "enum": [
     "income",
     "expense"
    ]
   }
  ]
 },
 {
  "method": "GET",
  "path": "/admin/finance/pnl",
  "summary": "期間損益報表（限管理員）",
  "tag": "admin",
  "parameters": [
   {
    "name": "from",
    "in": "query",
    "required": false,
    "type": "string"
   },
   {
    "name": "to",
    "in": "query",
    "required": false,
    "type": "string"
   }
  ]
 },
 {
  "method": "GET",
  "path": "/admin/institution-wallets",
  "summary": "機構錢包總覽（限管理員）",
  "tag": "admin"
 },
 {
  "method": "GET",
  "path": "/admin/institution-wallets/:institutionId",
  "summary": "單一機構錢包明細（限管理員）",
  "tag": "admin",
  "parameters": [
   {
    "name": "institutionId",
    "in": "path",
    "required": true,
    "type": "integer"
   }
  ]
 },
 {
  "method": "POST",
  "path": "/admin/institution-wallets/:institutionId/adjust",
  "summary": "管理員儲值／調整機構錢包（限管理員）",
  "tag": "admin",
  "parameters": [
   {
    "name": "institutionId",
    "in": "path",
    "required": true,
    "type": "integer"
   }
  ],
  "body": {
   "type": "object",
   "required": [
    "type",
    "amount"
   ],
   "properties": {
    "type": {
     "type": "string",
     "enum": [
      "deposit",
      "adjust"
     ]
    },
    "amount": {
     "type": "integer",
     "description": "儲值必須為正；調整可為正負 (NT$)"
    },
    "reason": {
     "type": [
      "string",
      "null"
     ],
     "maxLength": 200
    }
   }
  }
 },
 {
  "method": "GET",
  "path": "/admin/institutions",
  "summary": "機構主檔列表（後台）",
  "tag": "admin"
 },
 {
  "method": "PATCH",
  "path": "/admin/institutions/:id",
  "summary": "更新機構分級",
  "tag": "admin",
  "parameters": [
   {
    "name": "id",
    "in": "path",
    "required": true,
    "type": "integer"
   }
  ],
  "body": {
   "type": "object",
   "properties": {
    "grade": {
     "type": [
      "string",
      "null"
     ],
     "enum": [
      "A",
      "B",
      "C",
      null
     ]
    }
   }
  }
 },
 {
  "method": "POST",
  "path": "/admin/inventory/adjust",
  "summary": "手動調整庫存（盤點 / 報廢等，限管理員）",
  "tag": "admin",
  "body": {
   "type": "object",
   "required": [
    "productId",
    "quantity",
    "reason"
   ],
   "properties": {
    "productId": {
     "type": "integer"
    },
    "variantId": {
     "type": [
      "integer",
      "null"
     ],
     "description": "多規格商品需指定規格"
    },
    "quantity": {
     "type": "integer",
     "description": "正數入庫、負數出庫，不可為 0"
    },
    "reason": {
     "type": "string",
     "minLength": 1,
     "description": "盤點 / 報廢 / 其他"
    },
    "note": {
     "type": [
      "string",
      "null"
     ]
    }
   }
  }
 },
 {
  "method": "GET",
  "path": "/admin/linktree",
  "summary": "Admin overview of member linktree pages",
  "tag": "linktree",
  "parameters": [
   {
    "name": "search",
    "in": "query",
    "required": false,
    "type": "string"
   }
  ]
 },
 {
  "method": "PATCH",
  "path": "/admin/linktree/links/:id",
  "summary": "Enable/disable a member's link (moderation)",
  "tag": "linktree",
  "parameters": [
   {
    "name": "id",
    "in": "path",
    "required": true,
    "type": "integer"
   }
  ],
  "body": {
   "type": "object",
   "required": [
    "isActive"
   ],
   "properties": {
    "isActive": {
     "type": "boolean"
    }
   }
  }
 },
 {
  "method": "GET",
  "path": "/admin/mcp/actions",
  "summary": "Bot 送出的操作（最新 50 筆）",
  "tag": "admin-mcp",
  "parameters": [
   {
    "name": "status",
    "in": "query",
    "required": false,
    "type": "string"
   }
  ]
 },
 {
  "method": "POST",
  "path": "/admin/mcp/actions/:id/confirm",
  "summary": "確認並執行 Bot 送出的操作",
  "tag": "admin-mcp",
  "parameters": [
   {
    "name": "id",
    "in": "path",
    "required": true,
    "type": "integer"
   }
  ]
 },
 {
  "method": "POST",
  "path": "/admin/mcp/actions/:id/reject",
  "summary": "拒絕 Bot 送出的操作",
  "tag": "admin-mcp",
  "parameters": [
   {
    "name": "id",
    "in": "path",
    "required": true,
    "type": "integer"
   }
  ]
 },
 {
  "method": "GET",
  "path": "/admin/mcp/keys",
  "summary": "Bot 連線金鑰列表",
  "tag": "admin-mcp"
 },
 {
  "method": "POST",
  "path": "/admin/mcp/keys",
  "summary": "新增 Bot 連線金鑰（明碼只回傳這一次）",
  "tag": "admin-mcp",
  "body": {
   "type": "object",
   "required": [
    "name"
   ],
   "properties": {
    "name": {
     "type": "string"
    }
   }
  }
 },
 {
  "method": "DELETE",
  "path": "/admin/mcp/keys/:id",
  "summary": "刪除 Bot 連線金鑰",
  "tag": "admin-mcp",
  "parameters": [
   {
    "name": "id",
    "in": "path",
    "required": true,
    "type": "integer"
   }
  ]
 },
 {
  "method": "PATCH",
  "path": "/admin/mcp/keys/:id",
  "summary": "啟用或停用 Bot 連線金鑰",
  "tag": "admin-mcp",
  "parameters": [
   {
    "name": "id",
    "in": "path",
    "required": true,
    "type": "integer"
   }
  ],
  "body": {
   "type": "object",
   "required": [
    "isActive"
   ],
   "properties": {
    "isActive": {
     "type": "boolean"
    }
   }
  }
 },
 {
  "method": "GET",
  "path": "/admin/members",
  "summary": "會員列表（限管理員）",
  "tag": "admin",
  "parameters": [
   {
    "name": "search",
    "in": "query",
    "required": false,
    "type": "string",
    "description": "搜尋帳號 / 姓名 / Email / 電話"
   },
   {
    "name": "tier",
    "in": "query",
    "required": false,
    "type": "string",
    "enum": [
     "hospital",
     "clinic",
     "consumer"
    ]
   }
  ]
 },
 {
  "method": "POST",
  "path": "/admin/members",
  "summary": "後台建立會員（限系統管理員）",
  "tag": "admin",
  "body": {
   "type": "object",
   "required": [
    "username",
    "password",
    "name",
    "tier",
    "role"
   ],
   "properties": {
    "username": {
     "type": "string",
     "minLength": 3,
     "maxLength": 30,
     "pattern": "^[A-Za-z0-9_.-]+$"
    },
    "password": {
     "type": "string",
     "minLength": 8,
     "maxLength": 128
    },
    "name": {
     "type": "string",
     "minLength": 1,
     "maxLength": 100
    },
    "email": {
     "type": [
      "string",
      "null"
     ],
     "format": "email"
    },
    "phone": {
     "type": [
      "string",
      "null"
     ],
     "maxLength": 30
    },
    "tier": {
     "type": "string",
     "enum": [
      "hospital",
      "clinic",
      "consumer"
     ]
    },
    "role": {
     "type": "string",
     "enum": [
      "admin",
      "ops",
      "support",
      "member"
     ]
    }
   }
  }
 },
 {
  "method": "GET",
  "path": "/admin/members/:id",
  "summary": "會員詳情（限管理員）",
  "tag": "admin",
  "parameters": [
   {
    "name": "id",
    "in": "path",
    "required": true,
    "type": "integer"
   }
  ]
 },
 {
  "method": "PATCH",
  "path": "/admin/members/:id",
  "summary": "編輯會員資料 / 等級 / 角色 / 啟用狀態（限管理員）",
  "tag": "admin",
  "parameters": [
   {
    "name": "id",
    "in": "path",
    "required": true,
    "type": "integer"
   }
  ],
  "body": {
   "type": "object",
   "properties": {
    "username": {
     "type": "string",
     "minLength": 3,
     "maxLength": 30,
     "pattern": "^[A-Za-z0-9_.-]+$"
    },
    "password": {
     "type": "string",
     "minLength": 8,
     "maxLength": 128,
     "description": "留空或省略代表不變更；API 永不回傳密碼"
    },
    "name": {
     "type": "string",
     "minLength": 1
    },
    "email": {
     "type": [
      "string",
      "null"
     ]
    },
    "phone": {
     "type": [
      "string",
      "null"
     ]
    },
    "tier": {
     "type": "string",
     "enum": [
      "hospital",
      "clinic",
      "consumer"
     ]
    },
    "role": {
     "type": "string",
     "enum": [
      "admin",
      "ops",
      "support",
      "member"
     ],
     "description": "系統管理員 / 營運 / 客服 / 一般會員"
    },
    "requestedTier": {
     "type": [
      "string",
      "null"
     ],
     "description": "註冊時申請的身份（hospital / clinic），待管理員審核；null 表示沒有待審申請"
    },
    "isActive": {
     "type": "boolean"
    },
    "institutionVerified": {
     "type": "boolean"
    },
    "shippingAddress": {
     "type": [
      "string",
      "null"
     ]
    }
   }
  }
 },
 {
  "method": "GET",
  "path": "/admin/orders",
  "summary": "全部訂單列表（限管理員）",
  "tag": "admin",
  "parameters": [
   {
    "name": "status",
    "in": "query",
    "required": false,
    "type": "string",
    "enum": [
     "pending",
     "paid",
     "shipped",
     "completed",
     "cancelled",
     "returned"
    ]
   },
   {
    "name": "search",
    "in": "query",
    "required": false,
    "type": "string",
    "description": "搜尋訂單編號 / 會員姓名"
   }
  ]
 },
 {
  "method": "GET",
  "path": "/admin/orders/:id",
  "summary": "訂單詳情（限管理員）",
  "tag": "admin",
  "parameters": [
   {
    "name": "id",
    "in": "path",
    "required": true,
    "type": "integer"
   }
  ]
 },
 {
  "method": "PATCH",
  "path": "/admin/orders/:id/shipment",
  "summary": "填入出貨資訊（貨運公司、運送單號）；訂單是已付款時預設順便改成已出貨",
  "tag": "admin",
  "parameters": [
   {
    "name": "id",
    "in": "path",
    "required": true,
    "type": "integer"
   }
  ],
  "body": {
   "type": "object",
   "required": [
    "trackingNo"
   ],
   "properties": {
    "carrier": {
     "type": [
      "string",
      "null"
     ],
     "description": "貨運公司"
    },
    "trackingNo": {
     "type": "string",
     "description": "運送單號"
    },
    "markShipped": {
     "type": "boolean",
     "description": "訂單是已付款時要不要順便改成已出貨，預設要"
    }
   }
  }
 },
 {
  "method": "POST",
  "path": "/admin/orders/:id/shipment-photos",
  "summary": "出貨照片存證（限營運人員）",
  "tag": "admin",
  "parameters": [
   {
    "name": "id",
    "in": "path",
    "required": true,
    "type": "integer"
   }
  ],
  "body": {
   "type": "object",
   "required": [
    "photos"
   ],
   "properties": {
    "photos": {
     "type": "array",
     "maxItems": 10,
     "items": {
      "type": "string",
      "maxLength": 500
     }
    }
   }
  }
 },
 {
  "method": "PATCH",
  "path": "/admin/orders/:id/status",
  "summary": "更新訂單狀態（限管理員）",
  "tag": "admin",
  "parameters": [
   {
    "name": "id",
    "in": "path",
    "required": true,
    "type": "integer"
   }
  ],
  "body": {
   "type": "object",
   "required": [
    "status"
   ],
   "properties": {
    "status": {
     "type": "string",
     "enum": [
      "pending",
      "paid",
      "shipped",
      "completed",
      "cancelled",
      "returned"
     ]
    }
   }
  }
 },
 {
  "method": "POST",
  "path": "/admin/orders/bulk-delete",
  "summary": "批量刪除訂單（限管理員；僅已取消/已退貨可刪，已有銷退紀錄者保留）",
  "tag": "admin",
  "body": {
   "type": "object",
   "required": [
    "ids"
   ],
   "properties": {
    "ids": {
     "type": "array",
     "items": {
      "type": "integer"
     },
     "minItems": 1,
     "maxItems": 100
    }
   }
  }
 },
 {
  "method": "POST",
  "path": "/admin/orders/bulk-status",
  "summary": "批量更新訂單狀態（限管理員；逐筆套用狀態機，不符合的跳過並回報原因）",
  "tag": "admin",
  "body": {
   "type": "object",
   "required": [
    "ids",
    "status"
   ],
   "properties": {
    "ids": {
     "type": "array",
     "items": {
      "type": "integer"
     },
     "minItems": 1,
     "maxItems": 100
    },
    "status": {
     "type": "string",
     "enum": [
      "pending",
      "paid",
      "shipped",
      "completed",
      "cancelled",
      "returned"
     ]
    }
   }
  }
 },
 {
  "method": "GET",
  "path": "/admin/products",
  "summary": "商品列表（限管理員，含下架與成本價）",
  "tag": "admin",
  "parameters": [
   {
    "name": "search",
    "in": "query",
    "required": false,
    "type": "string"
   },
   {
    "name": "category",
    "in": "query",
    "required": false,
    "type": "string"
   },
   {
    "name": "status",
    "in": "query",
    "required": false,
    "type": "string",
    "enum": [
     "all",
     "active",
     "inactive"
    ]
   }
  ]
 },
 {
  "method": "POST",
  "path": "/admin/products",
  "summary": "新增商品（限管理員）",
  "tag": "admin",
  "body": {
   "type": "object",
   "required": [
    "code",
    "name",
    "category",
    "priceHospital",
    "priceClinic",
    "priceConsumer"
   ],
   "properties": {
    "code": {
     "type": "string",
     "minLength": 1
    },
    "name": {
     "type": "string",
     "minLength": 1
    },
    "category": {
     "type": "string",
     "minLength": 1
    },
    "description": {
     "type": [
      "string",
      "null"
     ]
    },
    "imageUrl": {
     "type": [
      "string",
      "null"
     ]
    },
    "priceHospital": {
     "type": "integer",
     "minimum": 0
    },
    "priceClinic": {
     "type": "integer",
     "minimum": 0
    },
    "priceConsumer": {
     "type": "integer",
     "minimum": 0
    },
    "costPrice": {
     "type": "integer",
     "minimum": 0
    },
    "stock": {
     "type": "integer",
     "minimum": 0
    },
    "isHot": {
     "type": "boolean"
    },
    "isNew": {
     "type": "boolean"
    },
    "isActive": {
     "type": "boolean"
    },
    "spec": {
     "type": [
      "string",
      "null"
     ]
    },
    "allowedGrades": {
     "type": [
      "array",
      "null"
     ],
     "items": {
      "type": "string",
      "enum": [
       "A",
       "B",
       "C"
      ]
     },
     "description": "授權可銷售機構分級；null 或空陣列 = 不限"
    }
   }
  }
 },
 {
  "method": "PATCH",
  "path": "/admin/products/:id",
  "summary": "編輯商品 / 上下架（限管理員）",
  "tag": "admin",
  "parameters": [
   {
    "name": "id",
    "in": "path",
    "required": true,
    "type": "integer"
   }
  ],
  "body": {
   "type": "object",
   "properties": {
    "code": {
     "type": "string",
     "minLength": 1
    },
    "name": {
     "type": "string",
     "minLength": 1
    },
    "category": {
     "type": "string",
     "minLength": 1
    },
    "description": {
     "type": [
      "string",
      "null"
     ]
    },
    "imageUrl": {
     "type": [
      "string",
      "null"
     ]
    },
    "priceHospital": {
     "type": "integer",
     "minimum": 0
    },
    "priceClinic": {
     "type": "integer",
     "minimum": 0
    },
    "priceConsumer": {
     "type": "integer",
     "minimum": 0
    },
    "costPrice": {
     "type": "integer",
     "minimum": 0
    },
    "isHot": {
     "type": "boolean"
    },
    "isNew": {
     "type": "boolean"
    },
    "isActive": {
     "type": "boolean"
    },
    "spec": {
     "type": [
      "string",
      "null"
     ]
    },
    "allowedGrades": {
     "type": [
      "array",
      "null"
     ],
     "items": {
      "type": "string",
      "enum": [
       "A",
       "B",
       "C"
      ]
     },
     "description": "授權可銷售機構分級；null 或空陣列 = 不限"
    }
   }
  }
 },
 {
  "method": "GET",
  "path": "/admin/products/:id/variants",
  "summary": "商品規格列表（後台人員）",
  "tag": "admin",
  "parameters": [
   {
    "name": "id",
    "in": "path",
    "required": true,
    "type": "integer"
   }
  ]
 },
 {
  "method": "POST",
  "path": "/admin/products/:id/variants",
  "summary": "新增商品規格（限營運人員）",
  "tag": "admin",
  "parameters": [
   {
    "name": "id",
    "in": "path",
    "required": true,
    "type": "integer"
   }
  ],
  "body": {
   "type": "object",
   "required": [
    "name",
    "priceHospital",
    "priceClinic",
    "priceConsumer"
   ],
   "properties": {
    "name": {
     "type": "string",
     "minLength": 1,
     "maxLength": 100
    },
    "priceHospital": {
     "type": "integer",
     "minimum": 0
    },
    "priceClinic": {
     "type": "integer",
     "minimum": 0
    },
    "priceConsumer": {
     "type": "integer",
     "minimum": 0
    },
    "costPrice": {
     "type": "integer",
     "minimum": 0
    },
    "stock": {
     "type": "integer",
     "minimum": 0,
     "description": "期初庫存，僅建立時使用"
    },
    "isActive": {
     "type": "boolean"
    }
   }
  }
 },
 {
  "method": "GET",
  "path": "/admin/profit-report",
  "summary": "利潤分享報表（期間／會員彙總，限管理員）",
  "tag": "admin",
  "parameters": [
   {
    "name": "from",
    "in": "query",
    "required": false,
    "type": "string"
   },
   {
    "name": "to",
    "in": "query",
    "required": false,
    "type": "string"
   },
   {
    "name": "memberId",
    "in": "query",
    "required": false,
    "type": "integer"
   }
  ]
 },
 {
  "method": "GET",
  "path": "/admin/profit-rules",
  "summary": "分潤規則列表（限管理員）",
  "tag": "admin"
 },
 {
  "method": "POST",
  "path": "/admin/profit-rules",
  "summary": "新增分潤規則（限管理員）",
  "tag": "admin",
  "body": {
   "type": "object",
   "required": [
    "name",
    "tier",
    "percentBps"
   ],
   "properties": {
    "name": {
     "type": "string",
     "minLength": 1,
     "maxLength": 100
    },
    "tier": {
     "type": "string",
     "enum": [
      "hospital",
      "clinic",
      "consumer",
      "all"
     ]
    },
    "percentBps": {
     "type": "integer",
     "minimum": 0,
     "maximum": 10000
    },
    "isActive": {
     "type": "boolean"
    }
   }
  }
 },
 {
  "method": "DELETE",
  "path": "/admin/profit-rules/:id",
  "summary": "刪除分潤規則（限管理員）",
  "tag": "admin",
  "parameters": [
   {
    "name": "id",
    "in": "path",
    "required": true,
    "type": "integer"
   }
  ]
 },
 {
  "method": "PATCH",
  "path": "/admin/profit-rules/:id",
  "summary": "更新分潤規則（限管理員）",
  "tag": "admin",
  "parameters": [
   {
    "name": "id",
    "in": "path",
    "required": true,
    "type": "integer"
   }
  ],
  "body": {
   "type": "object",
   "required": [
    "name",
    "tier",
    "percentBps"
   ],
   "properties": {
    "name": {
     "type": "string",
     "minLength": 1,
     "maxLength": 100
    },
    "tier": {
     "type": "string",
     "enum": [
      "hospital",
      "clinic",
      "consumer",
      "all"
     ]
    },
    "percentBps": {
     "type": "integer",
     "minimum": 0,
     "maximum": 10000
    },
    "isActive": {
     "type": "boolean"
    }
   }
  }
 },
 {
  "method": "GET",
  "path": "/admin/purchase-orders",
  "summary": "採購單列表（限管理員）",
  "tag": "admin",
  "parameters": [
   {
    "name": "status",
    "in": "query",
    "required": false,
    "type": "string",
    "enum": [
     "draft",
     "ordered",
     "received",
     "cancelled"
    ]
   }
  ]
 },
 {
  "method": "POST",
  "path": "/admin/purchase-orders",
  "summary": "建立採購單（限管理員）",
  "tag": "admin",
  "body": {
   "type": "object",
   "required": [
    "supplierId",
    "items"
   ],
   "properties": {
    "supplierId": {
     "type": "integer"
    },
    "warehouseId": {
     "type": "integer",
     "nullable": true
    },
    "creatorEmployeeId": {
     "type": [
      "integer",
      "null"
     ],
     "description": "製單人 ERP 員工 ID"
    },
    "note": {
     "type": [
      "string",
      "null"
     ]
    },
    "items": {
     "type": "array",
     "minItems": 1,
     "items": {
      "type": "object",
      "required": [
       "productId",
       "unitCost",
       "quantity"
      ],
      "properties": {
       "productId": {
        "type": "integer"
       },
       "variantId": {
        "type": [
         "integer",
         "null"
        ],
        "description": "多規格商品必填：收貨補到此規格庫存"
       },
       "unitCost": {
        "type": "integer",
        "minimum": 0
       },
       "quantity": {
        "type": "integer",
        "minimum": 1
       }
      }
     }
    }
   }
  }
 },
 {
  "method": "GET",
  "path": "/admin/purchase-orders/:id",
  "summary": "採購單詳情（限管理員）",
  "tag": "admin",
  "parameters": [
   {
    "name": "id",
    "in": "path",
    "required": true,
    "type": "integer"
   }
  ]
 },
 {
  "method": "POST",
  "path": "/admin/purchase-orders/:id/receive",
  "summary": "採購單收貨入庫（增加庫存、更新成本、寫入異動紀錄，限管理員）",
  "tag": "admin",
  "parameters": [
   {
    "name": "id",
    "in": "path",
    "required": true,
    "type": "integer"
   }
  ]
 },
 {
  "method": "PATCH",
  "path": "/admin/purchase-orders/:id/status",
  "summary": "採購單狀態流轉（草稿→已下單、取消，限管理員）",
  "tag": "admin",
  "parameters": [
   {
    "name": "id",
    "in": "path",
    "required": true,
    "type": "integer"
   }
  ],
  "body": {
   "type": "object",
   "required": [
    "status"
   ],
   "properties": {
    "status": {
     "type": "string",
     "enum": [
      "ordered",
      "cancelled"
     ],
     "description": "收貨請用 receive 端點"
    }
   }
  }
 },
 {
  "method": "GET",
  "path": "/admin/quotations",
  "summary": "報價單列表",
  "tag": "quotations",
  "parameters": [
   {
    "name": "status",
    "in": "query",
    "required": false,
    "type": "string"
   }
  ]
 },
 {
  "method": "POST",
  "path": "/admin/quotations",
  "summary": "建立報價單",
  "tag": "quotations",
  "body": {
   "type": "object",
   "required": [
    "customerName",
    "items"
   ],
   "properties": {
    "customerName": {
     "type": "string",
     "minLength": 1
    },
    "memberId": {
     "type": [
      "integer",
      "null"
     ],
     "description": "綁定會員（轉訂單必填）"
    },
    "institutionId": {
     "type": [
      "integer",
      "null"
     ]
    },
    "creatorEmployeeId": {
     "type": [
      "integer",
      "null"
     ],
     "description": "製單人 ERP 員工 ID"
    },
    "validUntil": {
     "type": [
      "string",
      "null"
     ],
     "description": "YYYY-MM-DD"
    },
    "note": {
     "type": [
      "string",
      "null"
     ]
    },
    "items": {
     "type": "array",
     "minItems": 1,
     "items": {
      "type": "object",
      "required": [
       "productId",
       "unitPrice",
       "quantity"
      ],
      "properties": {
       "productId": {
        "type": "integer"
       },
       "variantId": {
        "type": [
         "integer",
         "null"
        ]
       },
       "unitPrice": {
        "type": "integer",
        "minimum": 0
       },
       "quantity": {
        "type": "integer",
        "minimum": 1
       }
      }
     }
    }
   }
  }
 },
 {
  "method": "GET",
  "path": "/admin/quotations/:id",
  "summary": "報價單明細",
  "tag": "quotations",
  "parameters": [
   {
    "name": "id",
    "in": "path",
    "required": true,
    "type": "integer"
   }
  ]
 },
 {
  "method": "POST",
  "path": "/admin/quotations/:id/convert",
  "summary": "報價單轉訂單（依報價價格建立訂單並扣庫存）",
  "tag": "quotations",
  "parameters": [
   {
    "name": "id",
    "in": "path",
    "required": true,
    "type": "integer"
   }
  ]
 },
 {
  "method": "PATCH",
  "path": "/admin/quotations/:id/status",
  "summary": "變更報價單狀態（sent / accepted / cancelled）",
  "tag": "quotations",
  "parameters": [
   {
    "name": "id",
    "in": "path",
    "required": true,
    "type": "integer"
   }
  ],
  "body": {
   "type": "object",
   "required": [
    "status"
   ],
   "properties": {
    "status": {
     "type": "string",
     "enum": [
      "sent",
      "accepted",
      "cancelled"
     ]
    }
   }
  }
 },
 {
  "method": "GET",
  "path": "/admin/reports/inventory",
  "summary": "期間進銷存彙總報表（限管理員）",
  "tag": "admin",
  "parameters": [
   {
    "name": "from",
    "in": "query",
    "required": false,
    "type": "string"
   },
   {
    "name": "to",
    "in": "query",
    "required": false,
    "type": "string"
   }
  ]
 },
 {
  "method": "PUT",
  "path": "/admin/shop/payment-info",
  "summary": "設定匯款帳號資訊（系統管理員）",
  "tag": "admin",
  "body": {
   "type": "object",
   "required": [
    "bankName",
    "bankBranch",
    "bankAccount",
    "bankHolder",
    "bankNote"
   ],
   "properties": {
    "bankName": {
     "type": "string",
     "maxLength": 100
    },
    "bankBranch": {
     "type": "string",
     "maxLength": 100
    },
    "bankAccount": {
     "type": "string",
     "maxLength": 60
    },
    "bankHolder": {
     "type": "string",
     "maxLength": 100
    },
    "bankNote": {
     "type": "string",
     "maxLength": 500
    }
   }
  }
 },
 {
  "method": "GET",
  "path": "/admin/social-accounts",
  "summary": "社群帳號列表（含平台憑證設定狀態）",
  "tag": "social"
 },
 {
  "method": "DELETE",
  "path": "/admin/social-accounts/:id",
  "summary": "刪除社群帳號",
  "tag": "social",
  "parameters": [
   {
    "name": "id",
    "in": "path",
    "required": true,
    "type": "string"
   }
  ]
 },
 {
  "method": "PATCH",
  "path": "/admin/social-accounts/:id/toggle",
  "summary": "啟用/停用社群帳號",
  "tag": "social",
  "parameters": [
   {
    "name": "id",
    "in": "path",
    "required": true,
    "type": "string"
   }
  ]
 },
 {
  "method": "GET",
  "path": "/admin/social-accounts/oauth-callback/:platform",
  "summary": "",
  "tag": ""
 },
 {
  "method": "GET",
  "path": "/admin/social-accounts/oauth-url/:platform",
  "summary": "取得平台 OAuth 授權 URL",
  "tag": "social",
  "parameters": [
   {
    "name": "platform",
    "in": "path",
    "required": true,
    "type": "string"
   }
  ]
 },
 {
  "method": "GET",
  "path": "/admin/social-posts",
  "summary": "社群貼文列表",
  "tag": "social",
  "parameters": [
   {
    "name": "status",
    "in": "query",
    "required": false,
    "type": "string"
   }
  ]
 },
 {
  "method": "POST",
  "path": "/admin/social-posts",
  "summary": "建立社群貼文（可排程）",
  "tag": "social",
  "body": {
   "type": "object",
   "required": [
    "content",
    "platforms"
   ],
   "properties": {
    "content": {
     "type": "string",
     "minLength": 1
    },
    "platforms": {
     "type": "array",
     "items": {
      "type": "string"
     },
     "minItems": 1
    },
    "hashtags": {
     "type": [
      "string",
      "null"
     ]
    },
    "imageUrls": {
     "type": "array",
     "items": {
      "type": "string"
     }
    },
    "targetAccountIds": {
     "type": "object",
     "additionalProperties": {
      "type": "string"
     }
    },
    "scheduledAt": {
     "type": [
      "string",
      "null"
     ],
     "description": "ISO 時間，null 表示草稿"
    }
   }
  }
 },
 {
  "method": "DELETE",
  "path": "/admin/social-posts/:id",
  "summary": "刪除社群貼文",
  "tag": "social",
  "parameters": [
   {
    "name": "id",
    "in": "path",
    "required": true,
    "type": "string"
   }
  ]
 },
 {
  "method": "PATCH",
  "path": "/admin/social-posts/:id",
  "summary": "編輯社群貼文",
  "tag": "social",
  "parameters": [
   {
    "name": "id",
    "in": "path",
    "required": true,
    "type": "string"
   }
  ],
  "body": {
   "type": "object",
   "properties": {
    "content": {
     "type": "string",
     "minLength": 1
    },
    "platforms": {
     "type": "array",
     "items": {
      "type": "string"
     },
     "minItems": 1
    },
    "hashtags": {
     "type": [
      "string",
      "null"
     ]
    },
    "imageUrls": {
     "type": "array",
     "items": {
      "type": "string"
     }
    },
    "targetAccountIds": {
     "type": "object",
     "additionalProperties": {
      "type": "string"
     }
    },
    "scheduledAt": {
     "type": [
      "string",
      "null"
     ]
    }
   }
  }
 },
 {
  "method": "POST",
  "path": "/admin/social-posts/:id/publish",
  "summary": "立即發布貼文到所選平台",
  "tag": "social",
  "parameters": [
   {
    "name": "id",
    "in": "path",
    "required": true,
    "type": "string"
   }
  ]
 },
 {
  "method": "POST",
  "path": "/admin/social-posts/ai-planner",
  "summary": "AI 對話式內容排程規劃",
  "tag": "social",
  "body": {
   "type": "object",
   "required": [
    "messages"
   ],
   "properties": {
    "messages": {
     "type": "array",
     "minItems": 1,
     "items": {
      "type": "object",
      "required": [
       "role",
       "content"
      ],
      "properties": {
       "role": {
        "type": "string",
        "enum": [
         "user",
         "assistant"
        ]
       },
       "content": {
        "type": "string"
       }
      }
     }
    }
   }
  }
 },
 {
  "method": "POST",
  "path": "/admin/social-posts/batch-create",
  "summary": "批次建立排程貼文（AI Planner 計畫）",
  "tag": "social",
  "body": {
   "type": "object",
   "required": [
    "posts"
   ],
   "properties": {
    "posts": {
     "type": "array",
     "minItems": 1,
     "items": {
      "type": "object",
      "required": [
       "content",
       "platforms"
      ],
      "properties": {
       "content": {
        "type": "string",
        "minLength": 1
       },
       "platforms": {
        "type": "array",
        "items": {
         "type": "string"
        },
        "minItems": 1
       },
       "hashtags": {
        "type": [
         "string",
         "null"
        ]
       },
       "imageUrls": {
        "type": "array",
        "items": {
         "type": "string"
        }
       },
       "targetAccountIds": {
        "type": "object",
        "additionalProperties": {
         "type": "string"
        }
       },
       "scheduledAt": {
        "type": [
         "string",
         "null"
        ]
       }
      }
     }
    }
   }
  }
 },
 {
  "method": "POST",
  "path": "/admin/social-posts/generate-content",
  "summary": "AI 產生多平台文案",
  "tag": "social",
  "body": {
   "type": "object",
   "required": [
    "topic",
    "platforms"
   ],
   "properties": {
    "topic": {
     "type": "string",
     "minLength": 1
    },
    "platforms": {
     "type": "array",
     "items": {
      "type": "string"
     }
    },
    "tone": {
     "type": [
      "string",
      "null"
     ]
    }
   }
  }
 },
 {
  "method": "POST",
  "path": "/admin/social-posts/generate-image",
  "summary": "AI 產生社群圖片（存入物件儲存並回傳公開 URL）",
  "tag": "social",
  "body": {
   "type": "object",
   "required": [
    "prompt"
   ],
   "properties": {
    "prompt": {
     "type": "string",
     "minLength": 1
    }
   }
  }
 },
 {
  "method": "POST",
  "path": "/admin/social-posts/preview",
  "summary": "預覽各平台字數裁切結果",
  "tag": "social",
  "body": {
   "type": "object",
   "required": [
    "content",
    "platforms"
   ],
   "properties": {
    "content": {
     "type": "string"
    },
    "hashtags": {
     "type": [
      "string",
      "null"
     ]
    },
    "platforms": {
     "type": "array",
     "items": {
      "type": "string"
     }
    }
   }
  }
 },
 {
  "method": "GET",
  "path": "/admin/stats",
  "summary": "後台儀表板統計數字（限管理員）",
  "tag": "admin"
 },
 {
  "method": "GET",
  "path": "/admin/stock-movements",
  "summary": "庫存異動紀錄（限管理員）",
  "tag": "admin",
  "parameters": [
   {
    "name": "productId",
    "in": "query",
    "required": false,
    "type": "integer"
   },
   {
    "name": "type",
    "in": "query",
    "required": false,
    "type": "string",
    "enum": [
     "purchase",
     "sale",
     "adjust"
    ]
   },
   {
    "name": "from",
    "in": "query",
    "required": false,
    "type": "string"
   },
   {
    "name": "to",
    "in": "query",
    "required": false,
    "type": "string"
   }
  ]
 },
 {
  "method": "GET",
  "path": "/admin/suppliers",
  "summary": "供應商列表（限管理員）",
  "tag": "admin",
  "parameters": [
   {
    "name": "search",
    "in": "query",
    "required": false,
    "type": "string"
   }
  ]
 },
 {
  "method": "POST",
  "path": "/admin/suppliers",
  "summary": "新增供應商（限管理員）",
  "tag": "admin",
  "body": {
   "type": "object",
   "required": [
    "name"
   ],
   "properties": {
    "name": {
     "type": "string",
     "minLength": 1
    },
    "contactPerson": {
     "type": [
      "string",
      "null"
     ]
    },
    "phone": {
     "type": [
      "string",
      "null"
     ]
    },
    "email": {
     "type": [
      "string",
      "null"
     ]
    },
    "address": {
     "type": [
      "string",
      "null"
     ]
    },
    "paymentTerms": {
     "type": [
      "string",
      "null"
     ]
    },
    "note": {
     "type": [
      "string",
      "null"
     ]
    }
   }
  }
 },
 {
  "method": "PATCH",
  "path": "/admin/suppliers/:id",
  "summary": "編輯供應商（限管理員）",
  "tag": "admin",
  "parameters": [
   {
    "name": "id",
    "in": "path",
    "required": true,
    "type": "integer"
   }
  ],
  "body": {
   "type": "object",
   "properties": {
    "name": {
     "type": "string",
     "minLength": 1
    },
    "contactPerson": {
     "type": [
      "string",
      "null"
     ]
    },
    "phone": {
     "type": [
      "string",
      "null"
     ]
    },
    "email": {
     "type": [
      "string",
      "null"
     ]
    },
    "address": {
     "type": [
      "string",
      "null"
     ]
    },
    "paymentTerms": {
     "type": [
      "string",
      "null"
     ]
    },
    "note": {
     "type": [
      "string",
      "null"
     ]
    },
    "isActive": {
     "type": "boolean"
    }
   }
  }
 },
 {
  "method": "GET",
  "path": "/admin/support/conversations",
  "summary": "客服對話總覽（後台）",
  "tag": "support",
  "parameters": [
   {
    "name": "needsHuman",
    "in": "query",
    "required": false,
    "type": "string"
   }
  ]
 },
 {
  "method": "POST",
  "path": "/admin/support/conversations/:id/close",
  "summary": "結案客服對話",
  "tag": "support",
  "parameters": [
   {
    "name": "id",
    "in": "path",
    "required": true,
    "type": "integer"
   }
  ]
 },
 {
  "method": "GET",
  "path": "/admin/support/conversations/:id/messages",
  "summary": "檢視客服對話（後台）",
  "tag": "support",
  "parameters": [
   {
    "name": "id",
    "in": "path",
    "required": true,
    "type": "integer"
   }
  ]
 },
 {
  "method": "POST",
  "path": "/admin/support/conversations/:id/reply",
  "summary": "真人客服回覆",
  "tag": "support",
  "parameters": [
   {
    "name": "id",
    "in": "path",
    "required": true,
    "type": "integer"
   }
  ],
  "body": {
   "type": "object",
   "required": [
    "content"
   ],
   "properties": {
    "content": {
     "type": "string",
     "minLength": 1,
     "maxLength": 4000
    }
   }
  }
 },
 {
  "method": "DELETE",
  "path": "/admin/variants/:id",
  "summary": "刪除商品規格（限營運人員；已有訂單紀錄者不可刪除）",
  "tag": "admin",
  "parameters": [
   {
    "name": "id",
    "in": "path",
    "required": true,
    "type": "integer"
   }
  ]
 },
 {
  "method": "PATCH",
  "path": "/admin/variants/:id",
  "summary": "編輯商品規格（限營運人員；庫存請走庫存調整）",
  "tag": "admin",
  "parameters": [
   {
    "name": "id",
    "in": "path",
    "required": true,
    "type": "integer"
   }
  ],
  "body": {
   "type": "object",
   "properties": {
    "name": {
     "type": "string",
     "minLength": 1,
     "maxLength": 100
    },
    "priceHospital": {
     "type": "integer",
     "minimum": 0
    },
    "priceClinic": {
     "type": "integer",
     "minimum": 0
    },
    "priceConsumer": {
     "type": "integer",
     "minimum": 0
    },
    "costPrice": {
     "type": "integer",
     "minimum": 0
    },
    "isActive": {
     "type": "boolean"
    }
   }
  }
 },
 {
  "method": "GET",
  "path": "/admin/wallets/:memberId",
  "summary": "單一會員錢包明細（限管理員）",
  "tag": "admin",
  "parameters": [
   {
    "name": "memberId",
    "in": "path",
    "required": true,
    "type": "integer"
   }
  ]
 },
 {
  "method": "POST",
  "path": "/admin/wallets/:memberId/adjust",
  "summary": "管理員儲值／調整會員錢包（限管理員）",
  "tag": "admin",
  "parameters": [
   {
    "name": "memberId",
    "in": "path",
    "required": true,
    "type": "integer"
   }
  ],
  "body": {
   "type": "object",
   "required": [
    "type",
    "amount"
   ],
   "properties": {
    "type": {
     "type": "string",
     "enum": [
      "deposit",
      "adjust"
     ]
    },
    "amount": {
     "type": "integer",
     "description": "儲值必須為正；調整可為正負 (NT$)"
    },
    "reason": {
     "type": [
      "string",
      "null"
     ],
     "maxLength": 200
    }
   }
  }
 },
 {
  "method": "GET",
  "path": "/admin/wallets/stats",
  "summary": "會員錢包統計總覽（限管理員）",
  "tag": "admin",
  "parameters": [
   {
    "name": "from",
    "in": "query",
    "required": false,
    "type": "string"
   },
   {
    "name": "to",
    "in": "query",
    "required": false,
    "type": "string"
   }
  ]
 },
 {
  "method": "GET",
  "path": "/newsletter/api-keys",
  "summary": "API 金鑰列表",
  "tag": "newsletter"
 },
 {
  "method": "POST",
  "path": "/newsletter/api-keys",
  "summary": "新增 API 金鑰",
  "tag": "newsletter",
  "body": {
   "type": "object",
   "required": [
    "name"
   ],
   "properties": {
    "name": {
     "type": "string",
     "minLength": 1
    },
    "permissions": {
     "type": "string",
     "enum": [
      "full",
      "subscribe_only"
     ]
    }
   }
  }
 },
 {
  "method": "DELETE",
  "path": "/newsletter/api-keys/:id",
  "summary": "刪除 API 金鑰",
  "tag": "newsletter",
  "parameters": [
   {
    "name": "id",
    "in": "path",
    "required": true,
    "type": "integer"
   }
  ]
 },
 {
  "method": "PATCH",
  "path": "/newsletter/api-keys/:id",
  "summary": "更新 API 金鑰",
  "tag": "newsletter",
  "parameters": [
   {
    "name": "id",
    "in": "path",
    "required": true,
    "type": "integer"
   }
  ],
  "body": {
   "type": "object",
   "properties": {
    "name": {
     "type": "string"
    },
    "permissions": {
     "type": "string",
     "enum": [
      "full",
      "subscribe_only"
     ]
    },
    "isActive": {
     "type": "boolean"
    }
   }
  }
 },
 {
  "method": "GET",
  "path": "/newsletter/campaigns",
  "summary": "郵件活動列表",
  "tag": "newsletter"
 },
 {
  "method": "POST",
  "path": "/newsletter/campaigns",
  "summary": "建立郵件活動",
  "tag": "newsletter",
  "body": {
   "type": "object",
   "required": [
    "name",
    "subject",
    "fromEmail"
   ],
   "properties": {
    "name": {
     "type": "string",
     "minLength": 1
    },
    "subject": {
     "type": "string",
     "minLength": 1
    },
    "fromEmail": {
     "type": "string",
     "minLength": 3
    },
    "htmlContent": {
     "type": "string"
    },
    "tagFilter": {
     "type": "string",
     "nullable": true
    }
   }
  }
 },
 {
  "method": "DELETE",
  "path": "/newsletter/campaigns/:id",
  "summary": "刪除郵件活動",
  "tag": "newsletter",
  "parameters": [
   {
    "name": "id",
    "in": "path",
    "required": true,
    "type": "integer"
   }
  ]
 },
 {
  "method": "PATCH",
  "path": "/newsletter/campaigns/:id",
  "summary": "更新郵件活動",
  "tag": "newsletter",
  "parameters": [
   {
    "name": "id",
    "in": "path",
    "required": true,
    "type": "integer"
   }
  ],
  "body": {
   "type": "object",
   "properties": {
    "name": {
     "type": "string"
    },
    "subject": {
     "type": "string"
    },
    "fromEmail": {
     "type": "string"
    },
    "htmlContent": {
     "type": "string"
    },
    "tagFilter": {
     "type": "string",
     "nullable": true
    }
   }
  }
 },
 {
  "method": "GET",
  "path": "/newsletter/campaigns/:id/logs",
  "summary": "活動發送記錄",
  "tag": "newsletter",
  "parameters": [
   {
    "name": "id",
    "in": "path",
    "required": true,
    "type": "integer"
   }
  ]
 },
 {
  "method": "POST",
  "path": "/newsletter/campaigns/:id/schedule",
  "summary": "排程活動",
  "tag": "newsletter",
  "parameters": [
   {
    "name": "id",
    "in": "path",
    "required": true,
    "type": "integer"
   }
  ],
  "body": {
   "type": "object",
   "required": [
    "scheduledAt"
   ],
   "properties": {
    "scheduledAt": {
     "type": "string"
    }
   }
  }
 },
 {
  "method": "POST",
  "path": "/newsletter/campaigns/:id/send",
  "summary": "立即發送活動",
  "tag": "newsletter",
  "parameters": [
   {
    "name": "id",
    "in": "path",
    "required": true,
    "type": "integer"
   }
  ]
 },
 {
  "method": "GET",
  "path": "/newsletter/domains",
  "summary": "寄件域名列表",
  "tag": "newsletter"
 },
 {
  "method": "POST",
  "path": "/newsletter/domains",
  "summary": "新增寄件域名（Resend）",
  "tag": "newsletter",
  "body": {
   "type": "object",
   "required": [
    "domain"
   ],
   "properties": {
    "domain": {
     "type": "string",
     "minLength": 3
    }
   }
  }
 },
 {
  "method": "DELETE",
  "path": "/newsletter/domains/:id",
  "summary": "刪除域名",
  "tag": "newsletter",
  "parameters": [
   {
    "name": "id",
    "in": "path",
    "required": true,
    "type": "integer"
   }
  ]
 },
 {
  "method": "POST",
  "path": "/newsletter/domains/:id/verify",
  "summary": "驗證域名 DNS",
  "tag": "newsletter",
  "parameters": [
   {
    "name": "id",
    "in": "path",
    "required": true,
    "type": "integer"
   }
  ]
 },
 {
  "method": "GET",
  "path": "/newsletter/sequences",
  "summary": "自動序列列表",
  "tag": "newsletter"
 },
 {
  "method": "POST",
  "path": "/newsletter/sequences",
  "summary": "建立自動序列",
  "tag": "newsletter",
  "body": {
   "type": "object",
   "required": [
    "name"
   ],
   "properties": {
    "name": {
     "type": "string",
     "minLength": 1
    },
    "description": {
     "type": "string",
     "nullable": true
    },
    "fromEmail": {
     "type": "string",
     "nullable": true
    }
   }
  }
 },
 {
  "method": "DELETE",
  "path": "/newsletter/sequences/:id",
  "summary": "刪除序列",
  "tag": "newsletter",
  "parameters": [
   {
    "name": "id",
    "in": "path",
    "required": true,
    "type": "integer"
   }
  ]
 },
 {
  "method": "GET",
  "path": "/newsletter/sequences/:id",
  "summary": "序列詳情（含步驟與入列統計）",
  "tag": "newsletter",
  "parameters": [
   {
    "name": "id",
    "in": "path",
    "required": true,
    "type": "integer"
   }
  ]
 },
 {
  "method": "PATCH",
  "path": "/newsletter/sequences/:id",
  "summary": "更新序列（含 flowData 與啟用狀態）",
  "tag": "newsletter",
  "parameters": [
   {
    "name": "id",
    "in": "path",
    "required": true,
    "type": "integer"
   }
  ],
  "body": {
   "type": "object",
   "properties": {
    "name": {
     "type": "string"
    },
    "description": {
     "type": "string",
     "nullable": true
    },
    "fromEmail": {
     "type": "string",
     "nullable": true
    },
    "isActive": {
     "type": "boolean"
    },
    "flowData": {
     "nullable": true
    }
   }
  }
 },
 {
  "method": "GET",
  "path": "/newsletter/sequences/:id/steps",
  "summary": "序列步驟列表",
  "tag": "newsletter",
  "parameters": [
   {
    "name": "id",
    "in": "path",
    "required": true,
    "type": "integer"
   }
  ]
 },
 {
  "method": "POST",
  "path": "/newsletter/sequences/:id/steps",
  "summary": "新增序列步驟",
  "tag": "newsletter",
  "parameters": [
   {
    "name": "id",
    "in": "path",
    "required": true,
    "type": "integer"
   }
  ],
  "body": {
   "type": "object",
   "required": [
    "subject"
   ],
   "properties": {
    "subject": {
     "type": "string",
     "minLength": 1
    },
    "htmlContent": {
     "type": "string"
    },
    "delayDays": {
     "type": "integer",
     "minimum": 0
    },
    "stepOrder": {
     "type": "integer",
     "minimum": 1
    }
   }
  }
 },
 {
  "method": "DELETE",
  "path": "/newsletter/sequences/steps/:id",
  "summary": "刪除序列步驟",
  "tag": "newsletter",
  "parameters": [
   {
    "name": "id",
    "in": "path",
    "required": true,
    "type": "integer"
   }
  ]
 },
 {
  "method": "PATCH",
  "path": "/newsletter/sequences/steps/:id",
  "summary": "更新序列步驟",
  "tag": "newsletter",
  "parameters": [
   {
    "name": "id",
    "in": "path",
    "required": true,
    "type": "integer"
   }
  ],
  "body": {
   "type": "object",
   "properties": {
    "subject": {
     "type": "string"
    },
    "htmlContent": {
     "type": "string"
    },
    "delayDays": {
     "type": "integer",
     "minimum": 0
    },
    "stepOrder": {
     "type": "integer",
     "minimum": 1
    }
   }
  }
 },
 {
  "method": "GET",
  "path": "/newsletter/subscribers",
  "summary": "訂閱者列表",
  "tag": "newsletter",
  "parameters": [
   {
    "name": "status",
    "in": "query",
    "required": false,
    "type": "string"
   },
   {
    "name": "tag",
    "in": "query",
    "required": false,
    "type": "string"
   },
   {
    "name": "q",
    "in": "query",
    "required": false,
    "type": "string"
   }
  ]
 },
 {
  "method": "POST",
  "path": "/newsletter/subscribers",
  "summary": "新增訂閱者",
  "tag": "newsletter",
  "body": {
   "type": "object",
   "required": [
    "email"
   ],
   "properties": {
    "email": {
     "type": "string",
     "format": "email"
    },
    "name": {
     "type": "string",
     "nullable": true
    },
    "tags": {
     "type": "array",
     "items": {
      "type": "string"
     }
    }
   }
  }
 },
 {
  "method": "DELETE",
  "path": "/newsletter/subscribers/:id",
  "summary": "刪除訂閱者",
  "tag": "newsletter",
  "parameters": [
   {
    "name": "id",
    "in": "path",
    "required": true,
    "type": "integer"
   }
  ]
 },
 {
  "method": "PATCH",
  "path": "/newsletter/subscribers/:id",
  "summary": "更新訂閱者",
  "tag": "newsletter",
  "parameters": [
   {
    "name": "id",
    "in": "path",
    "required": true,
    "type": "integer"
   }
  ],
  "body": {
   "type": "object",
   "properties": {
    "email": {
     "type": "string",
     "format": "email"
    },
    "name": {
     "type": "string",
     "nullable": true
    },
    "tags": {
     "type": "array",
     "items": {
      "type": "string"
     }
    },
    "status": {
     "type": "string",
     "enum": [
      "subscribed",
      "unsubscribed"
     ]
    }
   }
  }
 },
 {
  "method": "POST",
  "path": "/newsletter/subscribers/import",
  "summary": "CSV 匯入訂閱者",
  "tag": "newsletter",
  "body": {
   "type": "object",
   "required": [
    "csv"
   ],
   "properties": {
    "csv": {
     "type": "string",
     "minLength": 1
    },
    "tags": {
     "type": "array",
     "items": {
      "type": "string"
     }
    }
   }
  }
 },
 {
  "method": "GET",
  "path": "/newsletter/unsubscribe",
  "summary": "",
  "tag": ""
 },
 {
  "method": "POST",
  "path": "/newsletter/unsubscribe",
  "summary": "",
  "tag": ""
 },
 {
  "method": "GET",
  "path": "/newsletter/usage",
  "summary": "郵件發送用量統計",
  "tag": "newsletter"
 },
 {
  "method": "POST",
  "path": "/newsletter/v1/send",
  "summary": "[公開 v1] 外部系統發送單封郵件（需 full 權限金鑰）",
  "tag": "newsletter",
  "body": {
   "type": "object",
   "required": [
    "from",
    "to",
    "subject",
    "html"
   ],
   "properties": {
    "from": {
     "type": "string"
    },
    "to": {
     "type": "string",
     "format": "email"
    },
    "subject": {
     "type": "string"
    },
    "html": {
     "type": "string"
    }
   }
  }
 },
 {
  "method": "POST",
  "path": "/newsletter/v1/subscribers",
  "summary": "[公開 v1] 外部系統訂閱",
  "tag": "newsletter",
  "body": {
   "type": "object",
   "required": [
    "email"
   ],
   "properties": {
    "email": {
     "type": "string",
     "format": "email"
    },
    "name": {
     "type": "string",
     "nullable": true
    },
    "tags": {
     "type": "array",
     "items": {
      "type": "string"
     }
    }
   }
  }
 },
 {
  "method": "POST",
  "path": "/newsletter/v1/unsubscribe",
  "summary": "[公開 v1] 外部系統退訂",
  "tag": "newsletter",
  "body": {
   "type": "object",
   "required": [
    "email"
   ],
   "properties": {
    "email": {
     "type": "string",
     "format": "email"
    }
   }
  }
 }
] as unknown as AdminEndpoint[];
