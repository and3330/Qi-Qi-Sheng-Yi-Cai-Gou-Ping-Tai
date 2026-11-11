import type { Member, Product, Institution, Article } from "@workspace/db";

export function serializeMember(
  m: Member,
  boundInstitutionName: string | null,
) {
  return {
    id: m.id,
    username: m.username,
    name: m.name,
    email: m.email,
    phone: m.phone,
    tier: m.tier,
    role: m.role,
    boundInstitutionId: m.boundInstitutionId,
    boundInstitutionName,
    boundDepartment: m.boundDepartment,
    points: m.points,
    shippingAddress: m.shippingAddress,
    erpRole: m.erpRole,
    requestedTier: m.requestedTier ?? null,
  };
}

export function serializeProduct(p: Product) {
  return {
    id: p.id,
    code: p.code,
    name: p.name,
    category: p.category,
    description: p.description,
    imageUrl: p.imageUrl,
    priceHospital: p.priceHospital,
    priceClinic: p.priceClinic,
    priceConsumer: p.priceConsumer,
    stock: p.stock,
    isHot: p.isHot,
    isNew: p.isNew,
    spec: p.spec,
  };
}

export function serializeInstitution(i: Institution) {
  return {
    id: i.id,
    name: i.name,
    type: i.type,
    city: i.city,
    address: i.address,
    phone: i.phone,
    hours: i.hours,
    departments: i.departments ?? [],
    grade: i.grade ?? null,
  };
}

export function serializeArticle(a: Article) {
  return {
    id: a.id,
    kind: a.kind,
    title: a.title,
    category: a.category,
    summary: a.summary,
    content: a.content,
    imageUrl: a.imageUrl,
    publishedAt: a.publishedAt.toISOString(),
  };
}

type TierPrices = { priceHospital: number; priceClinic: number; priceConsumer: number };

/** 這個身份實際適用的價格 */
export function priceForTier(tier: string | null | undefined, p: TierPrices): number {
  if (tier === "hospital") return p.priceHospital;
  if (tier === "clinic") return p.priceClinic;
  return p.priceConsumer;
}

/**
 * 商城對外只給「看的人自己那一級」的價格：三個價格欄位都填成同一個數字，
 * 其他身份的價格不會離開伺服器。未登入視同消費者。
 * 後台與 ERP 的商品管理不走這裡，仍看得到完整三種價格。
 */
export function maskTierPrices<T extends TierPrices>(obj: T, tier: string | null | undefined): T {
  const price = priceForTier(tier, obj);
  return { ...obj, priceHospital: price, priceClinic: price, priceConsumer: price };
}
