import { describe, expect, it } from 'vitest';

import { buildJetpackFormParityCssImpl } from './jetpack-form-css-impl.js';

describe('buildJetpackFormParityCssImpl', () => {
  it('carries representative source declarations to Jetpack form selectors', () => {
    const { css } = buildJetpackFormParityCssImpl({
      formsConverted: 1,
      sourceCss: `
        .form-input,
        form input[type="email"],
        .form-select,
        textarea.form-textarea {
          border: 1px solid #123456;
          border-radius: 6px;
          padding: 12px 14px;
          font-family: "Inter", sans-serif;
          font-size: 16px;
          line-height: 1.4;
          letter-spacing: .02em;
          color: #111;
          background-color: #fff;
          box-shadow: 0 1px 2px rgba(0,0,0,.2);
          width: 100%;
          max-width: 40rem;
          margin: 32px;
        }

        .form-label,
        form label {
          color: #555;
          font-weight: 700;
          font-size: .875rem;
          margin-bottom: 8px;
        }

        .form-submit,
        form button[type="submit"],
        form input[type="submit"] {
          background: #111;
          color: #fff;
          border: 0;
          border-radius: 999px;
          padding: 10px 24px;
          font-weight: 600;
        }
      `,
    });

    expect(css).toContain(
      '.wp-block-jetpack-contact-form .contact-form.commentsblock.jetpack-contact-form__form input.grunion-field:not([type=checkbox]):not([type=radio]):not([type=hidden])',
    );
    expect(css).toContain(
      '.jetpack-contact-form-container .contact-form.commentsblock.jetpack-contact-form__form textarea.grunion-field',
    );
    expect(css).toContain(
      '.wp-block-jetpack-contact-form .contact-form.commentsblock.jetpack-contact-form__form .grunion-field-url-wrap input.grunion-field[type=text]',
    );
    expect(css).toContain(
      '.jetpack-contact-form-container .contact-form.commentsblock.jetpack-contact-form__form .contact-form__select-wrapper select',
    );
    expect(css).toContain(
      '.wp-block-jetpack-contact-form .contact-form.commentsblock.jetpack-contact-form__form .grunion-field-label',
    );
    expect(css).toContain('.wp-block-jetpack-contact-form .wp-block-jetpack-button .wp-block-button__link');
    expect(css).toContain(
      '.jetpack-contact-form-container .contact-form.commentsblock.jetpack-contact-form__form .contact-submit button[type=submit]',
    );
    expect(css).toContain(
      '.jetpack-contact-form-container .contact-form.commentsblock.jetpack-contact-form__form button.pushbutton-wide',
    );

    expect(css).toContain('border:1px solid #123456');
    expect(css).toContain('border-radius:6px');
    expect(css).toContain('padding:12px 14px');
    expect(css).toContain('font-family:"Inter", sans-serif');
    expect(css).toContain('line-height:1.4');
    expect(css).toContain('letter-spacing:.02em');
    expect(css).toContain('background-color:#fff');
    expect(css).toContain('box-shadow:0 1px 2px rgba(0,0,0,.2)');
    expect(css).toContain('max-width:40rem');
    expect(css).not.toContain('margin:32px');
  });

  it('emits Jetpack focus control selectors from source focus rules', () => {
    const { css } = buildJetpackFormParityCssImpl({
      formsConverted: 1,
      sourceCss: `
        .contact-form input:focus,
        textarea.form-textarea:focus {
          border-color: #0055ff;
          box-shadow: 0 0 0 3px rgba(0,85,255,.2);
          outline: none;
        }
      `,
    });

    expect(css).toContain(
      '.wp-block-jetpack-contact-form .contact-form.commentsblock.jetpack-contact-form__form input.grunion-field:not([type=checkbox]):not([type=radio]):not([type=hidden]):focus',
    );
    expect(css).toContain(
      '.jetpack-contact-form-container .contact-form.commentsblock.jetpack-contact-form__form .grunion-field-url-wrap input.grunion-field[type=text]:focus',
    );
    expect(css).toContain('border-color:#0055ff');
    expect(css).toContain('box-shadow:0 0 0 3px rgba(0,85,255,.2)');
    expect(css).toContain('outline:none');
  });

  it('carries source form and field-wrapper rules to Jetpack wrapper selectors', () => {
    const { css } = buildJetpackFormParityCssImpl({
      formsConverted: 1,
      sourceCss: `
        .contact-form {
          display: grid;
          gap: 18px;
          max-width: 42rem;
          margin: 0 auto;
        }

        .form-group,
        .form-check {
          display: grid;
          gap: 6px;
          margin-bottom: 14px;
        }
      `,
    });

    expect(css).toContain('.wp-block-jetpack-contact-form');
    expect(css).toContain('.jetpack-contact-form-container');
    expect(css).toContain(
      '.wp-block-jetpack-contact-form .contact-form.commentsblock.jetpack-contact-form__form',
    );
    expect(css).not.toContain('display:grid');
    expect(css).toContain('gap:18px');
    expect(css).toContain('max-width:42rem');
    expect(css).toContain('margin:0 auto');
    expect(css).toContain(
      '.jetpack-contact-form-container .contact-form.commentsblock.jetpack-contact-form__form [class*="grunion-field-"][class*="-wrap"]',
    );
    expect(css).toContain(
      '.wp-block-jetpack-contact-form .contact-form.commentsblock.jetpack-contact-form__form .contact-form__select-wrapper',
    );
    expect(css).toContain('margin-bottom:14px');
  });

  it('maps bare source form button rules to Jetpack submit targets', () => {
    const { css } = buildJetpackFormParityCssImpl({
      formsConverted: 1,
      sourceCss: `
        .contact-form button {
          background: #2255aa;
          color: #fff;
          border-radius: 4px;
          padding: 10px 16px;
        }
      `,
    });

    expect(css).toContain('.wp-block-jetpack-contact-form .wp-block-jetpack-button .wp-block-button__link');
    expect(css).toContain(
      '.jetpack-contact-form-container .contact-form.commentsblock.jetpack-contact-form__form .contact-submit button[type=submit]',
    );
    expect(css).toContain('background:#2255aa');
    expect(css).toContain('border-radius:4px');
    expect(css).not.toContain('.wp-block-jetpack-contact-form{background:#2255aa');
  });

  it('never carries visibility or layout-state declarations into Jetpack selectors', () => {
    const { css } = buildJetpackFormParityCssImpl({
      formsConverted: 1,
      sourceCss: `
        .form-success {
          display: none;
          visibility: hidden;
          position: absolute;
          opacity: 0;
          transform: translateY(16px);
          float: left;
          clip: rect(0 0 0 0);
          clip-path: inset(50%);
          z-index: 10;
          margin: 0 auto;
          max-width: 42rem;
          color: #223344;
          background-color: #fff;
          box-shadow: 0 1px 2px rgba(0,0,0,.2);
        }

        .form-group {
          display: grid;
          visibility: hidden;
          position: relative;
          opacity: 0;
          transform: scale(.95);
          float: none;
          clip: auto;
          clip-path: none;
          z-index: 1;
          gap: 8px;
          margin-bottom: 12px;
          padding: 4px;
          border: 1px solid #ccddee;
        }

        .form-input {
          display: none;
          visibility: hidden;
          position: absolute;
          opacity: 0;
          transform: translateX(-8px);
          float: right;
          clip: rect(1px 1px 1px 1px);
          clip-path: inset(1px);
          z-index: 2;
          border-radius: 6px;
          padding: 10px 12px;
          font-size: 16px;
          color: #111;
          background: #fafafa;
        }

        .form-label {
          display: block;
          visibility: hidden;
          position: relative;
          opacity: 0;
          transform: translateY(4px);
          float: none;
          clip: auto;
          clip-path: none;
          z-index: 3;
          margin-bottom: 6px;
          font-weight: 700;
          color: #333;
        }

        .form-submit {
          display: inline-block;
          visibility: hidden;
          position: relative;
          opacity: 0;
          transform: translateY(4px);
          float: none;
          clip: auto;
          clip-path: none;
          z-index: 4;
          background: #111;
          color: #fff;
          border-radius: 999px;
          padding: 10px 24px;
          text-transform: uppercase;
        }

        .contact-form input:focus {
          display: none;
          visibility: hidden;
          position: absolute;
          opacity: 0;
          transform: scale(.95);
          float: none;
          clip: auto;
          clip-path: none;
          z-index: 5;
          border-color: #0055ff;
          box-shadow: 0 0 0 3px rgba(0,85,255,.2);
          outline: none;
        }
      `,
    });

    for (const prop of [
      'display',
      'visibility',
      'position',
      'opacity',
      'transform',
      'float',
      'clip',
      'clip-path',
      'z-index',
    ]) {
      expect(css).not.toMatch(new RegExp(`(?:^|[;{])${prop}:`));
    }

    expect(css).toContain('margin:0 auto');
    expect(css).toContain('max-width:42rem');
    expect(css).toContain('color:#223344');
    expect(css).toContain('background-color:#fff');
    expect(css).toContain('box-shadow:0 1px 2px rgba(0,0,0,.2)');
    expect(css).toContain('gap:8px');
    expect(css).toContain('margin-bottom:12px');
    expect(css).toContain('padding:4px');
    expect(css).toContain('border:1px solid #ccddee');
    expect(css).toContain('border-radius:6px');
    expect(css).toContain('padding:10px 12px');
    expect(css).toContain('font-size:16px');
    expect(css).toContain('background:#fafafa');
    expect(css).toContain('font-weight:700');
    expect(css).toContain('background:#111');
    expect(css).toContain('border-radius:999px');
    expect(css).toContain('text-transform:uppercase');
    expect(css).toContain('border-color:#0055ff');
    expect(css).toContain('outline:none');
  });

  it('returns empty CSS when no forms were converted', () => {
    const { css } = buildJetpackFormParityCssImpl({
      formsConverted: 0,
      sourceCss: '.form-input{border:1px solid red}',
    });

    expect(css).toBe('');
  });

  it('returns empty CSS when no source rules match form elements', () => {
    const { css } = buildJetpackFormParityCssImpl({
      formsConverted: 1,
      sourceCss: '.hero{color:red}.site-nav a{font-weight:700}',
    });

    expect(css).toBe('');
  });
});
