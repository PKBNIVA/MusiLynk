import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flush } from './helpers';

const { apiPost } = vi.hoisted(() => ({ apiPost: vi.fn() }));
vi.mock('../api', () => ({ apiPost }));

import {
  openRazorpayCheckout,
  type RazorpayCheckoutConfig,
  type RazorpayOptions,
  type RazorpayPaymentFailed,
} from '../razorpayCheckout';

const CHECKOUT_SRC = 'https://checkout.razorpay.com/v1/checkout.js';

class FakeRazorpay {
  static last: FakeRazorpay;
  handlers: Record<string, (event: RazorpayPaymentFailed) => void> = {};
  opened = false;
  constructor(public options: RazorpayOptions) {
    FakeRazorpay.last = this;
  }
  on(name: string, handler: (event: RazorpayPaymentFailed) => void) {
    this.handlers[name] = handler;
  }
  open() {
    this.opened = true;
  }
}

const subscription: RazorpayCheckoutConfig = { mode: 'razorpay', keyId: 'rzp_test_1', subscriptionId: 'sub_1' };
const order: RazorpayCheckoutConfig = {
  mode: 'razorpay',
  keyId: 'rzp_test_1',
  orderId: 'order_1',
  amount: 50_000,
  currency: 'INR',
};

beforeEach(() => {
  apiPost.mockReset();
  document.body.innerHTML = '';
  delete window.Razorpay;
});

afterEach(() => {
  delete window.Razorpay;
});

describe('openRazorpayCheckout with Razorpay', () => {
  it('loads checkout.js once, opens a subscription checkout and resolves on success', async () => {
    const result = openRazorpayCheckout(subscription, { description: 'Pro plan' });
    const script = document.querySelector<HTMLScriptElement>(`script[src="${CHECKOUT_SRC}"]`)!;
    expect(script).not.toBeNull();
    window.Razorpay = FakeRazorpay;
    script.dispatchEvent(new Event('load'));
    await flush();

    const rz = FakeRazorpay.last;
    expect(rz.opened).toBe(true);
    expect(rz.options).toMatchObject({
      key: 'rzp_test_1',
      subscription_id: 'sub_1',
      description: 'Pro plan',
      name: 'MusiLynk',
    });
    expect(rz.options.order_id).toBeUndefined();
    rz.options.handler({ razorpay_payment_id: 'pay_1', razorpay_signature: 'sig' });

    await expect(result).resolves.toEqual({
      status: 'success',
      response: { razorpay_payment_id: 'pay_1', razorpay_signature: 'sig' },
    });
  });

  it('reuses an already-loaded SDK for an order and reports the last decline on dismiss', async () => {
    window.Razorpay = FakeRazorpay;
    const result = openRazorpayCheckout(order, { description: 'Booking deposit' });
    await flush();

    const rz = FakeRazorpay.last;
    expect(rz.options).toMatchObject({ order_id: 'order_1', amount: 50_000, currency: 'INR' });
    rz.handlers['payment.failed']({ error: { description: 'Card declined by bank' } });
    rz.handlers['payment.failed']({});
    rz.options.modal.ondismiss();

    await expect(result).resolves.toEqual({ status: 'dismissed', lastError: 'The payment was declined.' });
    expect(document.querySelector('script')).toBeNull();
  });

  it('waits on a script tag another checkout already added', async () => {
    const existing = document.createElement('script');
    existing.src = CHECKOUT_SRC;
    document.body.appendChild(existing);

    const result = openRazorpayCheckout(subscription, { description: 'Pro' });
    expect(document.querySelectorAll('script')).toHaveLength(1);
    window.Razorpay = FakeRazorpay;
    existing.dispatchEvent(new Event('load'));
    await flush();
    FakeRazorpay.last.options.modal.ondismiss();
    await expect(result).resolves.toEqual({ status: 'dismissed', lastError: undefined });
  });

  it('rejects with a helpful message when checkout.js cannot load', async () => {
    const result = openRazorpayCheckout(subscription, { description: 'Pro' });
    document.querySelector('script')!.dispatchEvent(new Event('error'));
    await expect(result).rejects.toThrow('Unable to load Razorpay Checkout. Check your connection and try again.');
  });
});

describe('openRazorpayCheckout simulator', () => {
  const simulated: RazorpayCheckoutConfig = { ...subscription, simulator: true };
  const dialog = () => document.querySelector<HTMLElement>('[data-testid="razorpay-simulator"]');
  const button = (outcome: string) => document.querySelector<HTMLButtonElement>(`button[data-outcome="${outcome}"]`)!;
  const errorText = () => document.querySelector<HTMLElement>('[data-role="error"]')!;

  it('shows an accessible stand-in modal and resolves with the signed server response', async () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    apiPost.mockResolvedValue({ response: { razorpay_subscription_id: 'sub_1', razorpay_signature: 's' } });

    const result = openRazorpayCheckout(simulated, { description: 'Pro plan', amountLabel: '₹499 / month' });
    expect(dialog()).toMatchObject({ textContent: expect.stringContaining('Pro plan') });
    expect(dialog()!.getAttribute('aria-modal')).toBe('true');
    expect(document.querySelector('[data-role="amount"]')!.textContent).toBe('₹499 / month');
    expect(document.activeElement).toBe(button('success'));

    button('success').click();
    await expect(result).resolves.toEqual({
      status: 'success',
      response: { razorpay_subscription_id: 'sub_1', razorpay_signature: 's' },
    });
    expect(apiPost).toHaveBeenCalledWith('/dev/razorpay/checkout', { subscriptionId: 'sub_1', outcome: 'success' });
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('shows a decline, lets the user retry, then closes with the last error', async () => {
    let finish!: (value: unknown) => void;
    apiPost.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );

    const result = openRazorpayCheckout({ ...order, simulator: true }, { description: 'Deposit' });
    expect(document.querySelector('[data-role="amount"]')!.textContent).toBe('');
    button('fail').click();
    expect(button('success').disabled).toBe(true);
    // Clicks and Escape are ignored while the simulator request is in flight.
    button('dismiss').click();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(dialog()).not.toBeNull();

    finish({ error: { description: 'Insufficient funds' } });
    await flush();
    expect(apiPost).toHaveBeenCalledWith('/dev/razorpay/checkout', { orderId: 'order_1', outcome: 'fail' });
    expect(errorText().textContent).toBe('Insufficient funds You can try again or close checkout.');
    expect(errorText().classList.contains('hidden')).toBe(false);
    expect(button('success').disabled).toBe(false);

    apiPost.mockResolvedValueOnce({});
    button('fail').click();
    await flush();
    expect(errorText().textContent).toBe('The payment was declined. You can try again or close checkout.');

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await expect(result).resolves.toEqual({ status: 'dismissed', lastError: 'The payment was declined.' });
    expect(dialog()).toBeNull();
  });

  it('shows simulator request failures and closes from the close button', async () => {
    apiPost.mockRejectedValueOnce(new Error('Simulator is off')).mockRejectedValueOnce({});
    const result = openRazorpayCheckout(simulated, { description: 'Pro' });

    button('success').click();
    await flush();
    expect(errorText().textContent).toBe('Simulator is off');
    button('success').click();
    await flush();
    expect(errorText().textContent).toBe('Simulator request failed.');

    button('dismiss').click();
    await expect(result).resolves.toEqual({ status: 'dismissed', lastError: undefined });
  });
});
