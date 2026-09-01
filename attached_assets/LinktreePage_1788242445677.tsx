import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ExternalLink } from "lucide-react";

interface LinkItem {
  id: number;
  title: string;
  subtitle?: string;
  url: string;
  icon?: string;
  linkType: string;
}

interface LinktreeSettings {
  bio?: string;
  subtitle?: string;
  theme?: string;
  backgroundColor?: string;
  buttonColor?: string;
  buttonTextColor?: string;
  buttonStyle?: string;
  showAvatar?: boolean;
  customTitle?: string;
}

interface LinktreePageProps {
  user: { displayName: string; avatarUrl?: string };
  links: LinkItem[];
  settings: LinktreeSettings;
}

const buttonStyleClasses: Record<string, string> = {
  rounded: "rounded-lg",
  pill: "rounded-full",
  square: "rounded-none",
  outline: "rounded-lg border-2 bg-transparent",
};

export function LinktreePage({ user, links, settings }: LinktreePageProps) {
  const bgStyle = settings.backgroundColor ? { backgroundColor: settings.backgroundColor } : {};
  const btnStyle = {
    backgroundColor: settings.buttonColor || undefined,
    color: settings.buttonTextColor || undefined,
  };
  const btnClass = buttonStyleClasses[settings.buttonStyle || "rounded"] || buttonStyleClasses.rounded;
  const initials = user.displayName?.slice(0, 2) || "??";

  return (
    <div className="min-h-screen flex flex-col items-center py-8 px-4" style={bgStyle}>
      <div className="max-w-md w-full space-y-6">
        {settings.showAvatar !== false && (
          <div className="text-center">
            <Avatar className="w-20 h-20 mx-auto mb-3">
              <AvatarImage src={user.avatarUrl} alt={user.displayName} />
              <AvatarFallback className="text-lg">{initials}</AvatarFallback>
            </Avatar>
            <h1 className="text-xl font-bold">{settings.customTitle || user.displayName}</h1>
            {settings.subtitle && <p className="text-sm text-muted-foreground">{settings.subtitle}</p>}
            {settings.bio && <p className="text-sm mt-2">{settings.bio}</p>}
          </div>
        )}

        <div className="space-y-3">
          {links.map((link) => (
            <a key={link.id} href={link.url} target="_blank" rel="noopener noreferrer" className="block">
              <Button
                variant="outline"
                className={`w-full h-auto py-3 px-4 justify-between ${btnClass}`}
                style={btnStyle}
              >
                <div className="text-left">
                  <div className="font-medium">{link.title}</div>
                  {link.subtitle && <div className="text-xs opacity-70">{link.subtitle}</div>}
                </div>
                <ExternalLink className="h-4 w-4 opacity-50" />
              </Button>
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}
