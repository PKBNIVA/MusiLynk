import { apiPost } from './api';

// Opens Razorpay Checkout for a server-created subscription or order and resolves once the
// customer finishes: `success` carries the handler payload (razorpay_* ids + signature) for the
// server to verify; `dismissed` means the modal was closed (optionally after a declined payment).
// Nothing here grants access: subscriptions are activated by signed webhooks, deposits by the
// server's signature + provider check.
//
// When the server marks the checkout `simulator: true` (local RAZORPAY_SIMULATOR only; the API
// never sets it in production) a small stand-in modal replaces checkout.js and asks the dev-only
// simulator endpoint for a realistic, correctly signed handler payload.

export type RazorpayCheckoutConfig = {
  mode: 'razorpay';
  keyId: string;
  subscriptionId?: string;
  orderId?: string;
  amount?: number;
  currency?: string;
  simulator?: boolean;
};

export type CheckoutResult =
  { status: 'success'; response: Record<string, string> } | { status: 'dismissed'; lastError?: string };

type Options = { description: string; amountLabel?: string };

const CHECKOUT_SRC = 'https://checkout.razorpay.com/v1/checkout.js';

/** The checkout.js options this module passes (https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/). */
export type RazorpayOptions = {
  key: string;
  subscription_id?: string;
  order_id?: string;
  amount?: number;
  currency?: string;
  name?: string;
  description: string;
  handler: (response: Record<string, string>) => void;
  modal: { ondismiss: () => void };
  theme?: { color: string };
};

/** The payload checkout.js passes to a `payment.failed` listener. */
export type RazorpayPaymentFailed = { error?: { description?: string } };

/** The slice of checkout.js (window.Razorpay) this module uses. */
interface RazorpayInstance {
  on(event: 'payment.failed', handler: (event: RazorpayPaymentFailed) => void): void;
  open(): void;
}
type RazorpayConstructor = new (options: RazorpayOptions) => RazorpayInstance;
declare global {
  interface Window {
    Razorpay?: RazorpayConstructor;
  }
}

/** POST /dev/razorpay/checkout: a signed handler payload, or the simulated decline. */
type SimulatorResult = { response?: Record<string, string>; error?: { description?: string } };

function loadCheckoutScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.Razorpay) return resolve();
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${CHECKOUT_SRC}"]`);
    const script = existing || document.createElement('script');
    script.addEventListener('load', () => resolve(), { once: true });
    script.addEventListener(
      'error',
      () => reject(new Error('Unable to load Razorpay Checkout. Check your connection and try again.')),
      { once: true },
    );
    if (!existing) {
      script.src = CHECKOUT_SRC;
      document.body.appendChild(script);
    }
  });
}

export async function openRazorpayCheckout(
  checkout: RazorpayCheckoutConfig,
  options: Options,
): Promise<CheckoutResult> {
  if (checkout.simulator) return openSimulatedCheckout(checkout, options);
  await loadCheckoutScript();
  return new Promise<CheckoutResult>((resolve) => {
    let lastError: string | undefined;
    // loadCheckoutScript() resolved, so checkout.js has defined window.Razorpay.
    const rz = new window.Razorpay!({
      key: checkout.keyId,
      ...(checkout.subscriptionId
        ? { subscription_id: checkout.subscriptionId }
        : { order_id: checkout.orderId, amount: checkout.amount, currency: checkout.currency }),
      name: 'MusiLynk',
      description: options.description,
      handler: (response: Record<string, string>) => resolve({ status: 'success', response }),
      modal: { ondismiss: () => resolve({ status: 'dismissed', lastError }) },
      theme: { color: '#7c3aed' },
    });
    // Razorpay keeps the modal open after a decline so the customer can retry.
    rz.on('payment.failed', (event) => {
      lastError = event?.error?.description || 'The payment was declined.';
    });
    rz.open();
  });
}

function openSimulatedCheckout(checkout: RazorpayCheckoutConfig, options: Options): Promise<CheckoutResult> {
  return new Promise<CheckoutResult>((resolve) => {
    const target = checkout.subscriptionId
      ? { subscriptionId: checkout.subscriptionId }
      : { orderId: checkout.orderId };
    const previousFocus = document.activeElement as HTMLElement | null;
    let lastError: string | undefined;
    let busy = false;

    const overlay = document.createElement('div');
    overlay.className = 'fixed inset-0 z-[100] grid place-items-center bg-black/75 p-4';
    overlay.innerHTML = `
      <div role="dialog" aria-modal="true" aria-labelledby="rzp-sim-title" aria-describedby="rzp-sim-desc" data-testid="razorpay-simulator"
        class="w-full max-w-sm rounded-2xl border border-amber-300/40 bg-white p-6 text-slate-900 shadow-2xl">
        <div class="text-xs font-semibold uppercase tracking-wider text-amber-700">Test mode · Razorpay simulator</div>
        <h2 id="rzp-sim-title" class="mt-2 text-xl font-semibold">MusiLynk</h2>
        <p id="rzp-sim-desc" class="mt-1 text-sm text-slate-600"></p>
        <p data-role="amount" class="mt-3 text-2xl font-bold"></p>
        <p data-role="error" role="alert" class="mt-3 hidden rounded-lg bg-rose-50 p-3 text-sm text-rose-700"></p>
        <div class="mt-5 grid gap-2">
          <button type="button" data-outcome="success" class="rounded-lg bg-violet-600 px-4 py-2.5 font-semibold text-white disabled:opacity-60">Pay (simulate success)</button>
          <button type="button" data-outcome="fail" class="rounded-lg border border-rose-300 px-4 py-2.5 font-semibold text-rose-700 disabled:opacity-60">Decline payment</button>
          <button type="button" data-outcome="dismiss" class="rounded-lg px-4 py-2 text-sm text-slate-600 disabled:opacity-60">Close checkout</button>
        </div>
        <p class="mt-4 text-xs text-slate-500">No real money moves. The server signs the response exactly as Razorpay would.</p>
      </div>`;
    overlay.querySelector('#rzp-sim-desc')!.textContent = options.description;
    overlay.querySelector('[data-role="amount"]')!.textContent = options.amountLabel || '';
    const errorBox = overlay.querySelector<HTMLElement>('[data-role="error"]')!;
    const buttons = Array.from(overlay.querySelectorAll<HTMLButtonElement>('button[data-outcome]'));

    const close = (result: CheckoutResult) => {
      document.removeEventListener('keydown', onKey, true);
      overlay.remove();
      previousFocus?.focus?.();
      resolve(result);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) {
        event.stopPropagation();
        close({ status: 'dismissed', lastError });
      }
    };
    const run = async (outcome: string) => {
      if (busy) return;
      if (outcome === 'dismiss') return close({ status: 'dismissed', lastError });
      busy = true;
      buttons.forEach((button) => {
        button.disabled = true;
      });
      try {
        const result = await apiPost<SimulatorResult>('/dev/razorpay/checkout', { ...target, outcome });
        if (result.response) return close({ status: 'success', response: result.response });
        lastError = result.error?.description || 'The payment was declined.';
        errorBox.textContent = `${lastError} You can try again or close checkout.`;
        errorBox.classList.remove('hidden');
      } catch (error) {
        errorBox.textContent = (error instanceof Error && error.message) || 'Simulator request failed.';
        errorBox.classList.remove('hidden');
      } finally {
        busy = false;
        buttons.forEach((button) => {
          button.disabled = false;
        });
      }
    };
    buttons.forEach((button) => button.addEventListener('click', () => run(button.dataset.outcome!)));
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(overlay);
    buttons[0].focus();
  });
}
