import { describe, expect, it } from "vitest";
import { EmailResultUnknownError, readEmailResponse } from "../email-response";

describe("email request responses", () => {
  it("accepts only a complete preview and confirmed provider acceptance", async () => {
    expect(await readEmailResponse(Response.json({to:"",subject:"Invoice",html:"<p>Preview</p>"}),"preview"))
      .toMatchObject({to:"",subject:"Invoice"});
    expect(await readEmailResponse(Response.json({ok:true}),"send")).toEqual({ok:true});
    await expect(readEmailResponse(Response.json({}),"preview")).rejects.toThrow("預覽回應不完整");
    await expect(readEmailResponse(Response.json({}),"send")).rejects.toBeInstanceOf(EmailResultUnknownError);
  });
  it("explains session and permission errors without leaking HTML parsing errors", async () => {
    await expect(readEmailResponse(new Response("<html>Unauthorized</html>",{status:401}),"preview")).rejects.toThrow("重新登入");
    await expect(readEmailResponse(new Response("",{status:403}),"send")).rejects.toThrow("沒有寄信權限");
    await expect(readEmailResponse(new Response("<html>Internal Error</html>",{status:500}),"preview")).rejects.toThrow("尚未送出");
  });
  it("treats server errors, malformed success and gateway responses as uncertain sends", async () => {
    for (const status of [200,500,502,504]) {
      await expect(readEmailResponse(new Response("<html>Gateway Error</html>",{status}),"send"))
        .rejects.toBeInstanceOf(EmailResultUnknownError);
    }
    await expect(readEmailResponse(Response.json({error:"Provider or audit failure"},{status:502}),"send"))
      .rejects.toBeInstanceOf(EmailResultUnknownError);
    await expect(readEmailResponse(Response.json({error:"收件人 Email 格式不正確"},{status:400}),"send"))
      .rejects.toThrow("收件人 Email 格式不正確");
  });
});
