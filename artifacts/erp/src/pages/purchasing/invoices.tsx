import { useState } from "react";
import { RelatedDocs, useOpenFromUrl } from "@/components/shared/related-docs";
import { PaymentTermField, InvoiceSchedulePanel, paymentTermPayload } from "@/components/shared/payment-term";
import { ProjectField } from "@/components/shared/project-field";
import { useListInvoices, useCreateInvoice, useUpdateInvoice, useDeleteInvoice, useListItems } from "@workspace/erp-api-client-react";
import { DataTable } from "@/components/shared/data-table";
import { PageHeader } from "@/components/shared/page-header";
import { BatchActionBar, type BatchField } from "@/components/shared/batch-action-bar";
import { CheckboxCell, CheckboxHeader } from "@/components/shared/checkbox-column";
import { useBatchSelection } from "@/hooks/use-batch-selection";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { InvoiceCreateDialog, InvoiceEditDialog } from "@/components/accounting/invoice-doc";
import { useToast } from "@/hooks/use-toast";
import { SearchableSelect } from "@/components/shared/searchable-select";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

const BASE_URL = import.meta.env.BASE_URL;
const api = (path: string) => `/erp-api/${path}`;

const statusMap: Record<string, string> = { Draft: "草稿", Unpaid: "未付款", Paid: "已付款", Cancelled: "已取消" };
const statusOptions = ["Draft", "Unpaid", "Paid", "Cancelled"];

type LineItem = { itemId: number; quantity: number; rate: number };
type TaxType = "taxable" | "zero_rated" | "exempt" | "unclassified";
const taxOptions = [{ value: "taxable", label: "應稅 5%" }, { value: "zero_rated", label: "零稅率" }, { value: "exempt", label: "免稅" }];

export default function PurchaseInvoicesPage() {
  const queryClient = useQueryClient();
  const { data: allInvoices, isLoading } = useListInvoices();
  const { data: suppliers = [] } = useQuery({
    queryKey: ["/erp-api/suppliers"],
    queryFn: () => fetch(api("suppliers")).then(r => r.json()),
  });
  const { data: items } = useListItems();
  const invoices = Array.isArray(allInvoices) ? allInvoices.filter((inv) => inv.invoiceType === "Purchase") : [];
  const batch = useBatchSelection(invoices);
  const batchFields: BatchField[] = [{key:"status",label:"狀態",type:"select",options:[{value:"Draft",label:"草稿"},{value:"Submitted",label:"已提交"},{value:"Paid",label:"已付款"}]}];
  const deleteMut = useDeleteInvoice();
  const { toast } = useToast();

  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  useOpenFromUrl(invoices as any[], row => setEditing(row));
  const openCreate = () => setCreateOpen(true);
  const openEdit = (inv: any) => setEditing(inv);

  const handleDelete = async (inv: any) => {
    if (!confirm(`確定刪除發票「${inv.invoiceNumber}」？`)) return;
    try {
      await deleteMut.mutateAsync({ id: inv.id });
      toast({ title: "發票已刪除" });
    } catch (err: any) {
      toast({ title: "刪除失敗", description: err.message, variant: "destructive" });
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader title="採購發票" description="費用追蹤">
        <Button onClick={openCreate}><Plus size={16} className="mr-1" />新增採購發票</Button>
      </PageHeader>
      {batch.count > 0 && (
        <BatchActionBar
          count={batch.count}
          entityName="採購發票"
          entityEndpoint="invoices"
          ids={batch.ids}
          batchFields={batchFields}
          onClear={batch.clearSelection}
          onComplete={() => queryClient.invalidateQueries({ queryKey: ["/erp-api/invoices"] })}
        />
      )}
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <DataTable
            isLoading={isLoading}
            data={invoices}
            columns={[
              {
                header: () => <CheckboxHeader checked={batch.allSelected} indeterminate={batch.someSelected} onChange={batch.toggleAll} />,
                accessor: (r: any) => <CheckboxCell checked={batch.selectedIds.has(r.id)} onChange={() => batch.toggle(r.id)} />,
                className: "w-10",
              },
              { header: "發票編號", accessor: "invoiceNumber" },
              { header: "供應商", accessor: (r) => r.supplierName || "-", className: "hidden sm:table-cell" },
              { header: "日期", accessor: "invoiceDate" },
              {
                header: "狀態",
                accessor: (r) => (
                  <Badge variant={r.status === "Paid" ? "default" : r.status === "Cancelled" ? "destructive" : "secondary"}>
                    {statusMap[r.status] || r.status}
                  </Badge>
                ),
              },
              { header: "已付", accessor: (r) => `NT$ ${Number(r.paidAmount).toLocaleString()}`, className: "text-right hidden md:table-cell" },
              { header: "總額", accessor: (r) => `NT$ ${Number(r.totalAmount).toLocaleString()}`, className: "text-right" },
              {
                header: "操作",
                accessor: (r) => (
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon" onClick={() => openEdit(r)}><Pencil size={14} /></Button>
                    <Button variant="ghost" size="icon" onClick={() => handleDelete(r)}><Trash2 size={14} className="text-destructive" /></Button>
                  </div>
                ),
                className: "w-20",
              },
            ]}
          />
        </CardContent>
      </Card>

      {/* 新增、編輯發票：全系統同一個視窗（components/accounting/invoice-doc） */}
      <InvoiceCreateDialog open={createOpen} onOpenChange={setCreateOpen} fixedKind="Purchase" />
      <InvoiceEditDialog invoice={editing} onClose={() => setEditing(null)} />
    </div>
  );
}
