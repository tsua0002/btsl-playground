'use client';

import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { SchemaInputCard } from '@/components/btsl/schema-input-card';
import { ParameterBindingCard } from '@/components/btsl/parameter-binding-card';
import { CodeGenerationCard, ExecutionResult } from '@/components/btsl/code-generation-card';
import { PSBTOutputCard } from '@/components/btsl/psbt-output-card';
import { WelcomeBanner } from '@/components/btsl/welcome-banner';
import { QuickExampleCards } from '@/components/btsl/quick-example-cards';
import { PWAInstallPrompt } from '@/components/btsl/pwa-install-prompt';
import { ValidatorCard } from '@/components/btsl/validator-card';
import type { WorkflowContext, WorkflowOutputRef } from '@/lib/btsl/types';
import { BTSLDocument, BTSLParam, BoundParams, ParseResult } from '@/lib/btsl/types';
import type { PubkeyAddressType } from '@/lib/btsl/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import { orderSchemasByDependsOn } from '@/lib/btsl/workflow';
import { Bitcoin, FileCode, Github, ExternalLink, Sun, Moon, Monitor, Check, ChevronDown, Zap } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useFirstVisit } from '@/hooks/use-first-visit';
import type { ExampleDefinition } from '@/lib/btsl/examples-catalog';
import { EXAMPLES_CATALOG } from '@/lib/btsl/examples-catalog';

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
  /** Validator tab: Checker finished successfully */
  const [validatorComplete, setValidatorComplete] = useState(false);
  const [interfaceTab, setInterfaceTab] = useState<'maker' | 'validator'>('maker');
  /** Snapshot from last "Apply to fields" on a `.params` file — Validator Checker prefers these values. */
  const [paramsFileEntries, setParamsFileEntries] = useState<Record<string, string> | null>(null);

  // Active example tracking (for quick example cards highlight)
  const [activeExampleId, setActiveExampleId] = useState<string | null>(null);
  // Pre-fill params from selected example
  const [pendingPrefill, setPendingPrefill] = useState<Record<string, string> | null>(null);

  // Onboarding / first-visit
  const { isFirstVisit, isExperienced, loaded: visitLoaded, markExperienced, incrementSuccessfulRuns } = useFirstVisit();
  const [showWelcome, setShowWelcome] = useState(false);
  const examplesOpenInitialized = useRef(false);
  const [examplesSectionOpen, setExamplesSectionOpen] = useState(true);

  useEffect(() => {
    if (visitLoaded && isFirstVisit && !isExperienced) {
      setShowWelcome(true);
    }
  }, [visitLoaded, isFirstVisit, isExperienced]);

  useEffect(() => {
    if (!visitLoaded || examplesOpenInitialized.current) return;
    examplesOpenInitialized.current = true;
    setExamplesSectionOpen(!isExperienced);
  }, [visitLoaded, isExperienced]);

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
      setValidatorComplete(false);
      setBoundParams(null);
      setParamsFileEntries(null);
    } else {
      setCard1Complete(false);
    }
  }, []);

  const handleParamsBound = useCallback((bound: BoundParams) => {
    setBoundParams(bound);
    setCard2Complete(true);
    setCard3Complete(false);
    setValidatorComplete(false);
  }, []);

  /** `.params` / fee sync changes the form contract — drop stale binding so Maker uses Confirm again. */
  const handleParamsFileEntriesApplied = useCallback((entries: Record<string, string>) => {
    setParamsFileEntries(entries);
    setBoundParams(null);
    setCard2Complete(false);
    setCard3Complete(false);
    setValidatorComplete(false);
    setExecutionResultsBySchema({});
  }, []);

  const handleExecutionResult = useCallback((result: ExecutionResult) => {
    if (result.success) {
      setCard3Complete(true);
      incrementSuccessfulRuns();
      setValidatorComplete(false);
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
      if (inp.utxoRef?.trim()) names.add(inp.utxoRef.replace(/^@/, '').trim());
    }
    for (const out of s.outputs ?? []) {
      if (out.type === 'OP_RETURN' && out.payload?.trim().startsWith('@')) {
        names.add(out.payload.replace(/^@/, '').trim());
      }
    }
    return Array.from(names);
  }, [document, activeSchemaName, params]);

  const payloadParamNames = useMemo(() => {
    if (!document) return [] as string[];
    return Array.from(
      new Set(
        document.schemas.flatMap((s) =>
          (s.outputs ?? [])
            .filter((o) => o.type === 'OP_RETURN' && o.payload?.trim().startsWith('@'))
            .map((o) => o.payload!.replace(/^@/, '').trim())
        )
      )
    );
  }, [document]);

  const schemaBindingParams = useMemo(
    () => params.filter((p) => visibleParamNames.includes(p.name)),
    [params, visibleParamNames]
  );

  const bindingHydrateContext = useMemo(
    () => ({
      payloadParamNames,
      derivedParamSources,
      derivedParamSourceTypes,
      derivedParamAddressTypes,
      workflowDerivedUtxos,
      workflowContext,
    }),
    [
      payloadParamNames,
      derivedParamSources,
      derivedParamSourceTypes,
      derivedParamAddressTypes,
      workflowDerivedUtxos,
      workflowContext,
    ]
  );

  const activeExampleDefinition = useMemo(
    () => (activeExampleId ? EXAMPLES_CATALOG.find((e) => e.id === activeExampleId) ?? null : null),
    [activeExampleId]
  );

  const hasWorkflowDependsOn = useMemo(
    () => Boolean(document?.schemas?.some((s) => Boolean(s.options?.dependsOn))),
    [document]
  );

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
                <h1 className="text-lg font-bold leading-tight sm:text-xl">BTSL Schema Playground</h1>
                <p className="text-xs text-muted-foreground hidden sm:block">
                  Bitcoin Transaction Schema Language — PSBT compiler · Maker builds PSBTs · Validator audits chain + PSBT
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

      <Tabs
        value={interfaceTab}
        onValueChange={(v) => setInterfaceTab(v as 'maker' | 'validator')}
        className="gap-0"
      >
        <div className="border-b bg-muted/30">
          <div className="container mx-auto flex flex-col items-center gap-3 px-4 py-3">
            <TabsList className="grid w-full max-w-lg grid-cols-2">
              <TabsTrigger value="maker">Maker</TabsTrigger>
              <TabsTrigger value="validator">Validator</TabsTrigger>
            </TabsList>
            <p className="text-center text-xs text-muted-foreground max-w-xl">
              {interfaceTab === 'maker'
                ? 'Maker: parse schema → bind PARAMS → generate → export an unsigned PSBT (BIP-174). Sign in your wallet, then broadcast.'
                : 'Validator: same schema + PARAMS as Maker, paste PSBT (base64/hex) → Checker predicates §9.3.1 (shape S-1/S-2, I-1…I-4, O-1/O-2, calc/ASSERT, dust, weight).'}
            </p>
            {interfaceTab === 'validator' && card3Complete && (
              <p className="text-center text-xs text-muted-foreground max-w-md">
                After a successful Maker run, copy the PSBT from the output card and paste it below to validate it against this schema.
                <button
                  type="button"
                  className="ml-1 underline underline-offset-2 hover:text-foreground"
                  onClick={() =>
                    globalThis.document?.getElementById('btsl-validator-card')?.scrollIntoView({
                      behavior: 'smooth',
                      block: 'start',
                    })
                  }
                >
                  Jump to Checker
                </button>
              </p>
            )}
            {interfaceTab === 'maker' ? (
              <div className="flex w-full flex-wrap items-center justify-center gap-2">
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
                  label="Code generation"
                  active={card2Complete && !card3Complete}
                  complete={card3Complete}
                />
                <PipelineConnector active={card3Complete} />
                <PipelineStep
                  number={4}
                  label="PSBT output"
                  active={false}
                  complete={card3Complete}
                />
              </div>
            ) : (
              <div className="flex w-full flex-wrap items-center justify-center gap-2">
                <PipelineStep
                  number={1}
                  label="Schema"
                  active={!card1Complete}
                  complete={card1Complete}
                />
                <PipelineConnector active={card1Complete} />
                <PipelineStep
                  number={2}
                  label=".params binding"
                  active={card1Complete && !card2Complete}
                  complete={card2Complete}
                />
                <PipelineConnector active={card2Complete} />
                <PipelineStep
                  number={3}
                  label="Check PSBT"
                  active={card2Complete && !validatorComplete}
                  complete={validatorComplete}
                  onClick={() =>
                    globalThis.document?.getElementById('btsl-validator-card')?.scrollIntoView({
                      behavior: 'smooth',
                      block: 'start',
                    })
                  }
                />
              </div>
            )}
          </div>
        </div>

        <main className="container mx-auto px-4 py-6">
          <div className="max-w-4xl mx-auto space-y-6">
            {showWelcome && visitLoaded && (
              <WelcomeBanner onDismiss={handleDismissWelcome} />
            )}

            {visitLoaded && (
              <Collapsible open={examplesSectionOpen} onOpenChange={setExamplesSectionOpen}>
                <div className="rounded-xl border bg-card/80 shadow-sm">
                  <CollapsibleTrigger
                    className={cn(
                      'flex w-full items-center justify-between gap-3 rounded-xl px-4 py-3 text-left',
                      'hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
                    )}
                  >
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-3">
                      <span className="flex items-center gap-2 font-semibold text-sm">
                        <Zap className="h-4 w-4 shrink-0 text-primary" />
                        Example schemas
                      </span>
                      <span className="text-xs text-muted-foreground">
                        Curated demos — or use your own BTSL under Card 1
                      </span>
                    </div>
                    <ChevronDown
                      className={cn(
                        'h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200',
                        examplesSectionOpen && 'rotate-180'
                      )}
                    />
                  </CollapsibleTrigger>
                  <CollapsibleContent className="border-t px-4 pb-4 pt-2">
                    <QuickExampleCards
                      onSelectExample={handleSelectQuickExample}
                      activeExampleId={activeExampleId}
                      showSectionHeader={false}
                    />
                  </CollapsibleContent>
                </div>
              </Collapsible>
            )}
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
              params={schemaBindingParams}
              payloadParamNames={payloadParamNames}
              derivedParamSources={derivedParamSources}
              derivedParamSourceTypes={derivedParamSourceTypes}
              derivedParamAddressTypes={derivedParamAddressTypes}
              workflowDerivedUtxos={workflowDerivedUtxos}
              workflowContext={workflowContext}
              onBound={handleParamsBound}
              onParamsFileApplied={handleParamsFileEntriesApplied}
              disabled={!card1Complete}
              prefillValues={pendingPrefill ?? undefined}
              onPrefillConsumed={handleClearPrefill}
              demoParamsTemplate={activeExampleDefinition?.demoParamsTemplate}
            />
          </div>

            <TabsContent value="maker" className="mt-0 space-y-6 data-[state=inactive]:hidden">
              <CodeGenerationCard
                document={document}
                boundParams={boundParams}
                workflowContext={workflowContext}
                schemaIndex={activeSchemaIndex}
                onResult={handleExecutionResultForWorkflow}
                disabled={!card2Complete}
              />
              <PSBTOutputCard
                result={activeExecutionResult}
                schemaName={activeSchemaName ?? (document?.schemas?.[activeSchemaIndex]?.name ?? null)}
                workflowContext={workflowContext}
                onSetTxid={handleSetWorkflowTxid}
                disabled={!card3Complete}
                showWorkflowStep={hasWorkflowDependsOn}
                explorerLinkTemplate="https://blockstream.info/tx/{txid}"
              />
            </TabsContent>

            <TabsContent value="validator" className="mt-0 space-y-6 data-[state=inactive]:hidden">
              <ValidatorCard
                document={document}
                schemaIndex={activeSchemaIndex}
                schemaParams={schemaBindingParams}
                paramsFileEntries={paramsFileEntries}
                bindingHydrate={bindingHydrateContext}
                boundParams={boundParams}
                workflowContext={workflowContext}
                executionResult={activeExecutionResult}
                schemaName={activeSchemaName ?? document?.schemas?.[activeSchemaIndex]?.name ?? null}
                onValidationComplete={setValidatorComplete}
                disabled={!card2Complete}
              />
            </TabsContent>
          </div>
        </main>
      </Tabs>

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

function PipelineStep({
  number,
  label,
  active,
  complete,
  onClick,
}: {
  number: number;
  label: string;
  active: boolean;
  complete: boolean;
  onClick?: () => void;
}) {
  const inner = (
    <>
      <div
        className={`
          flex items-center justify-center h-7 w-7 rounded-full text-xs font-bold shrink-0
          ${complete ? 'bg-green-600 text-white' :
            active ? 'bg-primary text-primary-foreground' :
            'bg-muted text-muted-foreground'}
        `}
      >
        {complete ? <Check className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden /> : number}
      </div>
      <span className={`text-sm font-medium hidden sm:inline ${active ? 'text-foreground' : 'text-muted-foreground'}`}>
        {label}
      </span>
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`flex items-center gap-2 rounded-md px-1 py-0.5 text-left hover:bg-muted/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${!active && !complete ? 'opacity-50' : ''}`}
        title="Scroll to Checker validation"
      >
        {inner}
      </button>
    );
  }

  return (
    <div className={`flex items-center gap-2 ${!active && !complete ? 'opacity-50' : ''}`}>
      {inner}
    </div>
  );
}

// Pipeline Connector
function PipelineConnector({ active }: { active: boolean }) {
  return (
    <div className={`w-6 h-0.5 shrink-0 ${active ? 'bg-green-600' : 'bg-muted'}`} />
  );
}
