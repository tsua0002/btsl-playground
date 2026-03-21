'use client';

import { useMemo, useState, useCallback, useEffect } from 'react';
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
  activeExampleId?: string | null;
  onExampleSelected?: (id: string) => void;
}

export function SchemaInputCard({ onParsed, disabled, activeExampleId, onExampleSelected }: SchemaInputCardProps) {
  const [schema, setSchema] = useState('');
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [mode, setMode] = useState<'examples' | 'custom'>('examples');
  const [selectedExampleId, setSelectedExampleId] = useState<string | null>(activeExampleId ?? EXAMPLES_CATALOG[0]?.id ?? null);
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
      onExampleSelected?.(example.id);

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

  // Sync external activeExampleId into local state and auto-apply
  const [lastAppliedExternalId, setLastAppliedExternalId] = useState<string | null>(null);
  useEffect(() => {
    if (activeExampleId && activeExampleId !== lastAppliedExternalId) {
      const ex = EXAMPLES_CATALOG.find((e) => e.id === activeExampleId);
      if (ex) {
        setLastAppliedExternalId(activeExampleId);
        applyExample(ex);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeExampleId]);

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
