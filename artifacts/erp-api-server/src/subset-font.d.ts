declare module "subset-font" {
  /** 從字型檔抽出指定文字用到的字，回傳新的字型檔 */
  export default function subsetFont(
    font: Buffer | Uint8Array,
    text: string,
    options?: { targetFormat?: "sfnt" | "truetype" | "woff" | "woff2"; preserveNameIds?: number[] },
  ): Promise<Buffer>;
}
