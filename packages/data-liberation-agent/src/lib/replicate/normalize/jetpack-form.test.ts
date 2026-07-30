import { describe, expect, it } from 'vitest';
import * as cheerio from 'cheerio';
import type { Element } from 'domhandler';
import { validateBlockMarkup } from '../validate-block-markup.js';
import { InstanceStyleSheet } from './instance-styles.js';
import { emitJetpackForm, type EmitJetpackFormResult } from './jetpack-form.js';

function emit(html: string, selector = 'form'): EmitJetpackFormResult | null {
  const $ = cheerio.load(html);
  const el = $(selector).get(0);
  expect(el).toBeTruthy();
  return emitJetpackForm($, el as Element, new InstanceStyleSheet());
}

function expectValid(result: EmitJetpackFormResult | null): EmitJetpackFormResult {
  expect(result).not.toBeNull();
  expect(validateBlockMarkup(result!.markup)).toEqual([]);
  return result!;
}

describe('emitJetpackForm', () => {
  it('maps text-like controls and carries label, required, and placeholder attributes', () => {
    const result = expectValid(
      emit(`
        <form>
          <label for="full-name">Full Name</label>
          <input id="full-name" name="full_name" type="text" placeholder="Jane Doe" required>

          <label>Email <input type="email" name="email" placeholder="jane@example.com" required></label>

          <label for="phone">Phone</label>
          <input id="phone" type="tel" placeholder="+1 555 0100">

          <label for="website">Website</label>
          <input id="website" type="url" placeholder="https://example.com">

          <label for="message">Message</label>
          <textarea id="message" placeholder="How can we help?" required></textarea>

          <button type="submit">Send -- now</button>
        </form>
      `),
    );

    expect(result.fieldCount).toBe(5);
    expect(result.markup).toContain('<!-- wp:jetpack/contact-form -->');
    expect(result.markup).toContain('<!-- wp:jetpack/field-name {"label":"Full Name","required":true,"placeholder":"Jane Doe"} -->');
    expect(result.markup).toContain('<!-- wp:jetpack/label {"label":"Full Name","requiredText":"*"} /-->');
    expect(result.markup).toContain('<!-- wp:jetpack/input {"placeholder":"Jane Doe","type":"text"} /-->');
    expect(result.markup).toContain('<!-- wp:jetpack/field-email {"label":"Email","required":true,"placeholder":"jane@example.com"} -->');
    expect(result.markup).toContain('<!-- wp:jetpack/input {"placeholder":"jane@example.com","type":"email"} /-->');
    expect(result.markup).toContain('<!-- wp:jetpack/field-telephone {"label":"Phone","placeholder":"+1 555 0100"} -->');
    expect(result.markup).toContain('<!-- wp:jetpack/phone-input {"placeholder":"+1 555 0100"} /-->');
    expect(result.markup).toContain('<!-- wp:jetpack/field-url {"label":"Website","placeholder":"https://example.com"} -->');
    expect(result.markup).toContain('<!-- wp:jetpack/input {"placeholder":"https://example.com","type":"url"} /-->');
    expect(result.markup).toContain('<!-- wp:jetpack/field-textarea {"label":"Message","required":true,"placeholder":"How can we help?"} -->');
    expect(result.markup).toContain('<!-- wp:jetpack/input {"placeholder":"How can we help?","type":"textarea"} /-->');
    expect(result.markup).toContain('<!-- wp:jetpack/button {"element":"button","text":"Send \\u002d\\u002d now"} /-->');
  });

  it('maps name-ish text inputs with underscored ids or names to field-name', () => {
    const result = expectValid(
      emit(`
        <form>
          <label for="full_name">Full Name</label>
          <input id="full_name" name="full_name" type="text">
          <button>Send</button>
        </form>
      `),
    );

    expect(result.fieldCount).toBe(1);
    expect(result.markup).toContain('<!-- wp:jetpack/field-name {"label":"Full Name"} -->');
    expect(result.markup).not.toContain('wp:jetpack/field-text');
  });

  it('maps select options, skips a disabled placeholder option, and maps radio groups', () => {
    const result = expectValid(
      emit(`
        <form>
          <label for="topic">Topic</label>
          <select id="topic" required>
            <option value="" disabled selected>Choose one</option>
            <option>Sales</option>
            <option value="support">Support</option>
          </select>

          <fieldset>
            <legend>Preferred contact</legend>
            <label><input type="radio" name="contact" value="email" required>Email</label>
            <label><input type="radio" name="contact" value="phone">Phone</label>
          </fieldset>

          <input type="submit" value="Go">
        </form>
      `),
    );

    expect(result.fieldCount).toBe(2);
    expect(result.markup).toContain(
      '<!-- wp:jetpack/field-select {"label":"Topic","required":true,"placeholder":"Choose one","options":["Sales","Support"]} -->',
    );
    expect(result.markup).toContain('<!-- wp:jetpack/input {"placeholder":"Choose one","type":"dropdown"} /-->');
    expect(result.markup).toContain(
      '<!-- wp:jetpack/field-radio {"label":"Preferred contact","required":true,"options":["Email","Phone"]} -->',
    );
    expect(result.markup).toContain('<!-- wp:jetpack/options {"type":"radio"} -->');
    expect(result.markup).toContain('<!-- wp:jetpack/option {"label":"Email"} /-->');
    expect(result.markup).toContain('<!-- wp:jetpack/option {"label":"Phone"} /-->');
    expect(result.markup).toContain('<!-- wp:jetpack/button {"element":"button","text":"Go"} /-->');
  });

  it('carries wrapped select labels without option text pollution', () => {
    const result = expectValid(
      emit(`
        <form>
          <label>Topic
            <select required>
              <option value="" disabled selected>Choose one</option>
              <option>Sales</option>
              <option>Support</option>
            </select>
          </label>
          <button>Go</button>
        </form>
      `),
    );

    expect(result.markup).toContain(
      '<!-- wp:jetpack/field-select {"label":"Topic","required":true,"placeholder":"Choose one","options":["Sales","Support"]} -->',
    );
    expect(result.markup).not.toContain('Topic Choose one Sales Support');
  });

  it('carries explicit wrapped select labels without option text pollution', () => {
    const result = expectValid(
      emit(`
        <form>
          <label for="topic">Topic
            <select id="topic" required>
              <option value="" disabled selected>Choose one</option>
              <option>Sales</option>
            </select>
          </label>
          <button>Go</button>
        </form>
      `),
    );

    expect(result.markup).toContain(
      '<!-- wp:jetpack/field-select {"label":"Topic","required":true,"placeholder":"Choose one","options":["Sales"]} -->',
    );
    expect(result.markup).not.toContain('Topic Choose one Sales');
  });

  it('maps a single checkbox and upgrades required terms checkbox to consent', () => {
    const result = expectValid(
      emit(`
        <form>
          <label><input type="checkbox" name="newsletter"> Subscribe me</label>
          <label><input type="checkbox" name="terms" required> I agree to the Terms</label>
          <button>Send</button>
        </form>
      `),
    );

    expect(result.fieldCount).toBe(2);
    expect(result.markup).toContain('<!-- wp:jetpack/field-checkbox {"label":"Subscribe me"} -->');
    expect(result.markup).toContain('<!-- wp:jetpack/option {"label":"Subscribe me","isStandalone":true} /-->');
    expect(result.markup).toContain(
      '<!-- wp:jetpack/field-consent {"label":"I agree to the Terms","required":true,"consentType":"explicit","explicitConsentMessage":"I agree to the Terms"} -->',
    );
    expect(result.markup).toContain('<!-- wp:jetpack/option {"label":"I agree to the Terms","isStandalone":true,"hideInput":false} /-->');
  });

  it('emits a single form nested in a non-interactive wrapper', () => {
    const result = expectValid(
      emit(
        `
          <div>
            <form>
              <label for="wrapped-email">Email</label>
              <input id="wrapped-email" type="email" required>
              <button type="submit">Join</button>
            </form>
          </div>
        `,
        'div',
      ),
    );

    expect(result.fieldCount).toBe(1);
    expect(result.markup).toContain('<!-- wp:jetpack/field-email {"label":"Email","required":true} -->');
    expect(result.markup).toContain('<!-- wp:jetpack/input {"type":"email"} /-->');
    expect(result.markup).toContain('<!-- wp:jetpack/button {"element":"button","text":"Join"} /-->');
  });

  it('returns null for search-only or otherwise unmapped forms', () => {
    expect(
      emit(`
        <form role="search">
          <input type="search" placeholder="Search">
          <button type="submit">Search</button>
        </form>
      `),
    ).toBeNull();

    expect(
      emit(`
        <form>
          <label>Password <input type="password" required></label>
          <button type="submit">Sign in</button>
        </form>
      `),
    ).toBeNull();
  });
});
