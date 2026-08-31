import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListAdminQuotations,
  useCreateAdminQuotation,
  useUpdateAdminQuotationStatus,
  useConvertAdminQuotation,
  getListAdminQuotationsQueryKey,
  useListAdminProducts,
  type Quotation,
  type QuotationStatusUpdateStatus,
} from "@workspace/api-client-react";
import { Search, Plus, FileSpreadsheet, Eye, Send, CheckCircle2, RotateCcw, Ban, ArrowRightLeft } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { AdminLayout } from "./AdminLayout";
import { PoLineItem } from "@/components/PoLineItem";

const statusLabel: Record<string, string> = {
  draft: "草稿",
  sent: "已送出",
  accepted: "已接受",
  converted: "已轉訂單",
  cancelled: "已取消",
};

const statusColor: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700",
  sent: "bg-blue-100 text-blue-700 border-blue-200",
  accepted: "bg-green-100 text-green-700 border-green-200",
  converted: "bg-emerald-100 text-emerald-700 border-emerald-200",
  cancelled: "bg-red-100 text-red-700 border-red-200",
};

export default function AdminQuotationsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const { data: quotations, isLoading } = useListAdminQuotations(
    { status: statusFilter === "all" ? undefined : statusFilter },
    { query: { queryKey: getListAdminQuotationsQueryKey({ status: statusFilter === "all" ? undefined : statusFilter }) } }
  );
  
  const { data: products } = useListAdminProducts();

  const [createOpen, setCreateOpen] = useState(false);
  const [viewQuote, setViewQuote] = useState<Quotation | null>(null);

  // Form state
  const [customerName, setCustomerName] = useState("");
  const [memberId, setMemberId] = useState("");
  const [institutionId, setInstitutionId] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [note, setNote] = useState("");
  const [items, setItems] = useState<{ productId: string; variantId: string; unitCost: string; quantity: string }[]>([
    { productId: "", variantId: "", unitCost: "", quantity: "" }
  ]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListAdminQuotationsQueryKey() });

  const createQuote = useCreateAdminQuotation({
    mutation: {
      onSuccess: () => {
        invalidate();
        toast({ title: "已建立報價單" });
        setCreateOpen(false);
        resetForm();
      },
      onError: (err: any) => toast({ title: "建立失敗", description: err.message, variant: "destructive" })
    }
  });

  const updateStatus = useUpdateAdminQuotationStatus({
    mutation: {
      onSuccess: (q) => {
        invalidate();
        toast({ title: "狀態已更新" });
        if (viewQuote?.id === q.id) setViewQuote(q as Quotation);
      }
    }
  });

  const convertQuote = useConvertAdminQuotation({
    mutation: {
      onSuccess: (q) => {
        invalidate();
        toast({ title: "已成功轉為訂單", description: `訂單編號: ${q.convertedOrderNo}` });
        if (viewQuote?.id === q.id) setViewQuote(q as Quotation);
      },
      onError: (err: any) => toast({ title: "轉換失敗", description: err.message, variant: "destructive" })
    }
  });

  const resetForm = () => {
    setCustomerName("");
    setMemberId("");
    setInstitutionId("");
    setValidUntil("");
    setNote("");
    setItems([{ productId: "", variantId: "", unitCost: "", quantity: "" }]);
  };

  const handleCreate = () => {
    if (!customerName) {
      toast({ title: "請填寫客戶名稱", variant: "destructive" });
      return;
    }
    
    const validItems = items.filter(i => i.productId).map(i => ({
      productId: Number(i.productId),
      variantId: i.variantId ? Number(i.variantId) : undefined,
      unitPrice: Number(i.unitCost),
      quantity: Number(i.quantity)
    }));

    if (validItems.length === 0) {
      toast({ title: "至少需要一個品項", variant: "destructive" });
      return;
    }
    if (validItems.some(i => i.unitPrice < 0 || i.quantity < 1)) {
      toast({ title: "單價需大於等於0，數量需大於0", variant: "destructive" });
      return;
    }

    createQuote.mutate({
      data: {
        customerName,
        memberId: memberId ? Number(memberId) : null,
        institutionId: institutionId ? Number(institutionId) : null,
        validUntil: validUntil || null,
        note: note || null,
        items: validItems
      }
    });
  };

  const totalAmount = items.reduce((sum, item) => sum + (Number(item.unitCost) || 0) * (Number(item.quantity) || 0), 0);

  return (
    <AdminLayout title="報價單管理">
      <div className="flex justify-between mb-6">
        <Tabs value={statusFilter} onValueChange={setStatusFilter} className="w-full sm:w-auto">
          <TabsList>
            <TabsTrigger value="all">全部</TabsTrigger>
            <TabsTrigger value="draft">草稿</TabsTrigger>
            <TabsTrigger value="sent">已送出</TabsTrigger>
            <TabsTrigger value="accepted">已接受</TabsTrigger>
            <TabsTrigger value="converted">已轉訂單</TabsTrigger>
          </TabsList>
        </Tabs>
        <Button onClick={() => setCreateOpen(true)}><Plus size={16} className="mr-1" /> 建立報價單</Button>
      </div>

      <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 border-b">
            <tr>
              <th className="px-4 py-3 font-medium text-left">單號</th>
              <th className="px-4 py-3 font-medium text-left">客戶名稱</th>
              <th className="px-4 py-3 font-medium text-right">總額</th>
              <th className="px-4 py-3 font-medium text-center">狀態</th>
              <th className="px-4 py-3 font-medium text-left">建立時間</th>
              <th className="px-4 py-3 font-medium text-right">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {isLoading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <tr key={i}>
                  <td colSpan={6} className="p-4"><Skeleton className="h-8 w-full" /></td>
                </tr>
              ))
            ) : !quotations?.length ? (
              <tr><td colSpan={6} className="p-12 text-center text-muted-foreground">查無報價單</td></tr>
            ) : (
              quotations.map(q => (
                <tr key={q.id} className="hover:bg-muted/30">
                  <td className="px-4 py-3 font-medium">{q.quoteNo}</td>
                  <td className="px-4 py-3">{q.customerName}</td>
                  <td className="px-4 py-3 text-right">NT${q.totalAmount.toLocaleString()}</td>
                  <td className="px-4 py-3 text-center">
                    <Badge variant="outline" className={statusColor[q.status]}>{statusLabel[q.status]}</Badge>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{new Date(q.createdAt).toLocaleDateString()}</td>
                  <td className="px-4 py-3 text-right">
                    <Button variant="ghost" size="sm" onClick={() => setViewQuote(q as Quotation)}>
                      <Eye size={16} className="mr-1" /> 檢視
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>建立報價單</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>客戶名稱 *</Label>
                <Input value={customerName} onChange={e => setCustomerName(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>有效期限 (YYYY-MM-DD)</Label>
                <Input type="date" value={validUntil} onChange={e => setValidUntil(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>綁定會員 ID (轉訂單必填)</Label>
                <Input type="number" placeholder="選填" value={memberId} onChange={e => setMemberId(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>綁定機構 ID</Label>
                <Input type="number" placeholder="選填" value={institutionId} onChange={e => setInstitutionId(e.target.value)} />
              </div>
            </div>
            
            <div className="space-y-2">
              <Label>報價品項 *</Label>
              {items.map((line, idx) => (
                <PoLineItem
                  key={idx}
                  idx={idx}
                  line={line}
                  products={products ?? []}
                  canRemove={items.length > 1}
                  onChange={(index, nextLine) => {
                    const next = [...items];
                    next[index] = nextLine;
                    setItems(next);
                  }}
                  onRemove={(index) => setItems(items.filter((_, i) => i !== index))}
                />
              ))}
              <Button size="sm" variant="outline" onClick={() => setItems([...items, { productId: "", variantId: "", unitCost: "", quantity: "" }])}>
                <Plus size={14} className="mr-1" /> 新增品項
              </Button>
            </div>
            
            <div className="text-right font-medium">總計：NT${totalAmount.toLocaleString()}</div>
            
            <div className="space-y-2">
              <Label>備註</Label>
              <Input value={note} onChange={e => setNote(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>取消</Button>
            <Button onClick={handleCreate} disabled={createQuote.isPending}>建立</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!viewQuote} onOpenChange={(open) => !open && setViewQuote(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>報價單 {viewQuote?.quoteNo}</DialogTitle></DialogHeader>
          {viewQuote && (
            <div className="space-y-4">
              <div className="flex gap-2">
                <Badge variant="outline" className={statusColor[viewQuote.status]}>{statusLabel[viewQuote.status]}</Badge>
                {viewQuote.convertedOrderNo && <Badge variant="outline">訂單: {viewQuote.convertedOrderNo}</Badge>}
              </div>
              
              <div className="grid grid-cols-2 gap-4 text-sm bg-muted/30 p-4 rounded-lg">
                <div><span className="text-muted-foreground">客戶名稱：</span>{viewQuote.customerName}</div>
                {viewQuote.memberName && <div><span className="text-muted-foreground">綁定會員：</span>{viewQuote.memberName}</div>}
                {viewQuote.institutionName && <div><span className="text-muted-foreground">綁定機構：</span>{viewQuote.institutionName}</div>}
                {viewQuote.validUntil && <div><span className="text-muted-foreground">有效期限：</span>{viewQuote.validUntil}</div>}
              </div>

              <table className="w-full text-sm mt-4">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="px-3 py-2 text-left">品項</th>
                    <th className="px-3 py-2 text-right">單價</th>
                    <th className="px-3 py-2 text-right">數量</th>
                    <th className="px-3 py-2 text-right">小計</th>
                  </tr>
                </thead>
                <tbody>
                  {viewQuote.items.map((item, i) => (
                    <tr key={i} className="border-b">
                      <td className="px-3 py-2">{item.productName} {item.variantName ? `(${item.variantName})` : ''}</td>
                      <td className="px-3 py-2 text-right">NT${item.unitPrice.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right">{item.quantity}</td>
                      <td className="px-3 py-2 text-right">NT${(item.unitPrice * item.quantity).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={3} className="px-3 py-3 text-right font-medium">總計</td>
                    <td className="px-3 py-3 text-right font-bold text-lg text-primary">NT${viewQuote.totalAmount.toLocaleString()}</td>
                  </tr>
                </tfoot>
              </table>
              
              <div className="flex gap-2 justify-end mt-6">
                {viewQuote.status === 'draft' && (
                  <Button variant="outline" onClick={() => updateStatus.mutate({ id: viewQuote.id, data: { status: 'sent' } })}>標記為已送出</Button>
                )}
                {viewQuote.status === 'sent' && (
                  <Button variant="outline" onClick={() => updateStatus.mutate({ id: viewQuote.id, data: { status: 'accepted' } })}>標記為已接受</Button>
                )}
                {viewQuote.status === 'accepted' && (
                  <Button onClick={() => convertQuote.mutate({ id: viewQuote.id })} disabled={convertQuote.isPending}><ArrowRightLeft className="w-4 h-4 mr-1" /> 轉為訂單</Button>
                )}
                {['draft', 'sent'].includes(viewQuote.status) && (
                  <Button variant="destructive" onClick={() => updateStatus.mutate({ id: viewQuote.id, data: { status: 'cancelled' } })}>取消報價單</Button>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
