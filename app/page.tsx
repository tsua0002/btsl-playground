'use client';

import { useState, useCallback, useMemo, useEffect } from 'react';
import { SchemaInputCard } from '@/components/btsl/schema-input-card';
import { ParameterBindingCard } from '@/components/btsl/parameter-binding-card';
import { CodeGenerationCard, ExecutionResult } from '@/components/btsl/code-generation-card';
import { PSBTOutputCard } from '@/components/btsl/psbt-output-card';
import { WelcomeBanner } from '@/components/btsl/welcome-banner';
import { QuickExampleCards } from '@/components/btsl/quick-example-cards';
import { PWAInstallPrompt } from '@/components/btsl/pwa-install-prompt';
import type { WorkflowContext, WorkflowOutputRef } from '@/lib/btsl/types';
import { BTSLDocument, BTSLParam, BoundParams, ParseResult } from '@/lib/btsl/types';
import type { PubkeyAddressType } from '@/lib/btsl/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { orderSchemasByDependsOn } from '@/lib/btsl/workflow';
import { Bitcoin, FileCode, Github, ExternalLink, Sun, Moon, Monitor } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useFirstVisit } from '@/hooks/use-first-visit';
import type { ExampleDefinition } from '@/lib/btsl/examples-catalog';

export default function BTSLPlayground() {
  // Pipeline state
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const [params, setParams] = useState<BTSLParam[]>([]);
  const [document, setDocument] = useState<BTSLDocument | null>(null);
  const [boundParams, setBoundParams] = useState<BoundParams | null>(null);
  const [executionResultsBySchema, setExecutionResultsBySchema] = useState<Record<string, ExecutionResult | null>>({});
  const [workflowContext, setWorkflowContext] = useState<WorkflowContext>({ steps: {} });
  const [workflowOrder, setWorkflowOrder] = useState<string[]>([]);
  const [workflowErrors, setWorkflowErrors] = useState<string[]>([]);
  const [activeSchemaName, setActiveSchemaName] = useState<string | null>(null);

  // Card unlock state
  const [card1Complete, setCard1Complete] = useState(false);
  const [card2Complete, setCard2Complete] = useState(false);
  const [card3Complete, setCard3Complete] = useState(false);

  // Active example tracking (for quick example cards highlight)
  const [activeExampleId, setActiveExampleId] = useState<string | null>(null);
  // Pre-fill params from selected example
  const [pendingPrefill, setPendingPrefill] = useState<Record<string, string> | null>(null);

  // Onboarding / first-visit
  const { isFirstVisit, isExperienced, loaded: visitLoaded, markExperienced, incrementSuccessfulRuns } = useFirstVisit();
  const [showWelcome, setShowWelcome] = useState(false);

  useEffect(() => {
    if (visitLoaded && isFirstVisit && !isExperienced) {
      setShowWelcome(true);
    }
  }, [visitLoaded, isFirstVisit, isExperienced]);

  const handleDismissWelcome = useCallback(() => {
    setShowWelcome(false);
    markExperienced();
  }, [markExperienced]);

  const handleSchemaParsed = useCallback((result: ParseResult) => {
    setParseResult(result);
    if (result.success && result.document && result.params) {
      setDocument(result.document);
      setParams(result.params);
      const ordered = orderSchemasByDependsOn(result.document.schemas);
      setWorkflowOrder(ordered.ordered.map((s) => s.name));
      setWorkflowErrors(ordered.errors);
      setActiveSchemaName(ordered.ordered[0]?.name ?? null);
      setWorkflowContext({ steps: {} });
      setExecutionResultsBySchema({});
      setCard1Complete(true);
      setCard2Complete(false);
      setCard3Complete(false);
      setBoundParams(null);
    } else {
      setCard1Complete(false);
    }
  }, []);

  const handleParamsBound = useCallback((bound: BoundParams) => {
    setBoundParams(bound);
    setCard2Complete(true);
    setCard3Complete(false);
  }, []);

  const handleExecutionResult = useCallback((result: ExecutionResult) => {
    if (result.success) {
      setCard3Complete(true);
      incrementSuccessfulRuns();
    }
  }, [incrementSuccessfulRuns]);

  const activeExecutionResult = useMemo(() => {
    const name = activeSchemaName ?? workflowOrder[0] ?? null;
    if (!name) return null;
    return executionResultsBySchema[name] ?? null;
  }, [executionResultsBySchema, activeSchemaName, workflowOrder]);

  const activeSchemaIndex = useMemo(() => {
    if (!document || !activeSchemaName) return 0;
    const idx = document.schemas.findIndex((s) => s.name === activeSchemaName);
    return idx >= 0 ? idx : 0;
  }, [document, activeSchemaName]);

  const workflowDerivedUtxos = useMemo(() => {
    if (!document) return {} as Record<string, WorkflowOutputRef>;
    const map: Record<string, WorkflowOutputRef> = {};
    for (const s of document.schemas) {
      for (const inp of s.inputs ?? []) {
        if (inp.workflowRef) {
          const internalName = inp.utxoRef.replace(/^@/, '');
          map[internalName] = inp.workflowRef;
        }
      }
    }
    return map;
  }, [document]);

  const derivedParamSources = useMemo(() => {
    if (!document) return {};
    return Object.fromEntries(
      document.schemas.flatMap(s =>
        (s.inputs ?? [])
          .filter(inp => inp.utxoAlias && inp.fromRef)
          .map(inp => [inp.utxoAlias!, inp.fromRef!.replace(/^@/, '')])
      )
    );
  }, [document]);

  const derivedParamSourceTypes = useMemo(() => {
    const map: Record<string, 'PUBKEY' | 'ADDRESS'> = {};
    if (!document) return map;
    const allParams = new Map<string, string>();
    for (const s of document.schemas) {
      for (const p of s.params) allParams.set(p.name, p.type);
    }
    for (const s of document.schemas) {
      for (const inp of s.inputs ?? []) {
        if (!inp.utxoAlias || !inp.fromRef) continue;
        const src = inp.fromRef.replace(/^@/, '');
        const t = allParams.get(src);
        map[inp.utxoAlias] = t === 'ADDRESS' ? 'ADDRESS' : 'PUBKEY';
      }
    }
    return map;
  }, [document]);

  const derivedParamAddressTypes = useMemo(() => {
    if (!document) return {} as Record<string, PubkeyAddressType>;
    const map: Record<string, PubkeyAddressType> = {};
    for (const s of document.schemas) {
      for (const inp of s.inputs ?? []) {
        if (!inp.utxoAlias) continue;
        const t = inp.type;
        if (t === 'NATIVE_P2TR_KEY') map[inp.utxoAlias] = 'P2TR';
        else if (t === 'NATIVE_P2PKH') map[inp.utxoAlias] = 'P2PKH';
        else map[inp.utxoAlias] = 'P2WPKH';
      }
    }
    return map;
  }, [document]);

  const visibleParamNames = useMemo(() => {
    if (!document || !activeSchemaName) return params.map((p) => p.name);
    const s = document.schemas.find((x) => x.name === activeSchemaName);
    if (!s) return params.map((p) => p.name);
    const names = new Set<string>();
    for (const p of s.params) names.add(p.name);
    for (const inp of s.inputs ?? []) {
      if (inp.utxoAlias) names.add(inp.utxoAlias);
      if (inp.workflowRef) names.add(inp.utxoRef.replace(/^@/, ''));
      if (inp.utxoRef.startsWith('@')) names.add(inp.utxoRef.replace(/^@/, ''));
    }
    for (const out of s.outputs ?? []) {
      if (out.type === 'OP_RETURN' && out.payload?.trim().startsWith('@')) {
        names.add(out.payload.replace(/^@/, '').trim());
      }
    }
    return Array.from(names);
  }, [document, activeSchemaName, params]);

  const handleSetWorkflowTxid = useCallback((schemaName: string, txid: string) => {
    setWorkflowContext((prev) => ({
      steps: {
        ...prev.steps,
        [schemaName]: {
          ...(prev.steps[schemaName] ?? {}),
          txid: txid.trim() || undefined,
        },
      },
    }));
  }, []);

  const handleExecutionResultForWorkflow = useCallback((result: ExecutionResult) => {
    handleExecutionResult(result);
    if (!document) return;
    const schemaName = activeSchemaName ?? document.schemas[activeSchemaIndex]?.name;
    if (!schemaName) return;
    setExecutionResultsBySchema((prev) => ({ ...prev, [schemaName]: result }));
    if (result.success && result.summary) {
      const outputs = result.summary.outputs;
      setWorkflowContext((prev) => ({
        steps: {
          ...prev.steps,
          [schemaName]: {
            ...(prev.steps[schemaName] ?? {}),
            outputs: outputs.map((o) => ({ index: o.index, valueSats: o.value })),
          },
        },
      }));
    }
  }, [handleExecutionResult, document, activeSchemaName, activeSchemaIndex]);

  const handleSelectQuickExample = useCallback((example: ExampleDefinition) => {
    setActiveExampleId(example.id);
    setPendingPrefill(example.prefillParams ?? null);
    setShowWelcome(false);
  }, []);

  const handleClearPrefill = useCallback(() => {
    setPendingPrefill(null);
  }, []);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card sticky top-0 z-40">
        <div className="container mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center h-9 w-9 rounded-lg bg-primary text-primary-foreground shrink-0">
                <Bitcoin className="h-5 w-5" />
              </div>
              <div>
                <h1 className="text-lg font-bold leading-tight">BTSL Schema Playground</h1>
                <p className="text-xs text-muted-foreground hidden sm:block">
                  Bitcoin Transaction Schema Language → PSBT Compiler
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-xs hidden sm:flex">
                v1.0 Preview
              </Badge>
              <ThemeToggle />
              <a
                href="https://github.com/tsua0002/btsl-playground"
                target="_blank"
                rel="noopener noreferrer"
                className="text-muted-foreground hover:text-foreground transition-colors p-1.5 rounded-md hover:bg-muted"
                title="View on GitHub"
              >
                <Github className="h-4 w-4" />
              </a>
            </div>
          </div>
        </div>
      </header>

      {/* Pipeline Progress */}
      <div className="border-b bg-muted/30">
        <div className="container mx-auto px-4 py-3">
          <div className="flex items-center justify-center gap-2">
            <PipelineStep
              number={1}
              label="Schema Input"
              active={!card1Complete}
              complete={card1Complete}
            />
            <PipelineConnector active={card1Complete} />
            <PipelineStep
              number={2}
              label="Parameter Binding"
              active={card1Complete && !card2Complete}
              complete={card2Complete}
            />
            <PipelineConnector active={card2Complete} />
            <PipelineStep
              number={3}
              label="Code Generation"
              active={card2Complete && !card3Complete}
              complete={card3Complete}
            />
            <PipelineConnector active={card3Complete} />
            <PipelineStep
              number={4}
              label="PSBT Output"
              active={card3Complete}
              complete={false}
            />
          </div>
        </div>
      </div>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-6">
        <div className="max-w-4xl mx-auto space-y-6">
          {/* Welcome Banner — shown on first visit */}
          {showWelcome && visitLoaded && (
            <WelcomeBanner onDismiss={handleDismissWelcome} />
          )}

          {/* Quick Example Cards — shown to new users; experienced users can toggle */}
          {visitLoaded && (
            <>
              {!isExperienced ? (
                <QuickExampleCards
                  onSelectExample={handleSelectQuickExample}
                  activeExampleId={activeExampleId}
                />
              ) : (
                <div className="flex justify-end">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs text-muted-foreground"
                    onClick={() => {
                      localStorage.removeItem('btsl_experienced');
                      window.location.reload();
                    }}
                  >
                    Show examples panel
                  </Button>
                </div>
              )}
            </>
          )}

          {/* Workflow selector (multi-schema) */}
          {document && workflowOrder.length > 1 && (
            <div className="rounded-xl border bg-card p-4 space-y-2">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-medium">Workflow schemas</div>
                <div className="text-xs text-muted-foreground">
                  Active: <span className="font-mono">{activeSchemaName ?? workflowOrder[0]}</span>
                </div>
              </div>
              {workflowErrors.length > 0 && (
                <div className="text-sm text-red-600">
                  {workflowErrors.map((e, i) => (
                    <div key={i}>{e}</div>
                  ))}
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                {workflowOrder.map((name) => {
                  const schema = document.schemas.find((s) => s.name === name);
                  const dep = schema?.options?.dependsOn;
                  const unlocked = !dep || Boolean(workflowContext.steps[dep]?.txid);
                  const isActive = (activeSchemaName ?? workflowOrder[0]) === name;
                  return (
                    <Button
                      key={name}
                      variant={isActive ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setActiveSchemaName(name)}
                      disabled={!unlocked}
                      title={!unlocked ? `Locked: requires txid for ${dep}` : undefined}
                    >
                      {name}
                    </Button>
                  );
                })}
              </div>
              <div className="text-xs text-muted-foreground">
                A step becomes unlockable once its parent step has a txid set (after signing/broadcast).
              </div>
            </div>
          )}

          {/* Card 1 - Schema Input */}
          <SchemaInputCard
            onParsed={handleSchemaParsed}
            disabled={false}
            activeExampleId={activeExampleId}
            onExampleSelected={(id) => setActiveExampleId(id)}
          />

          {/* Card 2 - Parameter Binding */}
          <div id="card-parameter-binding">
            <ParameterBindingCard
              params={params.filter((p) => visibleParamNames.includes(p.name))}
              payloadParamNames={document ? Array.from(new Set(
                document.schemas.flatMap(s =>
                  (s.outputs ?? [])
                    .filter(o => o.type === 'OP_RETURN' && o.payload?.trim().startsWith('@'))
                    .map(o => o.payload!.replace(/^@/, '').trim())
                )
              )) : []}
              derivedParamSources={derivedParamSources}
              derivedParamSourceTypes={derivedParamSourceTypes}
              derivedParamAddressTypes={derivedParamAddressTypes}
              workflowDerivedUtxos={workflowDerivedUtxos}
              workflowContext={workflowContext}
              onBound={handleParamsBound}
              disabled={!card1Complete}
              prefillValues={pendingPrefill ?? undefined}
              onPrefillConsumed={handleClearPrefill}
            />
          </div>

          {/* Card 3 - Code Generation */}
          <CodeGenerationCard
            document={document}
            boundParams={boundParams}
            workflowContext={workflowContext}
            schemaIndex={activeSchemaIndex}
            onResult={handleExecutionResultForWorkflow}
            disabled={!card2Complete}
          />

          {/* Card 4 - PSBT Output */}
          <PSBTOutputCard
            result={activeExecutionResult}
            schemaName={activeSchemaName ?? (document?.schemas?.[activeSchemaIndex]?.name ?? null)}
            workflowContext={workflowContext}
            onSetTxid={handleSetWorkflowTxid}
            disabled={!card3Complete}
            explorerLinkTemplate="https://blockstream.info/tx/{txid}"
          />
        </div>
      </main>

      <PWAInstallPrompt />

      {/* Footer */}
      <footer className="border-t bg-card mt-auto">
        <div className="container mx-auto px-4 py-6">
          <div className="flex flex-col items-center justify-center gap-4 text-center">
            <div className="flex items-center gap-2 text-sm text-muted-foreground flex-wrap justify-center">
              <FileCode className="h-4 w-4" />
              <a
                href="https://github.com/tsua0002/btsl-standard"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-foreground transition-colors underline underline-offset-4"
              >
                BTSL Specification v1.0
              </a>
              <span className="mx-2">|</span>
              <a
                href="https://delvingbitcoin.org/t/btsl-bitcoin-transaction-schema-language-a-declarative-validation-schema-for-psbt-workflows/2338"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-foreground transition-colors underline underline-offset-4"
              >
                Delving Bitcoin
              </a>
              <span className="mx-2">|</span>
              <span>All operations run client-side — No private keys involved</span>
            </div>

            <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap justify-center">
              <a
                href="https://blockstream.info"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 hover:text-foreground transition-colors"
              >
                Blockstream API <ExternalLink className="h-3 w-3" />
              </a>
              <a
                href="https://mempool.space"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 hover:text-foreground transition-colors"
              >
                Mempool.space API <ExternalLink className="h-3 w-3" />
              </a>
              <a
                href="https://github.com/paulmillr/scure-btc-signer"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 hover:text-foreground transition-colors"
              >
                @scure/btc-signer <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

// Theme Toggle Component
function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return <div className="h-8 w-8" />;
  }

  const icons = {
    light: <Sun className="h-4 w-4" />,
    dark: <Moon className="h-4 w-4" />,
    system: <Monitor className="h-4 w-4" />,
  };

  const next = theme === 'light' ? 'dark' : theme === 'dark' ? 'system' : 'light';
  const label = `Switch to ${next} mode`;

  return (
    <button
      onClick={() => setTheme(next)}
      className="text-muted-foreground hover:text-foreground transition-colors p-1.5 rounded-md hover:bg-muted"
      title={label}
      aria-label={label}
    >
      {icons[(theme as keyof typeof icons) ?? 'system'] ?? icons.system}
    </button>
  );
}

// Pipeline Step Component
function PipelineStep({
  number,
  label,
  active,
  complete,
}: {
  number: number;
  label: string;
  active: boolean;
  complete: boolean;
}) {
  return (
    <div className={`flex items-center gap-2 ${!active && !complete ? 'opacity-50' : ''}`}>
      <div
        className={`
          flex items-center justify-center h-7 w-7 rounded-full text-xs font-bold shrink-0
          ${complete ? 'bg-green-600 text-white' :
            active ? 'bg-primary text-primary-foreground' :
            'bg-muted text-muted-foreground'}
        `}
      >
        {complete ? '✓' : number}
      </div>
      <span className={`text-sm font-medium hidden sm:inline ${active ? 'text-foreground' : 'text-muted-foreground'}`}>
        {label}
      </span>
    </div>
  );
}

// Pipeline Connector
function PipelineConnector({ active }: { active: boolean }) {
  return (
    <div className={`w-6 h-0.5 shrink-0 ${active ? 'bg-green-600' : 'bg-muted'}`} />
  );
}
