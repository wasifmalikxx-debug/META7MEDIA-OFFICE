import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Rocket } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function FBProgramPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <Card className="max-w-md w-full">
        <CardContent className="pt-10 pb-10 text-center space-y-4">
          <div className="flex justify-center">
            <div className="size-16 rounded-full bg-blue-100 dark:bg-blue-950/30 flex items-center justify-center">
              <Rocket className="size-8 text-blue-600" />
            </div>
          </div>
          <h1 className="text-2xl font-bold">Coming Soon</h1>
          <p className="text-muted-foreground text-sm max-w-sm mx-auto">
            The Facebook team bonus program is currently under development.
            Stay tuned for updates from the management.
          </p>
          <div className="pt-2">
            <span className="inline-flex items-center gap-1.5 text-xs bg-blue-100 dark:bg-blue-950/30 text-blue-700 dark:text-blue-400 px-3 py-1.5 rounded-full font-medium">
              <Rocket className="size-3" />
              Under Development
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
