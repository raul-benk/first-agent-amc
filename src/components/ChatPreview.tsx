import { useEffect, useRef, useState } from "react";
import { Send, Bot, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import MessageBubble from "./MessageBubble";

interface Message {
  id: number;
  content: string;
  isUser: boolean;
}

interface HistoryMessage {
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
}

const MEMORY_MESSAGES_KEY = "ai-assistant-studio:chat-memory:v2";
const MEMORY_CONVERSATION_KEY = "ai-assistant-studio:conversation-id:v2";

interface ChatPreviewProps {
  assistantName: string;
  model: string;
  temperature: number;
  systemPrompt: string;
  preloadedLead?: {
    nome?: string;
    produto_interesse?: string;
    fonte?: string;
  };
}

const ChatPreview = ({ assistantName, model, temperature, systemPrompt, preloadedLead }: ChatPreviewProps) => {
  const initialMessage = buildInitialMessage(assistantName, preloadedLead);

  const [messages, setMessages] = useState<Message[]>(() => {
    if (typeof window === "undefined") return [initialMessage];

    try {
      const raw = window.localStorage.getItem(MEMORY_MESSAGES_KEY);
      if (!raw) return [initialMessage];

      const parsed = JSON.parse(raw) as Message[];
      if (!Array.isArray(parsed) || parsed.length === 0) return [initialMessage];
      return parsed;
    } catch {
      return [initialMessage];
    }
  });
  const [conversationId, setConversationId] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    return window.localStorage.getItem(MEMORY_CONVERSATION_KEY) || "";
  });
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [backendStatus, setBackendStatus] = useState<"checking" | "online" | "offline">("checking");
  const [hasServerKey, setHasServerKey] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const idRef = useRef(
    Math.max(2, ...messages.map((msg) => (typeof msg.id === "number" ? msg.id + 1 : 2))),
  );

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, isTyping]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(MEMORY_MESSAGES_KEY, JSON.stringify(messages));
  }, [messages]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    if (conversationId) {
      window.localStorage.setItem(MEMORY_CONVERSATION_KEY, conversationId);
    } else {
      window.localStorage.removeItem(MEMORY_CONVERSATION_KEY);
    }
  }, [conversationId]);

  useEffect(() => {
    let cancelled = false;

    const loadHealth = async () => {
      try {
        const response = await fetch("/api/health");
        if (!response.ok) throw new Error("Healthcheck indisponivel");

        const data = await readJsonSafe<{ hasOpenAIKey?: boolean }>(response);
        if (!cancelled) {
          setBackendStatus("online");
          setHasServerKey(!!data.hasOpenAIKey);
        }
      } catch {
        if (!cancelled) {
          setBackendStatus("offline");
          setHasServerKey(false);
        }
      }
    };

    void loadHealth();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!conversationId) return;

    let cancelled = false;

    const loadHistory = async () => {
      try {
        const response = await fetch(`/api/conversations/${conversationId}`);
        if (!response.ok) return;

        const data = await readJsonSafe<{ messages?: HistoryMessage[] }>(response);
        const history = (data.messages || [])
          .filter((msg) => msg.role === "user" || msg.role === "assistant")
          .map((msg) => ({
            id: idRef.current++,
            content: msg.content,
            isUser: msg.role === "user",
          }));

        if (!cancelled && history.length > 0) {
          setMessages(history);
        }
      } catch {
        // fallback para memoria local
      }
    };

    void loadHistory();

    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  const sendMessage = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isTyping) return;

    const userMsg: Message = { id: idRef.current++, content: trimmed, isUser: true };
    const nextConversationId = conversationId || crypto.randomUUID();

    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setIsTyping(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          conversationId: nextConversationId,
          message: trimmed,
          model,
          temperature,
          systemPrompt,
          preloadedLead: {
            nome: preloadedLead?.nome || "",
            produto_interesse: preloadedLead?.produto_interesse || "",
            fonte: preloadedLead?.fonte || "",
          },
        }),
      });

      const data = await readJsonSafe<{
        conversationId?: string;
        reply?: string;
        error?: string;
      }>(response);

      if (!response.ok) {
        throw new Error(data.error || "Falha ao chamar backend do agente.");
      }

      if (!data || typeof data.reply !== "string") {
        throw new Error("Resposta invalida do servidor.");
      }

      setConversationId(data.conversationId || nextConversationId);

      setMessages((prev) => [
        ...prev,
        {
          id: idRef.current++,
          content: data.reply || "Sem resposta textual do modelo.",
          isUser: false,
        },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: idRef.current++,
          content:
            "Tive uma instabilidade para responder agora. Pode me enviar novamente em alguns segundos?",
          isUser: false,
        },
      ]);
    } finally {
      setIsTyping(false);
    }
  };

  const resetSimulation = () => {
    setMessages([buildInitialMessage(assistantName, preloadedLead)]);
    setConversationId("");
    setInput("");
    idRef.current = 2;
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(MEMORY_MESSAGES_KEY);
      window.localStorage.removeItem(MEMORY_CONVERSATION_KEY);
    }
  };

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-col bg-background">
      <div className="flex items-center gap-3 border-b border-border px-5 py-4">
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary">
          <Bot className="h-4 w-4 text-primary-foreground" />
        </div>
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-foreground">{assistantName || "Assistente"}</h3>
          <p className="text-xs text-muted-foreground">Online</p>
        </div>
        {backendStatus === "offline" ? (
          <Badge variant="secondary" className="text-[10px] font-medium">Backend offline</Badge>
        ) : backendStatus === "checking" ? (
          <Badge variant="secondary" className="text-[10px] font-medium">Verificando backend</Badge>
        ) : hasServerKey ? (
          <Badge variant="secondary" className="text-[10px] font-medium">Agente real ativo</Badge>
        ) : (
          <Badge variant="secondary" className="text-[10px] font-medium">Sem OPENAI_API_KEY no backend</Badge>
        )}
        <Button variant="outline" size="sm" onClick={resetSimulation} className="text-xs">
          <RotateCcw className="mr-1 h-3.5 w-3.5" />
          Nova simulação
        </Button>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-4 space-y-4 min-h-0">
        {messages.map((msg) => (
          <MessageBubble key={msg.id} content={msg.content} isUser={msg.isUser} />
        ))}
        {isTyping && (
          <div className="flex gap-2.5 max-w-[85%] mr-auto">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted">
              <Bot className="h-3.5 w-3.5 text-muted-foreground" />
            </div>
            <div className="rounded-2xl rounded-bl-md bg-muted px-4 py-3">
              <div className="flex gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50 animate-bounce" style={{ animationDelay: "0ms" }} />
                <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50 animate-bounce" style={{ animationDelay: "150ms" }} />
                <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50 animate-bounce" style={{ animationDelay: "300ms" }} />
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="border-t border-border px-5 py-3">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void sendMessage(input);
          }}
          className="mx-auto flex w-full max-w-3xl gap-2"
        >
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Digite sua mensagem..."
            className="flex-1"
            disabled={isTyping}
          />
          <Button type="submit" variant="accent" size="icon" disabled={!input.trim() || isTyping}>
            <Send className="h-4 w-4" />
          </Button>
        </form>
      </div>
    </div>
  );
};

function buildInitialMessage(
  assistantName: string,
  preloadedLead?: {
    nome?: string;
    produto_interesse?: string;
    fonte?: string;
  },
): Message {
  const contactFirstName = extractFirstName(preloadedLead?.nome) || "cliente";
  const userFirstName = extractFirstName(assistantName) || "consultor";
  const source = preloadedLead?.fonte?.trim() || "nossa central";
  const interesse = preloadedLead?.produto_interesse?.trim() || "veículo de interesse";

  return {
    id: 1,
    isUser: false,
    content: `Olá ${contactFirstName}, tudo bem?\n\nAqui é o ${userFirstName}, consultor da AMC Veículos.\nRecebi seu contato através do ${source} sobre o ${interesse}.\n\nPosso te ajudar com disponibilidade e condições atualizadas. Como você prefere seguir?`,
  };
}

function extractFirstName(value?: string) {
  if (!value) return "";
  const first = value.trim().split(/\s+/)[0];
  return first || "";
}

async function readJsonSafe<T>(response: Response): Promise<T> {
  const raw = await response.text();
  if (!raw.trim()) return {} as T;

  try {
    return JSON.parse(raw) as T;
  } catch {
    return {} as T;
  }
}

export default ChatPreview;
