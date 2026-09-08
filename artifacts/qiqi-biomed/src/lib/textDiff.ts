export type DiffPart = {
  value: string;
  kind: "same" | "removed" | "added";
};

const CJK_PATTERN = /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/u;
const MAX_MATRIX_CELLS = 1_000_000;
const MAX_MIDDLE_TOKENS = 20_000;

function tokenize(value: string): string[] {
  if (CJK_PATTERN.test(value)) return Array.from(value);
  if (typeof Intl.Segmenter === "function") {
    const segmenter = new Intl.Segmenter("zh-TW", { granularity: "word" });
    return Array.from(segmenter.segment(value), ({ segment }) => segment);
  }
  return Array.from(value);
}

export function diffText(before: string, after: string): DiffPart[] {
  if (before === after) return [{ value: before, kind: "same" }];

  const beforeTokens = tokenize(before);
  const afterTokens = tokenize(after);
  let prefixLength = 0;
  while (
    prefixLength < beforeTokens.length &&
    prefixLength < afterTokens.length &&
    beforeTokens[prefixLength] === afterTokens[prefixLength]
  ) {
    prefixLength++;
  }

  let suffixLength = 0;
  while (
    suffixLength < beforeTokens.length - prefixLength &&
    suffixLength < afterTokens.length - prefixLength &&
    beforeTokens[beforeTokens.length - 1 - suffixLength] ===
      afterTokens[afterTokens.length - 1 - suffixLength]
  ) {
    suffixLength++;
  }

  const left = beforeTokens.slice(prefixLength, beforeTokens.length - suffixLength);
  const right = afterTokens.slice(prefixLength, afterTokens.length - suffixLength);
  const parts: DiffPart[] = [];
  const push = (value: string, kind: DiffPart["kind"]) => {
    if (!value) return;
    const last = parts.at(-1);
    if (last?.kind === kind) last.value += value;
    else parts.push({ value, kind });
  };

  push(beforeTokens.slice(0, prefixLength).join(""), "same");
  if (!left.length) {
    push(right.join(""), "added");
  } else if (!right.length) {
    push(left.join(""), "removed");
  } else if (
    left.length * right.length > MAX_MATRIX_CELLS ||
    left.length + right.length > MAX_MIDDLE_TOKENS
  ) {
    push(left.join(""), "removed");
    push(right.join(""), "added");
  } else {
    const table = Array.from(
      { length: left.length + 1 },
      () => new Uint16Array(right.length + 1),
    );
    for (let i = left.length - 1; i >= 0; i--) {
      for (let j = right.length - 1; j >= 0; j--) {
        table[i][j] = left[i] === right[j]
          ? table[i + 1][j + 1] + 1
          : Math.max(table[i + 1][j], table[i][j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < left.length && j < right.length) {
      if (left[i] === right[j]) {
        push(left[i++], "same");
        j++;
      } else if (table[i + 1][j] >= table[i][j + 1]) {
        push(left[i++], "removed");
      } else {
        push(right[j++], "added");
      }
    }
    while (i < left.length) push(left[i++], "removed");
    while (j < right.length) push(right[j++], "added");
  }
  push(beforeTokens.slice(beforeTokens.length - suffixLength).join(""), "same");
  return parts;
}