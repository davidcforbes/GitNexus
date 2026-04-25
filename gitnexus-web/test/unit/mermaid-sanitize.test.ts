/**
 * Regression tests for the DOMPurify config used to sanitize mermaid SVG
 * before it is injected into the DOM.
 *
 * Locks in the GitNexus-sy7 hardening: the SVG profile + ADD_TAGS:['foreignObject']
 * combination on its own would let an attacker-controlled mermaid label ship
 * a <script> / inline-event payload inside a <foreignObject>.  These tests
 * pin the FORBID_TAGS / FORBID_ATTR additions that close that gap.
 *
 * Both ProcessFlowModal.tsx and MermaidDiagram.tsx use the same config — we
 * mirror it here rather than exporting a helper to keep the source-of-truth
 * unambiguous (those files are the production callers).
 */
import { describe, expect, it } from 'vitest';
import DOMPurify from 'dompurify';

const SANITIZE_CONFIG = {
  USE_PROFILES: { svg: true, svgFilters: true },
  ADD_TAGS: ['foreignObject'],
  FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed'],
  FORBID_ATTR: [
    'onerror',
    'onload',
    'onclick',
    'onmouseover',
    'onfocus',
    'onmouseenter',
    'onanimationstart',
    'onanimationend',
  ],
} as const;

describe('mermaid SVG sanitize config (GitNexus-sy7)', () => {
  it('strips <script> nested inside <foreignObject>', () => {
    const payload =
      '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><script>window.x = 1</script>ok</foreignObject></svg>';
    const out = DOMPurify.sanitize(payload, SANITIZE_CONFIG);
    expect(out).not.toMatch(/<script/i);
    expect(out).not.toMatch(/window\.x/);
    expect(out).toMatch(/foreignObject/);
    expect(out).toMatch(/ok/);
  });

  it('strips inline event handlers on foreignObject children', () => {
    const payload =
      '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><div onclick="alert(1)" onmouseover="alert(2)">label</div></foreignObject></svg>';
    const out = DOMPurify.sanitize(payload, SANITIZE_CONFIG);
    expect(out).not.toMatch(/onclick/i);
    expect(out).not.toMatch(/onmouseover/i);
    expect(out).not.toMatch(/alert\(/);
    expect(out).toMatch(/>label</);
  });

  it('strips <style> blocks (used for CSS exfiltration)', () => {
    const payload =
      '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><style>@import url(//evil)</style>x</foreignObject></svg>';
    const out = DOMPurify.sanitize(payload, SANITIZE_CONFIG);
    expect(out).not.toMatch(/<style/i);
    expect(out).not.toMatch(/@import/i);
    expect(out).not.toMatch(/evil/);
  });

  it('strips <iframe> and <object> embeds', () => {
    const payload =
      '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><iframe src="//evil"></iframe><object data="//evil"></object></foreignObject></svg>';
    const out = DOMPurify.sanitize(payload, SANITIZE_CONFIG);
    expect(out).not.toMatch(/<iframe/i);
    expect(out).not.toMatch(/<object/i);
    expect(out).not.toMatch(/evil/);
  });

  it('strips onerror on <img> nested in foreignObject', () => {
    const payload =
      '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><img src="x" onerror="alert(1)"></foreignObject></svg>';
    const out = DOMPurify.sanitize(payload, SANITIZE_CONFIG);
    expect(out).not.toMatch(/onerror/i);
    expect(out).not.toMatch(/alert\(/);
  });

  it('preserves benign mermaid SVG output (text labels survive)', () => {
    const payload =
      '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50"><foreignObject width="100" height="20"><div>Process step 1</div></foreignObject><circle cx="50" cy="35" r="10" fill="#22d3ee"/></svg>';
    const out = DOMPurify.sanitize(payload, SANITIZE_CONFIG);
    expect(out).toMatch(/Process step 1/);
    expect(out).toMatch(/foreignObject/);
    expect(out).toMatch(/<circle/);
  });
});
