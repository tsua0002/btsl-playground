'use client';

import { Badge } from '@/components/ui/badge';
import { ArrowRight, Zap } from 'lucide-react';
import { EXAMPLES_CATALOG } from '@/lib/btsl/examples-catalog';
import type { ExampleDefinition } from '@/lib/btsl/examples-catalog';

interface QuickExampleCardsProps {
  onSelectExample: (example: ExampleDefinition) => void;
  activeExampleId?: string | null;
  /** When false, only the card grid is shown (e.g. collapsible header lives on the parent). Default true. */
  showSectionHeader?: boolean;
}

const CATEGORY_LABELS: Record<string, string> = {
  simple_payment: 'Basics',
  tri_count: 'Multi-party',
  multisig: 'Multisig',
  op_return: 'On-chain Data',
  taproot_vault: 'Advanced',
};

const CATEGORY_COLORS: Record<string, string> = {
  simple_payment: 'bg-blue-100 text-blue-700 border-blue-200',
  tri_count: 'bg-purple-100 text-purple-700 border-purple-200',
  multisig: 'bg-amber-100 text-amber-700 border-amber-200',
  op_return: 'bg-green-100 text-green-700 border-green-200',
  taproot_vault: 'bg-rose-100 text-rose-700 border-rose-200',
};

export function QuickExampleCards({
  onSelectExample,
  activeExampleId,
  showSectionHeader = true,
}: QuickExampleCardsProps) {
  const featured = EXAMPLES_CATALOG.filter((e) =>
    ['simple_payment', 'multisig_2_of_2', 'op_return_deploy', 'brc20_swap_chain', 'taproot_vault', 'tri_count'].includes(e.id)
  );

  return (
    <div className="space-y-4">
      {showSectionHeader ? (
        <div className="flex flex-col gap-1 sm:flex-row sm:flex-wrap sm:items-center sm:gap-2">
          <div className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-primary" />
            <h2 className="text-base font-semibold">Quick Start — Pick an Example</h2>
          </div>
          <span className="text-sm text-muted-foreground">Click any card to load the schema and jump to parameters</span>
        </div>
      ) : null}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {featured.map((example) => {
          const isActive = activeExampleId === example.id;
          const categoryLabel = CATEGORY_LABELS[example.categoryId] ?? example.categoryId;
          const categoryColor = CATEGORY_COLORS[example.categoryId] ?? 'bg-muted text-muted-foreground';

          return (
            <button
              key={example.id}
              onClick={() => onSelectExample(example)}
              className={`
                group text-left rounded-xl border p-4 space-y-3 transition-all duration-150
                hover:shadow-md hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring
                ${isActive
                  ? 'border-primary bg-primary/5 shadow-sm'
                  : 'border-border bg-card hover:border-primary/40'
                }
              `}
            >
              <div className="flex items-start justify-between gap-2">
                <span className="text-2xl leading-none">{example.icon}</span>
                <Badge
                  variant="outline"
                  className={`text-xs font-medium shrink-0 ${categoryColor}`}
                >
                  {categoryLabel}
                </Badge>
              </div>

              <div className="space-y-1">
                <div className="font-semibold text-sm leading-tight">{example.title}</div>
                <div className="text-xs text-muted-foreground leading-relaxed line-clamp-2">
                  {example.description}
                </div>
              </div>

              <div className="flex items-center justify-between">
                <div className="text-xs text-muted-foreground/70 italic truncate pr-2">
                  {example.useCase}
                </div>
                <ArrowRight
                  className={`h-3.5 w-3.5 shrink-0 transition-transform group-hover:translate-x-0.5 ${
                    isActive ? 'text-primary' : 'text-muted-foreground'
                  }`}
                />
              </div>

              {isActive && (
                <div className="text-xs font-medium text-primary flex items-center gap-1">
                  <div className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
                  Active
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
