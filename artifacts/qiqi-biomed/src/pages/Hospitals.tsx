import { useState } from "react";
import { Search, MapPin, Phone, Clock } from "lucide-react";
import { useListInstitutions } from "@workspace/api-client-react";
import { classNames } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const TYPES = [
  { id: "all", label: "全部" },
  { id: "hospital", label: "醫院" },
  { id: "clinic", label: "診所" },
  { id: "pharmacy", label: "藥局" },
] as const;

const CITIES = ["台北市", "新北市", "桃園市", "台中市", "台南市", "高雄市"];

export default function HospitalsPage() {
  const [type, setType] = useState<"all" | "hospital" | "clinic" | "pharmacy">("all");
  const [city, setCity] = useState<string>("all");
  
  const { data: institutions, isLoading } = useListInstitutions({
    type: type === "all" ? undefined : type,
    city: city === "all" ? undefined : city,
  });

  return (
    <div className="flex flex-col min-h-screen bg-gray-50 pb-20 animate-in fade-in">
      <div className="sticky top-[var(--sf-header-h,0px)] z-30 bg-primary px-4 pt-safe pb-4 shadow-md">
        <h1 className="text-white font-bold text-center text-lg mb-4">合作醫院</h1>
        <div className="flex gap-2">
          <Select value={city} onValueChange={setCity}>
            <SelectTrigger className="w-[100px] h-10 bg-white/10 border-white/20 text-white placeholder:text-white/60 focus:ring-white/30">
              <SelectValue placeholder="選擇縣市" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全台灣</SelectItem>
              {CITIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
          
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
            <Input 
              type="search" 
              placeholder="搜尋院所名稱" 
              className="w-full bg-white border-0 pl-9 h-10 rounded-xl"
            />
          </div>
        </div>
      </div>

      <div className="px-4 py-3 bg-white border-b shadow-sm sticky top-[calc(var(--sf-header-h,0px)+100px)] z-30 flex">
        {TYPES.map(t => (
          <button
            key={t.id}
            onClick={() => setType(t.id)}
            className={classNames(
              "flex-1 py-1.5 text-sm font-bold border-b-2 transition-colors flex items-center justify-center",
              type === t.id ? "border-primary text-primary" : "border-transparent text-gray-500 hover:text-gray-900"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="p-4 space-y-4">
        {isLoading ? (
          Array(4).fill(0).map((_, i) => (
            <Skeleton key={i} className="h-32 w-full rounded-2xl" />
          ))
        ) : institutions?.length === 0 ? (
          <div className="text-center py-20 text-muted-foreground">
            <p>沒有找到符合條件的院所</p>
          </div>
        ) : (
          institutions?.map(inst => (
            <div key={inst.id} className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 hover-elevate">
              <div className="flex justify-between items-start mb-2">
                <h3 className="font-bold text-base text-gray-900 leading-tight">{inst.name}</h3>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-sm bg-primary/10 text-primary border border-primary/20 shrink-0">
                  {inst.type === 'hospital' ? '醫院' : inst.type === 'clinic' ? '診所' : '藥局'}
                </span>
              </div>
              
              <div className="space-y-2 mt-3 text-sm text-gray-600">
                <div className="flex items-start gap-2">
                  <MapPin size={16} className="text-gray-400 shrink-0 mt-0.5" />
                  <span className="leading-tight">{inst.city}{inst.address}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Phone size={16} className="text-gray-400 shrink-0" />
                  <span>{inst.phone || "暫無資料"}</span>
                </div>
                {inst.hours && (
                  <div className="flex items-start gap-2">
                    <Clock size={16} className="text-gray-400 shrink-0 mt-0.5" />
                    <span className="leading-tight text-xs">{inst.hours}</span>
                  </div>
                )}
              </div>
              
              {inst.departments && inst.departments.length > 0 && (
                <div className="mt-3 pt-3 border-t border-gray-50 flex flex-wrap gap-1.5">
                  {inst.departments.map((dept, i) => (
                    <span key={i} className="text-[10px] bg-gray-100 text-gray-600 px-2 py-0.5 rounded">
                      {dept}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
