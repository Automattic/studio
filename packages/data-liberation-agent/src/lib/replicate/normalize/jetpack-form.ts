import type { Cheerio, CheerioAPI } from 'cheerio';
import type { Element } from 'domhandler';
import { isTag } from 'domhandler';
import type { InstanceStyleSheet } from './instance-styles.js';

export interface EmitJetpackFormOpts {}

export interface EmitJetpackFormResult {
  markup: string;
  fieldCount: number;
}

export function emitJetpackForm(
  $: CheerioAPI,
  formEl: Element,
  sheet: InstanceStyleSheet,
  opts: EmitJetpackFormOpts = {},
): EmitJetpackFormResult | null {
  void sheet;
  void opts;

  const form = resolveSingleForm($, formEl);
  if (!form) return null;

  const controls = collectControls($, form);
  if (controls.unsupported) return null;

  const emitted: string[] = [];
  let fieldCount = 0;
  const emittedRadioGroups = new Set<string>();
  const submit = findSubmit($, form);

  for (const control of controls.fields) {
    const tag = control.tagName.toLowerCase();
    const $control = $(control);

    if (tag === 'textarea') {
      emitted.push(
        fieldBlock('jetpack/field-textarea', fieldAttrs($, form, control, $control.attr('placeholder')), {
          inputType: 'textarea',
        }),
      );
      fieldCount += 1;
      continue;
    }

    if (tag === 'select') {
      const options = selectOptions($, control);
      if (options.length === 0) return null;
      emitted.push(
        fieldBlock('jetpack/field-select', fieldAttrs($, form, control, selectPlaceholder($, control), options), {
          inputType: 'dropdown',
        }),
      );
      fieldCount += 1;
      continue;
    }

    if (tag !== 'input') return null;

    const type = inputType($control);
    if (type === 'radio') {
      const name = ($control.attr('name') ?? '').trim();
      const groupKey = name ? `name:${name}` : `node:${controls.fields.indexOf(control)}`;
      if (emittedRadioGroups.has(groupKey)) continue;

      const group = radioGroup($, form, control);
      if (!group) return null;
      emittedRadioGroups.add(groupKey);
      emitted.push(choiceFieldBlock('jetpack/field-radio', group, 'radio'));
      fieldCount += 1;
      continue;
    }

    if (type === 'checkbox') {
      const attrs = fieldAttrs($, form, control);
      const blockName = isConsentCheckbox($, control, attrs.label) ? 'jetpack/field-consent' : 'jetpack/field-checkbox';
      emitted.push(standaloneOptionFieldBlock(blockName, attrs));
      fieldCount += 1;
      continue;
    }

    const mapped = inputBlockName($, control);
    if (!mapped) return null;
    emitted.push(
      fieldBlock(mapped, fieldAttrs($, form, control, $control.attr('placeholder')), {
        inputBlockName: mapped === 'jetpack/field-telephone' ? 'jetpack/phone-input' : 'jetpack/input',
        inputType: mapped === 'jetpack/field-telephone' ? undefined : type,
      }),
    );
    fieldCount += 1;
  }

  if (fieldCount === 0) return null;
  if (submit) emitted.push(submitBlock($, submit));

  return {
    markup: `<!-- wp:jetpack/contact-form -->\n<div class="wp-block-jetpack-contact-form">\n${emitted.join('\n')}\n</div>\n<!-- /wp:jetpack/contact-form -->`,
    fieldCount,
  };
}

type FieldAttrs = {
  label?: string;
  required?: boolean;
  placeholder?: string;
  options?: string[];
};

type JetpackBlockAttrs = FieldAttrs & {
  consentType?: string;
  element?: string;
  explicitConsentMessage?: string;
  hideInput?: boolean;
  isStandalone?: boolean;
  requiredText?: string;
  text?: string;
  type?: string;
};

interface FieldBlockParts {
  inputBlockName?: 'jetpack/input' | 'jetpack/phone-input';
  inputType?: string;
}

interface CollectedControls {
  fields: Element[];
  unsupported: boolean;
}

const FIELD_SELECTOR = 'input, select, textarea';
const INTERACTIVE_SELECTOR = 'button, input, select, textarea';
const IGNORED_INPUT_TYPES = new Set(['hidden']);

function resolveSingleForm($: CheerioAPI, root: Element): Element | null {
  const tag = root.tagName?.toLowerCase() ?? '';
  if (tag === 'form') return root;

  const forms = $(root).find('form').toArray() as Element[];
  if (forms.length !== 1) return null;

  const [form] = forms;
  if (!onlyMeaningfulContentIsForm($, root, form)) return null;

  const interactiveOutsideForm = $(root)
    .find(INTERACTIVE_SELECTOR)
    .toArray()
    .some((node) => !isInside($, node as Element, form));

  return interactiveOutsideForm ? null : form;
}

function onlyMeaningfulContentIsForm($: CheerioAPI, root: Element, form: Element): boolean {
  if (hasMeaningfulAttrs(root)) return false;

  const rootClone = $(root).clone();
  rootClone.find('form').remove();
  if (normalizeText(rootClone.text())) return false;

  return rootClone
    .find('*')
    .toArray()
    .every((node) => {
      const $node = $(node as Element);
      const tag = (node as Element).tagName?.toLowerCase() ?? '';
      const attrs = (node as Element).attribs ?? {};
      if (tag === 'img' || tag === 'picture' || tag === 'svg' || tag === 'video' || tag === 'canvas') return false;
      if (hasMeaningfulAttrs(node as Element)) return false;
      if (attrs.src || attrs.href || attrs.role || attrs['aria-label']) return false;
      return $node.children().length === 0 && !normalizeText($node.text());
    });
}

function hasMeaningfulAttrs(el: Element): boolean {
  return Object.keys(el.attribs ?? {}).some((name) => name !== 'data-astro-cid');
}

function collectControls($: CheerioAPI, form: Element): CollectedControls {
  const fields: Element[] = [];
  const checkboxNames = new Map<string, number>();
  let unsupported = false;

  for (const node of $(form).find(FIELD_SELECTOR).toArray()) {
    if (!isTag(node)) continue;
    const el = node as Element;
    const tag = el.tagName.toLowerCase();
    const $el = $(el);

    if (tag === 'input') {
      const type = inputType($el);
      if (IGNORED_INPUT_TYPES.has(type)) continue;
      if (isSubmitInput(type)) continue;
      if (type === 'checkbox') {
        const name = ($el.attr('name') ?? '').trim();
        if (name) checkboxNames.set(name, (checkboxNames.get(name) ?? 0) + 1);
      }
      if (!isSupportedInputType(type)) {
        unsupported = true;
        continue;
      }
    }

    fields.push(el);
  }

  for (const el of fields) {
    const $el = $(el);
    if (el.tagName.toLowerCase() === 'input' && inputType($el) === 'checkbox') {
      const name = ($el.attr('name') ?? '').trim();
      if (name && (checkboxNames.get(name) ?? 0) > 1) unsupported = true;
    }
  }

  for (const node of $(form).find('button').toArray()) {
    if (!isTag(node)) continue;
    if (($(node).attr('type') ?? 'submit').trim().toLowerCase() !== 'submit') unsupported = true;
  }

  return { fields, unsupported };
}

function findSubmit($: CheerioAPI, form: Element): Element | null {
  for (const node of $(form).find('button, input').toArray()) {
    if (!isTag(node)) continue;
    const el = node as Element;
    const tag = el.tagName.toLowerCase();
    const $el = $(el);
    if (tag === 'button' && ($el.attr('type') ?? 'submit').toLowerCase() === 'submit') return el;
    if (tag === 'input' && inputType($el) === 'submit') return el;
  }
  return null;
}

function inputType($el: Cheerio<Element>): string {
  return ($el.attr('type') ?? 'text').trim().toLowerCase();
}

function isSubmitInput(type: string): boolean {
  return type === 'submit';
}

function isSupportedInputType(type: string): boolean {
  return ['text', 'email', 'tel', 'url', 'checkbox', 'radio'].includes(type);
}

function inputBlockName($: CheerioAPI, input: Element): string | null {
  const $input = $(input);
  switch (inputType($input)) {
    case 'text':
      return isNameInput($, input) ? 'jetpack/field-name' : 'jetpack/field-text';
    case 'email':
      return 'jetpack/field-email';
    case 'tel':
      return 'jetpack/field-telephone';
    case 'url':
      return 'jetpack/field-url';
    default:
      return null;
  }
}

function fieldAttrs(
  $: CheerioAPI,
  form: Element,
  control: Element,
  placeholder?: string,
  options?: string[],
): FieldAttrs {
  const attrs: FieldAttrs = {};
  const label = labelFor($, form, control);
  if (label) attrs.label = label;
  if (isRequired($, control)) attrs.required = true;
  const normalizedPlaceholder = normalizeText(placeholder ?? '');
  if (normalizedPlaceholder) attrs.placeholder = normalizedPlaceholder;
  if (options && options.length > 0) attrs.options = options;
  return attrs;
}

function radioGroup($: CheerioAPI, form: Element, first: Element): FieldAttrs | null {
  const $first = $(first);
  const name = ($first.attr('name') ?? '').trim();
  const radios = name
    ? (filterByAttr($(form).find('input[type="radio"]').toArray() as Element[], $, 'name', name) as Element[])
    : [first];

  const options = radios
    .filter((radio) => !$(radio).attr('disabled'))
    .map((radio) => labelFor($, form, radio) || normalizeText($(radio).attr('value') ?? ''))
    .filter(Boolean);

  if (options.length === 0) return null;

  const attrs: FieldAttrs = { options };
  const label = radioGroupLabel($, form, radios) || humanizeName(name);
  if (label) attrs.label = label;
  if (radios.some((radio) => isRequired($, radio))) attrs.required = true;
  return attrs;
}

function radioGroupLabel($: CheerioAPI, form: Element, radios: Element[]): string {
  const fieldset = $(radios[0]).closest('fieldset').get(0);
  if (fieldset && radios.every((radio) => isInside($, radio, fieldset as Element))) {
    const legend = normalizeText($(fieldset).children('legend').first().text());
    if (legend) return legend;
  }
  return labelFor($, form, radios[0]);
}

function selectOptions($: CheerioAPI, select: Element): string[] {
  return $(select)
    .children('option')
    .toArray()
    .filter((option, index) => !isDisabledPlaceholderOption($, option as Element, index))
    .map((option) => normalizeText($(option).text()) || normalizeText($(option).attr('value') ?? ''))
    .filter(Boolean);
}

function selectPlaceholder($: CheerioAPI, select: Element): string {
  const first = $(select).children('option').first().get(0);
  return first && isDisabledPlaceholderOption($, first as Element, 0) ? normalizeText($(first).text()) : '';
}

function isDisabledPlaceholderOption($: CheerioAPI, option: Element, index: number): boolean {
  const $option = $(option);
  if ($option.attr('disabled') === undefined) return false;
  const value = normalizeText($option.attr('value') ?? '');
  return index === 0 || value === '' || $option.attr('selected') !== undefined;
}

function submitBlock($: CheerioAPI, submit: Element): string {
  const $submit = $(submit);
  const tag = submit.tagName.toLowerCase();
  const text =
    tag === 'input'
      ? normalizeText($submit.attr('value') ?? $submit.attr('aria-label') ?? 'Submit')
      : normalizeText($submit.text() || $submit.attr('aria-label') || 'Submit');

  return voidBlock('jetpack/button', {
    element: 'button',
    text: text || 'Submit',
  });
}

function fieldBlock(name: string, attrs: FieldAttrs, parts: FieldBlockParts): string {
  const attrJson = blockAttrs(attrs);
  const inputBlockName = parts.inputBlockName ?? (parts.inputType ? 'jetpack/input' : undefined);
  const inner = [
    labelBlock(attrs),
    inputBlockName
      ? voidBlock(inputBlockName, {
          placeholder: attrs.placeholder,
          type: parts.inputType,
        })
      : '',
  ]
    .filter(Boolean)
    .join('\n');

  return `<!-- wp:${name}${attrJson} -->\n<div>\n${inner}\n</div>\n<!-- /wp:${name} -->`;
}

function choiceFieldBlock(name: string, attrs: FieldAttrs, type: 'radio' | 'checkbox'): string {
  const attrJson = blockAttrs(attrs);
  const optionBlocks = (attrs.options ?? []).map((option) => voidBlock('jetpack/option', { label: option })).join('\n');
  const inner = [
    labelBlock(attrs),
    `<!-- wp:jetpack/options ${JSON.stringify({ type })} -->\n<ul>\n${optionBlocks}\n</ul>\n<!-- /wp:jetpack/options -->`,
  ]
    .filter(Boolean)
    .join('\n');

  return `<!-- wp:${name}${attrJson} -->\n<div>\n${inner}\n</div>\n<!-- /wp:${name} -->`;
}

function standaloneOptionFieldBlock(name: string, attrs: FieldAttrs): string {
  const parentAttrs: JetpackBlockAttrs =
    name === 'jetpack/field-consent'
      ? { ...attrs, consentType: 'explicit', explicitConsentMessage: attrs.label }
      : attrs;
  const attrJson = blockAttrs(parentAttrs);
  const optionAttrs: JetpackBlockAttrs = {
    label: attrs.label,
  };
  const optionExtra = name === 'jetpack/field-consent' ? { ...optionAttrs, hideInput: false, isStandalone: true } : { ...optionAttrs, isStandalone: true };
  return `<!-- wp:${name}${attrJson} -->\n<div>\n${voidBlock('jetpack/option', optionExtra)}\n</div>\n<!-- /wp:${name} -->`;
}

function labelBlock(attrs: FieldAttrs): string {
  if (!attrs.label) return '';
  return voidBlock('jetpack/label', {
    label: attrs.label,
    requiredText: attrs.required ? '*' : undefined,
  });
}

function voidBlock(name: string, attrs: JetpackBlockAttrs): string {
  const attrJson = blockAttrs(attrs);
  return `<!-- wp:${name}${attrJson} /-->`;
}

function blockAttrs(attrs: JetpackBlockAttrs): string {
  const clean: Record<string, string | boolean | string[]> = {};
  if (attrs.label) clean.label = attrs.label;
  if (attrs.required) clean.required = true;
  if (attrs.placeholder) clean.placeholder = attrs.placeholder;
  if (attrs.options && attrs.options.length > 0) clean.options = attrs.options;
  if (attrs.consentType) clean.consentType = attrs.consentType;
  if (attrs.explicitConsentMessage) clean.explicitConsentMessage = attrs.explicitConsentMessage;
  if (attrs.element) clean.element = attrs.element;
  if (attrs.text) clean.text = attrs.text;
  if ('type' in attrs && typeof attrs.type === 'string' && attrs.type) clean.type = attrs.type;
  if ('requiredText' in attrs && typeof attrs.requiredText === 'string' && attrs.requiredText) clean.requiredText = attrs.requiredText;
  if ('isStandalone' in attrs && typeof attrs.isStandalone === 'boolean') clean.isStandalone = attrs.isStandalone;
  if ('hideInput' in attrs && typeof attrs.hideInput === 'boolean') clean.hideInput = attrs.hideInput;

  return Object.keys(clean).length === 0 ? '' : ` ${JSON.stringify(clean).replace(/--/g, '\\u002d\\u002d')}`;
}

function labelFor($: CheerioAPI, form: Element, control: Element): string {
  const $control = $(control);
  const id = ($control.attr('id') ?? '').trim();
  if (id) {
    const explicit = ($(form).find('label').toArray() as Element[]).find((label) => ($(label).attr('for') ?? '') === id);
    const text = explicit ? labelText($, explicit) : '';
    if (text) return text;
  }

  const wrapping = $control.closest('label').get(0);
  if (wrapping) {
    const text = labelText($, wrapping as Element);
    if (text) return text;
  }

  const previousLabel = $control.prevAll('label').first();
  if (previousLabel.length > 0) {
    const text = normalizeText(previousLabel.text());
    if (text) return text;
  }

  const ariaLabel = normalizeText($control.attr('aria-label') ?? '');
  if (ariaLabel) return ariaLabel;

  return '';
}

function labelText($: CheerioAPI, label: Element): string {
  const clone = $(label).clone();
  clone.find('input, select, textarea, button').remove();
  return normalizeText(clone.text());
}

function isRequired($: CheerioAPI, control: Element): boolean {
  const $control = $(control);
  return $control.attr('required') !== undefined || ($control.attr('aria-required') ?? '').toLowerCase() === 'true';
}

function isNameInput($: CheerioAPI, input: Element): boolean {
  const $input = $(input);
  const signal = [
    $input.attr('autocomplete') ?? '',
    $input.attr('id') ?? '',
    $input.attr('name') ?? '',
    labelFor($, $(input).closest('form').get(0) as Element, input),
  ]
    .join(' ')
    .toLowerCase();

  return /(^|[^a-z0-9])(given-name|family-name|additional-name|honorific-prefix|honorific-suffix|name)([^a-z0-9]|$)/.test(signal);
}

function isConsentCheckbox($: CheerioAPI, input: Element, label?: string): boolean {
  if (!isRequired($, input)) return false;
  const $input = $(input);
  const signal = [label ?? '', $input.attr('id') ?? '', $input.attr('name') ?? ''].join(' ').toLowerCase();
  return /\b(consent|terms?|privacy|agree|agreement|permission)\b/.test(signal);
}

function isInside($: CheerioAPI, node: Element, ancestor: Element): boolean {
  return node === ancestor || ($(node).parents().toArray() as Element[]).includes(ancestor);
}

function filterByAttr(nodes: Element[], $: CheerioAPI, attr: string, value: string): Element[] {
  return nodes.filter((node) => ($(node).attr(attr) ?? '') === value);
}

function humanizeName(name: string): string {
  return normalizeText(name.replace(/[_-]+/g, ' '));
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}
