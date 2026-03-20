'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Camera, X, AlertTriangle, CheckCircle } from 'lucide-react';

interface QRScannerProps {
  onScan: (data: string) => void;
  label?: string;
  title?: string;
  trigger?: React.ReactNode;
}

export function QRScanner({ onScan, label, title, trigger }: QRScannerProps) {
  const [open, setOpen] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scanned, setScanned] = useState<string | null>(null);
  const scannerRef = useRef<{ stop: () => Promise<void>; clear: () => void } | null>(null);
  const SCANNER_ELEMENT_ID = 'btsl-qr-scanner-container';

  const stopScanner = useCallback(async () => {
    if (scannerRef.current) {
      try {
        await scannerRef.current.stop();
        scannerRef.current.clear();
      } catch {
        // ignore stop errors
      }
      scannerRef.current = null;
    }
    setScanning(false);
  }, []);

  const startScanner = useCallback(async () => {
    setScanning(true);
    setError(null);
    setScanned(null);

    try {
      const { Html5Qrcode } = await import('html5-qrcode');
      const scanner = new Html5Qrcode(SCANNER_ELEMENT_ID);
      scannerRef.current = scanner;

      await scanner.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 240, height: 240 } },
        (decodedText) => {
          setScanned(decodedText);
          stopScanner().then(() => {
            onScan(decodedText);
            setTimeout(() => setOpen(false), 800);
          });
        },
        undefined
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Camera unavailable';
      if (msg.toLowerCase().includes('permission') || msg.toLowerCase().includes('denied')) {
        setError('Camera access denied. Please allow camera permission in your browser settings.');
      } else if (msg.toLowerCase().includes('device')) {
        setError('No camera found on this device.');
      } else {
        setError(msg);
      }
      setScanning(false);
    }
  }, [onScan, stopScanner]);

  useEffect(() => {
    if (open) {
      const timer = setTimeout(startScanner, 100);
      return () => clearTimeout(timer);
    } else {
      stopScanner();
    }
  }, [open, startScanner, stopScanner]);

  useEffect(() => {
    return () => {
      stopScanner();
    };
  }, [stopScanner]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="outline" size="sm">
            <Camera className="mr-2 h-4 w-4" />
            Scan QR
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Camera className="h-4 w-4" />
            {title ?? label ?? 'Scan QR Code'}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {scanned ? (
            <div className="flex flex-col items-center gap-3 py-4">
              <CheckCircle className="h-10 w-10 text-green-600" />
              <p className="text-sm font-medium text-green-700">QR code scanned successfully</p>
              <p className="text-xs font-mono text-muted-foreground text-center break-all max-h-20 overflow-auto">
                {scanned.length > 80 ? scanned.slice(0, 80) + '...' : scanned}
              </p>
            </div>
          ) : (
            <>
              <div
                id={SCANNER_ELEMENT_ID}
                className="w-full rounded-xl overflow-hidden bg-muted min-h-[280px]"
              />

              {error && (
                <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
                  <AlertTriangle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
                  <p className="text-sm text-destructive">{error}</p>
                </div>
              )}

              {scanning && !error && (
                <p className="text-xs text-muted-foreground text-center">
                  Point your camera at a PSBT QR code
                </p>
              )}
            </>
          )}

          {scanning && !scanned && (
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => {
                stopScanner();
                setOpen(false);
              }}
            >
              <X className="mr-2 h-4 w-4" />
              Cancel
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
