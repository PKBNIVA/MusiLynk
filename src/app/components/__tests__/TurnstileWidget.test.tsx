import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TurnstileWidget } from '../auth/TurnstileWidget';
import { resetTurnstileLoader } from '../../lib/turnstile';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const api = { render: vi.fn(() => 'widget-1'), remove: vi.fn(), reset: vi.fn() };

function mount(onToken = vi.fn()) {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => root.render(<TurnstileWidget action="otp-request" onToken={onToken} />));
  return onToken;
}

beforeEach(() => {
  resetTurnstileLoader();
  delete window.turnstile;
  document.head.innerHTML = '';
  api.render.mockClear();
  api.remove.mockClear();
});
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  delete window.turnstile;
});

describe('TurnstileWidget', () => {
  it('renders nothing and loads no script when the build has no site key', () => {
    vi.stubEnv('VITE_TURNSTILE_SITE_KEY', '');
    mount();
    expect(container.innerHTML).toBe('');
    expect(document.querySelector('script')).toBeNull();
    expect(api.render).not.toHaveBeenCalled();
  });

  it('with a site key, renders the challenge with the action and forwards tokens, expiry and errors', async () => {
    vi.stubEnv('VITE_TURNSTILE_SITE_KEY', '0x4AAA');
    window.turnstile = api;
    const onToken = mount();
    await act(async () => {});
    expect(container.querySelector('[data-testid="turnstile"]')).not.toBeNull();
    expect(api.render).toHaveBeenCalledTimes(1);
    const [element, options] = api.render.mock.calls[0] as unknown as [HTMLElement, Record<string, unknown>];
    expect(element).toBe(container.querySelector('[data-testid="turnstile"]'));
    expect(options.sitekey).toBe('0x4AAA');
    expect(options.action).toBe('otp-request');
    (options.callback as (token: string) => void)('tok-1');
    expect(onToken).toHaveBeenLastCalledWith('tok-1');
    (options['expired-callback'] as () => void)();
    expect(onToken).toHaveBeenLastCalledWith(null);
    (options['error-callback'] as () => void)();
    expect(onToken).toHaveBeenLastCalledWith(null);
    act(() => root.unmount());
    expect(api.remove).toHaveBeenCalledWith('widget-1');
  });

  it('reports null when the script cannot load, so the form can show its error', async () => {
    vi.stubEnv('VITE_TURNSTILE_SITE_KEY', '0x4AAA');
    const onToken = mount();
    const script = document.querySelector('script');
    expect(script).not.toBeNull();
    await act(async () => {
      script!.dispatchEvent(new Event('error'));
    });
    expect(onToken).toHaveBeenCalledWith(null);
    expect(api.render).not.toHaveBeenCalled();
  });
});
