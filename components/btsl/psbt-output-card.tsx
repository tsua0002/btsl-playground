'use client';

import { useState, useCallback, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { 
  FileOutput, 
  Copy, 
  CheckCircle, 
  AlertTriangle, 
  ArrowRightLeft,
  Info,
  Lock,
  Unlock
} from 'lucide-react';
import type { ExecutionResult } from './code-generation-card';
import type { WorkflowContext } from '@/lib/btsl/types';

interface PSBTOutputCardProps {
  result: ExecutionResult | null;
  schemaName?: string | null;
  workflowContext?: WorkflowContext;
  onSetTxid?: (schemaName: string, txid: string) => void;
  disabled?: boolean;
}

export function PSBTOutputCard({ result, schemaName, workflowContext, onSetTxid, disabled }: PSBTOutputCardProps) {
  const [copiedBase64, setCopiedBase64] = useState(false);
  const [copiedHex, setCopiedHex] = useState(false);
  const [txidDraft, setTxidDraft] = useState('');

  useEffect(() => {
    if (!schemaName) return;
    const existing = workflowContext?.steps?.[schemaName]?.txid ?? '';
    setTxidDraft(existing);
  }, [schemaName, workflowContext?.steps]);

  const handleCopyBase64 = useCallback(async () => {
    if (!result?.psbtBase64) return;
    try {
      await navigator.clipboard.writeText(result.psbtBase64);
      setCopiedBase64(true);
      setTimeout(() => setCopiedBase64(false), 2000);
    } catch (error) {
      console.error('Failed to copy:', error);
    }
  }, [result?.psbtBase64]);

  const handleCopyHex = useCallback(async () => {
    if (!result?.psbtHex) return;
    try {
      await navigator.clipboard.writeText(result.psbtHex);
      setCopiedHex(true);
      setTimeout(() => setCopiedHex(false), 2000);
    } catch (error) {
      console.error('Failed to copy:', error);
    }
  }, [result?.psbtHex]);

  if (disabled || !result?.success) {
    return (
      <Card className="opacity-50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileOutput className="h-5 w-5" />
            Card 4 - PSBT Output
          </CardTitle>
          <CardDescription>
            View and export the generated PSBT
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Waiting for Execution</AlertTitle>
            <AlertDescription>
              Run the generated code successfully to view the PSBT output.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  const { psbtBase64, psbtHex, summary } = result;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <FileOutput className="h-5 w-5" />
              Card 4 - PSBT Output
            </CardTitle>
            <CardDescription>
              View and export the generated PSBT
            </CardDescription>
          </div>
          <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">
            <Lock className="mr-1 h-3 w-3" />
            UNSIGNED
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Status Banner */}
        <Alert className="border-blue-200 bg-blue-50">
          <Info className="h-4 w-4 text-blue-600" />
          <AlertTitle className="text-blue-800">Ready for Signing</AlertTitle>
          <AlertDescription className="text-blue-700">
            This PSBT is unsigned and ready to be imported into a signing device.
            <br />
            <span className="text-sm">
              Compatible with: Sparrow Wallet, Coldcard, Ledger, bitcoin-cli analyzepsbt
            </span>
          </AlertDescription>
        </Alert>

        {schemaName && (
          <div className="rounded-lg border p-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-medium">Workflow step</div>
                <div className="text-xs text-muted-foreground font-mono">{schemaName}</div>
              </div>
              <Badge variant="outline">
                {workflowContext?.steps?.[schemaName]?.txid ? (
                  <>
                    <Unlock className="mr-1 h-3 w-3" />
                    Txid set
                  </>
                ) : (
                  <>
                    <Lock className="mr-1 h-3 w-3" />
                    Locked for children
                  </>
                )}
              </Badge>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="workflow-txid" className="text-xs">
                Broadcast txid (after signing)
              </Label>
              <div className="flex gap-2">
                <Input
                  id="workflow-txid"
                  placeholder="64-hex txid"
                  value={txidDraft}
                  onChange={(e) => setTxidDraft(e.target.value)}
                  className="font-mono text-sm"
                />
                <Button
                  variant="outline"
                  onClick={() => onSetTxid?.(schemaName, txidDraft)}
                  disabled={!onSetTxid}
                >
                  Save
                </Button>
              </div>
              <div className="text-xs text-muted-foreground">
                Child schemas with <span className="font-mono">DEPENDS_ON</span> will unlock once the parent txid is saved.
              </div>
            </div>
          </div>
        )}

        {/* PSBT Formats */}
        <Tabs defaultValue="base64">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="base64">Base64</TabsTrigger>
            <TabsTrigger value="hex">Hex</TabsTrigger>
          </TabsList>
          
          <TabsContent value="base64" className="space-y-2">
            <div className="relative">
              <div className="rounded-lg border bg-muted/30 p-4">
                <pre className="text-xs font-mono break-all whitespace-pre-wrap max-h-[150px] overflow-auto">
                  {psbtBase64}
                </pre>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="absolute right-2 top-2"
                onClick={handleCopyBase64}
              >
                {copiedBase64 ? (
                  <CheckCircle className="h-4 w-4 text-green-600" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
            </div>
            <Button onClick={handleCopyBase64} variant="outline" className="w-full">
              <Copy className="mr-2 h-4 w-4" />
              Copy PSBT Base64
            </Button>
          </TabsContent>
          
          <TabsContent value="hex" className="space-y-2">
            <div className="relative">
              <div className="rounded-lg border bg-muted/30 p-4">
                <pre className="text-xs font-mono break-all whitespace-pre-wrap max-h-[150px] overflow-auto">
                  {psbtHex}
                </pre>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="absolute right-2 top-2"
                onClick={handleCopyHex}
              >
                {copiedHex ? (
                  <CheckCircle className="h-4 w-4 text-green-600" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
            </div>
            <Button onClick={handleCopyHex} variant="outline" className="w-full">
              <Copy className="mr-2 h-4 w-4" />
              Copy PSBT Hex
            </Button>
          </TabsContent>
        </Tabs>

        {/* How to sign */}
        <div className="rounded-lg border bg-muted/30 p-4">
          <div className="text-sm font-medium mb-2">How to sign this PSBT</div>
          <Accordion type="single" collapsible>
            <AccordionItem value="sparrow">
              <AccordionTrigger>Sparrow Wallet (desktop)</AccordionTrigger>
              <AccordionContent>
                <ol className="list-decimal ml-4 space-y-1 text-sm">
                  <li>Copy the PSBT Base64 from this page.</li>
                  <li>In Sparrow: <span className="font-mono">File → Import PSBT</span> (or paste into the PSBT import dialog).</li>
                  <li>Review inputs/outputs and fee rate, then click <span className="font-mono">Sign</span>.</li>
                  <li>Export the signed PSBT or broadcast.</li>
                </ol>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="bitcoin_core">
              <AccordionTrigger>bitcoin-cli / Bitcoin Core (RPC)</AccordionTrigger>
              <AccordionContent>
                <ol className="list-decimal ml-4 space-y-1 text-sm">
                  <li>Copy the PSBT Base64 from this page.</li>
                  <li>Inspect: <span className="font-mono">bitcoin-cli analyzepsbt \"&lt;base64&gt;\"</span></li>
                  <li>Sign: <span className="font-mono">bitcoin-cli walletprocesspsbt \"&lt;base64&gt;\"</span></li>
                  <li>Finalize: <span className="font-mono">bitcoin-cli finalizepsbt \"&lt;signed_base64&gt;\"</span></li>
                  <li>Broadcast the resulting raw transaction hex.</li>
                </ol>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="hardware">
              <AccordionTrigger>Coldcard / hardware wallets</AccordionTrigger>
              <AccordionContent>
                <ol className="list-decimal ml-4 space-y-1 text-sm">
                  <li>Copy the PSBT Base64 (or Hex) and load it into your coordinator (Sparrow/Specter/etc.).</li>
                  <li>Export to the hardware device (QR / file / USB depending on device).</li>
                  <li>Verify outputs and fee rate on-device, then sign.</li>
                  <li>Import the signed PSBT back into the coordinator and broadcast.</li>
                </ol>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="web_signers">
              <AccordionTrigger>Browser wallets (via LaserEyes demo)</AccordionTrigger>
              <AccordionContent>
                <ol className="list-decimal ml-4 space-y-1 text-sm">
                  <li>Open <span className="font-mono">demo.lasereyes.build</span>.</li>
                  <li>Connect your browser wallet (Unisat / Xverse / Wizz / etc.).</li>
                  <li>Paste the PSBT Hex into <span className="font-mono">Unsigned PSBT</span>.</li>
                  <li>Sign, then copy the resulting <span className="font-mono">Signed PSBT</span> (or final tx) and broadcast.</li>
                </ol>
                <div className="text-xs text-muted-foreground mt-2">
                  Note: many browser wallets do not expose a native “sign PSBT” UI directly; LaserEyes acts as the signing UI layer.
                  Always verify outputs and fees before signing. Use at your own risk for anything beyond demos.
                </div>
              </AccordionContent>
            </AccordionItem>

          </Accordion>
          <div className="text-xs text-muted-foreground mt-2">
            Always verify outputs and fee rate in your signing wallet before signing.
          </div>
        </div>

        {/* Human-readable Summary */}
        {summary && (
          <div className="rounded-lg border bg-muted/20 p-4 space-y-4">
            <h4 className="font-semibold flex items-center gap-2">
              <ArrowRightLeft className="h-4 w-4" />
              Transaction Summary
            </h4>
            
            {/* Inputs */}
            <div>
              <h5 className="text-sm font-medium text-muted-foreground mb-2">
                Inputs ({summary.inputs.length})
              </h5>
              <div className="space-y-1">
                {summary.inputs.map((input, idx) => (
                  <div key={idx} className="flex justify-between text-sm font-mono bg-background rounded px-3 py-2">
                    <span className="text-muted-foreground">Input {input.index}</span>
                    <span className="font-semibold">{parseInt(input.value).toLocaleString()} sats</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Outputs */}
            <div>
              <h5 className="text-sm font-medium text-muted-foreground mb-2">
                Outputs ({summary.outputs.length})
              </h5>
              <div className="space-y-1">
                {summary.outputs.map((output, idx) => (
                  <div key={idx} className="flex justify-between text-sm font-mono bg-background rounded px-3 py-2">
                    <span className="text-muted-foreground">Output {output.index}</span>
                    <span className="font-semibold">
                      {output.value === '0' ? 'OP_RETURN' : `${parseInt(output.value).toLocaleString()} sats`}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Fees & vSize */}
            <div className="grid grid-cols-2 gap-4 pt-2 border-t">
              <div className="text-center">
                <p className="text-sm text-muted-foreground">Fees</p>
                <p className="text-lg font-semibold font-mono">{parseInt(summary.fees).toLocaleString()} sats</p>
              </div>
              <div className="text-center">
                <p className="text-sm text-muted-foreground">vSize</p>
                <p className="text-lg font-semibold font-mono">{summary.vsize} vB</p>
              </div>
            </div>

            {/* Fee Rate */}
            <div className="text-center pt-2 border-t">
              <p className="text-sm text-muted-foreground">Effective Fee Rate</p>
              <p className="text-lg font-semibold font-mono">
                {(parseInt(summary.fees) / summary.vsize).toFixed(2)} sat/vB
              </p>
            </div>
          </div>
        )}

        {/* Finalization Section */}
        <div className="rounded-lg border p-4 space-y-3 opacity-60">
          <h4 className="font-semibold flex items-center gap-2">
            <Unlock className="h-4 w-4" />
            Finalization
            <Badge variant="outline" className="text-xs ml-2">Coming with Validator</Badge>
          </h4>
          <p className="text-sm text-muted-foreground">
            PSBT finalization and independent verification (Validator pipeline) will be available in a future update.
            For now, sign this PSBT with your wallet and broadcast via your preferred tool.
          </p>
        </div>

        {/* Export Hint */}
        <Alert>
          <Info className="h-4 w-4" />
          <AlertTitle>Next Steps</AlertTitle>
          <AlertDescription>
            <ol className="list-decimal list-inside mt-2 space-y-1 text-sm">
              <li>Copy the PSBT Base64 above</li>
              <li>Import into your signing device (Sparrow, Coldcard, etc.)</li>
              <li>Review the transaction details carefully</li>
              <li>Sign with your hardware wallet or software signer</li>
              <li>Broadcast the signed transaction</li>
            </ol>
          </AlertDescription>
        </Alert>
      </CardContent>
    </Card>
  );
}
