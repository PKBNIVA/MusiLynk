import { useEffect, useState } from 'react';
import { apiGet } from './api';

export type PaymentMode = 'live' | 'test' | 'mock' | 'disabled';

let pending: Promise<PaymentMode | null> | null = null;

/** How payments run here, read once per page load. Null until known, and when it cannot be read. */
export function usePaymentMode(): PaymentMode | null {
  const [mode, setMode] = useState<PaymentMode | null>(null);
  useEffect(() => {
    let active = true;
    pending ??= apiGet<{ paymentMode?: PaymentMode }>('/billing/subscription')
      .then((d) => d.paymentMode ?? null)
      .catch(() => {
        pending = null;
        return null;
      });
    void pending.then((value) => active && setMode(value));
    return () => {
      active = false;
    };
  }, []);
  return mode;
}
