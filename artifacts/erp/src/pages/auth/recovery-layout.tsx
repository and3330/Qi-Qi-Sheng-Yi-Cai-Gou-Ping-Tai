import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function RecoveryLayout({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <main className="min-h-[100dvh] bg-background md:bg-muted/30 px-4 py-8 md:py-14 pt-safe-top pb-safe">
      <div className="mx-auto w-full max-w-md">
        <div className="mb-6 flex flex-col items-center text-center">
          <img
            src={`${import.meta.env.BASE_URL}logo.png`}
            alt="七期生醫"
            className="mb-4 h-16 w-16 object-contain"
          />
          <p className="text-sm font-medium text-muted-foreground">七期生醫</p>
        </div>
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="text-xl" data-testid="text-recovery-title">{title}</CardTitle>
            <p className="text-sm leading-6 text-muted-foreground">{description}</p>
          </CardHeader>
          <CardContent>{children}</CardContent>
        </Card>
        <div className="mt-5 text-center">
          <Link href="/login" className="text-sm font-medium text-primary hover:underline" data-testid="link-login">
            返回登入
          </Link>
        </div>
      </div>
    </main>
  );
}