import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetErpQuotationQueryKey, getListErpQuotationsQueryKey,
  useConvertErpQuotation,
  useCreateErpQuotation,
  useGetErpQuotation,
  useListErpItems, useListErpHrEmployees,
  useListErpQuotations,
  useUpdateErpQuotationStatus,
} from "@workspace/api-client-react";
import { ArrowRightLeft, Eye, Loader2, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";

const statusLabel: Record<string, string> = {
  draft: "草稿", sent: "已送出", accepted: "已接受", converted: "已轉訂單", cancelled: "已取消",
};
const statusColor: Record<string, string> = {
  draft: "bg-slate-100 text-slate-700", sent: "bg-blue-100 text-blue-700",
  accepted: "bg-green-100 text-green-700", converted: "bg-emerald-100 text-emerald-700",
  cancelled: "bg-red-100 text-red-700",
};
const errorMessage = (err: any) => err?.response?.data?.error || err?.data?.error || err?.message || "發生未知錯誤";
type Line = { productId: string; variantId: string; unitPrice: string; quantity: string };
const emptyLine = (): Line => ({ productId: "", variantId: "", unitPrice: "", quantity: "1" });

export default function QuotationsPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [status, setStatus] = useState("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [customerName, setCustomerName] = useState("");
  const [memberId, setMemberId] = useState("");
  const [institutionId, setInstitutionId] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [note, setNote] = useState("");
  const [creatorEmployeeId, setCreatorEmployeeId] = useState("");
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const params = { status: status === "all" ? undefined : status };
  const { data: quotations, isLoading } = useListErpQuotations(params);
  const { data: products } = useListErpItems();
  const { data: employees, isLoading: employeesLoading } = useListErpHrEmployees();
  const activeEmployees = employees?.filter((employee) => employee.status === "active") ?? [];
  const creatorName = (id?: number | null) => employees?.find((employee) => employee.id === id)?.name || "—";
  const { data: detail, isLoading: detailLoading } = useGetErpQuotation(detailId ?? 0, {
    query: { queryKey: getGetErpQuotationQueryKey(detailId ?? 0), enabled: detailId !== null },
  });
  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListErpQuotationsQueryKey() });
  const reset = () => {
    setCustomerName(""); setMemberId(""); setInstitutionId(""); setValidUntil(""); setNote(""); setCreatorEmployeeId(""); setLines([emptyLine()]);
  };
  const create = useCreateErpQuotation({ mutation: {
    onSuccess: () => { invalidate(); toast({ title: "已建立報價單" }); setCreateOpen(false); reset(); },
    onError: (err: any) => toast({ title: "建立失敗", description: errorMessage(err), variant: "destructive" }),
  }});
  const updateStatus = useUpdateErpQuotationStatus({ mutation: {
    onSuccess: () => { invalidate(); queryClient.invalidateQueries({ queryKey: getGetErpQuotationQueryKey(detailId ?? 0) }); toast({ title: "狀態已更新" }); },
    onError: (err: any) => toast({ title: "更新失敗", description: errorMessage(err), variant: "destructive" }),
  }});
  const convert = useConvertErpQuotation({ mutation: {
    onSuccess: (result) => { invalidate(); queryClient.invalidateQueries({ queryKey: getGetErpQuotationQueryKey(detailId ?? 0) }); toast({ title: "已轉為訂單", description: result.convertedOrderNo || undefined }); },
    onError: (err: any) => toast({ title: "轉單失敗", description: errorMessage(err), variant: "destructive" }),
  }});

  const submit = () => {
    const items = lines.filter((line) => line.productId).map((line) => ({
      productId: Number(line.productId), variantId: line.variantId ? Number(line.variantId) : null,
      unitPrice: Number(line.unitPrice), quantity: Number(line.quantity),
    }));
    if (!customerName.trim() || !items.length || items.some((item) => item.unitPrice < 0 || item.quantity < 1)) {
      toast({ title: "請填寫客戶與有效品項", description: "單價不可小於 0，數量至少為 1", variant: "destructive" }); return;
    }
    create.mutate({ data: { customerName: customerName.trim(), memberId: memberId ? Number(memberId) : null,
      institutionId: institutionId ? Number(institutionId) : null, creatorEmployeeId: creatorEmployeeId ? Number(creatorEmployeeId) : null, validUntil: validUntil || null, note: note || null, items } });
  };

  return <div className="space-y-6">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <Tabs value={status} onValueChange={setStatus}><TabsList>
        <TabsTrigger value="all">全部</TabsTrigger><TabsTrigger value="draft">草稿</TabsTrigger>
        <TabsTrigger value="sent">已送出</TabsTrigger><TabsTrigger value="accepted">已接受</TabsTrigger>
        <TabsTrigger value="converted">已轉訂單</TabsTrigger><TabsTrigger value="cancelled">已取消</TabsTrigger>
      </TabsList></Tabs>
      <Button onClick={() => setCreateOpen(true)}><Plus className="mr-1 h-4 w-4" />建立報價單</Button>
    </div>
    <Card className="overflow-hidden border-t-2 border-t-primary shadow-sm"><Table>
      <TableHeader className="bg-secondary/50"><TableRow>
        <TableHead>單號</TableHead><TableHead>客戶</TableHead><TableHead>有效期限</TableHead>
        <TableHead className="text-right">金額</TableHead><TableHead>狀態</TableHead><TableHead>製單人</TableHead><TableHead>建立時間</TableHead><TableHead className="text-right">操作</TableHead>
      </TableRow></TableHeader>
      <TableBody>{isLoading ? <TableRow><TableCell colSpan={8} className="h-32 text-center"><Loader2 className="mx-auto h-6 w-6 animate-spin" /></TableCell></TableRow>
        : !quotations?.length ? <TableRow><TableCell colSpan={8} className="h-32 text-center text-muted-foreground">查無報價單</TableCell></TableRow>
        : quotations.map((q) => <TableRow key={q.id}>
          <TableCell className="font-medium">{q.quoteNo}</TableCell><TableCell>{q.customerName}</TableCell>
          <TableCell>{q.validUntil || "—"}</TableCell><TableCell className="text-right">NT$ {q.totalAmount.toLocaleString()}</TableCell>
          <TableCell><Badge variant="outline" className={statusColor[q.status]}>{statusLabel[q.status]}</Badge></TableCell><TableCell>{creatorName(q.creatorEmployeeId)}</TableCell>
          <TableCell>{new Date(q.createdAt).toLocaleDateString("zh-TW")}</TableCell>
          <TableCell className="text-right"><Button variant="ghost" size="sm" onClick={() => setDetailId(q.id)}><Eye className="mr-1 h-4 w-4" />明細</Button></TableCell>
        </TableRow>)}</TableBody>
    </Table></Card>

    <Dialog open={createOpen} onOpenChange={(open) => { setCreateOpen(open); if (!open) reset(); }}><DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
      <DialogHeader><DialogTitle>建立報價單</DialogTitle></DialogHeader>
      <div className="grid gap-4 py-2">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2"><Label>客戶名稱 *</Label><Input value={customerName} onChange={(e) => setCustomerName(e.target.value)} /></div>
          <div className="space-y-2"><Label>有效期限</Label><Input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} /></div>
          <div className="space-y-2"><Label>會員 ID（轉單必填）</Label><Input type="number" value={memberId} onChange={(e) => setMemberId(e.target.value)} /></div>
          <div className="space-y-2"><Label>機構 ID</Label><Input type="number" value={institutionId} onChange={(e) => setInstitutionId(e.target.value)} /></div>
           <div className="space-y-2"><Label>製單人（選填）</Label><Select value={creatorEmployeeId} onValueChange={setCreatorEmployeeId} disabled={employeesLoading || !activeEmployees.length}><SelectTrigger><SelectValue placeholder={employeesLoading ? "載入員工中…" : activeEmployees.length ? "選擇製單人" : "無在職員工"} /></SelectTrigger><SelectContent>{activeEmployees.map((employee) => <SelectItem key={employee.id} value={String(employee.id)}>{employee.employeeNo}－{employee.name}</SelectItem>)}</SelectContent></Select></div>
        </div>
        <div className="space-y-2"><Label>報價品項 *</Label>{lines.map((line, index) => {
          const product = products?.find((p) => p.id === Number(line.productId));
          return <div key={index} className="grid grid-cols-12 gap-2">
            <Select value={line.productId} onValueChange={(value) => setLines(lines.map((x, i) => i === index ? { ...x, productId: value, variantId: "" } : x))}>
              <SelectTrigger className="col-span-4"><SelectValue placeholder="選擇品項" /></SelectTrigger><SelectContent>
                {products?.filter((p) => p.isActive).map((p) => <SelectItem key={p.id} value={String(p.id)}>{p.code}－{p.name}</SelectItem>)}
              </SelectContent></Select>
            <Select value={line.variantId || "none"} onValueChange={(value) => setLines(lines.map((x, i) => i === index ? { ...x, variantId: value === "none" ? "" : value } : x))}>
              <SelectTrigger className="col-span-3"><SelectValue placeholder="規格" /></SelectTrigger><SelectContent><SelectItem value="none">無規格</SelectItem>
                {product?.variants.filter((v) => v.isActive).map((v) => <SelectItem key={v.id} value={String(v.id)}>{v.name}</SelectItem>)}
              </SelectContent></Select>
            <Input className="col-span-2" type="number" min="0" placeholder="單價" value={line.unitPrice} onChange={(e) => setLines(lines.map((x, i) => i === index ? { ...x, unitPrice: e.target.value } : x))} />
            <Input className="col-span-2" type="number" min="1" placeholder="數量" value={line.quantity} onChange={(e) => setLines(lines.map((x, i) => i === index ? { ...x, quantity: e.target.value } : x))} />
            <Button className="col-span-1" variant="ghost" size="icon" disabled={lines.length === 1} onClick={() => setLines(lines.filter((_, i) => i !== index))}><Trash2 className="h-4 w-4" /></Button>
          </div>;
        })}
          <Button variant="outline" size="sm" onClick={() => setLines([...lines, emptyLine()])}><Plus className="mr-1 h-4 w-4" />新增品項</Button>
        </div>
        <div className="text-right font-medium">總計：NT$ {lines.reduce((sum, x) => sum + (Number(x.unitPrice) || 0) * (Number(x.quantity) || 0), 0).toLocaleString()}</div>
        <div className="space-y-2"><Label>備註</Label><Textarea value={note} onChange={(e) => setNote(e.target.value)} /></div>
      </div>
      <DialogFooter><Button variant="outline" onClick={() => setCreateOpen(false)}>取消</Button><Button disabled={create.isPending} onClick={submit}>建立</Button></DialogFooter>
    </DialogContent></Dialog>

    <Dialog open={detailId !== null} onOpenChange={(open) => !open && setDetailId(null)}><DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
      <DialogHeader><DialogTitle>報價單明細 {detail?.quoteNo}</DialogTitle></DialogHeader>
      {detailLoading ? <Loader2 className="mx-auto my-12 h-6 w-6 animate-spin" /> : detail && <div className="space-y-4">
        <div className="flex gap-2"><Badge variant="outline" className={statusColor[detail.status]}>{statusLabel[detail.status]}</Badge>
          {detail.convertedOrderNo && <Badge variant="outline">訂單：{detail.convertedOrderNo}</Badge>}</div>
        <div className="grid gap-2 rounded-lg bg-muted/40 p-4 text-sm sm:grid-cols-2">
          <div>客戶：{detail.customerName}</div><div>有效期限：{detail.validUntil || "—"}</div><div>製單人：{creatorName(detail.creatorEmployeeId)}</div>
          {detail.memberName && <div>會員：{detail.memberName}</div>}{detail.institutionName && <div>機構：{detail.institutionName}</div>}
          {detail.note && <div className="sm:col-span-2">備註：{detail.note}</div>}
        </div>
        <Table><TableHeader><TableRow><TableHead>品項</TableHead><TableHead>規格</TableHead><TableHead className="text-right">單價</TableHead><TableHead className="text-right">數量</TableHead><TableHead className="text-right">小計</TableHead></TableRow></TableHeader>
          <TableBody>{detail.items.map((item) => <TableRow key={item.id}><TableCell>{item.productCode}－{item.productName}</TableCell><TableCell>{item.variantName || "—"}</TableCell>
            <TableCell className="text-right">NT$ {item.unitPrice.toLocaleString()}</TableCell><TableCell className="text-right">{item.quantity}</TableCell><TableCell className="text-right">NT$ {(item.unitPrice * item.quantity).toLocaleString()}</TableCell></TableRow>)}</TableBody>
        </Table>
        <div className="text-right text-lg font-bold">總計：NT$ {detail.totalAmount.toLocaleString()}</div>
        <div className="flex flex-wrap justify-end gap-2">
          {detail.status === "draft" && <Button variant="outline" onClick={() => updateStatus.mutate({ id: detail.id, data: { status: "sent" } })}>送出報價</Button>}
          {detail.status === "sent" && <Button variant="outline" onClick={() => updateStatus.mutate({ id: detail.id, data: { status: "accepted" } })}>接受報價</Button>}
          {detail.status === "accepted" && <Button disabled={convert.isPending} onClick={() => convert.mutate({ id: detail.id })}><ArrowRightLeft className="mr-1 h-4 w-4" />轉訂單</Button>}
          {["draft", "sent"].includes(detail.status) && <Button variant="destructive" onClick={() => updateStatus.mutate({ id: detail.id, data: { status: "cancelled" } })}>取消報價單</Button>}
        </div>
      </div>}
    </DialogContent></Dialog>
  </div>;
}