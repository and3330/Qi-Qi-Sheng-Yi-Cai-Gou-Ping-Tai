import { Phone, Printer, Clock, Mail, MapPin, MessageCircle } from "lucide-react";

export default function CompanyFooter() {
  return (
    <footer className="mt-6 bg-[#f3f7f5] border-t border-[#e3ece7] px-5 pt-6 pb-8 text-gray-600">
      <div className="text-sm font-bold text-gray-800 mb-1">
        七期生醫科技股份有限公司
      </div>
      <div className="text-[11px] text-gray-500 mb-4">統一編號 83131399</div>

      <div className="space-y-2.5 text-[12px]">
        <div className="flex items-start gap-2">
          <Phone size={14} className="text-primary mt-0.5 shrink-0" />
          <span>
            訂購／客服專線{" "}
            <a href="tel:0800789188" className="font-semibold text-primary">
              0800-789-188
            </a>
          </span>
        </div>
        <div className="flex items-start gap-2">
          <Clock size={14} className="text-primary mt-0.5 shrink-0" />
          <span>客服時間 週一至週五 9:00–17:00</span>
        </div>
        <div className="flex items-start gap-2">
          <Printer size={14} className="text-primary mt-0.5 shrink-0" />
          <span>傳真 04-2259-1593</span>
        </div>
        <div className="flex items-start gap-2">
          <Mail size={14} className="text-primary mt-0.5 shrink-0" />
          <a href="mailto:7thcentral.pha@gmail.com" className="break-all">
            7thcentral.pha@gmail.com
          </a>
        </div>
        <div className="flex items-start gap-2">
          <MessageCircle size={14} className="text-primary mt-0.5 shrink-0" />
          <span>LINE 官方帳號 @0800789188th7</span>
        </div>
        <div className="flex items-start gap-2">
          <MapPin size={14} className="text-primary mt-0.5 shrink-0" />
          <span>407 台中市西屯區市政北二路 417 號</span>
        </div>
      </div>

      <div className="mt-5 pt-4 border-t border-[#e3ece7] text-center text-[10px] text-gray-400">
        © {new Date().getFullYear()} 七期生醫科技股份有限公司 All Rights
        Reserved.
      </div>
    </footer>
  );
}
