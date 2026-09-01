import React, { useState } from 'react';
import { useListErpUsers, getListErpUsersQueryKey, useUpdateErpUser, useListErpDepartments, getListErpDepartmentsQueryKey, type ErpUserUpdateErpRole } from '@workspace/api-client-react';
import { ERP_ROLES, ErpRole } from '@/lib/roles';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Search, Loader2 } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { Checkbox } from '@/components/ui/checkbox';

export default function UsersPage() {
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [erpOnly, setErpOnly] = useState<boolean>(false);
  
  const { data: users, isLoading } = useListErpUsers(
    { q: search, erpOnly },
    { query: { queryKey: getListErpUsersQueryKey({ q: search, erpOnly }) } }
  );

  const { data: departments } = useListErpDepartments({ query: { queryKey: getListErpDepartmentsQueryKey() } });
  
  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setSearch(q);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <form onSubmit={handleSearch} className="flex flex-1 max-w-md items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input 
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="搜尋名稱、Email..."
              className="pl-9 bg-card shadow-sm"
            />
          </div>
          <Button type="submit" variant="secondary">搜尋</Button>
        </form>
        
        <div className="flex items-center gap-2 text-sm">
          <Checkbox 
            id="erpOnly" 
            checked={erpOnly} 
            onCheckedChange={(checked) => setErpOnly(!!checked)} 
          />
          <label htmlFor="erpOnly" className="cursor-pointer font-medium">僅顯示具 ERP 權限者</label>
        </div>
      </div>

      <Card className="shadow-sm border-t-2 border-t-primary">
        <div className="rounded-md border-0">
          <Table>
            <TableHeader className="bg-secondary/50">
              <TableRow>
                <TableHead className="font-semibold text-foreground/80">使用者</TableHead>
                <TableHead className="font-semibold text-foreground/80">商城角色</TableHead>
                <TableHead className="font-semibold text-foreground/80 w-48">部門</TableHead>
                <TableHead className="font-semibold text-foreground/80 w-48">ERP 權限角色</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={4} className="h-32 text-center">
                    <Loader2 className="w-6 h-6 animate-spin mx-auto text-primary" />
                  </TableCell>
                </TableRow>
              ) : users?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="h-32 text-center text-muted-foreground">
                    查無使用者
                  </TableCell>
                </TableRow>
              ) : (
                users?.map((user) => (
                  <UserRow 
                    key={user.id} 
                    user={user} 
                    departments={departments ?? []} 
                  />
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}

function UserRow({ user, departments }: { user: any; departments: any[] }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  const updateUser = useUpdateErpUser({
    mutation: {
      onSuccess: () => {
        toast({ title: '更新成功', description: '使用者權限已儲存' });
        queryClient.invalidateQueries({ queryKey: getListErpUsersQueryKey() });
      },
      onError: (err: any) => {
        toast({ title: '更新失敗', description: err.message, variant: 'destructive' });
      }
    }
  });

  const handleRoleChange = (role: string) => {
    updateUser.mutate({
      id: user.id,
      data: { erpRole: role === 'none' ? null : (role as ErpUserUpdateErpRole) }
    });
  };

  const handleDeptChange = (deptId: string) => {
    updateUser.mutate({
      id: user.id,
      data: { departmentId: deptId === 'none' ? null : parseInt(deptId, 10) }
    });
  };

  return (
    <TableRow className="hover:bg-muted/30">
      <TableCell>
        <div className="font-medium text-foreground">{user.name}</div>
        <div className="text-xs text-muted-foreground">{user.email || user.username}</div>
      </TableCell>
      <TableCell>
        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-secondary text-secondary-foreground">
          {user.role}
        </span>
      </TableCell>
      <TableCell>
        <Select 
          value={user.departmentId ? String(user.departmentId) : 'none'} 
          onValueChange={handleDeptChange}
          disabled={updateUser.isPending}
        >
          <SelectTrigger className="h-8 text-sm">
            <SelectValue placeholder="選擇部門" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">-- 無部門 --</SelectItem>
            {departments.map(d => (
              <SelectItem key={d.id} value={String(d.id)}>{d.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </TableCell>
      <TableCell>
        <Select 
          value={user.erpRole || 'none'} 
          onValueChange={handleRoleChange}
          disabled={updateUser.isPending}
        >
          <SelectTrigger className={`h-8 text-sm ${!user.erpRole ? 'text-muted-foreground' : 'font-medium'}`}>
            <SelectValue placeholder="選擇角色" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">-- 無 ERP 權限 --</SelectItem>
            {Object.entries(ERP_ROLES).map(([key, label]) => (
              <SelectItem key={key} value={key}>{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </TableCell>
    </TableRow>
  );
}
