import { useState } from "react";
import { MessageSquare, BarChart3 } from "lucide-react";
import ChatPreview from "@/components/ChatPreview";
import OperationsDashboard from "@/components/OperationsDashboard";
import { useIsMobile } from "@/hooks/use-mobile";
import { UNIFIED_PRE_ATTENDANCE_PROMPT } from "@/lib/unifiedPrompt";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const DEFAULT_ASSISTANT_NAME = "Lucas";
const DEFAULT_MODEL = "gpt-5-mini";
const DEFAULT_TEMPERATURE = 0.7;
const DEFAULT_PROMPT = UNIFIED_PRE_ATTENDANCE_PROMPT;

const Index = () => {
  const [activeTab, setActiveTab] = useState<"chat" | "ops">("chat");
  const [desktopPanel, setDesktopPanel] = useState<"chat" | "ops">("chat");
  const [preloadedLead, setPreloadedLead] = useState({
    nome: "",
    produto_interesse: "",
    fonte: "",
  });
  const isMobile = useIsMobile();

  return (
    <div className="flex h-screen flex-col bg-background">
      {/* Top bar */}
      <header className="flex items-center justify-between border-b border-border px-5 py-3 lg:px-8">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white p-1">
            <img src="/favIcon.png" alt="Logo" className="h-full w-full object-contain" />
          </div>
          <span className="text-sm font-bold text-foreground">AI Chat Studio</span>
        </div>
        <span className="text-xs text-muted-foreground hidden sm:block">Simulação de atendimento AMC Veículos</span>
        {!isMobile ? (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setDesktopPanel("chat")}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                desktopPanel === "chat" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
              }`}
            >
              Chat
            </button>
            <button
              onClick={() => setDesktopPanel("ops")}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                desktopPanel === "ops" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
              }`}
            >
              Operações
            </button>
          </div>
        ) : null}
      </header>

      {/* Mobile tabs */}
      {isMobile && (
        <div className="flex border-b border-border">
          <button
            onClick={() => setActiveTab("chat")}
            className={`flex-1 flex items-center justify-center gap-2 py-3 text-sm font-medium transition-colors ${
              activeTab === "chat"
                ? "text-foreground border-b-2 border-primary"
                : "text-muted-foreground"
            }`}
          >
            <MessageSquare className="h-4 w-4" />
            Preview
          </button>
          <button
            onClick={() => setActiveTab("ops")}
            className={`flex-1 flex items-center justify-center gap-2 py-3 text-sm font-medium transition-colors ${
              activeTab === "ops"
                ? "text-foreground border-b-2 border-primary"
                : "text-muted-foreground"
            }`}
          >
            <BarChart3 className="h-4 w-4" />
            Operações
          </button>
        </div>
      )}

      {/* Main content */}
      <div className="flex min-h-0 flex-1 overflow-hidden px-3 py-3 lg:px-6 lg:py-5">
        {/* Chat panel */}
        {isMobile ? (
          <>
            <div className={`${activeTab === "chat" ? "flex" : "hidden"} flex-1 flex-col`}>
              <ChatPreview
                assistantName={DEFAULT_ASSISTANT_NAME}
                model={DEFAULT_MODEL}
                temperature={DEFAULT_TEMPERATURE}
                systemPrompt={DEFAULT_PROMPT}
                preloadedLead={preloadedLead}
              />
            </div>
            <div className={`${activeTab === "ops" ? "flex" : "hidden"} flex-1 flex-col`}>
              <OperationsDashboard />
            </div>
          </>
        ) : (
          <div className="mx-auto flex h-full min-h-0 w-full max-w-[1440px] gap-4">
            {desktopPanel === "chat" ? (
              <>
                <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden rounded-xl border border-border bg-background">
                  <ChatPreview
                    assistantName={DEFAULT_ASSISTANT_NAME}
                    model={DEFAULT_MODEL}
                    temperature={DEFAULT_TEMPERATURE}
                    systemPrompt={DEFAULT_PROMPT}
                    preloadedLead={preloadedLead}
                  />
                </div>

                <div className="w-[340px] shrink-0">
                  <Card className="h-full">
                    <CardHeader className="pb-4">
                      <CardTitle className="text-base">Dados Preliminares</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="space-y-1.5">
                        <Label htmlFor="lead-nome" className="text-xs text-muted-foreground">
                          Nome do cliente
                        </Label>
                        <Input
                          id="lead-nome"
                          value={preloadedLead.nome}
                          onChange={(e) =>
                            setPreloadedLead((prev) => ({
                              ...prev,
                              nome: e.target.value,
                            }))
                          }
                          placeholder="Ex.: João Silva"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="lead-veiculo" className="text-xs text-muted-foreground">
                          Veículo de interesse
                        </Label>
                        <Input
                          id="lead-veiculo"
                          value={preloadedLead.produto_interesse}
                          onChange={(e) =>
                            setPreloadedLead((prev) => ({
                              ...prev,
                              produto_interesse: e.target.value,
                            }))
                          }
                          placeholder="Ex.: Tracker Premier"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="lead-fonte" className="text-xs text-muted-foreground">
                          Fonte
                        </Label>
                        <Input
                          id="lead-fonte"
                          value={preloadedLead.fonte}
                          onChange={(e) =>
                            setPreloadedLead((prev) => ({
                              ...prev,
                              fonte: e.target.value,
                            }))
                          }
                          placeholder="Ex.: Meta Ads / Site / Indicação"
                        />
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Esses dados são enviados no início da conversa para contextualizar o atendimento da IA.
                      </p>
                    </CardContent>
                  </Card>
                </div>
              </>
            ) : (
              <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden rounded-xl border border-border bg-background">
                <OperationsDashboard />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default Index;
