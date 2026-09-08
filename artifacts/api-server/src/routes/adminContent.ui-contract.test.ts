import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const contentPagePath = fileURLToPath(
  new URL("../../../qiqi-biomed/src/pages/admin/Content.tsx", import.meta.url),
);

test("content edit forms hydrate existing article, FAQ, and announcement fields", async () => {
  const source = await readFile(contentPagePath, "utf8");
  for (const initialization of [
    'article?.kind ?? "article"',
    'item?.title ?? ""',
    'item?.category ?? ""',
    'article?.summary ?? ""',
    'item?.content ?? ""',
    'item?.imageUrl ?? ""',
    'item?.status ?? "draft"',
  ]) {
    assert(source.includes(initialization), `missing existing-data initialization: ${initialization}`);
  }
  assert.match(source, /key=\{`\$\{editTarget\.kind\}-\$\{editTarget\.item\.id\}`\}/);
});

test("archive requires explicit confirmation and cancel performs no mutation", async () => {
  const source = await readFile(contentPagePath, "utf8");
  assert(source.includes("確定要下架這筆內容？"));
  assert(source.includes("<AlertDialogCancel disabled={isPending}>取消</AlertDialogCancel>"));
  assert.match(source, /AlertDialogAction[\s\S]*handleArchive\(\)/);
  assert.doesNotMatch(source, /AlertDialogCancel[\s\S]{0,200}mutateAsync/);
});

test("successful edits and archives refresh lists and revision history", async () => {
  const source = await readFile(contentPagePath, "utf8");
  assert.match(source, /updateArticle\.mutateAsync[\s\S]*getListAdminArticlesQueryKey/);
  assert.match(source, /updateAnnouncement\.mutateAsync[\s\S]*getListAdminAnnouncementsQueryKey/);
  const revisionInvalidations = source.match(/getListAdminContentRevisionsQueryKey/g) ?? [];
  assert(revisionInvalidations.length >= 3, "revision history must refresh after edit and archive");
});