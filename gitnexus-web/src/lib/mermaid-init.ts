/**
 * Centralized mermaid initialization (GitNexus-b7r).
 *
 * Both ProcessFlowModal and MermaidDiagram previously called
 * `mermaid.initialize()` at module evaluation time with conflicting
 * `flowchart` settings. Whichever module loaded second silently
 * overrode the other's config — so the modal's intended large-diagram
 * spacing and the inline diagram's compact spacing fought each other,
 * with the winner depending on dynamic-import order.
 *
 * `mermaid.initialize()` is idempotent (it merges into the global config),
 * so the safe pattern is:
 *   1. `applyBaseMermaidConfig()` once at module load to set theme + safety
 *   2. `applyFlowchartConfig({ ... })` inside each component's render call
 *      to apply the diagram-specific spacing for that render
 *
 * The latter is cheap (microseconds) and means whichever component is
 * about to render always wins the global state for THAT render.
 */
import mermaid from 'mermaid';

interface FlowchartConfig {
  padding?: number;
  nodeSpacing?: number;
  rankSpacing?: number;
  htmlLabels?: boolean;
  curve?: 'basis' | 'linear' | 'cardinal' | 'monotoneX' | 'monotoneY' | 'natural' | 'step';
}

let baseApplied = false;

/**
 * Theme + global safety settings shared by every mermaid render in the app.
 * Idempotent — calling more than once is a no-op after the first call.
 */
export const applyBaseMermaidConfig = (): void => {
  if (baseApplied) return;
  mermaid.initialize({
    startOnLoad: false,
    suppressErrorRendering: true,
    // 900000 chars handles the largest combined "all processes" diagram.
    maxTextSize: 900000,
    theme: 'base',
    themeVariables: {
      primaryColor: '#1e293b',
      primaryTextColor: '#f1f5f9',
      primaryBorderColor: '#22d3ee',
      lineColor: '#94a3b8',
      secondaryColor: '#1e293b',
      tertiaryColor: '#0f172a',
      mainBkg: '#1e293b',
      nodeBorder: '#22d3ee',
      clusterBkg: '#1e293b',
      clusterBorder: '#475569',
      titleColor: '#f1f5f9',
      edgeLabelBackground: '#0f172a',
    },
    sequence: {
      actorMargin: 50,
      boxMargin: 10,
      boxTextMargin: 5,
      noteMargin: 10,
      messageMargin: 35,
    },
    fontFamily: '"JetBrains Mono", "Fira Code", monospace',
    fontSize: 13,
  });
  // Mermaid's parseError surfaces a visual error overlay by default —
  // we already render our own error UI inside each component's catch.
  mermaid.parseError = (_err) => {
    /* swallowed — components render their own error state */
  };
  baseApplied = true;
};

/**
 * Apply per-render flowchart spacing. Call immediately before
 * `mermaid.render(...)` to set the dimensions for THIS render's output.
 */
export const applyFlowchartConfig = (cfg: FlowchartConfig): void => {
  mermaid.initialize({
    flowchart: {
      curve: cfg.curve ?? 'basis',
      padding: cfg.padding ?? 15,
      nodeSpacing: cfg.nodeSpacing ?? 50,
      rankSpacing: cfg.rankSpacing ?? 50,
      htmlLabels: cfg.htmlLabels ?? true,
    },
  });
};
