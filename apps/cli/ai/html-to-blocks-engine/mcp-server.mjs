#!/usr/bin/env node
// stdout carries the Content-Length-framed MCP protocol; library logging
// (e.g. @wordpress/blocks block-validation diffs) must go to stderr or it
// corrupts the stream.
for (const method of ['log', 'info', 'warn', 'debug']) {
    console[method] = (...args) => process.stderr.write(`${args.map(String).join(' ')}\n`);
}

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
    PLUGIN_ROOT, isPathInside, resolvePath, resolveWorkspacePath, readIfExists, readJson,
    readJsonIfExists, writeFile, writeJson, firstMatch, cleanText, titleCase,
    slug, camelName, escapeHtml, escapeAttr, relativeUrl, findFiles,
} from './lib/workspace.mjs';
import {
    DEFAULT_VIEWPORTS, loadCaptureDeps, serveDirectory, capture, captureEditor,
    editorComparisonCss, motionFreezeCss, transientOverlayCaptureCss, comparePngs,
} from './lib/capture.mjs';
import { serializeBlockTreeWithWordPress, stripBlockComments, ensureBlocksRegistered } from './lib/wp-serialize.mjs';
import { fixBlockMarkup } from './lib/fix-markup.mjs';
import { analyzeThemeEvidence } from './theme/evidence.mjs';
import { inferTemplateParts } from './theme/parts.mjs';
import { fetchThemeFonts } from './theme/fonts.mjs';
import { scaffoldBlockTheme } from './theme/scaffold.mjs';
import { validateBlockTheme } from './theme/validate.mjs';
import { playgroundRender } from './theme/playground.mjs';
import { validateContentModel, scaffoldContentModelPlugin } from './content/model.mjs';

const TOOLS = [
  {
    name: 'create_workspace',
    description: 'Create an html-to-blocks workspace with mockup, plan, wordpress, rendered, editor, and report folders.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['workspaceRoot', 'prompt'],
      properties: {
        workspaceRoot: { type: 'string' },
        prompt: { type: 'string' },
        force: { type: 'boolean', default: false },
      },
    },
  },
  {
    name: 'import_provided_markup',
    description: 'Import an existing HTML/CSS site export into a workspace mockup path instead of generating a new mockup.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['workspaceRoot', 'sourceHtmlPath'],
      properties: {
        workspaceRoot: { type: 'string' },
        sourceHtmlPath: { type: 'string' },
        sourceRoot: { type: 'string' },
        mockupPath: { type: 'string', default: 'mockup/index.html' },
        cssOutPath: { type: 'string', default: 'mockup/style.css' },
        cssPaths: {
          type: 'array',
          items: { type: 'string' },
        },
        copyAssets: { type: 'boolean', default: true },
      },
    },
  },
  {
    name: 'analyze_mockup',
    description: 'Analyze mockup/index.html and mockup/style.css into content inventory and CSS selector summaries.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['workspaceRoot'],
      properties: {
        workspaceRoot: { type: 'string' },
        htmlPath: { type: 'string', default: 'mockup/index.html' },
        cssPath: { type: 'string', default: 'mockup/style.css' },
      },
    },
  },
  {
    name: 'scaffold_custom_block',
    description: 'Generate a vanilla JavaScript WordPress custom block baseline with block.json, index.js, and style.css.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['workspaceRoot', 'name', 'attributes'],
      properties: {
        workspaceRoot: { type: 'string' },
        name: { type: 'string' },
        title: { type: 'string' },
        category: { type: 'string' },
        description: { type: 'string' },
        form: { type: 'boolean', default: false },
        attributes: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: true,
            required: ['name', 'type'],
            properties: {
              name: { type: 'string' },
              type: { type: 'string', enum: ['string', 'number', 'boolean', 'array', 'object'] },
              role: { type: 'string' },
              default: {},
            },
          },
        },
      },
    },
  },
  {
    name: 'serialize_wordpress_blocks',
    description: 'Serialize wordpress/block-tree.json with @wordpress/blocks into canonical wordpress/content.html, frontend rendered/rendered-blocks.html, editor/block-editor.html, and CSS reports.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['workspaceRoot'],
      properties: {
        workspaceRoot: { type: 'string' },
        treePath: { type: 'string', default: 'wordpress/block-tree.json' },
        contentPath: { type: 'string', default: 'wordpress/content.html' },
        outPath: { type: 'string', default: 'rendered/rendered-blocks.html' },
        editorPath: { type: 'string', default: 'editor/block-editor.html' },
        includeMockupCss: { type: 'boolean', default: false },
      },
    },
  },
  {
    name: 'create_block_editor_preview',
    description: 'Create a reusable no-build WordPress block editor preview that loads a generated data-only block tree, custom blocks, and CSS sources.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['workspaceRoot'],
      properties: {
        workspaceRoot: { type: 'string' },
        treePath: { type: 'string', default: 'wordpress/block-tree.json' },
        editorPath: { type: 'string', default: 'editor/block-editor.html' },
        cssPaths: {
          type: 'array',
          items: { type: 'string' },
        },
        includeMockupCss: { type: 'boolean', default: false },
        validateTree: { type: 'boolean', default: true },
      },
    },
  },
  {
    name: 'screenshot_html',
    description: 'Capture screenshots for mockup, rendered, editor, or arbitrary workspace HTML files without running a pixel diff.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['workspaceRoot'],
      properties: {
        workspaceRoot: { type: 'string' },
        outDir: { type: 'string', default: 'visual' },
        targets: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['name', 'path'],
            properties: {
              name: { type: 'string' },
              path: { type: 'string' },
              kind: { type: 'string', enum: ['html', 'editor'], default: 'html' },
            },
          },
        },
        viewports: {
          type: 'array',
          items: {
            type: 'object',
            required: ['name', 'width', 'height'],
            properties: {
              name: { type: 'string' },
              width: { type: 'number' },
              height: { type: 'number' },
              fullPage: { type: 'boolean', default: true },
            },
          },
        },
      },
    },
  },
  {
    name: 'compare_html',
    description: 'Capture mockup/rendered/editor screenshots, generate pixel diffs, and write a per-page comparison report plus repair tasks. Reports and screenshots are namespaced by the mockup filename, so multi-page comparisons never overwrite each other.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['workspaceRoot'],
      properties: {
        workspaceRoot: { type: 'string' },
        mockupPath: { type: 'string', default: 'mockup/index.html' },
        renderedPath: { type: 'string', default: 'rendered/rendered-blocks.html' },
        editorPath: { type: 'string', default: 'editor/block-editor.html' },
        reportPath: { type: 'string', description: 'Override the comparison JSON path. Default: reports/comparison.json for index, reports/<page>.comparison.json otherwise.' },
        tasksPath: { type: 'string', description: 'Override the repair-tasks markdown path. Default: reports/repair-tasks.md for index, reports/<page>.repair-tasks.md otherwise.' },
        compareEditor: { type: 'boolean', default: true },
        maxMismatchPercent: { type: 'number', default: 1 },
        maxHeightDelta: { type: 'number', default: 8 },
        viewports: {
          type: 'array',
          items: {
            type: 'object',
            required: ['name', 'width', 'height'],
            properties: {
              name: { type: 'string' },
              width: { type: 'number' },
              height: { type: 'number' },
              fullPage: { type: 'boolean', default: true },
            },
          },
        },
      },
    },
  },
  {
    name: 'measure_layout',
    description: 'Compare element geometry (offsetTop/height) between the mockup and a rendered or editor page, aligned by selector match order. Localizes vertical drift to specific sections far faster than reading pixel diffs — use it to find WHERE a height delta comes from, then drill with a narrower selector.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['workspaceRoot'],
      properties: {
        workspaceRoot: { type: 'string' },
        mockupPath: { type: 'string', default: 'mockup/index.html' },
        candidatePath: { type: 'string', default: 'rendered/rendered-blocks.html' },
        candidateKind: { type: 'string', enum: ['html', 'editor'], default: 'html' },
        selector: { type: 'string', description: 'CSS selector evaluated in both pages; matches are aligned by index. Default: main sections plus footer.' },
        viewports: {
          type: 'array',
          items: {
            type: 'object',
            required: ['name', 'width', 'height'],
            properties: {
              name: { type: 'string' },
              width: { type: 'number' },
              height: { type: 'number' },
            },
          },
        },
      },
    },
  },
  {
    name: 'validate_content_model',
    description: 'Validate an agent-authored WordPress content model JSON for CPT, taxonomy, meta, REST, and seed-content consistency. Writes reports/content-model-validation.json.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['workspaceRoot'],
      properties: {
        workspaceRoot: { type: 'string' },
        modelPath: { type: 'string', default: 'content-model/content-model.json' },
        reportPath: { type: 'string', default: 'reports/content-model-validation.json' },
      },
    },
  },
  {
    name: 'scaffold_content_model_plugin',
    description: 'Generate an installable WordPress plugin from content-model/content-model.json. The plugin registers CPTs, taxonomies, post meta, and submission REST routes while active, plus a Tools screen to import/remove generated seed content with state and collision reporting.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['workspaceRoot'],
      properties: {
        workspaceRoot: { type: 'string' },
        modelPath: { type: 'string', default: 'content-model/content-model.json' },
        reportPath: { type: 'string', default: 'reports/content-model-validation.json' },
        outDir: { type: 'string', default: 'content-model/plugin' },
      },
    },
  },
  {
    name: 'analyze_theme_evidence',
    description: 'Scan all page block trees and workspace CSS into a style-evidence report (recurring colors/fonts/spacing with occurrence counts, custom properties, support usage, lift buckets per CSS rule). Facts only — the agent decides what lifts into theme.json.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['workspaceRoot'], properties: { workspaceRoot: { type: 'string' } } },
  },
  {
    name: 'infer_template_parts',
    description: 'Group top-level subtrees across pages by exact and structural hashes into template-part candidates with occurrence, position, tag evidence and per-page variance tables. No header/footer assumptions — evidence only.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['workspaceRoot'], properties: { workspaceRoot: { type: 'string' } } },
  },
  {
    name: 'fetch_theme_fonts',
    description: 'Resolve the mockup CSS Google Fonts @import to local woff2 files under the theme assets and return ready theme.json fontFace entries. Fails explicitly offline.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['workspaceRoot', 'slug'], properties: { workspaceRoot: { type: 'string' }, slug: { type: 'string' }, importUrl: { type: 'string' } } },
  },
  {
    name: 'scaffold_block_theme',
    description: 'Write the block theme (style.css, theme.json, templates incl. default archive/single/404, parts, functions.php, assets), the blocks plugin, and the content plugin payload from agent-authored decisions. Owns serialization and the mechanical rewrites (preset refs, --wp--custom-- renames, permalinks, media placeholders).',
    inputSchema: { type: 'object', additionalProperties: false,
        required: ['workspaceRoot', 'slug', 'name', 'tokenMap', 'themeSettings', 'themeStyles', 'parts', 'templates', 'pages'],
        properties: {
            workspaceRoot: { type: 'string' }, slug: { type: 'string' }, name: { type: 'string' }, description: { type: 'string' },
            tokenMap: { type: 'object' }, themeSettings: { type: 'object' }, themeStyles: { type: 'object' },
            fontFamilies: { type: 'array' }, customCss: { type: 'string' },
            parts: { type: 'array' },
            templates: { type: 'object' },
            pages: { type: 'array', description: 'Page manifest entries: { page, slug, title, front?, stripIndexes?, sourceFile? }. sourceFile is the original mockup filename (e.g. "Bucharest Feline Show.html"); it keys the permalink link map so cross-page <a href> rewrites resolve — required whenever the mockup filename differs from "<page>.html".' },
            mediaMap: { type: 'object' },
        } },
  },
  {
    name: 'validate_block_theme',
    description: 'Static gate: theme.json schema (vendored), template/part parse with all blocks registered, header/file/ref/fontFace/remote-url/payload checks. Writes reports/theme-validation.json.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['workspaceRoot', 'slug'], properties: { workspaceRoot: { type: 'string' }, slug: { type: 'string' } } },
  },
  {
    name: 'playground_render',
    description: 'Boot the theme + plugins in WordPress Playground, import the pages through the content plugin, screenshot every page logged-out at both viewports, and diff against the mockups. Writes reports/theme-comparison.json with the standard thresholds.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['workspaceRoot', 'slug'], properties: { workspaceRoot: { type: 'string' }, slug: { type: 'string' }, port: { type: 'number' }, maxMismatchPercent: { type: 'number' }, maxHeightDelta: { type: 'number' } } },
  },
  {
    name: 'fix_block_markup',
    description: 'Canonicalize block markup: parse, recreate every block from its attributes, and re-serialize so the markup byte-matches save() output, eliminating editor block-validation errors. Pass raw markup, or workspace-relative file paths to fix in place. Registers the workspace custom blocks before parsing.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['workspaceRoot'],
      properties: {
        workspaceRoot: { type: 'string' },
        markup: { type: 'string' },
        paths: { type: 'array', items: { type: 'string' } },
      },
    },
  },
];

const handlers = {
  create_workspace: createWorkspace,
  import_provided_markup: importProvidedMarkup,
  analyze_mockup: analyzeMockup,
  scaffold_custom_block: scaffoldCustomBlock,
  serialize_wordpress_blocks: serializeWordPressBlocks,
  create_block_editor_preview: createBlockEditorPreview,
  screenshot_html: screenshotHtml,
  compare_html: compareHtml,
  measure_layout: measureLayout,
  validate_content_model: (args) => validateContentModel(args),
  scaffold_content_model_plugin: (args) => scaffoldContentModelPlugin(args),
  analyze_theme_evidence: (args) => analyzeThemeEvidence(args),
  infer_template_parts: (args) => inferTemplateParts(args),
  fetch_theme_fonts: (args) => {
      const workspaceRoot = resolvePath(args.workspaceRoot);
      return fetchThemeFonts({
          ...args,
          sourceCss: readIfExists(path.join(workspaceRoot, 'mockup/style.css')) || readIfExists(path.join(workspaceRoot, 'wordpress/style.css')),
          targetDir: path.join(workspaceRoot, 'theme', args.slug, 'assets/fonts'),
      });
  },
  scaffold_block_theme: (args) => scaffoldBlockTheme(args),
  validate_block_theme: (args) => validateBlockTheme(args),
  playground_render: (args) => playgroundRender(args),
  fix_block_markup: (args) => {
      const workspaceRoot = resolvePath(args.workspaceRoot);
      ensureBlocksRegistered(workspaceRoot);
      if (args.markup !== undefined) {
          return fixBlockMarkup(args.markup);
      }
      if (!Array.isArray(args.paths) || args.paths.length === 0) {
          throw new Error('fix_block_markup needs either markup or a non-empty paths array.');
      }
      const results = args.paths.map((rel) => {
          const filePath = resolveWorkspacePath(workspaceRoot, rel);
          const result = fixBlockMarkup(readIfExists(filePath));
          if (result.changed) writeFile(filePath, result.markup);
          return { path: rel, changed: result.changed, issues: result.issues };
      });
      return { results, next: 'Re-run validate_block_theme to confirm the markup is clean.' };
  },
};

export { handlers, TOOLS };

let buffer = Buffer.alloc(0);

process.stdin.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  processIncoming();
});

function processIncoming() {
  while (buffer.length) {
    const headerEnd = buffer.indexOf('\r\n\r\n');
    if (headerEnd >= 0) {
      const header = buffer.slice(0, headerEnd).toString('utf8');
      const match = header.match(/Content-Length:\s*(\d+)/i);
      if (!match) throw new Error('Missing Content-Length header.');
      const length = Number(match[1]);
      const messageStart = headerEnd + 4;
      if (buffer.length < messageStart + length) return;
      const raw = buffer.slice(messageStart, messageStart + length).toString('utf8');
      buffer = buffer.slice(messageStart + length);
      void handleMessage(JSON.parse(raw));
      continue;
    }

    const newline = buffer.indexOf('\n');
    if (newline < 0) return;
    const line = buffer.slice(0, newline).toString('utf8').trim();
    buffer = buffer.slice(newline + 1);
    if (line) void handleMessage(JSON.parse(line));
  }
}

async function handleMessage(message) {
  if (!message || typeof message !== 'object') return;
  if (!Object.prototype.hasOwnProperty.call(message, 'id')) return;

  try {
    if (message.method === 'initialize') {
      return send({
        jsonrpc: '2.0',
        id: message.id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'html-to-blocks', version: '0.1.0' },
        },
      });
    }

    if (message.method === 'tools/list') {
      return send({ jsonrpc: '2.0', id: message.id, result: { tools: TOOLS } });
    }

    if (message.method === 'tools/call') {
      const { name, arguments: args = {} } = message.params || {};
      if (!handlers[name]) throw new Error(`Unknown tool: ${name}`);
      const result = await handlers[name](args);
      return send({
        jsonrpc: '2.0',
        id: message.id,
        result: {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        },
      });
    }

    if (message.method === 'ping') {
      return send({ jsonrpc: '2.0', id: message.id, result: {} });
    }

    throw new Error(`Unsupported method: ${message.method}`);
  } catch (error) {
    send({
      jsonrpc: '2.0',
      id: message.id,
      error: {
        code: -32000,
        message: error instanceof Error ? error.message : String(error),
      },
    });
  }
}

function send(payload) {
  const body = JSON.stringify(payload);
  process.stdout.write(`Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`);
}

async function createWorkspace(args) {
  const workspaceRoot = resolvePath(args.workspaceRoot);
  if (fs.existsSync(workspaceRoot) && !args.force) {
    throw new Error(`Workspace exists: ${workspaceRoot}. Pass force=true to reuse it.`);
  }

  for (const dir of ['mockup', 'analysis', 'plan', 'content-model', 'wordpress/blocks', 'rendered', 'editor', 'reports', 'visual']) {
    fs.mkdirSync(path.join(workspaceRoot, dir), { recursive: true });
  }

  writeFile(path.join(workspaceRoot, 'brief.md'), `${args.prompt.trim()}\n`);
  writeFile(path.join(workspaceRoot, 'mockup/index.html'), starterHtml(args.prompt));
  writeFile(path.join(workspaceRoot, 'mockup/style.css'), starterCss());
  writeFile(path.join(workspaceRoot, 'wordpress/style.css'), '/* Generated WordPress preview CSS belongs here. Do not import mockup/style.css. */\n');
  writeJson(path.join(workspaceRoot, 'wordpress/block-tree.json'), { version: 2, contract: 'data-only', blocks: [] });
  writeFile(path.join(workspaceRoot, 'wordpress/content.html'), '<!-- Serialized from wordpress/block-tree.json by @wordpress/blocks. -->\n');
  writeJson(path.join(workspaceRoot, 'plan/block-plan.json'), { sections: [], customBlocks: [] });
  writeJson(path.join(workspaceRoot, 'content-model/content-model.json'), {
    version: 1,
    plugin: {
      slug: `${slug(path.basename(workspaceRoot)) || 'site'}-content`,
      name: `${titleCase(path.basename(workspaceRoot)) || 'Site'} Content Model`,
    },
    postTypes: [],
    taxonomies: [],
  });
  copyReference('design-prompt.md', path.join(workspaceRoot, 'plan/design-prompt.md'));

  return {
    workspaceRoot,
    files: {
      brief: path.join(workspaceRoot, 'brief.md'),
      mockupHtml: path.join(workspaceRoot, 'mockup/index.html'),
      mockupCss: path.join(workspaceRoot, 'mockup/style.css'),
      blockPlan: path.join(workspaceRoot, 'plan/block-plan.json'),
      blockTree: path.join(workspaceRoot, 'wordpress/block-tree.json'),
      blockContent: path.join(workspaceRoot, 'wordpress/content.html'),
      contentModel: path.join(workspaceRoot, 'content-model/content-model.json'),
      editorPreview: path.join(workspaceRoot, 'editor/block-editor.html'),
      wordpressCss: path.join(workspaceRoot, 'wordpress/style.css'),
    },
    next: 'Replace the starter mockup with the designed HTML/CSS/JS, then call analyze_mockup. Assemble blocks in wordpress/block-tree.json.',
  };
}

async function importProvidedMarkup(args) {
  const workspaceRoot = resolvePath(args.workspaceRoot);
  const sourceHtmlPath = resolvePath(args.sourceHtmlPath);
  if (!fs.existsSync(sourceHtmlPath)) {
    throw new Error(`sourceHtmlPath does not exist: ${sourceHtmlPath}`);
  }

  const sourceRoot = args.sourceRoot ? resolvePath(args.sourceRoot) : path.dirname(sourceHtmlPath);
  if (!fs.existsSync(sourceRoot) || !fs.statSync(sourceRoot).isDirectory()) {
    throw new Error(`sourceRoot is not a directory: ${sourceRoot}`);
  }
  if (!isPathInside(sourceRoot, sourceHtmlPath)) {
    throw new Error(`sourceHtmlPath must be inside sourceRoot: ${sourceHtmlPath}`);
  }

  const mockupPath = resolveWorkspacePath(workspaceRoot, args.mockupPath || 'mockup/index.html');
  const cssOutPath = resolveWorkspacePath(workspaceRoot, args.cssOutPath || 'mockup/style.css');
  fs.mkdirSync(path.dirname(mockupPath), { recursive: true });
  fs.mkdirSync(path.dirname(cssOutPath), { recursive: true });

  if (args.copyAssets !== false) {
    copyProvidedSourceRoot(sourceRoot, path.dirname(mockupPath));
  } else {
    fs.copyFileSync(sourceHtmlPath, mockupPath);
  }

  const copiedHtmlPath = path.join(path.dirname(mockupPath), path.relative(sourceRoot, sourceHtmlPath));
  if (path.resolve(copiedHtmlPath) !== path.resolve(mockupPath)) {
    fs.copyFileSync(sourceHtmlPath, mockupPath);
  }

  const importedHtml = fs.readFileSync(mockupPath, 'utf8');
  const stylesheetPaths = providedStylesheetPaths({ sourceRoot, sourceHtmlPath, html: importedHtml, cssPaths: args.cssPaths });
  const cssBundle = stylesheetPaths
    .map((file) => `/* ${path.relative(sourceRoot, file)} */\n${fs.readFileSync(file, 'utf8').trim()}\n`)
    .join('\n');
  writeFile(cssOutPath, cssBundle || '/* No local stylesheets discovered from provided markup. */\n');

  const pages = discoverProvidedPages(sourceRoot, sourceHtmlPath, path.dirname(mockupPath), workspaceRoot);

  return {
    workspaceRoot,
    sourceHtmlPath,
    sourceRoot,
    mockupPath,
    cssOutPath,
    copiedAssets: args.copyAssets !== false,
    stylesheets: stylesheetPaths.map((file) => path.relative(sourceRoot, file)),
    pages,
    next: pages.length > 1
      ? 'Multi-page export detected. Call analyze_mockup per page (htmlPath), plan shared blocks once, then use the suggested per-page treePath/renderedPath/editorPath/reportPath when calling serialize_wordpress_blocks, create_block_editor_preview, compare_html, and measure_layout. Every page must pass comparison before the run is complete.'
      : 'Call analyze_mockup on the imported mockup, then plan and assemble the block tree without generating a replacement HTML mockup.',
  };
}

function discoverProvidedPages(sourceRoot, primaryHtmlPath, mockupRoot, workspaceRoot) {
  const htmlFiles = fs.readdirSync(sourceRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.html'))
    .map((entry) => entry.name)
    .sort((a, b) => {
      if (path.join(sourceRoot, a) === primaryHtmlPath) return -1;
      if (path.join(sourceRoot, b) === primaryHtmlPath) return 1;
      return a.localeCompare(b);
    });

  return htmlFiles.map((name) => {
    const pageSlug = slug(path.basename(name, path.extname(name))) || 'page';
    return {
      page: pageSlug,
      sourceFile: name,
      primary: path.join(sourceRoot, name) === primaryHtmlPath,
      mockupPath: path.relative(workspaceRoot, path.join(mockupRoot, name)),
      suggested: {
        treePath: `wordpress/pages/${pageSlug}.block-tree.json`,
        contentPath: `wordpress/pages/${pageSlug}.content.html`,
        renderedPath: `rendered/${pageSlug}.html`,
        editorPath: `editor/${pageSlug}.html`,
        reportPath: `reports/${pageSlug}.comparison.json`,
        tasksPath: `reports/${pageSlug}.repair-tasks.md`,
      },
    };
  });
}

function copyProvidedSourceRoot(sourceRoot, mockupRoot) {
  fs.mkdirSync(mockupRoot, { recursive: true });
  for (const entry of fs.readdirSync(sourceRoot, { withFileTypes: true })) {
    const sourcePath = path.join(sourceRoot, entry.name);
    const targetPath = path.join(mockupRoot, entry.name);
    if (entry.isDirectory()) {
      fs.cpSync(sourcePath, targetPath, { recursive: true });
    } else if (entry.isFile()) {
      fs.copyFileSync(sourcePath, targetPath);
    }
  }
}

function providedStylesheetPaths({ sourceRoot, sourceHtmlPath, html, cssPaths = [] }) {
  const explicit = Array.isArray(cssPaths) ? cssPaths : [];
  const hrefs = [...html.matchAll(/<link\b[^>]*rel=["'][^"']*stylesheet[^"']*["'][^>]*>/gi)]
    .map((match) => firstMatch(match[0], /\bhref=["']([^"']+)["']/i))
    .filter(Boolean);
  const candidates = [...explicit, ...hrefs];
  const baseDir = path.dirname(sourceHtmlPath);
  const seen = new Set();
  const files = [];

  for (const candidate of candidates) {
    if (isRemoteUrl(candidate) || candidate.startsWith('#')) continue;
    const withoutQuery = candidate.split(/[?#]/)[0];
    const resolved = path.resolve(baseDir, withoutQuery);
    if (!isPathInside(sourceRoot, resolved)) continue;
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) continue;
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    files.push(resolved);
  }

  return files;
}

function isRemoteUrl(value) {
  return /^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(String(value || '')) || /^(?:data|mailto|tel):/i.test(String(value || ''));
}

async function analyzeMockup(args) {
  const workspaceRoot = resolvePath(args.workspaceRoot);
  const htmlPath = path.join(workspaceRoot, args.htmlPath || 'mockup/index.html');
  const cssPath = path.join(workspaceRoot, args.cssPath || 'mockup/style.css');
  const html = fs.readFileSync(htmlPath, 'utf8');
  const css = fs.existsSync(cssPath) ? fs.readFileSync(cssPath, 'utf8') : '';
  const inventory = extractInventory(html);
  const analysis = {
    title: firstMatch(html, /<title[^>]*>([\s\S]*?)<\/title>/i) || '',
    sections: inventory.sections.map((section) => ({
      id: section.id,
      selector: section.selector,
      tagName: section.tagName,
      className: section.className,
      heading: section.headings[0]?.content || '',
      textLength: section.text.length,
      features: {
        forms: section.forms.length,
        links: section.links.length,
        cards: section.cards.length,
        headings: section.headings.length,
      },
    })),
    css: {
      customProperties: extractCustomProperties(css),
      selectors: extractSelectors(css),
    },
  };

  writeJson(path.join(workspaceRoot, 'analysis/content-inventory.json'), inventory);
  writeJson(path.join(workspaceRoot, 'analysis/analysis.json'), analysis);

  return {
    analysisPath: path.join(workspaceRoot, 'analysis/analysis.json'),
    inventoryPath: path.join(workspaceRoot, 'analysis/content-inventory.json'),
    sections: analysis.sections.length,
    forms: inventory.forms.length,
    links: inventory.links.length,
    selectors: analysis.css.selectors.length,
  };
}

async function scaffoldCustomBlock(args) {
  const workspaceRoot = resolvePath(args.workspaceRoot);
  const name = String(args.name || '').trim();
  if (!/^[a-z0-9-]+\/[a-z0-9-]+$/.test(name)) {
    throw new Error('Block name must look like namespace/block-name.');
  }

  const slug = name.split('/')[1];
  const blockRoot = path.join(workspaceRoot, 'wordpress/blocks', slug);
  fs.mkdirSync(blockRoot, { recursive: true });
  const attributes = normalizeAttributes(args.attributes || [], Boolean(args.form));
  const title = args.title || titleCase(slug);
  const form = Boolean(args.form) || looksFormLike(name, attributes);

  writeJson(path.join(blockRoot, 'block.json'), {
    apiVersion: 3,
    name,
    title,
    category: args.category || (form ? 'forms' : 'design'),
    description: args.description || `${title} custom block generated by the html-to-blocks workflow.`,
    editorScript: 'file:./index.js',
    style: 'file:./style.css',
    attributes: blockJsonAttributes(attributes),
    supports: defaultSupports(),
  });
  writeFile(path.join(blockRoot, 'index.js'), generateIndexJs({ name, title, slug, attributes, form }));
  writeFile(path.join(blockRoot, 'style.css'), generateBlockCss({ name, slug, form }));

  return {
    blockRoot,
    files: ['block.json', 'index.js', 'style.css'].map((file) => path.join(blockRoot, file)),
    next: 'Edit the generated block source to match the mockup component exactly, then reference it from wordpress/block-tree.json.',
  };
}

async function serializeWordPressBlocks(args) {
  const workspaceRoot = resolvePath(args.workspaceRoot);
  const treePath = path.join(workspaceRoot, args.treePath || 'wordpress/block-tree.json');
  const contentPath = path.join(workspaceRoot, args.contentPath || 'wordpress/content.html');
  const outPath = path.join(workspaceRoot, args.outPath || 'rendered/rendered-blocks.html');
  const editorPath = path.join(workspaceRoot, args.editorPath || 'editor/block-editor.html');
  const treeExists = fs.existsSync(treePath);
  const tree = treeExists ? readJson(treePath) : null;
  const blockMarkup = treeExists
    ? serializeBlockTreeWithWordPress(tree, { workspaceRoot })
    : fs.readFileSync(contentPath, 'utf8');
  const cssSources = workspaceCssSources(workspaceRoot, args);
  const styleAudit = auditStyleUsage(tree, cssSources);

  if (treeExists) writeFile(contentPath, `${blockMarkup.trim()}\n`);
  writeFile(outPath, renderedPreviewHtml('Rendered WordPress Blocks', path.dirname(outPath), cssSources, stripBlockComments(blockMarkup)));
  if (treeExists) writeFile(editorPath, editorPreviewHtml({ workspaceRoot, editorPath, treePath, cssSources }));
  writeJson(path.join(workspaceRoot, 'reports/style-audit.json'), styleAudit);
  return {
    treePath: treeExists ? treePath : null,
    contentPath,
    renderedPath: outPath,
    editorPath: treeExists ? editorPath : null,
    cssSources: cssSources.map((source) => source.relativePath),
    styleAuditPath: path.join(workspaceRoot, 'reports/style-audit.json'),
    styleAudit,
    next: 'Call compare_html, inspect rendered and editor screenshots/diffs, then write repair tasks against wordpress/block-tree.json, custom block edit/save code, or CSS.',
  };
}

async function createBlockEditorPreview(args) {
  const workspaceRoot = resolvePath(args.workspaceRoot);
  const treePath = resolveWorkspacePath(workspaceRoot, args.treePath || 'wordpress/block-tree.json');
  const editorPath = resolveWorkspacePath(workspaceRoot, args.editorPath || 'editor/block-editor.html');
  if (!fs.existsSync(treePath)) {
    throw new Error(`Block tree does not exist: ${treePath}`);
  }

  const tree = readJson(treePath);
  if (args.validateTree !== false) {
    serializeBlockTreeWithWordPress(tree, { workspaceRoot });
  }

  const cssSources = workspaceCssSources(workspaceRoot, args);
  writeFile(editorPath, editorPreviewHtml({ workspaceRoot, editorPath, treePath, cssSources }));

  return {
    treePath,
    editorPath,
    cssSources: cssSources.map((source) => source.relativePath),
    customBlocks: findFiles(path.join(workspaceRoot, 'wordpress/blocks'), 'index.js')
      .map((file) => path.relative(workspaceRoot, path.dirname(file))),
    next: 'Open the editor preview in a local static server or call screenshot_html with kind="editor" to inspect the editable block tree.',
  };
}

function workspaceCssSources(workspaceRoot, args = {}) {
  const cssPaths = Array.isArray(args.cssPaths) && args.cssPaths.length
    ? args.cssPaths.map((cssPath) => resolveWorkspacePath(workspaceRoot, cssPath))
    : [
        ...(args.includeMockupCss ? [path.join(workspaceRoot, 'mockup/style.css')] : []),
        path.join(workspaceRoot, 'wordpress/style.css'),
        ...findFiles(path.join(workspaceRoot, 'wordpress/blocks'), 'style.css'),
      ];

  return cssPaths
    .map((file) => cssSource(workspaceRoot, file))
    .filter((source) => source.css);
}

function cssSource(workspaceRoot, filePath) {
  const css = readIfExists(filePath);
  return {
    path: filePath,
    relativePath: path.relative(workspaceRoot, filePath),
    css,
  };
}

function editorPreviewHtml({ workspaceRoot, editorPath, treePath, cssSources }) {
  const editorDir = path.dirname(editorPath);
  const tree = readJson(treePath);
  const cssLinks = cssSources
    .map((source) => `<link rel="stylesheet" href="${escapeAttr(relativeUrl(editorDir, source.path))}">`)
    .join('\n    ');
  const customBlockAssets = findFiles(path.join(workspaceRoot, 'wordpress/blocks'), 'index.js')
    .map((file) => ({
      script: relativeUrl(editorDir, file),
      source: readIfExists(file),
      metadata: readJsonIfExists(path.join(path.dirname(file), 'block.json')),
    }));
  const scriptTags = wordpressBrowserScripts()
    .map((src) => `<script src="${src}"></script>`)
    .join('\n    ');

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Editable WordPress Block Tree</title>
    <style>
      /*
        WordPress editor chrome CSS is demoted into a cascade layer so the
        unlayered workspace stylesheets linked below win by default cascade
        rules at any specificity — the same relationship theme CSS has to
        block-library CSS on a real site. default-editor-styles.min.css is
        intentionally NOT loaded: it themes the canvas (line-height 1.8,
        fallback fonts) and only creates parity drift against the mockup.
      */
      @layer wp-editor, wbdc-parity;
      @import url("https://s.w.org/wp-includes/css/dist/components/style.min.css") layer(wp-editor);
      @import url("https://s.w.org/wp-includes/css/dist/block-editor/style.min.css") layer(wp-editor);
      @import url("https://s.w.org/wp-includes/css/dist/block-editor/content.min.css") layer(wp-editor);
      @import url("https://s.w.org/wp-includes/css/dist/block-library/style.min.css") layer(wp-editor);
    </style>
    <style>
      @layer wbdc-parity {
        /*
          Frontend-parity canvas defaults. These neutralize editor-only
          deviations (block-gap margins, rich-text pre-wrap, editor
          line-height) but live in a layer, so any unlayered workspace rule
          — even a bare element selector — overrides them.
        */
        .block-editor-block-list__block {
          margin-top: 0;
          margin-bottom: 0;
        }

        .block-editor-block-list__block:not(button):not(input):not(textarea):not(select),
        .block-editor-rich-text__editable:not(button):not(input):not(textarea):not(select) {
          line-height: inherit;
          white-space: inherit;
        }

        .block-editor-inner-blocks {
          display: contents;
        }

        .is-root-container.block-editor-block-list__layout {
          padding: 0;
        }

        .is-root-container > .block-editor-block-list__block {
          max-width: none;
        }

        .block-editor-block-list__layout .block-editor-block-list__block::before {
          outline-color: rgba(215, 255, 56, 0.65);
        }

        .components-placeholder,
        .block-editor-block-variation-picker,
        .block-editor-default-block-appender,
        .block-editor-block-list__empty-block-inserter {
          display: none !important;
        }
      }
    </style>
    ${cssLinks}
    <style>
      /* preview shell chrome — not part of the compared canvas */
      html,
      body {
        margin: 0;
        min-height: 100%;
      }

      .wbdc-editor-shell {
        min-height: 100vh;
        background: inherit;
      }

      .wbdc-editor-toolbar {
        position: sticky;
        top: 0;
        z-index: 40;
        display: flex;
        justify-content: space-between;
        gap: 12px;
        align-items: center;
        min-height: 44px;
        padding: 0 12px;
        border-bottom: 1px solid #333;
        background: #181818;
        color: #f7f1df;
        font: 700 12px/1.2 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        letter-spacing: 0.04em;
        text-transform: uppercase;
      }

      .wbdc-editor-toolbar a {
        color: #d7ff38;
        text-decoration: none;
      }

      .wbdc-editor-canvas {
        min-height: calc(100vh - 44px);
      }

      .wbdc-editor-error {
        margin: 0;
        padding: 24px;
        color: #ffe6e6;
        background: #290d0d;
        font: 14px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        white-space: pre-wrap;
      }
    </style>
  </head>
  <body>
    <div id="editor-root">
      <pre class="wbdc-editor-error">Loading WordPress block editor...</pre>
    </div>
    ${scriptTags}
    <script>
      window.wpEditorL10n = window.wpEditorL10n || {};
      window.__unstableAutoRegisterBlocks = false;
    </script>
    <script>
      (async function () {
        const el = wp.element.createElement;
        const rootEl = document.getElementById('editor-root');
        const customBlockAssets = ${JSON.stringify(customBlockAssets)};

        function renderError(error) {
          rootEl.innerHTML = '';
          const pre = document.createElement('pre');
          pre.className = 'wbdc-editor-error';
          pre.textContent = error && error.stack ? error.stack : String(error);
          rootEl.appendChild(pre);
        }

        function toWpBlock(block) {
          const name = block.blockName || block.name;
          const attrs = block.attrs || block.attributes || {};
          const innerBlocks = (block.innerBlocks || []).map(toWpBlock);
          return wp.blocks.createBlock(name, attrs, innerBlocks);
        }

        function fallbackTitle(name) {
          return String(name || 'Custom block')
            .split('/').pop()
            .split('-')
            .filter(Boolean)
            .map(function (part) { return part.charAt(0).toUpperCase() + part.slice(1); })
            .join(' ');
        }

        async function registerCustomBlocks() {
          const originalBlocks = window.wp.blocks;
          const originalRegisterBlockType = originalBlocks.registerBlockType;
          for (const asset of customBlockAssets) {
            const metadata = asset.metadata || {};
            const wrappedBlocks = Object.assign({}, originalBlocks, {
              registerBlockType: function (name, settings) {
                const blockName = name || metadata.name;
                const normalized = Object.assign(
                  {
                    apiVersion: 3,
                    title: metadata.title || fallbackTitle(blockName),
                    category: metadata.category || 'design',
                    attributes: metadata.attributes || {},
                    supports: metadata.supports || {}
                  },
                  metadata,
                  settings || {}
                );
                normalized.apiVersion = normalized.apiVersion || 3;
                normalized.title = normalized.title || fallbackTitle(blockName);
                normalized.category = normalized.category || 'design';
                normalized.attributes = Object.assign({}, metadata.attributes || {}, (settings && settings.attributes) || {});
                normalized.supports = Object.assign({}, metadata.supports || {}, (settings && settings.supports) || {});
                return originalRegisterBlockType.call(originalBlocks, blockName, normalized);
              }
            });
            const source = asset.source || '';
            if (!source) throw new Error('Could not load custom block script: ' + asset.script);
            try {
              window.wp.blocks = wrappedBlocks;
              Function(source + '\\n//# sourceURL=' + asset.script)();
            } finally {
              window.wp.blocks = originalBlocks;
            }
          }
        }

        function EditorApp() {
          const useState = wp.element.useState;
          const treeState = window.__wbdcInitialBlocks || [];
          const state = useState(treeState);
          const blocks = state[0];
          const setBlocks = state[1];
          const BlockEditorProvider = wp.blockEditor.BlockEditorProvider;
          const BlockList = wp.blockEditor.BlockList;
          const BlockTools = wp.blockEditor.BlockTools;
          const WritingFlow = wp.blockEditor.WritingFlow;
          const ObserveTyping = wp.blockEditor.ObserveTyping;
          const BlockEditorKeyboardShortcuts = wp.blockEditor.BlockEditorKeyboardShortcuts;
          const SlotFillProvider = wp.components.SlotFillProvider;
          const Popover = wp.components.Popover;

          return el(SlotFillProvider, null,
            el('div', { className: 'wbdc-editor-shell' },
              el('div', { className: 'wbdc-editor-toolbar' },
                el('span', null, 'Editable block tree'),
                el('a', { href: '../rendered/rendered-blocks.html', target: '_blank', rel: 'noreferrer' }, 'Open render')
              ),
              el('div', { className: 'wbdc-editor-canvas editor-styles-wrapper' },
                el(BlockEditorProvider, {
                  value: blocks,
                  onInput: setBlocks,
                  onChange: setBlocks,
                  settings: {
                    alignWide: true,
                    supportsLayout: true,
                    hasFixedToolbar: false,
                    bodyPlaceholder: 'Add blocks'
                  }
                },
                  el(BlockEditorKeyboardShortcuts, null),
                  el(BlockTools, null,
                    el(WritingFlow, null,
                      el(ObserveTyping, null,
                        el(BlockList, null)
                      )
                    )
                  )
                )
              ),
              el(Popover.Slot, null)
            )
          );
        }

        try {
          if (!window.wp || !wp.blockEditor || !wp.blocks || !wp.element) {
            throw new Error('WordPress block editor globals did not load.');
          }
          if (wp.blockLibrary && wp.blockLibrary.registerCoreBlocks) {
            wp.blockLibrary.registerCoreBlocks();
          }
          await registerCustomBlocks();
          const tree = ${JSON.stringify(tree)};
          window.__wbdcInitialBlocks = (Array.isArray(tree) ? tree : tree.blocks || []).map(toWpBlock);
          wp.element.createRoot(rootEl).render(el(EditorApp));
        } catch (error) {
          renderError(error);
        }
      })();
    </script>
  </body>
</html>
`;
}

function wordpressBrowserScripts() {
  const base = 'https://s.w.org/wp-includes/js/dist';
  return [
    `${base}/vendor/react.min.js`,
    `${base}/vendor/react-dom.min.js`,
    `${base}/vendor/react-jsx-runtime.min.js`,
    `${base}/vendor/moment.min.js`,
    `${base}/element.min.js`,
    `${base}/hooks.min.js`,
    `${base}/deprecated.min.js`,
    `${base}/i18n.min.js`,
    `${base}/warning.min.js`,
    `${base}/escape-html.min.js`,
    `${base}/is-shallow-equal.min.js`,
    `${base}/priority-queue.min.js`,
    `${base}/private-apis.min.js`,
    `${base}/compose.min.js`,
    `${base}/dom.min.js`,
    `${base}/dom-ready.min.js`,
    `${base}/html-entities.min.js`,
    `${base}/url.min.js`,
    `${base}/a11y.min.js`,
    `${base}/blob.min.js`,
    `${base}/autop.min.js`,
    `${base}/shortcode.min.js`,
    `${base}/token-list.min.js`,
    `${base}/redux-routine.min.js`,
    `${base}/data.min.js`,
    `${base}/rich-text.min.js`,
    `${base}/date.min.js`,
    `${base}/primitives.min.js`,
    `${base}/keycodes.min.js`,
    `${base}/keyboard-shortcuts.min.js`,
    `${base}/notices.min.js`,
    `${base}/components.min.js`,
    `${base}/preferences.min.js`,
    `${base}/viewport.min.js`,
    `${base}/api-fetch.min.js`,
    `${base}/upload-media.min.js`,
    `${base}/block-serialization-default-parser.min.js`,
    `${base}/blocks.min.js`,
    `${base}/undo-manager.min.js`,
    `${base}/commands.min.js`,
    `${base}/style-engine.min.js`,
    `${base}/server-side-render.min.js`,
    `${base}/wordcount.min.js`,
    `${base}/block-editor.min.js`,
    `${base}/core-data.min.js`,
    `${base}/patterns.min.js`,
    `${base}/block-library.min.js`,
  ];
}

function auditStyleUsage(tree, cssSources) {
  const blocks = collectTreeBlocks(tree);
  const supportKeys = ['style', 'layout', 'align', 'backgroundColor', 'textColor', 'gradient', 'fontSize', 'borderColor'];
  const blocksWithSupportAttrs = blocks.filter((block) => {
    const attrs = block.attrs || block.attributes || {};
    return supportKeys.some((key) => attrs[key] !== undefined);
  });
  const stylePaths = new Map();
  for (const block of blocks) {
    const attrs = block.attrs || block.attributes || {};
    collectStylePaths(attrs.style, '', stylePaths);
  }
  const cssFiles = cssSources.map((source) => ({
    path: source.relativePath,
    bytes: Buffer.byteLength(source.css, 'utf8'),
    lines: source.css.split(/\r?\n/).filter((line) => line.trim()).length,
    rules: countCssRules(source.css),
  }));
  const pageCss = cssFiles.filter((file) => file.path === 'wordpress/style.css');
  const blockCss = cssFiles.filter((file) => file.path.startsWith('wordpress/blocks/'));
  return {
    generatedAt: new Date().toISOString(),
    blockCount: blocks.length,
    coreBlockCount: blocks.filter((block) => (block.blockName || block.name || '').startsWith('core/')).length,
    customBlockCount: blocks.filter((block) => !(block.blockName || block.name || '').startsWith('core/')).length,
    blocksWithSupportAttrs: blocksWithSupportAttrs.length,
    supportStyledPercent: blocks.length ? Number(((blocksWithSupportAttrs.length / blocks.length) * 100).toFixed(2)) : 0,
    supportAttributeCounts: Object.fromEntries(
      supportKeys.map((key) => [key, blocks.filter((block) => (block.attrs || block.attributes || {})[key] !== undefined).length])
    ),
    stylePaths: [...stylePaths.entries()].sort().map(([pathKey, count]) => ({ path: pathKey, count })),
    css: {
      totalBytes: cssFiles.reduce((sum, file) => sum + file.bytes, 0),
      totalLines: cssFiles.reduce((sum, file) => sum + file.lines, 0),
      totalRules: cssFiles.reduce((sum, file) => sum + file.rules, 0),
      pageCssBytes: pageCss.reduce((sum, file) => sum + file.bytes, 0),
      pageCssLines: pageCss.reduce((sum, file) => sum + file.lines, 0),
      pageCssRules: pageCss.reduce((sum, file) => sum + file.rules, 0),
      blockCssBytes: blockCss.reduce((sum, file) => sum + file.bytes, 0),
      blockCssLines: blockCss.reduce((sum, file) => sum + file.lines, 0),
      blockCssRules: blockCss.reduce((sum, file) => sum + file.rules, 0),
      files: cssFiles,
    },
    guidance: [
      'Prefer attrs.style, layout, align, color, spacing, typography, border, and dimensions support settings for block-level design.',
      'Keep wordpress/style.css for tokens, document-level defaults, responsive grid behavior, and selectors that WordPress supports cannot express.',
      'Keep wordpress/blocks/*/style.css scoped to custom block internals such as pseudo-elements, nested controls, horizontal rails, and ornamental geometry.',
    ],
  };
}

function collectTreeBlocks(tree) {
  const roots = Array.isArray(tree) ? tree : tree?.blocks || [];
  const blocks = [];
  const visit = (block) => {
    if (!block || typeof block !== 'object') return;
    blocks.push(block);
    for (const child of block.innerBlocks || []) visit(child);
  };
  for (const block of roots) visit(block);
  return blocks;
}

function collectStylePaths(value, prefix, out) {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    const next = prefix ? `${prefix}.${key}` : key;
    if (child && typeof child === 'object' && !Array.isArray(child)) collectStylePaths(child, next, out);
    else out.set(next, (out.get(next) || 0) + 1);
  }
}

function countCssRules(css) {
  return (String(css || '').match(/\{[^{}]*\}/g) || []).length;
}

async function compareHtml(args) {
  const workspaceRoot = resolvePath(args.workspaceRoot);
  const { chromium, PNG, pixelmatch } = await loadCaptureDeps(PLUGIN_ROOT);

  const mockupPath = path.join(workspaceRoot, args.mockupPath || 'mockup/index.html');
  const renderedPath = path.join(workspaceRoot, args.renderedPath || 'rendered/rendered-blocks.html');
  const editorPath = path.join(workspaceRoot, args.editorPath || 'editor/block-editor.html');
  const shouldCompareEditor = args.compareEditor !== false && fs.existsSync(editorPath);
  const outDir = path.join(workspaceRoot, 'visual');
  fs.mkdirSync(outDir, { recursive: true });
  const viewports = Array.isArray(args.viewports) && args.viewports.length ? args.viewports : DEFAULT_VIEWPORTS;
  // Per-page namespacing: comparisons of secondary pages must not overwrite
  // the index page's reports/screenshots. "index" keeps the legacy names.
  const pageSlug = pageSlugFor(mockupPath);
  const prefix = pageSlug === 'index' ? '' : `${pageSlug}-`;
  const reportPath = resolveWorkspacePath(
    workspaceRoot,
    args.reportPath || (pageSlug === 'index' ? 'reports/comparison.json' : `reports/${pageSlug}.comparison.json`),
  );
  const tasksPath = resolveWorkspacePath(
    workspaceRoot,
    args.tasksPath || (pageSlug === 'index' ? 'reports/repair-tasks.md' : `reports/${pageSlug}.repair-tasks.md`),
  );
  const browser = await chromium.launch({ headless: true });
  const results = [];
  const server = shouldCompareEditor ? await serveDirectory(workspaceRoot) : null;

  try {
    for (const viewport of viewports) {
      const mockupShot = path.join(outDir, `${prefix}mockup-${viewport.name}.png`);
      const renderedShot = path.join(outDir, `${prefix}rendered-${viewport.name}.png`);
      const diffShot = path.join(outDir, `${prefix}diff-${viewport.name}.png`);
      await capture(browser, mockupPath, mockupShot, viewport);
      await capture(browser, renderedPath, renderedShot, viewport);
      results.push(comparePngs({
        target: 'rendered',
        mockupShot,
        candidateShot: renderedShot,
        diffShot,
        viewport,
        PNG,
        pixelmatch,
      }));

      if (shouldCompareEditor) {
        const editorShot = path.join(outDir, `${prefix}editor-${viewport.name}.png`);
        const editorDiffShot = path.join(outDir, `${prefix}diff-editor-${viewport.name}.png`);
        await captureEditor(browser, server.urlFor(editorPath), editorShot, viewport);
        results.push(comparePngs({
          target: 'editor',
          mockupShot,
          candidateShot: editorShot,
          diffShot: editorDiffShot,
          viewport,
          PNG,
          pixelmatch,
        }));
      }
    }
  } finally {
    await browser.close();
    if (server) await server.close();
  }

  const thresholds = {
    maxMismatchPercent: Number(args.maxMismatchPercent ?? 1),
    maxHeightDelta: Number(args.maxHeightDelta ?? 8),
  };
  const aggregate = aggregateComparisonResults(results);
  const aggregates = {
    all: aggregate,
    rendered: aggregateComparisonResults(results.filter((result) => result.target === 'rendered')),
    editor: aggregateComparisonResults(results.filter((result) => result.target === 'editor')),
  };
  const tasks = comparisonTasks(results, thresholds);
  const report = {
    page: pageSlug,
    mockupPath,
    renderedPath,
    editorPath: shouldCompareEditor ? editorPath : null,
    thresholds,
    aggregate,
    aggregates,
    results,
    tasks,
  };
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  writeJson(reportPath, report);
  writeFile(tasksPath, renderRepairTasks(tasks, report));

  return {
    page: pageSlug,
    reportPath,
    tasksPath,
    aggregate,
    passed: aggregate.maxMismatchPercent <= thresholds.maxMismatchPercent && aggregate.maxHeightDelta <= thresholds.maxHeightDelta,
    tasks,
  };
}

function pageSlugFor(mockupPath) {
  return slug(path.basename(mockupPath, path.extname(mockupPath))) || 'index';
}

const DEFAULT_MEASURE_SELECTOR = 'main > section, main > div, main section, footer, .site-footer';

async function measureLayout(args) {
  const workspaceRoot = resolvePath(args.workspaceRoot);
  let chromium;
  try {
    chromium = (await import('playwright')).chromium;
  } catch (error) {
    throw new Error(`measure_layout needs optional packages. Run npm install in ${PLUGIN_ROOT}. Missing dependency: ${error.message}`);
  }

  const mockupPath = resolveWorkspacePath(workspaceRoot, args.mockupPath || 'mockup/index.html');
  const candidatePath = resolveWorkspacePath(workspaceRoot, args.candidatePath || 'rendered/rendered-blocks.html');
  const candidateKind = args.candidateKind === 'editor' ? 'editor' : 'html';
  const selector = args.selector || DEFAULT_MEASURE_SELECTOR;
  const viewports = Array.isArray(args.viewports) && args.viewports.length ? args.viewports : DEFAULT_VIEWPORTS;
  for (const file of [mockupPath, candidatePath]) {
    if (!fs.existsSync(file)) throw new Error(`measure_layout target does not exist: ${file}`);
  }

  const browser = await chromium.launch({ headless: true });
  const server = candidateKind === 'editor' ? await serveDirectory(workspaceRoot) : null;
  const measurements = [];

  try {
    for (const viewport of viewports) {
      const mockup = await measurePageGeometry(browser, { htmlPath: mockupPath, kind: 'html', viewport, selector });
      const candidate = await measurePageGeometry(browser, {
        htmlPath: candidatePath,
        kind: candidateKind,
        url: server ? server.urlFor(candidatePath) : null,
        viewport,
        selector,
      });

      const count = Math.max(mockup.elements.length, candidate.elements.length);
      const rows = [];
      for (let index = 0; index < count; index += 1) {
        const a = mockup.elements[index] || null;
        const b = candidate.elements[index] || null;
        rows.push({
          index,
          key: (a || b).key,
          mockup: a ? { top: a.top, height: a.height } : null,
          candidate: b ? { top: b.top, height: b.height } : null,
          deltaTop: a && b ? b.top - a.top : null,
          deltaHeight: a && b ? b.height - a.height : null,
          drifted: a && b ? Math.abs(b.top - a.top) > 2 || Math.abs(b.height - a.height) > 2 : true,
          missingIn: a ? (b ? null : 'candidate') : 'mockup',
        });
      }

      measurements.push({
        viewport: viewport.name,
        width: viewport.width,
        bodyHeight: { mockup: mockup.bodyHeight, candidate: candidate.bodyHeight, delta: candidate.bodyHeight - mockup.bodyHeight },
        driftedRows: rows.filter((row) => row.drifted).length,
        rows,
      });
    }
  } finally {
    await browser.close();
    if (server) await server.close();
  }

  return {
    mockupPath,
    candidatePath,
    candidateKind,
    selector,
    measurements,
    next: 'Rows with drifted=true localize the divergence. Re-run with a narrower selector (e.g. ".section-x > *") to drill into the drifted section, then fix the block tree or CSS rather than guessing from pixel diffs.',
  };
}

async function measurePageGeometry(browser, { htmlPath, kind, url, viewport, selector }) {
  const page = await browser.newPage({
    viewport: { width: Number(viewport.width), height: Number(viewport.height) },
    deviceScaleFactor: 1,
  });
  try {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    if (kind === 'editor') {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
      await page.waitForSelector('.block-editor-block-list__layout', { timeout: 60000 });
      await page.addStyleTag({ content: editorComparisonCss() });
    } else {
      await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'networkidle' });
      await page.addStyleTag({ content: `${motionFreezeCss()}\n${transientOverlayCaptureCss()}` });
    }
    await page.waitForTimeout(150);
    return await page.evaluate((sel) => {
      const seen = new Set();
      const elements = [];
      for (const node of document.querySelectorAll(sel)) {
        if (seen.has(node)) continue;
        seen.add(node);
        const rect = node.getBoundingClientRect();
        elements.push({
          key: `${node.tagName.toLowerCase()}${node.className && typeof node.className === 'string' ? ` ${node.className.split(/\s+/).filter(Boolean).slice(0, 4).join('.')}` : ''}`.trim(),
          top: Math.round(rect.top + window.scrollY),
          height: Math.round(rect.height),
        });
        if (elements.length >= 400) break;
      }
      return { elements, bodyHeight: Math.round(document.body.scrollHeight) };
    }, selector);
  } finally {
    await page.close();
  }
}

async function screenshotHtml(args) {
  const workspaceRoot = resolvePath(args.workspaceRoot);
  let chromium;
  try {
    chromium = (await import('playwright')).chromium;
  } catch (error) {
    throw new Error(`screenshot_html needs optional packages. Run npm install in ${PLUGIN_ROOT}. Missing dependency: ${error.message}`);
  }

  const outDir = resolveWorkspacePath(workspaceRoot, args.outDir || 'visual');
  fs.mkdirSync(outDir, { recursive: true });
  const viewports = Array.isArray(args.viewports) && args.viewports.length ? args.viewports : DEFAULT_VIEWPORTS;
  const targets = normalizeScreenshotTargets(workspaceRoot, args.targets);
  const needsServer = targets.some((target) => target.kind === 'editor');
  const browser = await chromium.launch({ headless: true });
  const server = needsServer ? await serveDirectory(workspaceRoot) : null;
  const screenshots = [];

  try {
    for (const target of targets) {
      for (const viewport of viewports) {
        const screenshotPath = path.join(outDir, `${safeFileSegment(target.name)}-${safeFileSegment(viewport.name)}.png`);
        if (target.kind === 'editor') {
          await captureEditor(browser, server.urlFor(target.path), screenshotPath, viewport);
        } else {
          await capture(browser, target.path, screenshotPath, viewport);
        }
        screenshots.push({
          target: target.name,
          kind: target.kind,
          sourcePath: target.path,
          viewport: viewport.name,
          size: `${viewport.width}x${viewport.height}`,
          screenshotPath,
        });
      }
    }
  } finally {
    await browser.close();
    if (server) await server.close();
  }

  return {
    outDir,
    screenshots,
    next: 'Inspect the screenshots directly, or use compare_html when you need measured diffs against the mockup.',
  };
}

function normalizeScreenshotTargets(workspaceRoot, targets) {
  const normalized = Array.isArray(targets) && targets.length
    ? targets.map((target) => ({
        name: String(target.name || '').trim(),
        path: resolveWorkspacePath(workspaceRoot, target.path || ''),
        kind: target.kind === 'editor' ? 'editor' : 'html',
      }))
    : [
        { name: 'mockup', path: path.join(workspaceRoot, 'mockup/index.html'), kind: 'html' },
        { name: 'rendered', path: path.join(workspaceRoot, 'rendered/rendered-blocks.html'), kind: 'html' },
        { name: 'editor', path: path.join(workspaceRoot, 'editor/block-editor.html'), kind: 'editor' },
      ].filter((target) => fs.existsSync(target.path));

  if (!normalized.length) {
    throw new Error('No screenshot targets found. Pass targets or create mockup/rendered/editor files first.');
  }

  for (const target of normalized) {
    if (!target.name) throw new Error('Every screenshot target needs a non-empty name.');
    if (!fs.existsSync(target.path)) throw new Error(`Screenshot target does not exist: ${target.path}`);
    if (!isPathInside(workspaceRoot, target.path)) {
      throw new Error(`Screenshot target must be inside workspaceRoot: ${target.path}`);
    }
  }

  return normalized;
}

function safeFileSegment(value) {
  const safe = String(value || '').toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return safe || 'target';
}

function aggregateComparisonResults(results) {
  if (!results.length) return { maxMismatchPercent: 0, maxHeightDelta: 0 };
  return {
    maxMismatchPercent: Math.max(...results.map((result) => result.mismatchPercent)),
    maxHeightDelta: Math.max(...results.map((result) => result.heightDelta)),
  };
}

function comparisonTasks(results, thresholds) {
  const tasks = [];
  for (const result of results) {
    const surface = result.target === 'editor' ? 'editor preview' : 'rendered frontend';
    const label = result.target === 'editor' ? 'Editor preview' : 'Rendered page';
    if (result.heightDelta > thresholds.maxHeightDelta) {
      tasks.push({
        priority: 'high',
        surface,
        viewport: result.viewport,
        issue: `${label} height differs by ${result.heightDelta}px.`,
        target: result.target === 'editor' ? 'editable editor canvas / block edit output' : 'macro layout / section vertical scale',
        fix: result.target === 'editor'
          ? 'Inspect mockup/editor/diff screenshots and restore edit render structure, wrapper scale, missing block content, responsive behavior, or editor-only CSS drift.'
          : 'Inspect screenshots and restore missing content, section height, component scale, responsive columns, or vertical rhythm before fine polish.',
        verification: `Height delta <= ${thresholds.maxHeightDelta}px for ${result.viewport}.`,
        images: { mockup: result.mockup, candidate: result.candidate, rendered: result.rendered, editor: result.editor, diff: result.diff },
      });
    }
    if (result.mismatchPercent > thresholds.maxMismatchPercent) {
      tasks.push({
        priority: result.mismatchPercent > thresholds.maxMismatchPercent * 3 ? 'high' : 'medium',
        surface,
        viewport: result.viewport,
        issue: `${label} pixel mismatch is ${result.mismatchPercent}%.`,
        target: result.target === 'editor' ? 'visible editor canvas differences in screenshot diff' : 'visible frontend differences in screenshot diff',
        fix: result.target === 'editor'
          ? 'Inspect mockup/editor/diff images. Write specific tasks for edit component output, missing editable text, wrapper classes, wrong grids, button layout, component scale, color, and typography.'
          : 'Inspect mockup/rendered/diff images. Write specific tasks for missing elements, wrong grid geometry, button layout, component scale, color, and typography.',
        verification: `Mismatch <= ${thresholds.maxMismatchPercent}% for ${result.viewport}.`,
        images: { mockup: result.mockup, candidate: result.candidate, rendered: result.rendered, editor: result.editor, diff: result.diff },
      });
    }
  }
  return tasks;
}

function renderRepairTasks(tasks, report) {
  const lines = [
    '# Repair Tasks',
    '',
    `Mockup: ${report.mockupPath}`,
    `Rendered: ${report.renderedPath}`,
    ...(report.editorPath ? [`Editor: ${report.editorPath}`] : []),
    `Max mismatch: ${report.aggregate.maxMismatchPercent}%`,
    `Max height delta: ${report.aggregate.maxHeightDelta}px`,
    ...(report.aggregates ? [
      `Rendered aggregate: ${report.aggregates.rendered.maxMismatchPercent}% mismatch, ${report.aggregates.rendered.maxHeightDelta}px height delta`,
      `Editor aggregate: ${report.aggregates.editor.maxMismatchPercent}% mismatch, ${report.aggregates.editor.maxHeightDelta}px height delta`,
    ] : []),
    '',
  ];
  if (!tasks.length) {
    lines.push('No deterministic visual drift tasks. Inspect screenshots for residual polish.');
  } else {
    for (const task of tasks) {
      lines.push(
        `- [ ] Priority: ${task.priority}`,
        `  Surface: ${task.surface}`,
        `  Viewport: ${task.viewport}`,
        `  Issue: ${task.issue}`,
        `  Target: ${task.target}`,
        `  Fix: ${task.fix}`,
        `  Verify: ${task.verification}`,
        `  Images: ${task.images.mockup}, ${task.images.candidate}, ${task.images.diff}`,
        ''
      );
    }
  }
  return `${lines.join('\n').replace(/\n+$/g, '')}\n`;
}

function extractInventory(html) {
  const sections = [];
  const sectionPattern = /<(header|section|footer|main|aside|article|nav)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
  let match;
  let index = 0;
  while ((match = sectionPattern.exec(html))) {
    index += 1;
    const tagName = match[1].toLowerCase();
    const attrs = parseAttrs(match[2]);
    const inner = match[3];
    const id = attrs['data-section'] || attrs.id || attrs.class || `${tagName}-${index}`;
    sections.push({
      id: slug(id) || `${tagName}-${index}`,
      selector: attrs.id ? `#${attrs.id}` : attrs.class ? `.${attrs.class.split(/\s+/)[0]}` : tagName,
      tagName,
      className: attrs.class || '',
      text: cleanText(inner),
      headings: extractHeadings(inner),
      paragraphs: extractParagraphs(inner),
      links: extractLinks(inner),
      forms: extractForms(inner),
      cards: extractCards(inner),
      html: match[0],
    });
  }
  return {
    sections,
    headings: extractHeadings(html),
    paragraphs: extractParagraphs(html),
    links: extractLinks(html),
    forms: extractForms(html),
    cards: extractCards(html),
  };
}

function extractHeadings(html) {
  return [...html.matchAll(/<h([1-6])\b([^>]*)>([\s\S]*?)<\/h\1>/gi)]
    .map((match) => ({ level: Number(match[1]), className: parseAttrs(match[2]).class || '', content: cleanText(match[3]) }))
    .filter((item) => item.content);
}

function extractParagraphs(html) {
  return [...html.matchAll(/<p\b([^>]*)>([\s\S]*?)<\/p>/gi)]
    .map((match) => ({ className: parseAttrs(match[1]).class || '', content: cleanText(match[2]) }))
    .filter((item) => item.content);
}

function extractLinks(html) {
  return [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)]
    .map((match) => {
      const attrs = parseAttrs(match[1]);
      return { className: attrs.class || '', url: attrs.href || '', text: cleanText(match[2]) };
    })
    .filter((item) => item.text || item.url);
}

function extractForms(html) {
  return [...html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)].map((match) => {
    const attrs = parseAttrs(match[1]);
    const inner = match[2];
    const fields = [...inner.matchAll(/<label\b[^>]*>([\s\S]*?)<\/label>/gi)].map((labelMatch, index) => {
      const labelHtml = labelMatch[1];
      const control = firstMatch(labelHtml, /<(input|select|textarea)\b([^>]*)>/i, 0);
      const controlAttrs = control ? parseAttrs(control.replace(/^<\w+\s*|\s*\/?>$/g, '')) : {};
      return {
        label: cleanText(labelHtml.replace(/<(input|select|textarea)\b[\s\S]*$/i, '')) || `Field ${index + 1}`,
        type: control?.startsWith('<textarea') ? 'textarea' : control?.startsWith('<select') ? 'select' : controlAttrs.type || 'text',
        name: controlAttrs.name || '',
        placeholder: controlAttrs.placeholder || '',
        required: Object.prototype.hasOwnProperty.call(controlAttrs, 'required'),
      };
    });
    return {
      className: attrs.class || '',
      action: attrs.action || '',
      method: attrs.method || 'post',
      fields,
      buttonText: cleanText(firstMatch(inner, /<button\b[^>]*>([\s\S]*?)<\/button>/i) || ''),
    };
  });
}

function extractCards(html) {
  return [...html.matchAll(/<article\b([^>]*)>([\s\S]*?)<\/article>/gi)].map((match) => ({
    className: parseAttrs(match[1]).class || '',
    title: extractHeadings(match[2])[0]?.content || '',
    text: extractParagraphs(match[2])[0]?.content || '',
    links: extractLinks(match[2]),
  }));
}

function parseAttrs(value) {
  const attrs = {};
  for (const match of String(value || '').matchAll(/([:@A-Za-z0-9_-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) {
    attrs[match[1]] = match[2] ?? match[3] ?? match[4] ?? '';
  }
  return attrs;
}

function extractCustomProperties(css) {
  const props = {};
  for (const match of css.matchAll(/(--[A-Za-z0-9_-]+)\s*:\s*([^;]+);/g)) props[match[1]] = match[2].trim();
  return props;
}

function extractSelectors(css) {
  return [...new Set([...css.matchAll(/([^{}@]+)\{/g)].map((match) => match[1].trim()).filter(Boolean))];
}

function normalizeAttributes(attributes, form) {
  const normalized = attributes.map((attribute) => ({
    name: camelName(attribute.name),
    type: ['string', 'number', 'boolean', 'array', 'object'].includes(attribute.type) ? attribute.type : 'string',
    role: attribute.role || roleFromName(attribute.name),
    default: attribute.default,
  }));
  if (form && !normalized.some((attribute) => attribute.name === 'fields')) {
    normalized.push({ name: 'fields', type: 'array', role: 'form-fields', default: [] });
  }
  return normalized;
}

function blockJsonAttributes(attributes) {
  const payload = {};
  for (const attribute of attributes) {
    payload[attribute.name] = { type: attribute.type };
    if (attribute.default !== undefined) payload[attribute.name].default = attribute.default;
    else if (attribute.type === 'array') payload[attribute.name].default = [];
    else if (attribute.type === 'object') payload[attribute.name].default = {};
    else if (attribute.type === 'boolean') payload[attribute.name].default = false;
  }
  return payload;
}

function defaultSupports() {
  return {
    anchor: true,
    align: ['wide', 'full'],
    className: true,
    color: { text: true, background: true, gradients: true },
    spacing: { margin: true, padding: true, blockGap: true },
    typography: { fontSize: true, lineHeight: true },
    border: { color: true, radius: true, style: true, width: true },
    dimensions: { minHeight: true },
    html: false,
  };
}

function generateIndexJs({ name, slug, attributes, form }) {
  const richText = attributes
    .filter((attribute) => isInlineEditable(attribute) && !(form && isButtonText(attribute)))
    .map((attribute) => richTextEdit(attribute, slug))
    .join(',\n        ');
  const inspector = attributes.filter((attribute) => !isInlineEditable(attribute) && attribute.type !== 'array' && attribute.type !== 'object').map(inspectorControl).join(',\n            ');
  const formCanvas = form ? formEditCanvas(slug) : '';
  const saveContent = form ? formSaveCanvas(slug) : attributes.filter((attribute) => isInlineEditable(attribute) || attribute.type === 'array').map((attribute) => saveElement(attribute, slug)).join(',\n          ');
  return `(function (blocks, blockEditor, components, element) {
  const el = element.createElement;
  const Fragment = element.Fragment;
  const registerBlockType = blocks.registerBlockType;
  const useBlockProps = blockEditor.useBlockProps;
  const RichText = blockEditor.RichText;
  const InspectorControls = blockEditor.InspectorControls;
  const PanelBody = components.PanelBody;
  const TextControl = components.TextControl;
  const ToggleControl = components.ToggleControl;

  registerBlockType(${JSON.stringify(name)}, {
    apiVersion: 3,

    edit: function Edit(props) {
      const attributes = props.attributes;
      const setAttributes = props.setAttributes;
      const blockProps = useBlockProps({ className: ${JSON.stringify(slug)} });
      const fields = attributes.fields && attributes.fields.length ? attributes.fields : [{ label: 'Email address', type: 'email', name: 'email', placeholder: '', required: false }];
      const updateField = function (index, key, value) {
        const next = fields.slice();
        next[index] = Object.assign({}, next[index], { [key]: value });
        setAttributes({ fields: next });
      };

      return el(Fragment, null,
        ${inspector ? `el(InspectorControls, null, el(PanelBody, { title: 'Settings' }, ${inspector})),` : ''}
        el('section', blockProps,
          ${[richText, formCanvas].filter(Boolean).join(',\n          ') || "el('div', null)"}
        )
      );
    },

    save: function Save(props) {
      const attributes = props.attributes;
      const blockProps = useBlockProps.save({ className: ${JSON.stringify(slug)} });
      return el('section', blockProps,
          ${saveContent || "el('div', null)"}
      );
    }
  });
})(window.wp.blocks, window.wp.blockEditor, window.wp.components, window.wp.element);
`;
}

function richTextEdit(attribute, slugValue) {
  const tag = tagFor(attribute);
  return `el(RichText, {
            tagName: ${JSON.stringify(tag)},
            className: ${JSON.stringify(`${slugValue}__${slug(attribute.name)}`)},
            value: attributes.${attribute.name} || '',
            allowedFormats: ['core/bold', 'core/italic', 'core/link'],
            placeholder: ${JSON.stringify(titleCase(attribute.name))},
            onChange: function (value) { setAttributes({ ${attribute.name}: value }); }
          })`;
}

function inspectorControl(attribute) {
  if (attribute.type === 'boolean') {
    return `el(ToggleControl, { label: ${JSON.stringify(titleCase(attribute.name))}, checked: !!attributes.${attribute.name}, onChange: function (value) { setAttributes({ ${attribute.name}: value }); } })`;
  }
  const type = attribute.type === 'number' ? ', type: "number"' : '';
  const value = attribute.type === 'number' ? `Number(value)` : 'value';
  return `el(TextControl, { label: ${JSON.stringify(titleCase(attribute.name))}${type}, value: attributes.${attribute.name} || '', onChange: function (value) { setAttributes({ ${attribute.name}: ${value} }); } })`;
}

function formEditCanvas(slugValue) {
  return `el('form', { className: ${JSON.stringify(`${slugValue}__form`)} },
            fields.map(function (field, index) {
              return el('label', { key: field.name || index },
                el(RichText, {
                  tagName: 'span',
                  className: ${JSON.stringify(`${slugValue}__field-label`)},
                  value: field.label || '',
                  placeholder: 'Field label',
                  allowedFormats: ['core/bold', 'core/italic'],
                  onChange: function (value) { updateField(index, 'label', value); }
                }),
                field.type === 'textarea'
                  ? el('textarea', { name: field.name || '', placeholder: field.placeholder || '', rows: field.rows || 5, required: !!field.required, disabled: true })
                  : el('input', { type: field.type || 'text', name: field.name || '', placeholder: field.placeholder || '', required: !!field.required, disabled: true })
              );
            }),
            el('button', { type: 'button', disabled: true },
              el(RichText, {
                tagName: 'span',
                value: attributes.buttonText || 'Submit',
                placeholder: 'Button text',
                allowedFormats: ['core/bold', 'core/italic'],
                onChange: function (value) { setAttributes({ buttonText: value }); }
              })
            )
          )`;
}

function formSaveCanvas(slugValue) {
  return `el('form', { className: ${JSON.stringify(`${slugValue}__form`)}, action: attributes.action || '#', method: attributes.method || 'post' },
            (attributes.fields || []).map(function (field, index) {
              const name = field.name || String(field.label || 'field-' + index).toLowerCase().replace(/[^a-z0-9]+/g, '-');
              return el('label', { key: name },
                field.label || name,
                field.type === 'textarea'
                  ? el('textarea', { name: name, placeholder: field.placeholder || '', rows: field.rows || 5, required: !!field.required })
                  : el('input', { type: field.type || 'text', name: name, placeholder: field.placeholder || '', required: !!field.required })
              );
            }),
            el('button', { type: 'submit' }, attributes.buttonText || 'Submit')
          )`;
}

function saveElement(attribute, slugValue) {
  if (attribute.type === 'array') {
    return `el('div', { className: ${JSON.stringify(`${slugValue}__${slug(attribute.name)}`)} }, (attributes.${attribute.name} || []).map(function (item, index) { return el('article', { key: index }, item.title ? el('h3', null, item.title) : null, item.text ? el('p', null, item.text) : null); }))`;
  }
  if (!isInlineEditable(attribute)) return '';
  return `attributes.${attribute.name} ? el(RichText.Content, { tagName: ${JSON.stringify(tagFor(attribute))}, className: ${JSON.stringify(`${slugValue}__${slug(attribute.name)}`)}, value: attributes.${attribute.name} }) : null`;
}

function generateBlockCss({ name, slug: slugValue, form }) {
  const className = `wp-block-${name.replace('/', '-')}`;
  return `.${className} {
  box-sizing: border-box;
}

.${className} .${slugValue}__form {
  display: grid;
  gap: 1rem;
}

.${className} .${slugValue}__form label {
  display: grid;
  gap: 0.5rem;
}

.${className} .${slugValue}__form input,
.${className} .${slugValue}__form textarea,
.${className} .${slugValue}__form select,
.${className} .${slugValue}__form button {
  font: inherit;
}
${form ? '' : `\n.${className} [class$="__items"] { display: grid; gap: 1rem; }\n`}
`;
}

function isInlineEditable(attribute) {
  const role = `${attribute.role || ''} ${attribute.name}`.toLowerCase();
  if (/url|href|action|method|required|placeholder|inputname|style|variant|speed|duration|fields/.test(role)) return false;
  return attribute.type === 'string';
}

function isButtonText(attribute) {
  return /button|cta|submit/.test(`${attribute.role || ''} ${attribute.name}`.toLowerCase());
}

function tagFor(attribute) {
  const role = `${attribute.role || ''} ${attribute.name}`.toLowerCase();
  if (/heading|title|headline/.test(role)) return 'h2';
  if (/eyebrow|kicker|label/.test(role)) return 'p';
  if (/button|cta/.test(role)) return 'span';
  return 'p';
}

function roleFromName(name) {
  const value = String(name).toLowerCase();
  if (/heading|title|headline/.test(value)) return 'heading';
  if (/body|text|intro|description|copy|lede/.test(value)) return 'body';
  if (/button|cta|submit/.test(value)) return 'button-text';
  if (/url|href|link/.test(value)) return 'url';
  if (/fields?/.test(value)) return 'form-fields';
  return 'content';
}

function looksFormLike(name, attributes) {
  return /form|search|subscribe|booking|contact|inquiry|email/.test(`${name} ${attributes.map((attribute) => `${attribute.name} ${attribute.role}`).join(' ')}`.toLowerCase());
}

function starterHtml(prompt) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>HTML to Blocks Mockup</title>
    <link rel="stylesheet" href="./style.css">
  </head>
  <body>
    <main>
      <!-- Replace this starter with the designed source-of-truth mockup for:
${escapeHtml(prompt)}
      -->
    </main>
  </body>
</html>
`;
}

function starterCss() {
  return `:root {
  --paper: #f8f5ef;
  --ink: #181512;
}

* { box-sizing: border-box; }
body { margin: 0; background: var(--paper); color: var(--ink); font-family: system-ui, sans-serif; }
`;
}

function fullHtml(title, css, body) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(title)}</title>
    <style>
${css}
    </style>
  </head>
  <body>
${body}
  </body>
</html>
`;
}

function renderedPreviewHtml(title, outDir, cssSources, body) {
  // CSS is linked (not inlined) so relative url() assets resolve from each
  // stylesheet's own directory — identical to how the editor preview loads
  // the same files. Inlining used to shift url() resolution to the rendered/
  // directory, splitting asset paths between the two surfaces.
  const cssLinks = cssSources
    .map((source) => `<link rel="stylesheet" href="${escapeAttr(relativeUrl(outDir, source.path))}">`)
    .join('\n    ');
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(title)}</title>
    ${cssLinks}
  </head>
  <body>
${body}
  </body>
</html>
`;
}

function copyReference(name, target) {
  const source = path.join(PLUGIN_ROOT, 'skills/html-to-blocks/references', name);
  if (fs.existsSync(source)) writeFile(target, fs.readFileSync(source, 'utf8'));
}
