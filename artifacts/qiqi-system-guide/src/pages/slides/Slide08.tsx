const base = import.meta.env.BASE_URL;

export default function Slide8() {
  return (
    <div className="w-screen h-screen overflow-hidden relative bg-bg font-body text-text">
      <div className="h-[10vh] bg-primary px-[5vw] flex items-center justify-between text-white">
        <div>
          <p className="text-[1.5vw] font-bold tracking-[0.16em]">商城｜商城後台</p>
          <h1 className="text-[3.1vw] font-display font-extrabold tracking-tight">會員管理</h1>
        </div>
        <p className="text-[1.5vw]">08 / 82</p>
      </div>
      <div className="grid grid-cols-[1fr_1.78fr] gap-[3vw] px-[5vw] py-[5vh] h-[90vh]">
        <div className="flex flex-col justify-between">
          <div className="space-y-[3vh]">
            <section>
              <h2 className="text-[1.7vw] font-bold text-primary">各身分註冊</h2>
              <p className="mt-[1vh] text-[1.65vw] leading-relaxed">C 消費者走一般註冊；A 醫院與 B 診所／藥局使用各自專屬註冊連結。</p>
            </section>
            <section>
              <h2 className="text-[1.7vw] font-bold text-primary">後台建帳</h2>
              <p className="mt-[1vh] text-[1.65vw] leading-relaxed">管理員可新增會員，並指定會員等級及管理員、營運、客服或一般會員角色。</p>
            </section>
            <section>
              <h2 className="text-[1.7vw] font-bold text-primary">帳號與密碼</h2>
              <p className="mt-[1vh] text-[1.65vw] leading-relaxed">後台可修改登入帳號並設定新密碼；基於安全原則，系統不顯示原密碼。</p>
            </section>
          </div>
          <div className="border-t border-slate-300 pt-[2vh]">
            <p className="text-[1.5vw] font-bold">權限與注意事項</p>
            <p className="mt-[1vh] text-[1.5vw] leading-relaxed text-muted">只有系統管理員可建帳、改登入帳號、重設密碼及指派後台角色。</p>
          </div>
        </div>
        <div className="relative rounded-[1.2vw] overflow-hidden border border-slate-200 shadow-lg bg-white">
          <img src={`${base}screens/shop-members.jpg`} crossOrigin="anonymous" className="w-full h-full object-cover object-top" />
          <div className="absolute bottom-0 inset-x-0 bg-slate-950/80 text-white px-[2vw] py-[1.3vh] text-[1.5vw]">登入保護畫面｜最終版待置換</div>
        </div>
      </div>
    </div>
  );
}