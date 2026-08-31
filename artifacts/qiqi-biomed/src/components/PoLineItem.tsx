import { useEffect, useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Trash2 } from "lucide-react";
import { useListAdminProductVariants, getListAdminProductVariantsQueryKey, AdminProduct } from "@workspace/api-client-react";

type PoLine = { productId: string; variantId: string; unitCost: string; quantity: string };

export function PoLineItem({
  line,
  idx,
  products,
  canRemove,
  onChange,
  onRemove,
}: {
  line: PoLine;
  idx: number;
  products: AdminProduct[];
  canRemove: boolean;
  onChange: (idx: number, line: PoLine) => void;
  onRemove: (idx: number) => void;
}) {
  const { data: variants } = useListAdminProductVariants(
    line.productId ? Number(line.productId) : 0,
    { query: { enabled: !!line.productId, queryKey: getListAdminProductVariantsQueryKey(line.productId ? Number(line.productId) : 0) } }
  );

  return (
    <div className="flex items-center gap-2">
      <Select
        value={line.productId}
        onValueChange={(v) => {
          const product = products.find((p) => String(p.id) === v);
          onChange(idx, {
            ...line,
            productId: v,
            variantId: "", // reset variant on product change
            unitCost: line.unitCost || (product ? String(product.costPrice) : ""),
          });
        }}
      >
        <SelectTrigger className="flex-1" data-testid={`select-po-product-${idx}`}>
          <SelectValue placeholder="選擇商品" />
        </SelectTrigger>
        <SelectContent>
          {products.map((p) => (
            <SelectItem key={p.id} value={String(p.id)}>
              {p.code} {p.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {variants && variants.length > 0 && (
        <Select
          value={line.variantId}
          onValueChange={(v) => onChange(idx, { ...line, variantId: v })}
        >
          <SelectTrigger className="w-32" data-testid={`select-po-variant-${idx}`}>
            <SelectValue placeholder="選擇規格" />
          </SelectTrigger>
          <SelectContent>
            {variants.map((v) => (
              <SelectItem key={v.id} value={String(v.id)}>
                {v.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      <Input
        type="number"
        min={0}
        placeholder="進價"
        className="w-24"
        value={line.unitCost}
        onChange={(e) => onChange(idx, { ...line, unitCost: e.target.value })}
        data-testid={`input-po-cost-${idx}`}
      />
      <Input
        type="number"
        min={1}
        placeholder="數量"
        className="w-20"
        value={line.quantity}
        onChange={(e) => onChange(idx, { ...line, quantity: e.target.value })}
        data-testid={`input-po-qty-${idx}`}
      />
      <Button
        size="icon"
        variant="ghost"
        disabled={!canRemove}
        onClick={() => onRemove(idx)}
        data-testid={`button-remove-po-line-${idx}`}
      >
        <Trash2 size={15} className="text-muted-foreground" />
      </Button>
    </div>
  );
}
