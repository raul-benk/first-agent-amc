import { cn } from "@/lib/utils";
import { Bot, User } from "lucide-react";

interface MessageBubbleProps {
  content: string;
  isUser: boolean;
  timestamp?: string;
}

const MessageBubble = ({ content, isUser }: MessageBubbleProps) => (
  <div className={cn("flex gap-2.5 max-w-[85%]", isUser ? "ml-auto flex-row-reverse" : "mr-auto")}>
    <div className={cn(
      "flex h-7 w-7 shrink-0 items-center justify-center rounded-full",
      isUser ? "bg-primary" : "bg-muted"
    )}>
      {isUser ? <User className="h-3.5 w-3.5 text-primary-foreground" /> : <Bot className="h-3.5 w-3.5 text-muted-foreground" />}
    </div>
    <div className={cn(
      "rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
      isUser
        ? "bg-primary text-primary-foreground rounded-br-md"
        : "bg-muted text-foreground rounded-bl-md"
    )}>
      {content}
    </div>
  </div>
);

export default MessageBubble;
