import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";

export default function NotFound() {
  return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <Card className="w-full max-w-md mx-4">
        <CardContent className="pt-6 text-center space-y-4">
          <h1 className="text-6xl font-bold text-muted-foreground">404</h1>
          <h2 className="text-xl font-semibold text-foreground">找不到頁面</h2>
          <p className="text-sm text-muted-foreground">您訪問的頁面不存在或已被移除。</p>
          <Link href="/">
            <Button>返回儀表板</Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
