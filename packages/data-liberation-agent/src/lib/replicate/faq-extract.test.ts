import { describe, it, expect } from 'vitest';
import { extractFaqsFromHtml } from './faq-extract.js';

describe('extractFaqsFromHtml', () => {
  it('returns [] for empty or structureless HTML', () => {
    expect(extractFaqsFromHtml('')).toEqual([]);
    expect(extractFaqsFromHtml('<div><p>just prose, no accordion</p></div>')).toEqual([]);
  });

  it('extracts pairs from the getsnooz button + answer-wrapper accordion shape', () => {
    const html = `
      <section class="snooz-faq-section">
        <h2>Frequently Asked Questions</h2>
        <div class="snooz-faq-item">
          <button class="snooz-faq-question" aria-expanded="false">
            <span>What is the SNOOZ Go 2?</span>
            <span class="snooz-faq-chevron"><svg viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"></polyline></svg></span>
          </button>
          <div class="snooz-faq-answer-wrapper">The SNOOZ Go 2 is a portable 3-in-1 device.</div>
        </div>
        <div class="snooz-faq-item">
          <button class="snooz-faq-question" aria-expanded="false">
            <span>How long does the battery last?</span>
            <span class="snooz-faq-chevron"><svg></svg></span>
          </button>
          <div class="snooz-faq-answer-wrapper">Up to 24 hours on a single charge.</div>
        </div>
      </section>`;
    const faqs = extractFaqsFromHtml(html);
    expect(faqs).toEqual([
      { question: 'What is the SNOOZ Go 2?', answer: 'The SNOOZ Go 2 is a portable 3-in-1 device.' },
      { question: 'How long does the battery last?', answer: 'Up to 24 hours on a single charge.' },
    ]);
  });

  it('extracts pairs from native <details>/<summary>', () => {
    const html = `
      <div>
        <details><summary>Is it good for travel?</summary><p>Yes — it has a travel pouch.</p></details>
        <details><summary>What is the loop lock?</summary><p>A built-in hook to hang it anywhere.</p></details>
      </div>`;
    const faqs = extractFaqsFromHtml(html);
    expect(faqs).toEqual([
      { question: 'Is it good for travel?', answer: 'Yes — it has a travel pouch.' },
      { question: 'What is the loop lock?', answer: 'A built-in hook to hang it anywhere.' },
    ]);
  });

  it('resolves answers via aria-controls when present', () => {
    const html = `
      <div class="accordion">
        <button aria-expanded="false" aria-controls="a1">Question one?</button>
        <button aria-expanded="false" aria-controls="a2">Question two?</button>
        <div id="a1">Answer one.</div>
        <div id="a2">Answer two.</div>
      </div>`;
    const faqs = extractFaqsFromHtml(html);
    expect(faqs).toEqual([
      { question: 'Question one?', answer: 'Answer one.' },
      { question: 'Question two?', answer: 'Answer two.' },
    ]);
  });

  it('de-dupes repeated questions and keeps source order', () => {
    const html = `
      <div>
        <details><summary>Repeated?</summary><p>First.</p></details>
        <details><summary>Unique?</summary><p>Second.</p></details>
        <details><summary>Repeated?</summary><p>Clone.</p></details>
      </div>`;
    const faqs = extractFaqsFromHtml(html);
    expect(faqs.map((f) => f.question)).toEqual(['Repeated?', 'Unique?']);
  });

  it('skips collapsible category/group headers whose answer nests real questions', () => {
    // A category header ("About Go 2") is also an accordion trigger; its answer
    // is the container of the real question triggers. It must NOT become a pair.
    const html = `
      <section class="snooz-faq-section">
        <h2>Frequently Asked Questions</h2>
        <button class="snooz-faq-category" aria-expanded="false">About Go 2</button>
        <div class="snooz-faq-group">
          <button class="snooz-faq-question" aria-expanded="false"><span>What is the SNOOZ Go 2?</span></button>
          <div class="snooz-faq-answer-wrapper">A portable 3-in-1 device.</div>
          <button class="snooz-faq-question" aria-expanded="false"><span>What sounds are included?</span></button>
          <div class="snooz-faq-answer-wrapper">12 premium sounds.</div>
        </div>
      </section>`;
    const faqs = extractFaqsFromHtml(html);
    expect(faqs.map((f) => f.question)).toEqual([
      'What is the SNOOZ Go 2?',
      'What sounds are included?',
    ]);
    expect(faqs.find((f) => f.question === 'About Go 2')).toBeUndefined();
  });

  it('keeps a question with an empty answer rather than inventing one', () => {
    const html = `
      <div class="accordion">
        <button aria-expanded="false" class="accordion-trigger">Orphan question?</button>
      </div>
      <button aria-expanded="false" class="accordion-trigger">Second question?</button>`;
    const faqs = extractFaqsFromHtml(html);
    expect(faqs.find((f) => f.question === 'Orphan question?')?.answer).toBe('');
  });
});
