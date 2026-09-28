import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JOB_POST_TEMPLATES, JobPostTemplates } from '../JobPostTemplates';

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

describe('JOB_POST_TEMPLATES', () => {
  it('has exactly six templates, each with a title, description and three screening questions', () => {
    expect(JOB_POST_TEMPLATES).toHaveLength(6);
    for (const template of JOB_POST_TEMPLATES) {
      expect(template.title.length).toBeGreaterThan(0);
      expect(template.description.length).toBeGreaterThanOrEqual(60);
      expect(template.screeningQuestions).toHaveLength(3);
      expect(template.opportunityKind.length).toBeGreaterThan(0);
    }
  });

  it('covers the six expected opportunity types', () => {
    expect(JOB_POST_TEMPLATES.map((t) => t.id).sort()).toEqual(
      ['jingle-ad', 'ott-film-score', 'studio-session', 'teaching', 'tour', 'wedding-event'].sort(),
    );
  });

  it('has no duplicate ids', () => {
    const ids = JOB_POST_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('JobPostTemplates', () => {
  it('renders one button per template', () => {
    act(() => root.render(<JobPostTemplates onApply={() => {}} />));
    const buttons = container.querySelectorAll('button');
    expect(buttons).toHaveLength(JOB_POST_TEMPLATES.length);
    expect(container.textContent).toContain('Studio session');
    expect(container.textContent).toContain('Teaching');
  });

  it('calls onApply with the full template when a button is clicked', () => {
    const onApply = vi.fn();
    act(() => root.render(<JobPostTemplates onApply={onApply} />));
    const tourButton = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Tour')!;
    act(() => tourButton.dispatchEvent(new MouseEvent('click', { bubbles: true })));

    expect(onApply).toHaveBeenCalledTimes(1);
    const applied = onApply.mock.calls[0][0];
    expect(applied.id).toBe('tour');
    expect(applied.screeningQuestions).toHaveLength(3);
  });
});
