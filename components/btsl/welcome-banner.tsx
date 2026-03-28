'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { X, Bitcoin, QrCode, Shield, Zap, BookOpen } from 'lucide-react';

interface WelcomeBannerProps {
  onDismiss: () => void;
}

const FEATURES = [
  {
    icon: <Bitcoin className="h-4 w-4 text-orange-500" />,
    title: 'Declarative Bitcoin Transactions',
    description: 'Define PSBTs using BTSL — a human-readable schema language. No raw bytes, no scripting.',
  },
  {
    icon: <Zap className="h-4 w-4 text-yellow-500" />,
    title: '4-Step Maker pipeline',
    description:
      '1) Schema 2) PARAMS 3) Generate code 4) Export an unsigned PSBT. Optional: Validator tab replays calc and ASSERT on a pasted PSBT.',
  },
  {
    icon: <QrCode className="h-4 w-4 text-blue-500" />,
    title: 'Air-Gap Compatible',
    description: 'Export PSBTs as QR codes for SeedSigner, Coldcard, and other offline signing devices.',
  },
  {
    icon: <Shield className="h-4 w-4 text-green-500" />,
    title: '100% Client-Side',
    description: 'All operations run in your browser. No private keys are ever transmitted or stored.',
  },
];

export function WelcomeBanner({ onDismiss }: WelcomeBannerProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-xl border bg-gradient-to-br from-card to-muted/30 p-5 space-y-5 relative shadow-sm">
      <button
        onClick={onDismiss}
        className="absolute top-3 right-3 text-muted-foreground hover:text-foreground transition-colors rounded-md p-1 hover:bg-muted"
        aria-label="Dismiss welcome banner"
      >
        <X className="h-4 w-4" />
      </button>

      <div className="space-y-2 pr-6">
        <div className="flex items-center gap-2 flex-wrap">
          <h1 className="text-xl font-bold">
            Build Bitcoin Transactions Without Code
          </h1>
          <Badge variant="outline" className="text-xs">
            First-time here?
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground leading-relaxed max-w-2xl">
          BTSL Schema Playground compiles schemas into <strong>unsigned PSBTs</strong> (BIP-174). Pick an example,
          load the demo <strong>PARAMS</strong> fixture, confirm, then generate — you get base64/hex and QR for cold signing.
          Sign in your wallet or hardware device, broadcast when ready. Use the <strong>Validator</strong> tab with the same
          schema and PARAMS to audit a pasted PSBT against the chain.
        </p>

        <ol className="list-decimal pl-5 text-sm text-muted-foreground space-y-1 max-w-2xl">
          <li>Choose an example schema (or paste your own BTSL).</li>
          <li>Load demo PARAMS or your <span className="font-mono text-xs">.params</span> file, then Confirm.</li>
          <li>Run code generation and copy or scan the PSBT export.</li>
          <li>Optional: open Validator and paste the PSBT to replay checks.</li>
        </ol>
      </div>

      {expanded && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
          {FEATURES.map((feature) => (
            <div
              key={feature.title}
              className="flex gap-3 rounded-lg border bg-background/60 p-3"
            >
              <div className="mt-0.5 shrink-0">{feature.icon}</div>
              <div className="space-y-0.5">
                <div className="text-sm font-medium">{feature.title}</div>
                <div className="text-xs text-muted-foreground leading-relaxed">
                  {feature.description}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-3 flex-wrap">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setExpanded((v) => !v)}
          className="text-xs text-muted-foreground"
        >
          <BookOpen className="mr-1.5 h-3.5 w-3.5" />
          {expanded ? 'Show less' : 'How it works'}
        </Button>
        <Button variant="ghost" size="sm" onClick={onDismiss} className="text-xs text-muted-foreground ml-auto">
          I know what I am doing — skip intro
        </Button>
      </div>
    </div>
  );
}
