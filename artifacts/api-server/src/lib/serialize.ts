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
