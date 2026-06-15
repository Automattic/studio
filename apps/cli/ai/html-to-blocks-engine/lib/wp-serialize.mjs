// tools/lib/wp-serialize.mjs — WordPress block registration + tree serialization shared by all skills' tools.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { PLUGIN_ROOT, findFiles, readJson, slug, titleCase } from './workspace.mjs';

const require = createRequire(import.meta.url);
const customInnerBlocksStack = [];
const customBlockPropsStack = [];
const ALLOWED_GROUP_TAGS = new Set(['div', 'main', 'section', 'article', 'aside', 'header', 'footer']);
let coreBlocksRegistered = false;
let domEnvironmentReady = false;

export function stripBlockComments(markup) {
    return String(markup || '')
        .replace(/<!--\s*\/?wp:[\s\S]*?-->\s*/g, '')
        .replace(/>\s+</g, '><');
}

export function serializeBlockTreeWithWordPress(tree, context) {
    const { createBlock, serialize } = loadWordPressBlocks();
    registerWordPressCoreBlocks();
    registerWorkspaceCustomBlocks(context.workspaceRoot);
    const blocks = Array.isArray(tree) ? tree : tree.blocks;
    if (!Array.isArray(blocks)) {
        throw new Error('Block tree must be an array or an object with a blocks array.');
    }
    return serialize(blocks.map((block) => toWordPressBlock(block, createBlock)));
}

function toWordPressBlock(block, createBlock) {
    if (!block || typeof block !== 'object') throw new Error('Every block tree item must be an object.');
    assertDataOnlyBlock(block);
    const blockName = block.blockName || block.name;
    if (!blockName || typeof blockName !== 'string') throw new Error('Every block tree item needs blockName or name.');
    const attrs = block.attrs || block.attributes || {};
    validateBlockContract(blockName, attrs);
    const innerBlocks = (block.innerBlocks || []).map((child) => toWordPressBlock(child, createBlock));
    return createBlock(blockName, attrs, innerBlocks);
}

function assertDataOnlyBlock(block) {
    for (const key of ['htmlLines', 'innerHTML', 'innerContent', 'html', 'markup', 'sourceHtml', 'innerHtml']) {
        if (Object.prototype.hasOwnProperty.call(block, key)) {
            throw new Error(`Data-only block tree violation in ${block.blockName || block.name || 'unknown block'}: remove ${key}. Use attrs, style, className, and innerBlocks only.`);
        }
    }
}

function validateBlockContract(blockName, attrs) {
    if (!blockName.startsWith('core/')) return;
    const { getBlockType } = loadWordPressBlocks();
    const blockType = getBlockType(blockName);
    if (!blockType) {
        throw new Error(`${blockName} is not registered by @wordpress/block-library. Use a real registered core block or a custom block; do not invent core blocks.`);
    }
    const allowed = new Set(Object.keys(blockType.attributes || {}));
    for (const key of Object.keys(attrs || {})) {
        if (!allowed.has(key)) {
            throw new Error(`${blockName} does not define "${key}" in WordPress block metadata. Move semantic attributes into a custom block or supported WordPress attributes.`);
        }
    }
    if (blockName === 'core/group') {
        const tagName = attrs.tagName || 'div';
        if (!ALLOWED_GROUP_TAGS.has(tagName)) {
            throw new Error(`core/group tagName "${tagName}" is not allowed. Use core/group only for block-level containers or create a semantic custom block.`);
        }
    }
}

export function registerWorkspaceCustomBlocks(workspaceRoot, blocksDir) {
    const root = blocksDir || (workspaceRoot ? path.join(workspaceRoot, 'wordpress/blocks') : '');
    if (!root) return;
    const blockRoots = findFiles(root, 'index.js').map((file) => path.dirname(file));
    for (const blockRoot of blockRoots) {
        registerWorkspaceCustomBlock(blockRoot);
    }
}

function registerWorkspaceCustomBlock(blockRoot) {
    const indexPath = path.join(blockRoot, 'index.js');
    if (!fs.existsSync(indexPath)) return;
    const blockJsonPath = path.join(blockRoot, 'block.json');
    const blockJson = fs.existsSync(blockJsonPath) ? readJson(blockJsonPath) : {};
    const { registerBlockType, unregisterBlockType, getBlockType } = loadWordPressBlocks();
    const element = loadWordPressElement();
    const blockEditor = createBlockEditorShim();
    const components = createComponentShim();
    const blocks = {
        ...loadWordPressBlocks(),
        registerBlockType(name, settings) {
            if (getBlockType(name)) unregisterBlockType(name);
            return registerBlockType(name, normalizeCustomBlockSettings(name, settings, blockJson));
        },
    };
    const context = vm.createContext({
        window: { wp: { blocks, blockEditor, components, element } },
        wp: { blocks, blockEditor, components, element },
        console,
    });
    vm.runInContext(fs.readFileSync(indexPath, 'utf8'), context, { filename: indexPath });
}

function normalizeCustomBlockSettings(name, settings, blockJson = {}) {
    const save = settings.save
        ? (props) => {
                customBlockPropsStack.push({ name, attributes: props.attributes || {} });
                customInnerBlocksStack.push(props.innerBlocks || []);
                try {
                    return settings.save(props);
                } finally {
                    customInnerBlocksStack.pop();
                    customBlockPropsStack.pop();
                }
            }
        : undefined;
    return {
        apiVersion: 3,
        title: titleCase(name.split('/')[1] || name),
        category: 'design',
        ...blockJson,
        ...settings,
        attributes: { ...(blockJson.attributes || {}), ...(settings.attributes || {}) },
        ...(save ? { save } : {}),
    };
}

function createBlockEditorShim() {
    const { createElement: el, RawHTML } = loadWordPressElement();
    const { serialize } = loadWordPressBlocks();
    const useBlockProps = (props = {}) => blockPropsWithSupports(props, customBlockPropsStack.at(-1));
    useBlockProps.save = (props = {}) => blockPropsWithSupports(props, customBlockPropsStack.at(-1));
    const RichText = () => null;
    RichText.Content = ({ tagName = 'div', value = '', ...props }) => {
        const cleanProps = { ...props };
        delete cleanProps.allowedFormats;
        delete cleanProps.onChange;
        return el(tagName, cleanProps, el(RawHTML, null, richText(value)));
    };
    return {
        useBlockProps,
        RichText,
        InspectorControls: ({ children }) => el('div', null, children),
        InnerBlocks: {
            Content: () => el(RawHTML, null, serialize(customInnerBlocksStack.at(-1) || [], { isInnerBlocks: true })),
        },
    };
}

function blockPropsWithSupports(props = {}, context) {
    if (!context) return props;
    const attrs = context.attributes || {};
    const supportStyle = styleSupportToReactStyle(attrs.style || {});
    const mergedStyle = { ...supportStyle, ...(props.style || {}) };
    const className = mergeClasses(
        blockSupportClassName(context.name),
        supportClassNames(attrs),
        attrs.className,
        props.className
    );
    return {
        ...props,
        ...(className ? { className } : {}),
        ...(Object.keys(mergedStyle).length ? { style: mergedStyle } : {}),
    };
}

function blockSupportClassName(name) {
    return name ? `wp-block-${name.replace('/', '-')}` : '';
}

function supportClassNames(attrs) {
    const classes = [];
    if (attrs.textColor || attrs.style?.color?.text) classes.push('has-text-color');
    if (attrs.backgroundColor || attrs.style?.color?.background || attrs.style?.color?.gradient) classes.push('has-background');
    if (attrs.fontSize) classes.push(`has-${slug(attrs.fontSize)}-font-size`);
    return classes;
}

function mergeClasses(...values) {
    const seen = new Set();
    const flatten = (value) => Array.isArray(value) ? value.flatMap(flatten) : String(value || '').split(/\s+/);
    return values
        .flatMap(flatten)
        .filter((value) => {
            if (!value || seen.has(value)) return false;
            seen.add(value);
            return true;
        })
        .join(' ');
}

function styleSupportToReactStyle(style) {
    const out = {};
    if (!style || typeof style !== 'object') return out;

    assignIf(out, 'color', style.color?.text);
    assignIf(out, 'backgroundColor', style.color?.background);
    assignIf(out, 'background', style.color?.gradient);
    assignIf(out, 'fontSize', style.typography?.fontSize);
    assignIf(out, 'fontFamily', style.typography?.fontFamily);
    assignIf(out, 'lineHeight', style.typography?.lineHeight);
    assignIf(out, 'fontWeight', style.typography?.fontWeight);
    assignIf(out, 'fontStyle', style.typography?.fontStyle);
    assignIf(out, 'letterSpacing', style.typography?.letterSpacing);
    assignIf(out, 'textTransform', style.typography?.textTransform);
    assignIf(out, 'minHeight', style.dimensions?.minHeight);
    assignBox(out, 'padding', style.spacing?.padding);
    assignBox(out, 'margin', style.spacing?.margin);
    assignIf(out, 'gap', style.spacing?.blockGap);
    assignBorder(out, style.border);

    for (const [key, value] of Object.entries(style)) {
        if (key.startsWith('--')) out[key] = cssPresetValue(value);
    }

    return out;
}

function assignIf(out, key, value) {
    if (value !== undefined && value !== null && value !== '') out[key] = cssPresetValue(value);
}

function assignBox(out, prefix, value) {
    if (!value) return;
    if (typeof value === 'string') {
        out[prefix] = cssPresetValue(value);
        return;
    }
    assignIf(out, `${prefix}Top`, value.top);
    assignIf(out, `${prefix}Right`, value.right);
    assignIf(out, `${prefix}Bottom`, value.bottom);
    assignIf(out, `${prefix}Left`, value.left);
}

function assignBorder(out, border) {
    if (!border || typeof border !== 'object') return;
    assignIf(out, 'borderColor', border.color);
    assignIf(out, 'borderWidth', border.width);
    assignIf(out, 'borderStyle', border.style);
    assignIf(out, 'borderRadius', border.radius);
    for (const side of ['top', 'right', 'bottom', 'left']) {
        const sideBorder = border[side];
        if (!sideBorder || typeof sideBorder !== 'object') continue;
        const prefix = `border${titleCase(side)}`;
        assignIf(out, `${prefix}Color`, sideBorder.color);
        assignIf(out, `${prefix}Width`, sideBorder.width);
        assignIf(out, `${prefix}Style`, sideBorder.style);
    }
}

function cssPresetValue(value) {
    if (typeof value !== 'string') return value;
    const match = value.match(/^var:preset\|([a-z0-9-]+)\|([a-z0-9-]+)$/i);
    return match ? `var(--wp--preset--${match[1]}--${match[2]})` : value;
}

function createComponentShim() {
    const { createElement: el } = loadWordPressElement();
    const passthrough = ({ children }) => el('div', null, children);
    return {
        PanelBody: passthrough,
        TextControl: passthrough,
        ToggleControl: passthrough,
    };
}

function richText(value) {
    return String(value ?? '');
}

export function loadWordPressBlocks() {
    try {
        return require('@wordpress/blocks');
    } catch (error) {
        throw new Error(`WordPress block serialization needs @wordpress/blocks. Run npm install in ${PLUGIN_ROOT}. Missing dependency: ${error.message}`);
    }
}

function loadWordPressElement() {
    try {
        return require('@wordpress/element');
    } catch (error) {
        throw new Error(`WordPress block serialization needs @wordpress/element. Run npm install in ${PLUGIN_ROOT}. Missing dependency: ${error.message}`);
    }
}

export function registerWordPressCoreBlocks() {
    if (coreBlocksRegistered) return;
    setupDomEnvironment();
    try {
        require('@wordpress/block-library').registerCoreBlocks();
        coreBlocksRegistered = true;
    } catch (error) {
        throw new Error(`WordPress core block registration needs @wordpress/block-library and jsdom. Run npm install in ${PLUGIN_ROOT}. Registration failed: ${error.message}`);
    }
}

function setupDomEnvironment() {
    if (domEnvironmentReady) return;
    let JSDOM;
    let VirtualConsole;
    try {
        ({ JSDOM, VirtualConsole } = require('jsdom'));
    } catch (error) {
        throw new Error(`WordPress core block registration needs jsdom. Run npm install in ${PLUGIN_ROOT}. Missing dependency: ${error.message}`);
    }
    const virtualConsole = new VirtualConsole();
    virtualConsole.on('jsdomError', () => {});
    const dom = new JSDOM('<!doctype html><html><body></body></html>', {
        url: 'http://localhost/',
        virtualConsole,
    });
    const win = dom.window;
    globalThis.window = win;
    globalThis.document = win.document;
    Object.defineProperty(globalThis, 'navigator', { value: win.navigator, configurable: true });
    for (const key of ['HTMLElement', 'HTMLAnchorElement', 'HTMLButtonElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'Node', 'Element', 'MutationObserver', 'CustomEvent', 'File', 'Blob', 'DOMParser', 'Range', 'Selection']) {
        if (win[key]) globalThis[key] = win[key];
    }
    globalThis.getComputedStyle = win.getComputedStyle.bind(win);
    win.matchMedia ||= () => ({
        matches: false,
        media: '',
        onchange: null,
        addListener() {},
        removeListener() {},
        addEventListener() {},
        removeEventListener() {},
        dispatchEvent() { return false; },
    });
    globalThis.matchMedia = win.matchMedia;
    globalThis.requestAnimationFrame ||= (callback) => setTimeout(callback, 16);
    globalThis.cancelAnimationFrame ||= clearTimeout;
    globalThis.requestIdleCallback ||= (callback) => setTimeout(() => callback({ didTimeout: false, timeRemaining: () => 50 }), 1);
    globalThis.cancelIdleCallback ||= clearTimeout;
    domEnvironmentReady = true;
}
let registered = false;
export function ensureBlocksRegistered(workspaceRoot, { blocksDir } = {}) {
    if (!registered) { registerWordPressCoreBlocks(); registered = true; }
    registerWorkspaceCustomBlocks(workspaceRoot, blocksDir);
}

export function serializeBlocks(blocks, context) {
    return serializeBlockTreeWithWordPress({ version: 2, contract: 'data-only', blocks }, context);
}
