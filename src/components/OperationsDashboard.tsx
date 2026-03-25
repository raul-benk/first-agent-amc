import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { RefreshCw, Activity, CheckCircle2, AlertTriangle, Clock3, DollarSign } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface MetricsResponse {
  generated_at: string;
  totals: {
    sessions: number;
    leads: number;
    tool_calls: number;
    errors: number;
  };
  rates: {
    qualificacao: number;
    coleta_dados: number;
    conversao: number;
  };
  latency_ms: {
    avg: number;
    p95: number;
  };
  cost: {
    total_usd: number;
    avg_per_conversation_usd: number;
  };
}

interface EvalResult {
  id: string;
  scenario_id: string;
  success?: boolean;
  details?: string[];
  created_at?: string;
}

const AUTO_REFRESH_MS = 30000;

const OperationsDashboard = () => {
  const [metrics, setMetrics] = useState<MetricsResponse | null>(null);
  const [evals, setEvals] = useState<EvalResult[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState("");

  const successRate = useMemo(() => {
    if (!evals.length) return null;
    const success = evals.filter((item) => item.success).length;
    return success / evals.length;
  }, [evals]);

  const loadDashboard = useCallback(
    async (isManualRefresh = false) => {
      if (isManualRefresh) setIsRefreshing(true);
      if (!metrics) setIsLoading(true);
      setError("");

      try {
        const [metricsRes, evalsRes] = await Promise.all([fetch("/api/metrics"), fetch("/api/evals/latest")]);

        if (!metricsRes.ok) throw new Error("Falha ao carregar métricas.");
        if (!evalsRes.ok) throw new Error("Falha ao carregar evals.");

        const metricsData = (await metricsRes.json()) as MetricsResponse;
        const evalsData = (await evalsRes.json()) as { results?: EvalResult[] };

        setMetrics(metricsData);
        setEvals(Array.isArray(evalsData.results) ? evalsData.results : []);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Erro ao carregar painel operacional.");
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [metrics],
  );

  useEffect(() => {
    void loadDashboard();

    const timer = window.setInterval(() => {
      void loadDashboard();
    }, AUTO_REFRESH_MS);

    return () => {
      window.clearInterval(timer);
    };
  }, [loadDashboard]);

  const formatPercent = (value: number) => `${(value * 100).toFixed(1)}%`;
  const formatMoney = (value: number) => `US$ ${value.toFixed(4)}`;

  return (
    <div className="h-full overflow-y-auto bg-background p-5 lg:p-6">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-foreground">Operações</h2>
          <p className="text-xs text-muted-foreground">Observabilidade e qualidade operacional do agente</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void loadDashboard(true)} disabled={isRefreshing}>
          <RefreshCw className={`mr-2 h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
          Atualizar
        </Button>
      </div>

      {error ? (
        <Card className="mb-4 border-destructive/30">
          <CardContent className="pt-5 text-sm text-destructive">{error}</CardContent>
        </Card>
      ) : null}

      {isLoading && !metrics ? (
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">Carregando dados operacionais...</CardContent>
        </Card>
      ) : null}

      {metrics ? (
        <>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            <MetricCard title="Sessões" value={String(metrics.totals.sessions)} icon={<Activity className="h-4 w-4" />} />
            <MetricCard title="Leads" value={String(metrics.totals.leads)} icon={<CheckCircle2 className="h-4 w-4" />} />
            <MetricCard title="Tool Calls" value={String(metrics.totals.tool_calls)} icon={<RefreshCw className="h-4 w-4" />} />
            <MetricCard title="Erros" value={String(metrics.totals.errors)} icon={<AlertTriangle className="h-4 w-4" />} />
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 xl:grid-cols-3">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Taxas</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <RateRow label="Qualificação" value={formatPercent(metrics.rates.qualificacao)} />
                <RateRow label="Coleta de dados" value={formatPercent(metrics.rates.coleta_dados)} />
                <RateRow label="Conversão" value={formatPercent(metrics.rates.conversao)} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Latência</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <RateRow label="Média" value={`${metrics.latency_ms.avg.toFixed(1)} ms`} />
                <RateRow label="P95" value={`${metrics.latency_ms.p95.toFixed(1)} ms`} />
                <div className="flex items-center gap-1 pt-1 text-xs text-muted-foreground">
                  <Clock3 className="h-3.5 w-3.5" />
                  Atualizado em {new Date(metrics.generated_at).toLocaleTimeString("pt-BR")}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Custo</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <RateRow label="Total" value={formatMoney(metrics.cost.total_usd)} />
                <RateRow label="Médio por conversa" value={formatMoney(metrics.cost.avg_per_conversation_usd)} />
                <div className="flex items-center gap-1 pt-1 text-xs text-muted-foreground">
                  <DollarSign className="h-3.5 w-3.5" />
                  Estimativa operacional
                </div>
              </CardContent>
            </Card>
          </div>

          <Card className="mt-4">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm">Evals Recentes</CardTitle>
              {successRate !== null ? (
                <Badge variant="secondary">Sucesso: {formatPercent(successRate)}</Badge>
              ) : (
                <Badge variant="secondary">Sem execuções</Badge>
              )}
            </CardHeader>
            <CardContent>
              {!evals.length ? (
                <p className="text-sm text-muted-foreground">Nenhuma execução encontrada.</p>
              ) : (
                <div className="space-y-2">
                  {evals.slice(0, 8).map((item) => (
                    <div key={item.id} className="flex items-center justify-between rounded-md border p-2 text-sm">
                      <div>
                        <p className="font-medium text-foreground">{item.scenario_id}</p>
                        <p className="text-xs text-muted-foreground">{(item.details || []).join(" | ") || "Sem detalhes"}</p>
                      </div>
                      <Badge variant={item.success ? "default" : "destructive"}>
                        {item.success ? "ok" : "falha"}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
};

const MetricCard = ({ title, value, icon }: { title: string; value: string; icon: ReactNode }) => (
  <Card>
    <CardContent className="flex items-center justify-between pt-5">
      <div>
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{title}</p>
        <p className="mt-1 text-2xl font-semibold">{value}</p>
      </div>
      <div className="rounded-lg border p-2 text-muted-foreground">{icon}</div>
    </CardContent>
  </Card>
);

const RateRow = ({ label, value }: { label: string; value: string }) => (
  <div className="flex items-center justify-between">
    <span className="text-muted-foreground">{label}</span>
    <span className="font-medium text-foreground">{value}</span>
  </div>
);

export default OperationsDashboard;
