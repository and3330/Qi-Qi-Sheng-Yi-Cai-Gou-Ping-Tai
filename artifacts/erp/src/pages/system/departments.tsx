import React, { useState } from 'react';
import { 
  useListErpDepartments, getListErpDepartmentsQueryKey,
  useCreateErpDepartment,
  useUpdateErpDepartment,
  useDeleteErpDepartment,
  useListErpUsers,
  getListErpUsersQueryKey
} from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Edit, Trash2, Building2, Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';

const formSchema = z.object({
  name: z.string().min(1, '請輸入部門名稱'),
  description: z.string().optional().nullable(),
  parentId: z.coerce.number().optional().nullable(),
  managerId: z.coerce.number().optional().nullable(),
  costCenter: z.string().optional().nullable(),
  isActive: z.boolean().default(true),
});

type FormValues = z.infer<typeof formSchema>;

export default function DepartmentsPage() {
  const { data: departments, isLoading } = useListErpDepartments({ query: { queryKey: getListErpDepartmentsQueryKey() } });
  
  const [editingDept, setEditingDept] = useState<any>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  const deleteMutation = useDeleteErpDepartment({
    mutation: {
      onSuccess: () => {
        toast({ title: '已停用部門' });
        queryClient.invalidateQueries({ queryKey: getListErpDepartmentsQueryKey() });
      },
      onError: (e) => toast({ title: '操作失敗', description: e.message, variant: 'destructive' })
    }
  });

  const handleDelete = (id: number) => {
    if (confirm('確定要停用此部門嗎？')) {
      deleteMutation.mutate({ id });
    }
  };

  const openNew = () => {
    setEditingDept(null);
    setIsModalOpen(true);
  };

  const openEdit = (dept: any) => {
    setEditingDept(dept);
    setIsModalOpen(true);
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-bold flex items-center gap-2">
          <Building2 className="w-5 h-5 text-primary" />
          部門管理
        </h2>
        <Button onClick={openNew} className="shadow-sm">
          <Plus className="w-4 h-4 mr-2" />
          新增部門
        </Button>
      </div>

      <Card className="shadow-sm border-t-2 border-t-primary">
        <div className="rounded-md border-0">
          <Table>
            <TableHeader className="bg-secondary/50">
              <TableRow>
                <TableHead className="w-48 font-semibold">部門名稱</TableHead>
                <TableHead className="font-semibold">上層部門</TableHead>
                <TableHead className="font-semibold">主管</TableHead>
                <TableHead className="font-semibold">成本中心</TableHead>
                <TableHead className="text-center font-semibold">成員數</TableHead>
                <TableHead className="text-center font-semibold">狀態</TableHead>
                <TableHead className="text-right font-semibold">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-32 text-center">
                    <Loader2 className="w-6 h-6 animate-spin mx-auto text-primary" />
                  </TableCell>
                </TableRow>
              ) : departments?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-32 text-center text-muted-foreground">
                    無部門資料
                  </TableCell>
                </TableRow>
              ) : (
                departments?.map(dept => {
                  const parentName = departments.find(d => d.id === dept.parentId)?.name;
                  return (
                    <TableRow key={dept.id} className="hover:bg-muted/30">
                      <TableCell className="font-medium">{dept.name}</TableCell>
                      <TableCell className="text-muted-foreground text-sm">{parentName || '-'}</TableCell>
                      <TableCell className="text-sm">{dept.managerName || '-'}</TableCell>
                      <TableCell className="text-sm font-mono text-muted-foreground">{dept.costCenter || '-'}</TableCell>
                      <TableCell className="text-center">{dept.memberCount}</TableCell>
                      <TableCell className="text-center">
                        {dept.isActive ? (
                          <CheckCircle2 className="w-4 h-4 mx-auto text-emerald-500" />
                        ) : (
                          <XCircle className="w-4 h-4 mx-auto text-destructive" />
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="icon" onClick={() => openEdit(dept)}>
                          <Edit className="w-4 h-4" />
                        </Button>
                        <Button variant="ghost" size="icon" className="text-destructive hover:bg-destructive/10" onClick={() => handleDelete(dept.id)}>
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </Card>

      <DepartmentModal 
        isOpen={isModalOpen} 
        onClose={() => setIsModalOpen(false)} 
        initialData={editingDept}
        departments={departments || []}
      />
    </div>
  );
}

function DepartmentModal({ isOpen, onClose, initialData, departments }: { isOpen: boolean, onClose: () => void, initialData: any, departments: any[] }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  const { data: users } = useListErpUsers(
    { erpOnly: true },
    { query: { queryKey: getListErpUsersQueryKey({ erpOnly: true }), enabled: isOpen } }
  );

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: '',
      description: '',
      parentId: null,
      managerId: null,
      costCenter: '',
      isActive: true,
    }
  });

  React.useEffect(() => {
    if (isOpen) {
      if (initialData) {
        form.reset({
          name: initialData.name,
          description: initialData.description || '',
          parentId: initialData.parentId || null,
          managerId: initialData.managerId || null,
          costCenter: initialData.costCenter || '',
          isActive: initialData.isActive,
        });
      } else {
        form.reset({
          name: '',
          description: '',
          parentId: null,
          managerId: null,
          costCenter: '',
          isActive: true,
        });
      }
    }
  }, [isOpen, initialData, form]);

  const createMutation = useCreateErpDepartment({
    mutation: {
      onSuccess: () => {
        toast({ title: '已建立部門' });
        queryClient.invalidateQueries({ queryKey: getListErpDepartmentsQueryKey() });
        onClose();
      },
      onError: (e) => toast({ title: '建立失敗', description: e.message, variant: 'destructive' })
    }
  });

  const updateMutation = useUpdateErpDepartment({
    mutation: {
      onSuccess: () => {
        toast({ title: '已更新部門' });
        queryClient.invalidateQueries({ queryKey: getListErpDepartmentsQueryKey() });
        onClose();
      },
      onError: (e) => toast({ title: '更新失敗', description: e.message, variant: 'destructive' })
    }
  });

  const onSubmit = (values: FormValues) => {
    const payload = {
      name: values.name,
      description: values.description || undefined,
      parentId: values.parentId || undefined,
      managerId: values.managerId || undefined,
      costCenter: values.costCenter || undefined,
      isActive: values.isActive,
    };

    if (initialData) {
      updateMutation.mutate({ id: initialData.id, data: payload });
    } else {
      createMutation.mutate({ data: payload });
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>{initialData ? '編輯部門' : '新增部門'}</DialogTitle>
        </DialogHeader>
        
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 py-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>部門名稱 <span className="text-destructive">*</span></FormLabel>
                  <FormControl>
                    <Input placeholder="例如：總經理室" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="parentId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>上層部門</FormLabel>
                    <Select 
                      onValueChange={(val) => field.onChange(val === 'none' ? null : Number(val))}
                      value={field.value ? String(field.value) : 'none'}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="無上層部門" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="none">無 (最上層)</SelectItem>
                        {departments.filter(d => d.id !== initialData?.id).map(d => (
                          <SelectItem key={d.id} value={String(d.id)}>{d.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="managerId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>部門主管</FormLabel>
                    <Select 
                      onValueChange={(val) => field.onChange(val === 'none' ? null : Number(val))}
                      value={field.value ? String(field.value) : 'none'}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="選擇主管" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="none">尚未指派</SelectItem>
                        {users?.map(u => (
                          <SelectItem key={u.id} value={String(u.id)}>{u.name || u.username}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="costCenter"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>成本中心代碼</FormLabel>
                  <FormControl>
                    <Input placeholder="例如：CC-1001" {...field} value={field.value || ''} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>描述說明</FormLabel>
                  <FormControl>
                    <Textarea 
                      placeholder="部門職責簡述..." 
                      className="resize-none"
                      {...field}
                      value={field.value || ''}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="isActive"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-sm mt-4">
                  <div className="space-y-0.5">
                    <FormLabel>啟用狀態</FormLabel>
                    <div className="text-xs text-muted-foreground">停用後將不在列表中預設顯示</div>
                  </div>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                </FormItem>
              )}
            />

            <DialogFooter className="pt-4">
              <Button type="button" variant="outline" onClick={onClose}>取消</Button>
              <Button type="submit" disabled={isPending}>
                {isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                {initialData ? '儲存變更' : '建立部門'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
