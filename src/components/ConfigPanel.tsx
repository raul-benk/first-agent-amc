import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import ConfigCard from "./ConfigCard";

interface ConfigPanelProps {
  config: {
    assistantName: string;
    companyName: string;
    role: string;
    prompt: string;
    model: string;
    temperature: number;
  };
  onConfigChange: (config: ConfigPanelProps["config"]) => void;
  onTest: () => void;
}

const MODELS = ["gpt-5-mini", "gpt-5", "gpt-5-nano", "gpt-4.1-mini"];

const ConfigPanel = ({ config, onConfigChange, onTest }: ConfigPanelProps) => {
  const update = <K extends keyof typeof config>(key: K, value: (typeof config)[K]) => {
    onConfigChange({ ...config, [key]: value });
  };

  return (
    <div className="space-y-5 p-5 lg:p-6 overflow-y-auto h-full">
      <div className="mb-2">
        <h2 className="text-lg font-bold text-foreground">Configuração</h2>
        <p className="text-xs text-muted-foreground">Configure seu assistente virtual</p>
      </div>

      <ConfigCard title="Identidade do Assistente" description="Informações básicas do seu bot">
        <div>
          <Label className="text-xs text-muted-foreground">Nome do assistente</Label>
          <Input
            value={config.assistantName}
            onChange={(e) => update("assistantName", e.target.value)}
            placeholder="Ex: Consultor Virtual"
            className="mt-1"
          />
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">Empresa</Label>
          <Input
            value={config.companyName}
            onChange={(e) => update("companyName", e.target.value)}
            placeholder="Nome da empresa"
            className="mt-1"
          />
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">Papel do assistente</Label>
          <Input
            value={config.role}
            onChange={(e) => update("role", e.target.value)}
            placeholder="Ex: Atendente de vendas"
            className="mt-1"
          />
        </div>
      </ConfigCard>

      <ConfigCard title="Prompt / Instruções" description="Defina como o assistente deve se comportar">
        <Textarea
          value={config.prompt}
          onChange={(e) => update("prompt", e.target.value)}
          placeholder="Descreva o comportamento, tom de voz e instruções do assistente..."
          rows={8}
          className="resize-none text-sm"
        />
      </ConfigCard>

      <ConfigCard title="Configuração de IA" description="Parâmetros do modelo">
        <div className="rounded-md border border-input bg-muted/30 px-3 py-2">
          <Label className="text-xs text-muted-foreground">Chave OpenAI (backend)</Label>
          <p className="mt-1 text-xs">
            Defina OPENAI_API_KEY no arquivo .env do servidor para usar o modo real.
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            A chave fica somente no backend e nao e exposta no frontend.
          </p>
        </div>

        <div>
          <Label className="text-xs text-muted-foreground">Modelo (inclui GPT-5 Mini)</Label>
          <select
            value={config.model}
            onChange={(e) => update("model", e.target.value)}
            className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            {MODELS.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>

        <div>
          <Label className="text-xs text-muted-foreground">Temperatura: {config.temperature.toFixed(1)}</Label>
          <input
            type="range"
            min="0"
            max="2"
            step="0.1"
            value={config.temperature}
            onChange={(e) => update("temperature", parseFloat(e.target.value))}
            className="mt-2 w-full accent-primary h-1.5 rounded-full"
          />
          <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
            <span>Preciso</span>
            <span>Criativo</span>
          </div>
        </div>

        <div className="flex items-start gap-2 rounded-lg bg-muted p-3 text-xs text-muted-foreground">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-amber-500" />
          <span>Em producao, mantenha a chave apenas no backend e nunca exponha em clientes.</span>
        </div>

        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" onClick={() => {}}>
            Salvar
          </Button>
          <Button variant="accent" className="flex-1" onClick={onTest}>
            Testar
          </Button>
        </div>
      </ConfigCard>

    </div>
  );
};

export default ConfigPanel;
