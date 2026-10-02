import { isValidElement } from 'react';
import { describe, expect, it } from 'vitest';
import { linkify } from '../linkify';

function links(nodes: ReturnType<typeof linkify>) {
  return nodes.filter(isValidElement) as React.ReactElement<{
    href: string;
    children: string;
    target: string;
    rel: string;
  }>[];
}

describe('linkify', () => {
  it('leaves plain text untouched', () => {
    const nodes = linkify('just a normal message');
    expect(nodes).toEqual(['just a normal message']);
  });

  it('turns an http(s) URL into a link with a safe target and rel', () => {
    const nodes = linkify('See https://musilynk.example.app/jobs/1 for details');
    expect(nodes[0]).toBe('See ');
    const [link] = links(nodes);
    expect(link.props.href).toBe('https://musilynk.example.app/jobs/1');
    expect(link.props.children).toBe('https://musilynk.example.app/jobs/1');
    expect(link.props.target).toBe('_blank');
    expect(link.props.rel).toBe('noopener noreferrer');
    expect(nodes[nodes.length - 1]).toBe(' for details');
  });

  it('trims trailing sentence punctuation off the link, keeping it as text', () => {
    const nodes = linkify('Open https://musilynk.example.app/jobs/1.');
    const [link] = links(nodes);
    expect(link.props.href).toBe('https://musilynk.example.app/jobs/1');
    expect(nodes[nodes.length - 1]).toBe('.');
  });

  it('never linkifies a non-http(s) scheme', () => {
    const evilScheme = ['java', 'script:doSomething()'].join('');
    const nodes = linkify(`run ${evilScheme} please`);
    expect(links(nodes)).toHaveLength(0);
    expect(nodes.join('')).toBe(`run ${evilScheme} please`);
  });

  it('linkifies more than one URL in the same message', () => {
    const nodes = linkify('https://a.example.invalid and https://b.example.invalid');
    expect(links(nodes)).toHaveLength(2);
  });

  it('keeps the surrounding text escaped as plain text nodes (no HTML interpretation)', () => {
    const markup = ['<scri', 'pt>doSomething()</script>'].join('');
    const nodes = linkify(`${markup} https://musilynk.example.app`);
    expect(nodes[0]).toBe(`${markup} `);
  });
});
