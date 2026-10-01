import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PostJobPlanLimitDialog } from '../PostJobPlanLimitDialog';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const buttonNamed = (label: string) =>
  Array.from(document.querySelectorAll('button')).find((b) => b.textContent === label);

describe('PostJobPlanLimitDialog', () => {
  it('stays closed and calls nothing when there is no message', () => {
    const onNavigate = vi.fn();
    const onKeepAsDraft = vi.fn();
    act(() =>
      root.render(
        <PostJobPlanLimitDialog
          message={null}
          billingPath="/employer/billing"
          closeListingsPath="/employer"
          onNavigate={onNavigate}
          onKeepAsDraft={onKeepAsDraft}
        />,
      ),
    );
    expect(document.body.textContent).not.toContain("You've reached your plan's limit");
    expect(onNavigate).not.toHaveBeenCalled();
    expect(onKeepAsDraft).not.toHaveBeenCalled();
  });

  it('opens with the server message verbatim, the draft note, and the three buttons, without navigating', () => {
    const onNavigate = vi.fn();
    const onKeepAsDraft = vi.fn();
    act(() =>
      root.render(
        <PostJobPlanLimitDialog
          message="Your plan allows 1 active opportunity. Close one or upgrade your plan to continue."
          billingPath="/employer/billing"
          closeListingsPath="/employer"
          onNavigate={onNavigate}
          onKeepAsDraft={onKeepAsDraft}
        />,
      ),
    );
    expect(document.body.textContent).toContain("You've reached your plan's limit");
    expect(document.body.textContent).toContain(
      'Your plan allows 1 active opportunity. Close one or upgrade your plan to continue.',
    );
    expect(document.body.textContent).toContain('We saved this opportunity as a draft.');
    expect(buttonNamed('See plans')).toBeTruthy();
    expect(buttonNamed('Close another opportunity')).toBeTruthy();
    expect(buttonNamed('Keep as draft')).toBeTruthy();
    expect(onNavigate).not.toHaveBeenCalled();
    expect(onKeepAsDraft).not.toHaveBeenCalled();
  });

  it('"See plans" navigates to billing', () => {
    const onNavigate = vi.fn();
    act(() =>
      root.render(
        <PostJobPlanLimitDialog
          message="Limit reached."
          billingPath="/employer/billing"
          closeListingsPath="/employer"
          onNavigate={onNavigate}
          onKeepAsDraft={() => {}}
        />,
      ),
    );
    act(() => buttonNamed('See plans')?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(onNavigate).toHaveBeenCalledWith('/employer/billing');
  });

  it('"Close another opportunity" navigates to where active opportunities are managed', () => {
    const onNavigate = vi.fn();
    act(() =>
      root.render(
        <PostJobPlanLimitDialog
          message="Limit reached."
          billingPath="/employer/billing"
          closeListingsPath="/employer"
          onNavigate={onNavigate}
          onKeepAsDraft={() => {}}
        />,
      ),
    );
    act(() => buttonNamed('Close another opportunity')?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(onNavigate).toHaveBeenCalledWith('/employer');
  });

  it('"Keep as draft" closes the dialog without visiting billing or the opportunities page', () => {
    const onNavigate = vi.fn();
    const onKeepAsDraft = vi.fn();
    act(() =>
      root.render(
        <PostJobPlanLimitDialog
          message="Limit reached."
          billingPath="/employer/billing"
          closeListingsPath="/employer"
          onNavigate={onNavigate}
          onKeepAsDraft={onKeepAsDraft}
        />,
      ),
    );
    act(() => buttonNamed('Keep as draft')?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(onKeepAsDraft).toHaveBeenCalled();
    expect(onNavigate).not.toHaveBeenCalled();
  });
});
