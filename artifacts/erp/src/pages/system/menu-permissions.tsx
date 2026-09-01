import React, { useState } from 'react';
import { useGetErpMenuPermissions, getGetErpMenuPermissionsQueryKey, usePutErpMenuPermissions } from '@workspace/api-client-react';
import { NAV_CONFIG } from '@/lib/nav';
import { ERP_ROLES, ErpRole } from '@/lib/roles';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, ShieldCheck, Save, RotateCcw } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";

export default function MenuPermissionsPage() {
  const { data: permissions, isLoading } = useGetErpMenuPermissions({
    query: { queryKey: getGetErpMenuPermissionsQueryKey() }
  });

  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [overrides, setOverrides] = useState<Record<string, string[]>>({});
  const [isEditing, setIsEditing] = useState(false);

  // Sync server data to local state when entering edit mode
  const handleEdit = () => {
    setOverrides(permissions?.overrides || {});
    setIsEditing(true);
  };

  const handleCancel = () => {
    setOverrides({});
    setIsEditing(false);
  };

  const putMutation = usePutErpMenuPermissions({
    mutation: {
      onSuccess: () => {
        toast({ title: '選單權限已更新' });
        queryClient.invalidateQueries({ queryKey: getGetErpMenuPermissionsQueryKey() });
        setIsEditing(false);
      },
      onError: (e) => {
        toast({ title: '更新失敗', description: e.message, variant: 'destructive' });
      }
    }
  });

  const handleSave = () => {
    putMutation.mutate({ data: { overrides } });
  };

  const toggleRole = (path: string, role: string, checked: boolean) => {
    setOverrides(prev => {
      const currentRoles = prev[path] || NAV_CONFIG.find(i => i.path === path)?.defaultRoles || [];
      // 空陣列＝開放所有角色：要個別調整時，先展開為完整角色清單再增減
      const allRoles = (Object.keys(ERP_ROLES) as ErpRole[]).filter(r => r !== 'super_admin');
      const expanded = currentRoles.length === 0 ? allRoles : currentRoles;
      const newRoles = checked
        ? [...expanded.filter(r => r !== role), role]
        : expanded.filter(r => r !== role);

      return {
        ...prev,
        [path]: newRoles
      };
    });
  };

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  const roleKeys = Object.keys(ERP_ROLES) as ErpRole[];
  // Exclude super_admin from the matrix as it always has access
  const displayRoles = roleKeys.filter(r => r !== 'super_admin');

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div className="space-y-1">
          <h2 className="text-xl font-bold flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-primary" />
            選單權限設定
          </h2>
          <p className="text-sm text-muted-foreground">
            系統最高管理員預設擁有所有選單權限。
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isEditing ? (
            <>
              <Button variant="outline" onClick={handleCancel} disabled={putMutation.isPending}>
                <RotateCcw className="w-4 h-4 mr-2" />取消
              </Button>
              <Button onClick={handleSave} disabled={putMutation.isPending} className="shadow-sm">
                {putMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                儲存設定
              </Button>
            </>
          ) : (
            <Button onClick={handleEdit} className="shadow-sm">編輯權限</Button>
          )}
        </div>
      </div>

      <Card className="shadow-sm border-t-2 border-t-primary">
        <div className="overflow-x-auto rounded-md border-0">
          <Table>
            <TableHeader className="bg-secondary/50">
              <TableRow>
                <TableHead className="min-w-[200px] font-semibold sticky left-0 bg-secondary/90 backdrop-blur z-10 border-r">選單項目</TableHead>
                {displayRoles.map(role => (
                  <TableHead key={role} className="text-center font-semibold min-w-[100px]">
                    <div className="flex flex-col items-center gap-1">
                      <span className="text-xs text-muted-foreground">{role}</span>
                      <span>{ERP_ROLES[role]}</span>
                    </div>
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {NAV_CONFIG.map(item => {
                const effectiveRoles = isEditing
                  ? (overrides[item.path] || item.defaultRoles)
                  : (permissions?.overrides[item.path] || item.defaultRoles);
                
                // if empty, all roles have access
                const isAll = effectiveRoles.length === 0;

                return (
                  <TableRow key={item.path} className="hover:bg-muted/30">
                    <TableCell className="font-medium sticky left-0 bg-card/90 backdrop-blur z-10 border-r shadow-[1px_0_0_0_rgba(0,0,0,0.05)]">
                      <div className="flex flex-col">
                        <span className="text-foreground">{item.label}</span>
                        <span className="text-xs text-muted-foreground font-mono">{item.path}</span>
                      </div>
                    </TableCell>
                    
                    {displayRoles.map(role => {
                      const hasAccess = isAll || effectiveRoles.includes(role);
                      return (
                        <TableCell key={role} className="text-center">
                          {isEditing ? (
                            <Checkbox
                              checked={hasAccess}
                              onCheckedChange={(checked) => toggleRole(item.path, role, !!checked)}
                              className={isAll ? "opacity-50" : ""}
                              title={isAll ? "設定為開放所有角色，需取消勾選其他角色才能個別設定" : ""}
                            />
                          ) : (
                            hasAccess ? (
                              <div className="w-4 h-4 mx-auto rounded-full bg-primary/20 flex items-center justify-center">
                                <div className="w-2 h-2 rounded-full bg-primary" />
                              </div>
                            ) : (
                              <div className="w-4 h-4 mx-auto rounded-full bg-muted flex items-center justify-center">
                                <div className="w-1.5 h-1.5 rounded-full bg-background" />
                              </div>
                            )
                          )}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}
