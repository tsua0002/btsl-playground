'use client';

import { useMemo, useState, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Upload, CheckCircle, XCircle, AlertTriangle, FileCode } from 'lucide-react';
import { parseBTSL } from '@/lib/btsl/parser';
import { BTSLParam, BTSLError, BTSLWarning, ParseResult, ERROR_CODES, WARNING_CODES } from '@/lib/btsl/types';
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from '@/components/ui/accordion';
import type { ExampleDefinition, ExampleCategoryId } from '@/lib/btsl/examples-catalog';
import { EXAMPLES_CATALOG, EXAMPLES_CATALOG_BY_CATEGORY } from '@/lib/btsl/examples-catalog';

interface SchemaInputCardProps {
  onParsed: (result: ParseResult) => void;
  disabled?: boolean;
}

export function SchemaInputCard({ onParsed, disabled }: SchemaInputCardProps) {
  const [schema, setSchema] = useState('');
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [mode, setMode] = useState<'examples' | 'custom'>('examples');
  const [selectedExampleId, setSelectedExampleId] = useState<string | null>(EXAMPLES_CATALOG[0]?.id ?? null);
  const [openCategoryId, setOpenCategoryId] = useState<ExampleCategoryId | undefined>('simple_payment');

  const selectedExample: ExampleDefinition | null = useMemo(() => {
    if (!selectedExampleId) return null;
    return EXAMPLES_CATALOG.find((e) => e.id === selectedExampleId) ?? null;
  }, [selectedExampleId]);

  const setCustomMode = useCallback(() => {
    setMode('custom');
    setOpenCategoryId(undefined);
  }, []);

  const handleParse = useCallback(() => {
    if (!schema.trim()) return;
    
    setIsParsing(true);
    
    // Small delay to show loading state
    setTimeout(() => {
      try {
        const result = parseBTSL(schema);
        setParseResult(result);
        
        if (result.success) {
          onParsed(result);
        }
      } catch (error) {
        const errorResult: ParseResult = {
          success: false,
          errors: [{
            code: 'BTSL_ERR_00',
            message: error instanceof Error ? error.message : 'Unknown parsing error'
          }],
          warnings: []
        };
        setParseResult(errorResult);
      }
      setIsParsing(false);
    }, 100);
  }, [schema, onParsed]);

  const applyExample = useCallback(
    async (example: ExampleDefinition) => {
      if (disabled) return;

      setMode('examples');
      setSelectedExampleId(example.id);
      setOpenCategoryId(example.categoryId);
      setSchema(example.btsl);
      setParseResult(null);

      setIsParsing(true);
      setTimeout(() => {
        try {
          const result = parseBTSL(example.btsl);
          setParseResult(result);
          if (result.success) {
            onParsed(result);

            requestAnimationFrame(() => {
              document.getElementById('card-parameter-binding')?.scrollIntoView({
                behavior: 'smooth',
                block: 'start',
              });
            });
          }
        } catch (error) {
          const errorResult: ParseResult = {
            success: false,
            errors: [
              {
                code: 'BTSL_ERR_00',
                message: error instanceof Error ? error.message : 'Unknown parsing error',
              },
            ],
            warnings: [],
          };
          setParseResult(errorResult);
        } finally {
          setIsParsing(false);
        }
      }, 80);
    },
    [disabled, onParsed]
  );

  const handleFileUpload = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      setSchema(content);
      setParseResult(null);
    };
    reader.readAsText(file);
  }, []);

  return (
    <Card className={disabled ? 'opacity-50' : ''}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <FileCode className="h-5 w-5" />
              Card 1 - Schema Input
            </CardTitle>
            <CardDescription>
              Paste your BTSL Schema (.bts) or upload a file
            </CardDescription>
          </div>
          {parseResult && (
            parseResult.success ? (
              <Badge variant="default" className="bg-green-600 hover:bg-green-700">
                <CheckCircle className="mr-1 h-3 w-3" />
                Schema Valid
              </Badge>
            ) : (
              <Badge variant="destructive">
                <XCircle className="mr-1 h-3 w-3" />
                {parseResult.errors[0]?.code || 'Error'}
              </Badge>
            )
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          <label className="flex-1">
            <input
              type="file"
              accept=".bts,.txt"
              onChange={handleFileUpload}
              className="hidden"
              disabled={disabled}
            />
            <Button variant="outline" className="w-full" asChild disabled={disabled}>
              <span className="cursor-pointer">
                <Upload className="mr-2 h-4 w-4" />
                Upload .bts File
              </span>
            </Button>
          </label>
        </div>

        {/* Examples / guided presets */}
        <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-medium">Examples</div>
              <div className="text-xs text-muted-foreground">
                Pick one to auto-fill and auto-parse. Editing the textarea switches to Custom mode.
              </div>
            </div>
            {mode === 'custom' && (
              <Button variant="secondary" size="sm" onClick={() => setOpenCategoryId('simple_payment')}>
                Show examples
              </Button>
            )}
          </div>

          <div className="space-y-3">
            <Accordion
              type="single"
              collapsible
              value={openCategoryId}
              onValueChange={(v) => setOpenCategoryId(v as ExampleCategoryId)}
            >
                <AccordionItem value="simple_payment">
                  <AccordionTrigger>Simple Payment</AccordionTrigger>
                  <AccordionContent>
                    {EXAMPLES_CATALOG_BY_CATEGORY.simple_payment.map((ex) => (
                      <Button
                        key={ex.id}
                        variant={ex.id === selectedExampleId ? 'default' : 'outline'}
                        className="w-full justify-start mb-2"
                        onClick={() => applyExample(ex)}
                        disabled={disabled}
                      >
                        <div className="text-left">
                          <div className="font-medium">{ex.title}</div>
                          <div className="text-xs text-muted-foreground">{ex.subtitle}</div>
                        </div>
                      </Button>
                    ))}
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="tri_count">
                  <AccordionTrigger>Multi-input TRI-COUNT</AccordionTrigger>
                  <AccordionContent>
                    {EXAMPLES_CATALOG_BY_CATEGORY.tri_count.map((ex) => (
                      <Button
                        key={ex.id}
                        variant={ex.id === selectedExampleId ? 'default' : 'outline'}
                        className="w-full justify-start mb-2"
                        onClick={() => applyExample(ex)}
                        disabled={disabled}
                      >
                        <div className="text-left">
                          <div className="font-medium">{ex.title}</div>
                          <div className="text-xs text-muted-foreground">{ex.subtitle}</div>
                        </div>
                      </Button>
                    ))}
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="multisig">
                  <AccordionTrigger>Multisig</AccordionTrigger>
                  <AccordionContent>
                    {EXAMPLES_CATALOG_BY_CATEGORY.multisig.map((ex) => (
                      <Button
                        key={ex.id}
                        variant={ex.id === selectedExampleId ? 'default' : 'outline'}
                        className="w-full justify-start mb-2"
                        onClick={() => applyExample(ex)}
                        disabled={disabled}
                      >
                        <div className="text-left">
                          <div className="font-medium">{ex.title}</div>
                          <div className="text-xs text-muted-foreground">{ex.subtitle}</div>
                        </div>
                      </Button>
                    ))}
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="op_return">
                  <AccordionTrigger>OP_RETURN deploy</AccordionTrigger>
                  <AccordionContent>
                    {EXAMPLES_CATALOG_BY_CATEGORY.op_return.map((ex) => (
                      <Button
                        key={ex.id}
                        variant={ex.id === selectedExampleId ? 'default' : 'outline'}
                        className="w-full justify-start mb-2"
                        onClick={() => applyExample(ex)}
                        disabled={disabled}
                      >
                        <div className="text-left">
                          <div className="font-medium">{ex.title}</div>
                          <div className="text-xs text-muted-foreground">{ex.subtitle}</div>
                        </div>
                      </Button>
                    ))}
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="taproot_vault">
                  <AccordionTrigger>Taproot Vault (workflow)</AccordionTrigger>
                  <AccordionContent>
                    {EXAMPLES_CATALOG_BY_CATEGORY.taproot_vault.map((ex) => (
                      <Button
                        key={ex.id}
                        variant={ex.id === selectedExampleId ? 'default' : 'outline'}
                        className="w-full justify-start mb-2"
                        onClick={() => applyExample(ex)}
                        disabled={disabled}
                      >
                        <div className="text-left">
                          <div className="font-medium">{ex.title}</div>
                          <div className="text-xs text-muted-foreground">{ex.subtitle}</div>
                        </div>
                      </Button>
                    ))}
                  </AccordionContent>
                </AccordionItem>
              </Accordion>

            {mode === 'examples' && selectedExample && (
              <div className="rounded-lg border bg-background/60 p-3 space-y-2">
                <div className="text-sm font-medium">Quick tutorial</div>
                <div className="text-xs text-muted-foreground">{selectedExample.subtitle}</div>
                <ol className="list-decimal ml-4 text-sm space-y-1">
                  {selectedExample.quickTutorial.steps.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ol>
                <div className="text-xs text-muted-foreground">
                  Required params:{' '}
                  <span className="font-mono">
                    {selectedExample.quickTutorial.requiredParams.join(', ')}
                  </span>
                </div>
              </div>
            )}

            {mode === 'custom' && (
              <div className="text-xs text-muted-foreground">
                Custom mode: tutorials are hidden to avoid mismatch. Use “Show examples” if you want to restart from a preset.
              </div>
            )}
          </div>
        </div>

        <Textarea
          placeholder="Paste your BTSL schema here..."
          value={schema}
          onChange={(e) => {
            setSchema(e.target.value);
            setParseResult(null);
            setCustomMode();
          }}
          className="min-h-[300px] font-mono text-sm"
          disabled={disabled}
        />

        <Button 
          onClick={handleParse} 
          className="w-full"
          disabled={!schema.trim() || isParsing || disabled}
        >
          {isParsing ? 'Parsing...' : 'Parse Schema'}
        </Button>

        {/* Errors */}
        {parseResult && !parseResult.success && parseResult.errors.length > 0 && (
          <div className="space-y-2">
            {parseResult.errors.map((error, idx) => (
              <Alert key={idx} variant="destructive">
                <XCircle className="h-4 w-4" />
                <AlertTitle>{error.code}</AlertTitle>
                <AlertDescription>
                  {ERROR_CODES[error.code] || error.message}
                  {error.line && <span className="ml-2 text-xs">(line {error.line})</span>}
                </AlertDescription>
              </Alert>
            ))}
          </div>
        )}

        {/* Warnings */}
        {parseResult && parseResult.warnings.length > 0 && (
          <div className="space-y-2">
            {parseResult.warnings.map((warning, idx) => (
              <Alert key={idx} className="border-yellow-500 bg-yellow-50">
                <AlertTriangle className="h-4 w-4 text-yellow-600" />
                <AlertTitle className="text-yellow-800">{warning.code}</AlertTitle>
                <AlertDescription className="text-yellow-700">
                  {WARNING_CODES[warning.code] || warning.message}
                  {warning.line && <span className="ml-2 text-xs">(line {warning.line})</span>}
                </AlertDescription>
              </Alert>
            ))}
          </div>
        )}

        {/* Detected Parameters Preview */}
        {parseResult?.success && parseResult.params && parseResult.params.length > 0 && (
          <div className="rounded-lg border bg-muted/50 p-4">
            <h4 className="mb-3 font-medium">Detected Parameters ({parseResult.params.length})</h4>
            <div className="flex flex-wrap gap-2">
              {parseResult.params.map((param) => (
                <Badge key={param.name} variant="secondary" className="font-mono">
                  @{param.name}
                  <span className="ml-1 text-xs text-muted-foreground">
                    :{param.type}
                  </span>
                </Badge>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
