import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListAdminInstitutions,
  useUpdateAdminInstitution,
  getListAdminInstitutionsQueryKey,
  type Institution,
  type AdminInstitutionUpdateGrade
} from "@workspace/api-client-react";
import { Search, Building2, Pencil } from "lucide-react";
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
import { useToast } from "@/hooks/use-toast";
import { AdminLayout } from "./AdminLayout";

export default function Institutions() {
  const [search, setSearch] = useState("");
  const { data: allInstitutions, isLoading } = useListAdminInstitutions();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const institutions = allInstitutions?.filter((inst) => 
    !search || inst.name.includes(search)
  ) || [];

  const [editInst, setEditInst] = useState<Institution | null>(null);
  const [grade, setGrade] = useState<AdminInstitutionUpdateGrade>(null);

  const updateInst = useUpdateAdminInstitution();

  const handleEdit = (inst: Institution) => {
    setEditInst(inst);
    setGrade((inst.grade as AdminInstitutionUpdateGrade) || null);
  };

  const handleSave = async () => {
    if (!editInst) return;
    try {
      await updateInst.mutateAsync({
        id: editInst.id,
        data: { grade }
      });
      toast({ title: "儲存成功" });
      queryClient.invalidateQueries({ queryKey: getListAdminInstitutionsQueryKey() });
      setEditInst(null);
    } catch (e: any) {
      toast({ title: "儲存失敗", description: e.message, variant: "destructive" });
    }
  };

  return (
    <AdminLayout title="機構主檔">
      <div className="flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center mb-6">
        <div className="relative w-full sm:w-80">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="搜尋機構代碼、名稱或統編..."
            className="pl-9 bg-white"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="bg-white rounded-lg border shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-muted/50 border-b text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">代碼 / 名稱</th>
                <th className="px-4 py-3 font-medium">類型</th>
                <th className="px-4 py-3 font-medium">分級</th>
                <th className="px-4 py-3 font-medium">統編</th>
                <th className="px-4 py-3 font-medium">地區</th>
                <th className="px-4 py-3 font-medium text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}>
                    <td className="px-4 py-4"><Skeleton className="h-5 w-32" /></td>
                    <td className="px-4 py-4"><Skeleton className="h-5 w-16" /></td>
                    <td className="px-4 py-4"><Skeleton className="h-5 w-12" /></td>
                    <td className="px-4 py-4"><Skeleton className="h-5 w-24" /></td>
                    <td className="px-4 py-4"><Skeleton className="h-5 w-24" /></td>
                    <td className="px-4 py-4"><Skeleton className="h-8 w-8 ml-auto" /></td>
                  </tr>
                ))
              ) : institutions?.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-muted-foreground flex flex-col items-center">
                    <Building2 className="h-10 w-10 text-muted-foreground/30 mb-2" />
                    無符合的機構資料
                  </td>
                </tr>
              ) : (
                institutions?.map((inst) => (
                  <tr key={inst.id} className="hover:bg-muted/30">
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">{inst.name}</div>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant="outline">{inst.type}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      {inst.grade ? (
                        <Badge variant={inst.grade === 'A' ? 'default' : 'secondary'} className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100">
                          {inst.grade} 級
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">-</td>
                    <td className="px-4 py-3">{inst.city}</td>
                    <td className="px-4 py-3 text-right">
                      <Button variant="ghost" size="icon" onClick={() => handleEdit(inst)}>
                        <Pencil className="h-4 w-4 text-muted-foreground" />
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Dialog open={!!editInst} onOpenChange={(open) => !open && setEditInst(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>設定機構分級 - {editInst?.name}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label>授權分級</Label>
              <Select 
                value={grade || "none"} 
                onValueChange={(val) => setGrade(val === "none" ? null : val as AdminInstitutionUpdateGrade)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="請選擇分級" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">無 (不分級)</SelectItem>
                  <SelectItem value="A">A 級 (醫學中心/區域醫院)</SelectItem>
                  <SelectItem value="B">B 級 (地區醫院/大型診所)</SelectItem>
                  <SelectItem value="C">C 級 (一般診所/藥局)</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                商品可限制僅授權特定分級的機構採購。設定為「無」代表無法購買限購商品。
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditInst(null)}>取消</Button>
            <Button onClick={handleSave} disabled={updateInst.isPending}>
              儲存設定
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
