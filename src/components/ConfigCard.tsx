import { cn } from "@/lib/utils";

interface ConfigCardProps {
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}

const ConfigCard = ({ title, description, children, className }: ConfigCardProps) => (
  <div className={cn("bg-card rounded-xl border border-border p-5 shadow-card transition-shadow hover:shadow-card-hover", className)}>
    <div className="mb-4">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      {description && <p className="mt-1 text-xs text-muted-foreground">{description}</p>}
    </div>
    <div className="space-y-3">{children}</div>
  </div>
);

export default ConfigCard;
