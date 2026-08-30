/**
 * Script-gated entrance animations, made self-driving for the captured artifact.
 *
 * Builders ship entrance motion as a CSS animation declared `paused`, started by
 * runtime JS (IntersectionObserver / hydration) which then stamps a state
 * attribute to switch the rule off. Capture strips scripts, so the authored
 * motion can never run: the animation stays parked and the page is static.
 *
 * Rebinding the animation to a scroll timeline keeps the motion in the static
 * HTML artifact while allowing the browser to drive it without script.
 */
import postcss from 'postcss';

/** A paused, script-started animation rule recovered from the source CSS. */
export interface PausedAnimationRule {
	/** Original selector part, with any state-attribute gate removed. */
	selector: string;
	/** Declarations that reproduce the animation in a self-driving form. */
	declarations: string;
}

/**
 * A `paused` play state anywhere in the shorthand, or as its own declaration.
 * `animation-play-state` is matched separately so `animation: none` rules and
 * animation names containing the word are not caught by the shorthand test.
 */
const PAUSED_SHORTHAND_RE = /(?:^|[\s,])paused(?:$|[\s,])/i;

/**
 * Infinite motion is ambience (spinners, marquees), not an entrance. Binding it
 * to a scroll timeline would make it stutter with the scroll position.
 */
const INFINITE_RE = /(?:^|[\s,])infinite(?:$|[\s,])/i;

/**
 * Strip a state-attribute gate such as `:not([data-motion-enter="done"])`.
 *
 * The gate exists to let runtime JS turn the animation off after it has played.
 * Captured DOM carries whatever state the page happened to be in, so the gate
 * would decide arbitrarily whether motion survives. Removing it makes the
 * rewritten rule depend on the element, not on captured runtime state.
 */
function withoutStateAttributeGate( selector: string ): string {
	return selector.replace( /:not\(\s*\[[^\]]*\]\s*\)/gi, '' ).trim();
}

/** Whether a declaration list describes a paused, finite animation. */
function isScriptGatedEntrance( declarations: postcss.Declaration[] ): boolean {
	let paused = false;
	let infinite = false;
	for ( const declaration of declarations ) {
		const property = declaration.prop.toLowerCase();
		const value = declaration.value;
		if ( property === 'animation-play-state' && /\bpaused\b/i.test( value ) ) paused = true;
		if ( property === 'animation' && PAUSED_SHORTHAND_RE.test( value ) ) paused = true;
		if ( property === 'animation' && INFINITE_RE.test( value ) ) infinite = true;
		if ( property === 'animation-iteration-count' && /\binfinite\b/i.test( value ) )
			infinite = true;
	}
	return paused && ! infinite;
}

/**
 * Recover every script-gated entrance animation in `css`.
 *
 * Rules are reported with their gate removed so a caller can re-emit them in a
 * self-driving form. Rules nested in `@keyframes` are skipped: their `paused`
 * text belongs to the animation being defined, not to an element.
 */
export function detectPausedAnimationRules( css: string ): PausedAnimationRule[] {
	let root: postcss.Root;
	try {
		root = postcss.parse( css );
	} catch {
		return [];
	}

	const rules: PausedAnimationRule[] = [];
	root.walkRules( ( rule ) => {
		if ( rule.parent?.type === 'atrule' ) {
			const name = ( rule.parent as postcss.AtRule ).name.toLowerCase();
			if ( name.endsWith( 'keyframes' ) ) return;
		}

		const declarations = ( rule.nodes ?? [] ).filter(
			( node ): node is postcss.Declaration => node.type === 'decl'
		);
		if ( ! isScriptGatedEntrance( declarations ) ) return;

		const carried = declarations
			.filter( ( declaration ) => /^animation|^--motion/i.test( declaration.prop ) )
			.map( ( declaration ) => {
				if ( declaration.prop.toLowerCase() === 'animation-play-state' ) return '';
				if ( declaration.prop.toLowerCase() === 'animation' ) {
					return `animation:${ declaration.value.replace( PAUSED_SHORTHAND_RE, ' ' ) }`;
				}
				return `${ declaration.prop }:${ declaration.value }`;
			} )
			.filter( Boolean );
		if ( carried.length === 0 ) return;

		for ( const part of rule.selectors ) {
			const selector = withoutStateAttributeGate( part );
			if ( selector === '' ) continue;
			rules.push( { selector, declarations: carried.join( ';' ) } );
		}
	} );

	return rules;
}

/**
 * Append self-driving equivalents for the script-gated entrance animations in
 * `sourceCss`. Returns `css` unchanged when there are none.
 *
 * The override binds each animation to the element's own view progress, so the
 * browser runs it as the element scrolls into view — the behaviour the stripped
 * script provided. It is wrapped in `@supports` so browsers without scroll
 * timelines keep the captured end state rather than parking at the first
 * keyframe, which for an entrance is usually invisible.
 */
export function appendScrollDrivenAnimations( css: string, sourceCss: string ): string {
	const seen = new Set< string >();
	const blocks: string[] = [];
	for ( const rule of detectPausedAnimationRules( sourceCss ) ) {
		const key = `${ rule.selector }\n${ rule.declarations }`;
		if ( seen.has( key ) ) continue;
		seen.add( key );
		blocks.push(
			`${ rule.selector }{${ rule.declarations };animation-play-state:running;animation-timeline:view();animation-range:entry 0% cover 40%}`
		);
	}
	if ( blocks.length === 0 ) return css;

	return (
		css +
		`\n\n/* capture: drive script-gated entrance animations from the scroll timeline. */\n` +
		`@supports (animation-timeline: view()) {\n${ blocks.join( '\n' ) }\n}\n`
	);
}
