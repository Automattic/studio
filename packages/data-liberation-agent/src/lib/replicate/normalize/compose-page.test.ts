// src/lib/replicate/normalize/compose-page.test.ts
import { describe, it, expect } from 'vitest';
import { composePage } from './compose-page.js';
import { blockMarkupRoundtrips } from '../../streaming/block-markup-validate.js';
import type { LocalPage, Section, SectionBehavior } from '../local-site/types.js';

const page: LocalPage = {
  relPath: 'index.html',
  slug: 'home',
  title: 'Home',
  html: '<body><main><section id="hero"><h1>Hi</h1><p>Body</p></section><section id="cta"><p>More</p></section></main></body>',
};

describe('composePage', () => {
  it('produces round-tripping post content and a per-section report', () => {
    const { postContent, report } = composePage(page);
    expect(blockMarkupRoundtrips(postContent).ok).toBe(true);
    expect(report.map((r) => r.sectionId)).toEqual(['hero', 'cta']);
    expect(report.every((r) => r.confidence === 1)).toBe(true);
    expect(postContent).toContain('<h1 class="wp-block-heading">Hi</h1>');
  });

  it('returns empty content + empty report for a page with no body sections', () => {
    const empty: LocalPage = { ...page, html: '<body><main></main></body>' };
    const { postContent, report } = composePage(empty);
    expect(report).toEqual([]);
    expect(postContent).toBe('');
  });

  it('composes sections from a body without <main> (body > section wrappers)', () => {
    const noMain: LocalPage = {
      ...page,
      html: '<body><section id="alpha"><p>Alpha text</p></section><section id="beta"><p>Beta text</p></section></body>',
    };
    const { postContent, report } = composePage(noMain);
    expect(blockMarkupRoundtrips(postContent).ok).toBe(true);
    expect(report.map((r) => r.sectionId)).toEqual(['alpha', 'beta']);
    expect(postContent).toContain('Alpha text');
    expect(postContent).toContain('Beta text');
  });

  it('excludes chrome (header/footer) content from postContent in a chrome+body mix', () => {
    const mixed: LocalPage = {
      ...page,
      html:
        '<body><header><nav><a href="/">HeaderOnly</a></nav></header>' +
        '<section id="about"><h2>About</h2><p>BodyOnly</p></section>' +
        '<footer><p>FooterOnly</p></footer></body>',
    };
    const { postContent, report } = composePage(mixed);
    expect(blockMarkupRoundtrips(postContent).ok).toBe(true);
    expect(report.map((r) => r.sectionId)).toEqual(['about']);
    expect(postContent).toContain('BodyOnly');
    expect(postContent).not.toContain('HeaderOnly');
    expect(postContent).not.toContain('FooterOnly');
  });

  it('composes loose <main> content — each loose child becomes its own section', () => {
    const loose: LocalPage = {
      ...page,
      html: '<body><main><h1>Loose Heading</h1><p>Loose para</p></main></body>',
    };
    const { postContent, report } = composePage(loose);
    expect(blockMarkupRoundtrips(postContent).ok).toBe(true);
    expect(report).toHaveLength(2);
    expect(postContent).toContain('Loose Heading');
    expect(postContent).toContain('Loose para');
  });

  it('preserves mixed top-level children end-to-end (section + figure + heading)', () => {
    const mixed: LocalPage = {
      ...page,
      html:
        '<body><main><section id="intro"><p>Sec text</p></section>' +
        '<figure><img src="photo.jpg" alt="P"/></figure>' +
        '<h1>Page Title</h1></main></body>',
    };
    const { postContent, report } = composePage(mixed);
    expect(blockMarkupRoundtrips(postContent).ok).toBe(true);
    expect(report).toHaveLength(3);
    expect(postContent).toContain('Sec text');
    expect(postContent).toContain('photo.jpg');
    expect(postContent).toContain('Page Title');
  });

  it('preserves a loose text node end-to-end with escaping intact', () => {
    const withText: LocalPage = {
      ...page,
      html: '<body><main>Tom &amp; Jerry &lt;3 "quotes" here<section id="s"><p>x</p></section></main></body>',
    };
    const { postContent } = composePage(withText);
    expect(blockMarkupRoundtrips(postContent).ok).toBe(true);
    expect(postContent).toContain('Tom &amp; Jerry &lt;3 &quot;quotes&quot; here');
  });

  it('keeps tag-shaped loose display text literal (no re-parse into real markup)', () => {
    const withTagText: LocalPage = {
      ...page,
      html: '<body><main>see &lt;b&gt;bold&lt;/b&gt;<section id="s"><p>x</p></section></main></body>',
    };
    const { postContent } = composePage(withTagText);
    expect(blockMarkupRoundtrips(postContent).ok).toBe(true);
    // The source DISPLAYS the text "<b>bold</b>" — it must survive as literal
    // escaped text, not get re-parsed into an actual bold element.
    expect(postContent).toContain('see &lt;b&gt;bold&lt;/b&gt;');
    expect(postContent).not.toContain('<b>bold</b>');
  });
});

describe('composePage reveal tagging (nativeBehaviors)', () => {
  const reveal = { kind: 'reveal' as const, threshold: 0.2, translateY: '12px', durationMs: 500 };

  it('wraps every body section in wp:dla/reveal and reports the block type', () => {
    const { postContent, report } = composePage(page, { reveal });
    expect((postContent.match(/<!-- wp:dla\/reveal \{/g) ?? []).length).toBe(2);
    expect((postContent.match(/<!-- \/wp:dla\/reveal -->/g) ?? []).length).toBe(2);
    expect(postContent).toContain('data-wp-interactive="dla/reveal"');
    expect(postContent).toContain('"threshold":0.2');
    expect(postContent).not.toContain('wp:group');
    expect(report.map((r) => r.blockType)).toEqual(['dla/reveal', 'dla/reveal']);
    expect(report.map((r) => r.sectionId)).toEqual(['hero', 'cta']);
  });

  it('roundtrip gate accepts the custom dla/reveal delimiter (explicit lock)', () => {
    const { postContent } = composePage(page, { reveal });
    expect(blockMarkupRoundtrips(postContent).ok).toBe(true);
  });

  it('default call (no opts) is identical to explicit empty opts and keeps group wrappers (regression)', () => {
    const bare = composePage(page);
    expect(composePage(page, {})).toEqual(bare);
    expect(bare.postContent).not.toContain('dla/reveal');
    expect(bare.report.map((r) => r.blockType)).toEqual(['group', 'group']);
  });
});

describe('composePage per-section behavior tagging (detectSection)', () => {
  const reveal = { kind: 'reveal' as const, threshold: 0.2, translateY: '12px', durationMs: 500 };
  const tabsPage: LocalPage = {
    relPath: 'plans.html',
    slug: 'plans-page',
    title: 'Plans',
    html:
      '<body><main><section id="plans"><div role="tablist">' +
      '<button role="tab" aria-selected="true" aria-controls="p-a" class="tab is-active">A</button>' +
      '<button role="tab" aria-selected="false" aria-controls="p-b" class="tab">B</button></div>' +
      '<div role="tabpanel" id="p-a"><p>Alpha</p></div>' +
      '<div role="tabpanel" id="p-b" hidden><p>Beta</p></div></section>' +
      '<section id="cta"><p>More</p></section></main></body>',
  };
  const tagPlans = (s: Section): SectionBehavior | undefined =>
    s.id === 'plans' ? { kind: 'tabs', activeClass: 'is-active' } : undefined;

  it('specific section behavior beats uniform reveal (precedence) and reports dla/<kind>', () => {
    const { postContent, report } = composePage(tabsPage, { reveal, detectSection: tagPlans, native: true });
    expect(report.map((r) => [r.sectionId, r.blockType])).toEqual([
      ['plans', 'dla/tabs'],
      ['cta', 'dla/reveal'],
    ]);
    expect(postContent).toContain('data-wp-interactive="dla/tabs"');
    expect(postContent).toContain('data-wp-interactive="dla/reveal"');
    expect(postContent).toContain('role="tab"'); // verbatim inner survived compose
  });

  it('roundtrip gate accepts verbatim inner through the compose pipeline (explicit lock)', () => {
    const { postContent } = composePage(tabsPage, { reveal, detectSection: tagPlans, native: true });
    expect(blockMarkupRoundtrips(postContent).ok).toBe(true);
  });

  it('callback returning undefined everywhere changes nothing (regression)', () => {
    expect(composePage(tabsPage, { reveal, detectSection: () => undefined })).toEqual(
      composePage(tabsPage, { reveal }),
    );
    expect(composePage(tabsPage, { detectSection: () => undefined })).toEqual(composePage(tabsPage));
  });

  it('detectSection without reveal (native): only the matched section is tagged, others stay group', () => {
    const { postContent, report } = composePage(tabsPage, { detectSection: tagPlans, native: true });
    expect(report.map((r) => [r.sectionId, r.blockType])).toEqual([
      ['plans', 'dla/tabs'],
      ['cta', 'group'],
    ]);
    expect(postContent).toContain('wp:group');
  });
});

describe('composePage carry path (native unset): verbatim group wrappers', () => {
  const tabsPage: LocalPage = {
    relPath: 'plans.html',
    slug: 'plans-page',
    title: 'Plans',
    html:
      '<body><main><section id="plans"><div role="tablist">' +
      '<button role="tab" aria-selected="true" aria-controls="p-a" class="tab is-active">A</button>' +
      '<button role="tab" aria-selected="false" aria-controls="p-b" class="tab">B</button></div>' +
      '<div role="tabpanel" id="p-a"><p>Alpha</p></div>' +
      '<div role="tabpanel" id="p-b" hidden><p>Beta</p></div></section>' +
      '<section id="cta"><p>More</p></section></main></body>',
  };
  const tagPlans = (s: Section): SectionBehavior | undefined =>
    s.id === 'plans' ? { kind: 'tabs', activeClass: 'is-active' } : undefined;

  it('tagged sections keep VERBATIM inner inside a plain core/group; report stays group', () => {
    const { postContent, report } = composePage(tabsPage, { detectSection: tagPlans });
    expect(report.map((r) => [r.sectionId, r.blockType])).toEqual([
      ['plans', 'group'],
      ['cta', 'group'],
    ]);
    // Content survival: the interactive scaffolding the carried source JS
    // drives is byte-preserved instead of downgraded to text paragraphs.
    expect(postContent).toContain('role="tab"');
    expect(postContent).toContain('aria-controls="p-a"');
    expect(postContent).not.toContain('data-wp-interactive');
    expect(postContent).not.toContain('dla/');
    expect(blockMarkupRoundtrips(postContent).ok).toBe(true);
  });
});

describe('composePage block-contract issues (warning-level)', () => {
  it('exposes contractIssues ([] on clean output — the emitter is contract-clean by construction)', () => {
    const { contractIssues } = composePage(page);
    expect(contractIssues).toEqual([]);
  });

  it('empty page returns an empty contractIssues array too', () => {
    const empty: LocalPage = { ...page, html: '<body><main></main></body>' };
    expect(composePage(empty).contractIssues).toEqual([]);
  });
});

describe('composePage styling-conservation (dropped source classes)', () => {
  it('reports no dropped classes when source classes survive the conversion', () => {
    const p: LocalPage = {
      ...page,
      html: '<body><main><section id="s"><div class="stat"><div class="stat-num">12k</div></div></section></main></body>',
    };
    expect(composePage(p).stylingDrops).toEqual([]);
  });

  it('flags a dropped source class with its section id (inline <code> unwrapped in rich text)', () => {
    const p: LocalPage = {
      ...page,
      html: '<body><main><section id="s"><p>hi <code class="bar">x</code></p></section></main></body>',
    };
    expect(composePage(p).stylingDrops).toEqual([{ sectionId: 's', droppedClasses: ['bar'] }]);
  });

  it('does not flag classes dropped by an intentional form→Jetpack conversion', () => {
    const p: LocalPage = {
      ...page,
      html: '<body><main><section id="contact"><form class="form-card"><div class="field"><input type="email" name="email" placeholder="x"></div></form></section></main></body>',
    };
    const { stylingDrops, formsConverted } = composePage(p, { jetpackForms: true });
    expect(formsConverted).toBeGreaterThan(0); // the form actually converted
    expect(stylingDrops).toEqual([]); // form-card/field are intentionally replaced by Jetpack markup
  });

  it('empty page returns an empty stylingDrops array', () => {
    const empty: LocalPage = { ...page, html: '<body><main></main></body>' };
    expect(composePage(empty).stylingDrops).toEqual([]);
  });
});
