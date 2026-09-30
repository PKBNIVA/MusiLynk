import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  JOB_POST_TEMPLATES,
  JobPostTemplates,
  PlaceholderNotice,
  findPlaceholders,
  hasPlaceholder,
} from '../JobPostTemplates';

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

  it('marks every spot to fill in as a {{placeholder}}, and never with [brackets]', () => {
    for (const template of JOB_POST_TEMPLATES) {
      const all = [template.title, template.description, ...template.screeningQuestions].join('\n');
      expect(all).not.toMatch(/\[[^\]]+\]/);
    }
    for (const template of JOB_POST_TEMPLATES) {
      expect(findPlaceholders(template.description).length).toBeGreaterThan(0);
    }
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

describe('placeholders', () => {
  it('finds each distinct placeholder once, in order of appearance', () => {
    expect(findPlaceholders('Book {{date}} at {{venue}}', 'Again {{date}}', 'none here')).toEqual([
      '{{date}}',
      '{{venue}}',
    ]);
  });

  it('treats any leftover "{{" as a placeholder, even a half-deleted one', () => {
    expect(hasPlaceholder('all good', 'Bring {{gear')).toBe(true);
    expect(hasPlaceholder('all good', 'still good')).toBe(false);
  });

  it('renders nothing once none is left', () => {
    act(() => root.render(<PlaceholderNotice placeholders={[]} onSelect={() => {}} />));
    expect(container.textContent).toBe('');
  });

  it('lists each one as a button that reports which was chosen', () => {
    const onSelect = vi.fn();
    act(() => root.render(<PlaceholderNotice placeholders={['{{date}}', '{{venue}}']} onSelect={onSelect} />));
    expect(container.textContent).toContain('2 spots still to fill in');
    const venue = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === '{{venue}}')!;
    act(() => venue.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(onSelect).toHaveBeenCalledWith('{{venue}}');
  });
});
