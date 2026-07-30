// src/mcp-server/handlers/tool-schemas.ts
// Single source of truth for the 4 new tools' agent-facing input schemas.
// Imported by mcp-server.ts for registration AND by the snapshot test that
// locks the surface against accidental drift.
export const NEW_TOOL_SCHEMAS = {
  liberate_cluster_pages: {
    description: 'Cluster page signatures by exact layout signature; pick a representative per cluster.',
    inputSchema: {
      type: 'object',
      properties: { signatures: { type: 'array', description: 'PageSignature[]' } },
      required: ['signatures'],
    },
  },
  liberate_section_extract: {
    description: 'Extract a page signature (off saved HTML) or full computed-style section specs (representatives).',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string' }, html: { type: 'string' },
        detail: { type: 'string', enum: ['signature', 'full'] },
        mediaMap: { type: 'object', description: 'detail=full only: {sourceCdnUrl: uploadedWpUrl} rewrite map' },
        cdpPort: { type: 'number', description: 'detail=full only: connect to an existing Chromium over CDP instead of launching' },
      },
      required: ['url', 'detail'],
    },
  },
  liberate_compose_instantiate: {
    description: 'Deterministically fill a cluster layout skeleton with a page\'s content; flag misfits.',
    inputSchema: {
      type: 'object',
      properties: { skeleton: { type: 'object' }, pageContent: { type: 'object' } },
      required: ['skeleton', 'pageContent'],
    },
  },
  liberate_validate_artifacts: {
    description: 'Pre-install gate: drift + escaping/injection + provenance over generated patterns.',
    inputSchema: {
      type: 'object',
      properties: { patterns: { type: 'array', description: 'ArtifactPattern[]' } },
      required: ['patterns'],
    },
  },
} as const;
