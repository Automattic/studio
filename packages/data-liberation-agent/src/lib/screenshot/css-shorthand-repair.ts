// src/lib/screenshot/css-shorthand-repair.ts
//
// Repairs a browser CSSOM serialization quirk that loses font (and other
// shorthand) declarations that reference a CSS custom property.
//
// When a declaration block sets a shorthand via var() — e.g.
// `font: var(--token);` — and *also* explicitly overrides one of that
// shorthand's own longhands later in the same block — e.g.
// `font-style: normal;` — the shorthand becomes a "pending-substitution
// value" spanning all of its longhands (CSS Custom Properties §2.1). Chromium
// (and matching engines) then cannot re-serialize the shorthand: reading the
// live CSSOM (`CSSStyleRule.cssText`, `CSSStyleDeclaration.getPropertyValue`)
// for that declaration yields every one of the shorthand's longhands as an
// empty string, and the original `font: var(--token)` text is gone from the
// CSSOM entirely. `getComputedStyle()` still resolves the real value — only
// the *declaration text* is unrecoverable through the CSSOM.
//
// This is not specific to `font`, to var(), or to any one source: any
// shorthand property whose value references a custom property and is
// followed, in the same rule, by an explicit override of one of its own
// longhands hits this. A capture pipeline that reconstructs CSS from live
// `cssText` (needed to also pick up genuine CSSOM mutations — see
// `capturePageHtml`) silently drops the real declaration and keeps only the
// empty husk.
//
// The fix: when the *live* reconstruction of a rule shows this signature
// (a bare `property: ;`), recover the original declaration text for that
// same rule from the stylesheet's own pre-mutation source (an inline
// <style> element's `textContent`, read before anything overwrites it).
// Matched by selector/prelude *and* occurrence index, at each nesting level,
// so two rules that share a selector (common with `:where()`-scoped
// generated CSS) or a rule nested in @media are not confused with each
// other. When no matching original rule exists (the empty declaration is
// on a rule the page's own JS inserted after load, so there is nothing to
// recover), the live text is kept as-is — never worse than today.

/** A single top-level (or nested) CSS rule split out of a stylesheet's text. */
interface CssRuleNode {
	/** Selector text for a style rule, or the condition text for an at-rule (e.g. `@media (max-width: 1023px)`). */
	prelude: string;
	/** Raw text between the rule's braces. */
	body: string;
	/** Whether `body` itself contains nested rules (a grouping at-rule like @media/@supports/@layer). */
	isGroup: boolean;
}

/**
 * Builds the repair function. Every helper lives inside this one function, so
 * `toString()` of it is complete on its own: the browser copy below and the
 * Node export run the same code, and a minifier renames the helpers
 * consistently within it. Helpers kept at module level would be reached by
 * their minified module names, which do not exist in the page.
 */
function createShorthandVarCollapseRepair(): ( liveCssText: string, originalCssText: string ) => string {
	/** A declared-but-empty property: the CSSOM's telltale for a lost pending-substitution longhand. */
	const EMPTY_DECLARATION = /(?:^|;)\s*[a-zA-Z-]+\s*:\s*;/;

	/**
	 * Splits CSS text into a flat list of top-level rules, tracking brace depth
	 * and skipping braces inside quoted strings (so a `content: "{"` declaration
	 * does not desynchronize the split). Not a full CSS tokenizer — sufficient
	 * for text a browser's own CSSOM has already validated and serialized.
	 */
	function splitRules( css: string ): CssRuleNode[] {
		const rules: CssRuleNode[] = [];
		const n = css.length;
		let i = 0;
		while ( i < n ) {
			const preludeStart = i;
			let depth = 0;
			let quote: string | null = null;
			let bodyStart = -1;
			let sawNested = false;
			let closed = false;
			for ( ; i < n; i++ ) {
				const ch = css[ i ];
				if ( quote ) {
					if ( ch === '\\' ) { i++; continue; }
					if ( ch === quote ) quote = null;
					continue;
				}
				if ( ch === '"' || ch === "'" ) { quote = ch; continue; }
				if ( ch === '{' ) {
					if ( depth === 0 ) bodyStart = i + 1;
					else sawNested = true;
					depth++;
				} else if ( ch === '}' ) {
					depth--;
					if ( depth === 0 && bodyStart !== -1 ) {
						const prelude = css.slice( preludeStart, bodyStart - 1 ).trim();
						const body = css.slice( bodyStart, i );
						if ( prelude ) rules.push( { prelude, body, isGroup: sawNested } );
						i++;
						closed = true;
						break;
					}
				}
			}
			if ( ! closed ) break; // trailing whitespace / no more complete rules
		}
		return rules;
	}

	function repairNodes( liveNodes: CssRuleNode[], originalNodes: CssRuleNode[] ): string {
		const originalByPrelude = new Map< string, CssRuleNode[] >();
		for ( const node of originalNodes ) {
			const list = originalByPrelude.get( node.prelude );
			if ( list ) list.push( node );
			else originalByPrelude.set( node.prelude, [ node ] );
		}
		const consumedIndex = new Map< string, number >();
		const parts: string[] = [];
		for ( const node of liveNodes ) {
			const idx = consumedIndex.get( node.prelude ) ?? 0;
			consumedIndex.set( node.prelude, idx + 1 );
			const match = originalByPrelude.get( node.prelude )?.[ idx ];

			if ( node.isGroup ) {
				if ( match?.isGroup ) {
					const body = repairNodes( splitRules( node.body ), splitRules( match.body ) );
					parts.push( `${ node.prelude } { ${ body } }` );
				} else {
					parts.push( `${ node.prelude } { ${ node.body.trim() } }` );
				}
				continue;
			}

			if ( EMPTY_DECLARATION.test( node.body ) && match && ! match.isGroup && ! EMPTY_DECLARATION.test( match.body ) ) {
				parts.push( `${ node.prelude } { ${ match.body.trim() } }` );
			} else {
				parts.push( `${ node.prelude } { ${ node.body.trim() } }` );
			}
		}
		return parts.join( '\n' );
	}

	return function repairShorthandVarCollapse( liveCssText: string, originalCssText: string ): string {
		if ( ! EMPTY_DECLARATION.test( liveCssText ) ) return liveCssText;
		const liveNodes = splitRules( liveCssText );
		if ( liveNodes.length === 0 ) return liveCssText;
		const originalNodes = splitRules( originalCssText );
		return repairNodes( liveNodes, originalNodes );
	};
}

/**
 * Repairs `liveCssText` (a live CSSOM reconstruction, e.g. the concatenation
 * of `rule.cssText` across a stylesheet's rules) against `originalCssText`
 * (that same stylesheet's authored source text, e.g. an inline `<style>`
 * element's `textContent` read before anything else touches it).
 *
 * Rules without the empty-declaration signature are returned byte-identical
 * to their input (the common case: this function is a no-op on ordinary
 * CSS). `originalCssText` is only ever a *repair source* — rules the live
 * side has that the original text does not (genuine post-load CSSOM
 * mutations, e.g. `sheet.insertRule(...)`) are preserved untouched.
 */
export const repairShorthandVarCollapse = createShorthandVarCollapseRepair();

// ---------------------------------------------------------------------------
// Source string for browser injection
// ---------------------------------------------------------------------------

/**
 * A self-contained factory source string. When evaluated with
 * `new Function('return (' + factorySrc + ')')()()` in the browser, it returns
 * the same `repairShorthandVarCollapse(liveCssText, originalCssText)` exported
 * above.
 *
 * Callers that already round-trip through Node between collecting CSS and
 * writing it back (e.g. `collectStylesheets`, which just returns a string)
 * can import and call `repairShorthandVarCollapse` directly. Callers that
 * must do everything inside one `page.evaluate` (e.g. `capturePageHtml`,
 * which reads *and* writes the live DOM in the same pass) use this factory.
 */
export const CSS_SHORTHAND_REPAIR_FACTORY_SOURCE: { factorySrc: string } = {
	factorySrc: createShorthandVarCollapseRepair.toString(),
};
