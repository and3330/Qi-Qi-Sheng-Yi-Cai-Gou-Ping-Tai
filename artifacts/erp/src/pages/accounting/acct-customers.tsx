import { useState } from "react";
import { useListCustomers, useDeleteCustomer } from "@workspace/erp-api-client-react";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CustomerFormDialog, type CustomerRecord } from "@/components/sales/customer-form-dialog";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Trash2, Search, FileText } from "lucide-react";
import { Link } from "wouter";

export default function AcctCustomersPage() {
  const { data: customers, isLoading, refetch } = useListCustomers({ includeInactive: "1" } as any);
  const deleteCustomer = useDeleteCustomer();
  const { toast } = useToast();
  const [showDialog, setShowDialog] = useState(false);
  const [editing, setEditing] = useState<CustomerRecord | null>(null);
  const [search, setSearch] = useState("");

  // 新增和編輯開的是全系統共用的客戶視窗（和銷售的客戶管理同一個），存檔由視窗自己處理
  const openCreate = () => { setEditing(null); setShowDialog(true); };
  const openEdit = (c: CustomerRecord) => { setEditing(c); setShowDialog(true); };

  const handleDelete = async (id: number) => {
    await deleteCustomer.mutateAsync({ id });
    toast({ title: "客戶已刪除" });
    refetch();
  };

  const filtered = customers?.filter(c => {
    if (!search) return true;
    const q = search.toLowerCase();
    return c.name.toLowerCase().includes(q) || (c.email || "").toLowerCase().includes(q) || (c.taxId || "").toLowerCase().includes(q);
  });

  return (
    <div className="space-y-6">
      <PageHeader title="會計客戶" description="管理會計往來客戶資料">
        <Button size="sm" onClick={openCreate}><Plus className="h-4 w-4 mr-1" />新增客戶</Button>
      </PageHeader>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <Input placeholder="搜尋客戶名稱、Email、統編..." value={search} onChange={e => setSearch(e.target.value)} className="pl-10" />
      </div>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50/50">
                  <th className="text-left px-4 py-3 font-medium">客戶名稱</th>
                  <th className="text-left px-4 py-3 font-medium hidden sm:table-cell">Email</th>
                  <th className="text-left px-4 py-3 font-medium hidden md:table-cell">電話</th>
                  <th className="text-left px-4 py-3 font-medium hidden md:table-cell">統一編號</th>
                  <th className="text-left px-4 py-3 font-medium hidden lg:table-cell">地址</th>
                  <th className="text-center px-4 py-3 font-medium w-24">操作</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr><td colSpan={6} className="text-center py-8 text-gray-400">載入中...</td></tr>
                ) : !filtered?.length ? (
                  <tr><td colSpan={6} className="text-center py-8 text-gray-400">尚無客戶</td></tr>
                ) : filtered.map(c => (
                  <tr key={c.id} className="border-b hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium">{c.name}</td>
                    <td className="px-4 py-3 hidden sm:table-cell">{c.email || "-"}</td>
                    <td className="px-4 py-3 hidden md:table-cell">{c.phone || "-"}</td>
                    <td className="px-4 py-3 hidden md:table-cell font-mono">{c.taxId || "-"}</td>
                    <td className="px-4 py-3 hidden lg:table-cell truncate max-w-[200px]">{c.address || "-"}</td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex gap-1 justify-center">
                        <Link href={`/accounting/customer-statement/${c.id}`}>
                          <Button variant="ghost" size="sm" title="對帳單"><FileText className="h-4 w-4 text-blue-600" /></Button>
                        </Link>
                        <Link href={`/sales/quotations?customerId=${c.id}`}>
                          <Button variant="ghost" size="sm" className="whitespace-nowrap">開報價單</Button>
                        </Link>
                        <Link href={`/sales/orders?customerId=${c.id}`}>
                          <Button variant="ghost" size="sm" className="whitespace-nowrap">開訂單</Button>
                        </Link>
                        <Button variant="ghost" size="sm" onClick={() => openEdit(c as unknown as CustomerRecord)}><Pencil className="h-4 w-4" /></Button>
                        <Button variant="ghost" size="sm" onClick={() => handleDelete(c.id)}><Trash2 className="h-4 w-4 text-red-500" /></Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <CustomerFormDialog
        open={showDialog}
        onOpenChange={setShowDialog}
        customer={editing}
        onSaved={() => refetch()}
      />
    </div>
  );
}
