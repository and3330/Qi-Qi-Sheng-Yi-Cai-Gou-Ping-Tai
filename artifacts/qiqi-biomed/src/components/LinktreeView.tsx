import { ExternalLink } from "lucide-react";

export interface LinktreeViewLink {
  id: number;
  title: string;
  subtitle?: string | null;
  url: string;
  icon?: string | null;
  linkType?: string;
}

export interface LinktreeViewSettings {
  bio?: string | null;
  subtitle?: string | null;
  theme?: string;
  backgroundColor?: string | null;
  buttonColor?: string | null;
  buttonTextColor?: string | null;
  buttonStyle?: string;
  showAvatar?: boolean;
  customTitle?: string | null;
}

const THEME_CLASSES: Record<string, { page: string; button: string; sub: string }> = {
  default: {
    page: "bg-gray-50 text-gray-900",
    button: "bg-white border border-gray-200 text-gray-800 hover:bg-gray-100",
    sub: "text-gray-500",
  },
  dark: {
    page: "bg-gray-950 text-white",
    button: "bg-gray-800 border border-gray-700 text-white hover:bg-gray-700",
    sub: "text-gray-400",
  },
  gradient: {
    page: "bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 text-white",
    button: "bg-white/15 border border-white/30 text-white backdrop-blur hover:bg-white/25",
    sub: "text-white/70",
  },
  pastel: {
    page: "bg-rose-50 text-gray-800",
    button: "bg-white border border-rose-100 text-gray-800 hover:bg-rose-100",
    sub: "text-gray-500",
  },
};

const BUTTON_STYLE_CLASSES: Record<string, string> = {
  rounded: "rounded-xl",
  pill: "rounded-full",
  square: "rounded-none",
  outline: "rounded-xl border-2 bg-transparent",
};

/** 公開連結頁畫面（也用於編輯時的即時預覽） */
export function LinktreeView({
  displayName,
  links,
  settings,
  compact = false,
}: {
  displayName: string;
  links: LinktreeViewLink[];
  settings: LinktreeViewSettings;
  compact?: boolean;
}) {
  const theme = THEME_CLASSES[settings.theme || "default"] || THEME_CLASSES.default;
  const btnShape =
    BUTTON_STYLE_CLASSES[settings.buttonStyle || "rounded"] || BUTTON_STYLE_CLASSES.rounded;
  const pageStyle = settings.backgroundColor
    ? { backgroundColor: settings.backgroundColor }
    : undefined;
  const btnStyle = {
    backgroundColor: settings.buttonColor || undefined,
    color: settings.buttonTextColor || undefined,
    borderColor:
      settings.buttonStyle === "outline"
        ? settings.buttonColor || undefined
        : undefined,
  };
  const initials = (displayName || "??").slice(0, 2);

  return (
    <div
      className={`${compact ? "min-h-full py-6" : "min-h-screen py-10"} flex flex-col items-center px-4 ${theme.page}`}
      style={pageStyle}
      data-testid="linktree-view"
    >
      <div className="w-full max-w-md space-y-6">
        {settings.showAvatar !== false && (
          <div className="text-center">
            <div className="mx-auto mb-3 flex h-20 w-20 items-center justify-center rounded-full bg-black/10 text-xl font-bold backdrop-blur">
              {initials}
            </div>
            <h1 className="text-xl font-bold" data-testid="text-linktree-title">
              {settings.customTitle || displayName}
            </h1>
            {settings.subtitle && (
              <p className={`text-sm ${theme.sub}`}>{settings.subtitle}</p>
            )}
            {settings.bio && <p className="mt-2 text-sm">{settings.bio}</p>}
          </div>
        )}
        <div className="space-y-3">
          {links.length === 0 && (
            <p className={`py-8 text-center text-sm ${theme.sub}`}>尚無連結</p>
          )}
          {links.map((link) => (
            <a
              key={link.id}
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              className="block"
              data-testid={`link-linktree-${link.id}`}
            >
              <div
                className={`flex w-full items-center justify-between px-4 py-3 text-sm font-medium shadow-sm transition-colors ${theme.button} ${btnShape}`}
                style={btnStyle}
              >
                <div className="min-w-0 text-left">
                  <div className="truncate font-semibold">
                    {link.icon ? `${link.icon} ` : ""}
                    {link.title}
                  </div>
                  {link.subtitle && (
                    <div className="truncate text-xs opacity-70">{link.subtitle}</div>
                  )}
                </div>
                <ExternalLink className="ml-3 h-4 w-4 shrink-0 opacity-50" />
              </div>
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}
