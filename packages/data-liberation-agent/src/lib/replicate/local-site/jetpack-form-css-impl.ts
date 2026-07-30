import postcss, { type AtRule, type Declaration, type Document, type Rule } from 'postcss';
import selectorParser from 'postcss-selector-parser';

import type { JetpackFormParityCssInput, JetpackFormParityCssResult } from './jetpack-form-css.js';

type TargetKind = 'form' | 'field' | 'control' | 'label' | 'submit';
type TargetState = 'base' | 'focus';
type TargetKey = `${TargetKind}:${TargetState}`;

interface CarryDeclaration {
  prop: string;
  value: string;
  important: boolean;
}

interface AtRuleFrame {
  name: string;
  params: string;
}

type PostcssParent = Rule['parent'] | Document;

const FORM_CONTEXTS = ['.wp-block-jetpack-contact-form', '.jetpack-contact-form-container'] as const;
const JETPACK_FORM_SELECTOR = '.contact-form.commentsblock.jetpack-contact-form__form';
export const JETPACK_FORM_PARITY_NEVER_CARRY_PROPERTIES: ReadonlySet<string> = new Set([
  'display',
  'visibility',
  'position',
  'opacity',
  'transform',
  'float',
  'clip',
  'clip-path',
  'z-index',
]);

const FORM_TARGETS = [
  ...FORM_CONTEXTS,
  ...withContexts([JETPACK_FORM_SELECTOR]),
];

const FIELD_TARGETS = withContexts([
  `${JETPACK_FORM_SELECTOR} [class*="grunion-field-"][class*="-wrap"]`,
  `${JETPACK_FORM_SELECTOR} .contact-form__inset-label-wrap`,
  `${JETPACK_FORM_SELECTOR} .contact-form__select-wrapper`,
]);

const CONTROL_TARGETS = withContexts([
  `${JETPACK_FORM_SELECTOR} input.grunion-field:not([type=checkbox]):not([type=radio]):not([type=hidden])`,
  `${JETPACK_FORM_SELECTOR} textarea.grunion-field`,
  `${JETPACK_FORM_SELECTOR} .grunion-field-url-wrap input.grunion-field[type=text]`,
  `${JETPACK_FORM_SELECTOR} .contact-form__select-wrapper select`,
]);

const LABEL_TARGETS = withContexts([`${JETPACK_FORM_SELECTOR} .grunion-field-label`]);

const SUBMIT_TARGETS = withContexts([
  `${JETPACK_FORM_SELECTOR} .wp-block-jetpack-button .wp-block-button__link`,
  '.wp-block-jetpack-button .wp-block-button__link',
  `${JETPACK_FORM_SELECTOR} .contact-submit button[type=submit]`,
  `${JETPACK_FORM_SELECTOR} button.pushbutton-wide`,
]);

const NON_FOCUS_STATE_PSEUDOS = new Set([
  ':active',
  ':checked',
  ':disabled',
  ':enabled',
  ':hover',
  ':invalid',
  ':optional',
  ':placeholder-shown',
  ':required',
  ':valid',
  ':visited',
]);

export function buildJetpackFormParityCssImpl(input: JetpackFormParityCssInput): JetpackFormParityCssResult {
  if (input.formsConverted <= 0 || input.sourceCss.trim() === '') return { css: '' };

  let root: postcss.Root;
  try {
    root = postcss.parse(input.sourceCss);
  } catch {
    return { css: '' };
  }

  const fragments: string[] = [];

  root.walkRules((rule) => {
    if (isInsideKeyframes(rule)) return;

    const keys = matchingTargetKeys(rule);
    if (keys.length === 0) return;

    for (const key of keys) {
      const [kind, state] = key.split(':') as [TargetKind, TargetState];
      const declarations = carryDeclarations(rule, kind);
      if (declarations.length === 0) continue;
      const targets = targetSelectors(kind, state);
      fragments.push(formatRule(targets, declarations, atRuleFrames(rule)));
    }
  });

  return { css: fragments.join('\n') };
}

function withContexts(selectorTails: string[]): string[] {
  return FORM_CONTEXTS.flatMap((context) => selectorTails.map((tail) => `${context} ${tail}`));
}

function carryDeclarations(rule: Rule, kind: TargetKind): CarryDeclaration[] {
  const declarations: CarryDeclaration[] = [];
  for (const node of rule.nodes ?? []) {
    if (node.type !== 'decl') continue;
    const decl = node as Declaration;
    const prop = decl.prop.trim().toLowerCase();
    const value = decl.value.trim();
    if (!prop || !value || !isCarryProperty(prop, kind)) continue;
    declarations.push({ prop, value, important: decl.important });
  }
  return declarations;
}

function isCarryProperty(prop: string, kind: TargetKind): boolean {
  if (JETPACK_FORM_PARITY_NEVER_CARRY_PROPERTIES.has(prop)) return false;

  if (
    prop === 'color' ||
    prop === 'height' ||
    prop === 'line-height' ||
    prop === 'letter-spacing' ||
    prop === 'min-height' ||
    prop === 'min-width' ||
    prop === 'background' ||
    prop === 'background-color' ||
    prop === 'box-shadow' ||
    prop === 'width' ||
    prop === 'max-width' ||
    prop.startsWith('border') ||
    prop.startsWith('outline') ||
    prop.startsWith('padding') ||
    prop.startsWith('font')
  ) {
    return true;
  }

  if ((kind === 'form' || kind === 'field') && isLayoutProperty(prop)) return true;
  if ((kind === 'label' || kind === 'submit') && (prop === 'display' || prop.startsWith('margin'))) return true;
  if (kind === 'submit' && (prop === 'text-decoration' || prop === 'text-transform')) return true;

  return false;
}

function isLayoutProperty(prop: string): boolean {
  return (
    prop === 'display' ||
    prop === 'gap' ||
    prop === 'row-gap' ||
    prop === 'column-gap' ||
    prop === 'align-items' ||
    prop === 'justify-items' ||
    prop === 'justify-content' ||
    prop === 'flex-direction' ||
    prop === 'flex-wrap' ||
    prop === 'grid-template-columns' ||
    prop === 'grid-template-rows' ||
    prop.startsWith('margin')
  );
}

function matchingTargetKeys(rule: Rule): TargetKey[] {
  const keys = new Set<TargetKey>();
  for (const selector of rule.selectors) {
    const match = classifySelector(selector);
    if (!match) continue;
    const state: TargetState = match.focus ? 'focus' : 'base';
    for (const kind of match.kinds) keys.add(`${kind}:${state}`);
  }
  return [...keys];
}

function classifySelector(selector: string): { kinds: Set<TargetKind>; focus: boolean } | null {
  let root: selectorParser.Root;
  try {
    root = selectorParser().astSync(selector, { lossless: false });
  } catch {
    return null;
  }

  const kinds = new Set<TargetKind>();
  let focus = false;
  let unsupportedState = false;

  for (const parsed of root.nodes) {
    const selectorParts = selectorSignals(parsed);
    if (selectorParts.unsupportedState) unsupportedState = true;
    if (selectorParts.focus) focus = true;

    const hasSubmitElement =
      selectorParts.tags.includes('button') ||
      (selectorParts.hasTypeSubmit && selectorParts.tags.includes('input'));
    const hasControlElement =
      selectorParts.tags.some((tag) => tag === 'select' || tag === 'textarea') ||
      (selectorParts.tags.includes('input') && !hasSubmitElement);
    const hasLabelElement = selectorParts.tags.includes('label') || selectorParts.classes.some(isLabelClass);
    const hasFieldWrapper = selectorParts.classes.some(isFieldClass);
    const hasFormRoot =
      selectorParts.tags.includes('form') ||
      selectorParts.classes.some(isFormClass) ||
      selectorParts.ids.some(isFormId);

    if (hasControlElement || selectorParts.classes.some(isControlClass)) kinds.add('control');
    if (hasLabelElement) kinds.add('label');
    if (hasSubmitElement || selectorParts.classes.some(isSubmitClass)) kinds.add('submit');
    if (hasFieldWrapper && !hasControlElement && !hasLabelElement && !hasSubmitElement) kinds.add('field');
    if (hasFormRoot && kinds.size === 0) kinds.add('form');
  }

  if (unsupportedState || kinds.size === 0) return null;
  return { kinds, focus };
}

function selectorSignals(selector: selectorParser.Selector): {
  tags: string[];
  classes: string[];
  ids: string[];
  hasTypeSubmit: boolean;
  focus: boolean;
  unsupportedState: boolean;
} {
  const tags: string[] = [];
  const classes: string[] = [];
  const ids: string[] = [];
  let hasTypeSubmit = false;
  let focus = false;
  let unsupportedState = false;

  selector.walk((node) => {
    if (isInsideFunctionalPseudo(node)) return;

    if (selectorParser.isTag(node)) {
      tags.push(node.value.toLowerCase());
      return;
    }

    if (selectorParser.isClassName(node)) {
      classes.push(node.value.toLowerCase());
      return;
    }

    if (node.type === 'id') {
      const value = (node as { value?: string }).value;
      if (value) ids.push(value.toLowerCase());
      return;
    }

    if (selectorParser.isAttribute(node)) {
      const name = node.attribute.toLowerCase();
      const value = (node.value ?? '').toLowerCase();
      if (name === 'type' && node.operator === '=' && value === 'submit') hasTypeSubmit = true;
      return;
    }

    if (selectorParser.isPseudo(node)) {
      const value = node.value.toLowerCase();
      if (value === ':focus' || value === ':focus-visible') {
        focus = true;
        return;
      }
      if (NON_FOCUS_STATE_PSEUDOS.has(value)) unsupportedState = true;
    }
  });

  return { tags, classes, ids, hasTypeSubmit, focus, unsupportedState };
}

function isInsideFunctionalPseudo(node: selectorParser.Node): boolean {
  let parent = node.parent;
  while (parent) {
    if (selectorParser.isPseudo(parent)) return true;
    parent = parent.parent;
  }
  return false;
}

function isControlClass(className: string): boolean {
  if (['form-control', 'form-input', 'form-select', 'form-textarea'].includes(className)) return true;
  if (/^(?:input|select|textarea)(?:[-_](?:field|control))?$/.test(className)) return true;
  if (/^(?:field|control)[-_](?:input|select|textarea)$/.test(className)) return true;
  if (/(?:^|[-_])form[-_](?:control|field|input|select|textarea)(?:$|[-_])/.test(className)) return true;
  if (
    /(?:^|[-_])(?:input|select|textarea)(?:$|[-_])/.test(className) &&
    /(?:form|field|control|contact|email|message|name|phone)/.test(className)
  ) {
    return true;
  }
  if (
    /(?:^|[-_])(?:field|control)(?:$|[-_])/.test(className) &&
    /(?:form|contact|input|select|textarea)/.test(className)
  ) {
    return true;
  }
  return false;
}

function isFormClass(className: string): boolean {
  if (className === 'form') return true;
  if (!/(?:^|[-_])form(?:$|[-_])/.test(className)) return false;
  return !/(?:input|select|textarea|label|submit|button|btn|control|field|check|checkbox|radio)/.test(className);
}

function isFormId(id: string): boolean {
  return isFormClass(id);
}

function isFieldClass(className: string): boolean {
  if (['field', 'form-field', 'form-group', 'form-row', 'form-check', 'input-group'].includes(className)) return true;
  return (
    /(?:^|[-_])(?:form|contact)[-_](?:field|group|row|check)(?:$|[-_])/.test(className) ||
    /(?:^|[-_])(?:field|group|row|check)[-_](?:form|contact)(?:$|[-_])/.test(className)
  );
}

function isLabelClass(className: string): boolean {
  if (className === 'label' || className === 'form-label') return true;
  return /(?:^|[-_])(?:form|field|contact)[-_]label(?:$|[-_])/.test(className);
}

function isSubmitClass(className: string): boolean {
  if (className === 'submit' || className === 'form-submit') return true;
  return (
    /(?:^|[-_])(?:form|contact)[-_]submit(?:$|[-_])/.test(className) ||
    /(?:^|[-_])submit[-_](?:button|btn)(?:$|[-_])/.test(className)
  );
}

function targetSelectors(kind: TargetKind, state: TargetState): string[] {
  const selectors =
    kind === 'form'
      ? FORM_TARGETS
      : kind === 'field'
        ? FIELD_TARGETS
        : kind === 'control'
          ? CONTROL_TARGETS
          : kind === 'label'
            ? LABEL_TARGETS
            : SUBMIT_TARGETS;
  return state === 'focus' ? selectors.map(appendFocusPseudo) : selectors;
}

function appendFocusPseudo(selector: string): string {
  return `${selector}:focus`;
}

function atRuleFrames(rule: Rule): AtRuleFrame[] {
  const frames: AtRuleFrame[] = [];
  let parent: PostcssParent | undefined = rule.parent;
  while (parent) {
    if (parent.type === 'atrule') {
      const atRule = parent as AtRule;
      frames.unshift({ name: atRule.name, params: atRule.params });
    }
    parent = parent.parent;
  }
  return frames;
}

function isInsideKeyframes(rule: Rule): boolean {
  let parent: PostcssParent | undefined = rule.parent;
  while (parent) {
    if (parent.type === 'atrule' && /keyframes$/i.test((parent as AtRule).name)) return true;
    parent = parent.parent;
  }
  return false;
}

function formatRule(selectors: string[], declarations: CarryDeclaration[], frames: AtRuleFrame[]): string {
  let css = `${selectors.join(',')}{${declarations.map(formatDeclaration).join(';')}}`;
  for (let i = frames.length - 1; i >= 0; i -= 1) {
    const frame = frames[i];
    css = `@${frame.name}${frame.params ? ` ${frame.params}` : ''}{${css}}`;
  }
  return css;
}

function formatDeclaration(decl: CarryDeclaration): string {
  return `${decl.prop}:${decl.value}${decl.important ? '!important' : ''}`;
}
