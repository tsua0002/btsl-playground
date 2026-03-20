'use client';

import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { QrCode, Download, AlertTriangle } from 'lucide-react';

interface QRCodeDisplayProps {
  data: string;
  label?: string;
  size?: number;
  className?: string;
}

export function QRCodeDisplay({ data, label, size = 240, className }: QRCodeDisplayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!canvasRef.current || !data) return;
    setError(null);

    QRCode.toCanvas(
      canvasRef.current,
      data,
      {
        width: size,
        margin: 2,
        errorCorrectionLevel: 'H',
        color: { dark: '#000000', light: '#ffffff' },
      },
      (err) => {
        if (err) {
          setError('Data is too large for a single QR code. Use the Copy button instead.');
        }
      }
    );
  }, [data, size]);

  const handleDownload = () => {
    if (!canvasRef.current) return;
    const url = canvasRef.current.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url;
    a.download = `psbt-qr-${Date.now()}.png`;
    a.click();
  };

  if (error) {
    return (
      <div className={`flex flex-col items-center gap-2 p-4 rounded-lg border bg-muted/30 ${className ?? ''}`}>
        <AlertTriangle className="h-6 w-6 text-amber-500" />
        <p className="text-sm text-muted-foreground text-center">{error}</p>
      </div>
    );
  }

  return (
    <div className={`flex flex-col items-center gap-3 ${className ?? ''}`}>
      {label && <p className="text-sm text-muted-foreground">{label}</p>}
      <div className="rounded-xl border-2 border-border bg-white p-3 shadow-sm">
        <canvas ref={canvasRef} className="rounded-md block" />
      </div>
      <Button variant="outline" size="sm" onClick={handleDownload}>
        <Download className="mr-2 h-4 w-4" />
        Save as PNG
      </Button>
    </div>
  );
}

interface QRCodeModalProps {
  data: string;
  label?: string;
  title?: string;
  trigger?: React.ReactNode;
}

export function QRCodeModal({ data, label, title, trigger }: QRCodeModalProps) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="outline" size="sm">
            <QrCode className="mr-2 h-4 w-4" />
            Show QR
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <QrCode className="h-4 w-4" />
            {title ?? 'QR Code'}
          </DialogTitle>
        </DialogHeader>
        <div className="flex flex-col items-center py-4 gap-4">
          <QRCodeDisplay data={data} label={label} size={260} />
          <p className="text-xs text-muted-foreground text-center px-2">
            Scan with SeedSigner, Coldcard, or any PSBT-compatible air-gap signing device.
            For large PSBTs, use the Copy button and transfer via SD card or USB instead.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
