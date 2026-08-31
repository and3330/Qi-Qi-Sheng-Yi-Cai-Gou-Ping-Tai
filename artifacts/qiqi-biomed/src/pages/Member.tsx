import { useState } from "react";
import { Link, useLocation } from "wouter";
import { User, Package, Heart, CreditCard, HelpCircle, LogOut, Edit3, ShieldCheck } from "lucide-react";
import { useGetMe, useUpdateMe, useListInstitutions, getGetMeQueryKey } from "@workspace/api-client-react";
import { useClerk } from "@clerk/react";
import { useQueryClient } from "@tanstack/react-query";
import { getTierName } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

function EditProfileDialog({ me }: { me: any }) {
  const { mutateAsync: updateMe } = useUpdateMe();
  const { data: institutions } = useListInstitutions();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(me.name || "");
  const [phone, setPhone] = useState(me.phone || "");
  const [address, setAddress] = useState(me.shippingAddress || "");
  const [instId, setInstId] = useState(me.boundInstitutionId ? String(me.boundInstitutionId) : "none");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    setIsSubmitting(true);
    try {
      await updateMe({
        data: {
          name,
          phone,
          shippingAddress: address,
          boundInstitutionId: instId !== "none" ? Number(instId) : null
        }
      });
      queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
      toast({ title: "個人資料已更新" });
      setOpen(false);
    } catch (e) {
      toast({ title: "更新失敗", variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" className="text-white hover:bg-white/20">
          <Edit3 size={18} />
        </Button>
      </DialogTrigger>
      <DialogContent className="w-[90vw] max-w-[400px] rounded-2xl">
        <DialogHeader>
          <DialogTitle>編輯個人資料</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>姓名</Label>
            <Input value={name} onChange={e => setName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>聯絡電話</Label>
            <Input value={phone} onChange={e => setPhone(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>預設收件地址</Label>
            <Input value={address} onChange={e => setAddress(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>綁定醫療院所</Label>
            <Select value={instId} onValueChange={setInstId}>
              <SelectTrigger>
                <SelectValue placeholder="選擇綁定院所" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">無 (一般會員)</SelectItem>
                {institutions?.map(inst => (
                  <SelectItem key={inst.id} value={String(inst.id)}>
                    {inst.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[10px] text-gray-500">綁定院所後，經審核可享有醫療院所專屬價格。</p>
          </div>
          <Button className="w-full mt-4" onClick={handleSubmit} disabled={isSubmitting}>
            儲存修改
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function MemberPage() {
  const { data: me, isLoading } = useGetMe();
  const { signOut } = useClerk();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();

  const handleLogout = async () => {
    try {
      await signOut();
      queryClient.clear();
      setLocation("/");
    } catch (e) {
      console.error("Logout failed", e);
    }
  };

  if (isLoading) {
    return (
      <div className="flex flex-col min-h-screen bg-gray-50 pb-20 pt-4 px-4 space-y-4">
        <Skeleton className="h-48 w-full rounded-3xl" />
        <Skeleton className="h-64 w-full rounded-2xl" />
      </div>
    );
  }

  if (!me) return null;

  return (
    <div className="flex flex-col min-h-screen bg-gray-50 pb-20 animate-in fade-in">
      {/* Header Card */}
      <div className="bg-primary px-6 pt-safe pb-16 rounded-b-[2.5rem] text-white shadow-md relative overflow-hidden">
        <div className="absolute top-0 right-0 opacity-10 pointer-events-none transform translate-x-1/4 -translate-y-1/4">
          <ShieldCheck size={160} />
        </div>
        
        <div className="flex justify-between items-center mb-6 pt-4 relative z-10">
          <h1 className="font-bold text-xl">會員中心</h1>
          <EditProfileDialog me={me} />
        </div>

        <div className="flex items-center gap-4 relative z-10">
          <div className="w-16 h-16 bg-white/20 backdrop-blur-md rounded-full flex items-center justify-center border-2 border-white/30 shrink-0">
            <User size={32} className="text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-xl font-bold line-clamp-1">{me.name}</h2>
            <p className="text-primary-foreground/80 text-sm mb-1">{me.phone || "尚未設定電話"}</p>
            <div>
              <div className="inline-flex items-center bg-white text-primary text-[10px] font-bold px-2 py-0.5 rounded-full shadow-sm mb-1">
                {getTierName(me.tier)}
              </div>
              <p className="text-[10px] text-primary-foreground/70">會員身份由平台審核調整</p>
            </div>
          </div>
        </div>

        {me.boundInstitutionName && (
          <div className="mt-6 bg-white/10 backdrop-blur-sm rounded-xl p-3 border border-white/20 relative z-10 flex justify-between items-center">
            <div>
              <p className="text-[10px] text-white/70 font-medium mb-0.5">已綁定院所</p>
              <p className="text-sm font-bold">{me.boundInstitutionName}</p>
            </div>
            {me.boundDepartment && (
              <div className="text-right">
                <p className="text-[10px] text-white/70 font-medium mb-0.5">科室</p>
                <p className="text-sm font-bold">{me.boundDepartment}</p>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="px-4 -mt-6 relative z-20 space-y-4">
        {/* Points Card */}
        <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 flex justify-between items-center">
          <div>
            <p className="text-xs text-gray-500 font-medium mb-1">可用點數</p>
            <p className="text-2xl font-bold text-gray-900">{me.points.toLocaleString()} <span className="text-xs text-gray-400 font-normal">點</span></p>
          </div>
          <Button variant="outline" size="sm" className="rounded-full text-xs">
            點數兌換
          </Button>
        </div>

        {/* Links */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden divide-y divide-gray-50">
          {me.role === "admin" && (
            <Link href="/admin" className="flex items-center p-4 hover:bg-slate-50 transition-colors" data-testid="link-admin-panel">
              <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center mr-3">
                <ShieldCheck size={16} />
              </div>
              <span className="font-bold text-gray-800 flex-1">後台管理系統</span>
              <span className="text-gray-300">›</span>
            </Link>
          )}
          <Link href="/orders" className="flex items-center p-4 hover:bg-slate-50 transition-colors">
            <div className="w-8 h-8 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center mr-3">
              <Package size={16} />
            </div>
            <span className="font-bold text-gray-800 flex-1">訂單查詢</span>
            <span className="text-gray-300">›</span>
          </Link>
          <Link href="/favorites" className="flex items-center p-4 hover:bg-slate-50 transition-colors">
            <div className="w-8 h-8 rounded-full bg-red-50 text-red-500 flex items-center justify-center mr-3">
              <Heart size={16} />
            </div>
            <span className="font-bold text-gray-800 flex-1">收藏清單</span>
            <span className="text-gray-300">›</span>
          </Link>
          <div className="flex items-center p-4 opacity-50">
            <div className="w-8 h-8 rounded-full bg-green-50 text-green-600 flex items-center justify-center mr-3">
              <CreditCard size={16} />
            </div>
            <span className="font-bold text-gray-800 flex-1">機構錢包</span>
            <span className="text-[10px] bg-gray-200 text-gray-600 px-2 py-0.5 rounded mr-2">即將推出</span>
            <span className="text-gray-300">›</span>
          </div>
          <Link href="/knowledge" className="flex items-center p-4 hover:bg-slate-50 transition-colors">
            <div className="w-8 h-8 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center mr-3">
              <HelpCircle size={16} />
            </div>
            <span className="font-bold text-gray-800 flex-1">常見問題</span>
            <span className="text-gray-300">›</span>
          </Link>
        </div>

        <Button 
          variant="outline" 
          className="w-full rounded-2xl h-12 text-destructive border-destructive/20 bg-destructive/5 hover:bg-destructive/10 hover:text-destructive"
          onClick={handleLogout}
        >
          <LogOut size={18} className="mr-2" /> 登出帳號
        </Button>
      </div>
    </div>
  );
}
