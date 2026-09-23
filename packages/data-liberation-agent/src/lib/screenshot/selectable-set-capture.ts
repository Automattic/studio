import type { Page } from 'playwright';
import type { CapturedDialogInteraction } from './interaction-capture.js';

export const SELECTABLE_SET_KIND = 'selectable-set' as const;
export const CHOICE_GROUP_KIND = 'choice-group' as const;

export const SELECTABLE_SET_LIMITS = {
	maxSets: 3,
	maxMembers: 24,
	maxDriveMs: 16_000,
	maxHtmlBytes: 512 * 1024,
	settleMs: 500,
	maxCandidateScan: 1_500,
	maxPointerCandidates: 80,
	maxProbeGroups: 9,
} as const;

export interface SelectableSetCaptureOptions {
	maxSets?: number;
	maxMembers?: number;
	maxDriveMs?: number;
	maxHtmlBytes?: number;
	settleMs?: number;
	maxCandidateScan?: number;
	maxPointerCandidates?: number;
	maxProbeGroups?: number;
}

interface RawSelectableRecord {
	status: 'captured' | 'no-dialog' | 'click-failed';
	trigger: { selector: string; tag: string; id?: string; role?: string; label?: string };
	region?: { selector: string; tag: string; id?: string; role?: string; html?: string };
	set: { selector: string; size: number; index: number };
	choiceGroup?: {
		group: {
			selector: string;
			tag: string;
			id?: string;
			label?: string;
			labelSelector?: string;
			formSelector?: string;
		};
		choices: Array< {
			index: number;
			selector: string;
			tag: string;
			id?: string;
			role?: string;
			label?: string;
			value: string | null;
		} >;
		transition: { selectedIndex: number; selected: Array< boolean | null >; html: string };
		replay: 'activation-determined' | 'unsupported';
		replayReason?: string;
		restoration: 'verified' | 'unverified';
		coverage: 'complete' | 'partial';
	};
	error?: string;
}

/**
 * Capture the "N selectable members drive one shared region" shape.
 *
 * Dialogs and disclosures each bind one trigger to one surface. This shape is
 * different: a repeated cluster of activatable siblings (tabs, pickers, a
 * locator list, a map of zones) mutates a region *outside* the cluster, and
 * that region's content varies per member. Recognition is structural — repeated
 * selectable targets plus a confirmed shared mutation — not vendor- or
 * media-specific.
 *
 * Candidacy is broad: ARIA/button semantics *or* a computed `cursor: pointer`
 * (the CSS fact, not a class name). Confirmation is strict: two distinct
 * contents in the same outside region. Pointer-only SVG zones, seat pickers,
 * and chart legends have no role/tabindex; they still qualify as candidates.
 *
 * Runs after baseline HTML/screenshots so probing cannot rewrite the initial
 * capture. Each drive restores the region before the next member, and the
 * original selection is restored before returning.
 */
export async function captureSelectableSetStates(
	page: Page,
	options: SelectableSetCaptureOptions = {}
): Promise< CapturedDialogInteraction[] > {
	const maxSets = options.maxSets ?? SELECTABLE_SET_LIMITS.maxSets;
	const maxMembers = options.maxMembers ?? SELECTABLE_SET_LIMITS.maxMembers;
	const maxDriveMs = options.maxDriveMs ?? SELECTABLE_SET_LIMITS.maxDriveMs;
	const maxHtmlBytes = options.maxHtmlBytes ?? SELECTABLE_SET_LIMITS.maxHtmlBytes;
	const settleMs = options.settleMs ?? SELECTABLE_SET_LIMITS.settleMs;
	const maxCandidateScan = options.maxCandidateScan ?? SELECTABLE_SET_LIMITS.maxCandidateScan;
	const maxPointerCandidates =
		options.maxPointerCandidates ?? SELECTABLE_SET_LIMITS.maxPointerCandidates;
	const maxProbeGroups = options.maxProbeGroups ?? SELECTABLE_SET_LIMITS.maxProbeGroups;

	let raw: RawSelectableRecord[];
	try {
		const result = await page.evaluate(
			async ( limits: {
				maxSets: number;
				maxMembers: number;
				maxDriveMs: number;
				settleMs: number;
				maxCandidateScan: number;
				maxPointerCandidates: number;
				maxProbeGroups: number;
			} ) => {
				const globalWithName = globalThis as typeof globalThis & {
					__name?: ( fn: unknown ) => unknown;
				};
				if ( typeof globalWithName.__name === 'undefined' ) {
					globalWithName.__name = ( fn ) => fn;
				}
				const wait = ( ms: number ) => new Promise( ( resolve ) => setTimeout( resolve, ms ) );
				const cssEscape = ( value: string ) =>
					globalThis.CSS?.escape
						? globalThis.CSS.escape( value )
						: value.replace( /[^a-zA-Z0-9_-]/g, '\\$&' );
				const sourceSelector = ( element: Element ): string => {
					if ( element.id ) return `#${ cssEscape( element.id ) }`;
					const parts: string[] = [];
					for (
						let node: Element | null = element;
						node && node !== document.body;
						node = node.parentElement
					) {
						const tag = node.tagName.toLowerCase();
						const siblings = node.parentElement
							? Array.from( node.parentElement.children ).filter(
									( sibling ) => sibling.tagName === node!.tagName
							  )
							: [];
						parts.unshift(
							siblings.length > 1
								? `${ tag }:nth-of-type(${ siblings.indexOf( node ) + 1 })`
								: tag
						);
					}
					return `body > ${ parts.join( ' > ' ) }`;
				};
				const visible = ( element: Element ): boolean => {
					const rect = element.getBoundingClientRect();
					const style = getComputedStyle( element );
					return (
						rect.width > 0 &&
						rect.height > 0 &&
						style.display !== 'none' &&
						style.visibility !== 'hidden' &&
						Number.parseFloat( style.opacity || '1' ) > 0.1
					);
				};
				const textOf = ( element: Element ) =>
					( element.textContent || '' ).replace( /\s+/g, ' ' ).trim();
				const fingerprint = ( element: Element ) => {
					const hidden =
						element.hasAttribute( 'hidden' ) || element.getAttribute( 'aria-hidden' ) === 'true';
					let visibleChildren = 0;
					for ( const child of Array.from( element.children ) ) {
						if ( visible( child ) ) visibleChildren++;
					}
					return `${ hidden }|${ element.childElementCount }|${ visibleChildren }|${ textOf( element ) }`;
				};
				const isChrome = ( element: Element ) =>
					Boolean(
						element.closest(
							'header, footer, nav, [role="banner"], [role="navigation"], [role="contentinfo"]'
						)
					);
				const isNavigable = ( element: Element ) => {
					if ( element.tagName !== 'A' ) return false;
					const href = ( element.getAttribute( 'href' ) ?? '' ).trim();
					if ( ! href || href === '#' || href.startsWith( '#' ) ) return false;
					if ( href.toLowerCase().startsWith( 'javascript:' ) ) return false;
					return true;
				};
				/**
				 * A card grid renders the link outside the styled tile
				 * (`<a href><div style="cursor:pointer">...</div></a>`), so rejecting only
				 * the anchor leaves its descendant qualifying on the pointer cursor alone.
				 * The outermost-wins filter cannot rescue that: the anchor is not a
				 * candidate, so there is nothing for the descendant to lose to.
				 */
				const isInsideNavigable = ( element: Element ) => {
					const anchor = element.closest( 'a[href]' );
					return Boolean( anchor && anchor !== element && isNavigable( anchor ) );
				};
				const isDisclosureTrigger = ( element: Element ) => {
					if ( ! element.hasAttribute( 'aria-expanded' ) || ! element.hasAttribute( 'aria-controls' ) ) {
						return false;
					}
					const target = document.getElementById( element.getAttribute( 'aria-controls' ) || '' );
					return Boolean( target && target.getAttribute( 'role' ) === 'region' );
				};
				const isPagerControl = ( element: Element ) =>
					element.hasAttribute( 'data-dla-pager-control' ) ||
					Boolean( element.closest( '[data-dla-pager-stage]' ) );
				const looksSelectable = ( element: Element ): boolean => {
					if ( ! visible( element ) ) return false;
					if ( element.getAttribute( 'aria-disabled' ) === 'true' || element.hasAttribute( 'disabled' ) ) {
						return false;
					}
					if ( isNavigable( element ) ) return false;
					if ( isInsideNavigable( element ) ) return false;
					if ( element.hasAttribute( 'aria-haspopup' ) ) return false;
					if ( isDisclosureTrigger( element ) ) return false;
					if ( isPagerControl( element ) ) return false;
					if ( isChrome( element ) ) return false;
					const tag = element.tagName.toLowerCase();
					if (
						tag === 'input' ||
						tag === 'textarea' ||
						tag === 'select' ||
						tag === 'option' ||
						tag === 'script' ||
						tag === 'style' ||
						tag === 'link' ||
						tag === 'meta'
					) {
						return false;
					}
					const role = ( element.getAttribute( 'role' ) || '' ).toLowerCase();
					if (
						[ 'tab', 'option', 'radio', 'button', 'menuitem', 'menuitemradio' ].includes( role )
					) {
						return true;
					}
					if ( tag === 'button' ) {
						const type = ( element.getAttribute( 'type' ) || 'submit' ).toLowerCase();
						if ( type === 'submit' && element.closest( 'form' ) ) return false;
						return true;
					}
					if ( element.hasAttribute( 'aria-selected' ) || element.hasAttribute( 'aria-pressed' ) ) {
						return true;
					}
					if ( ( element as HTMLElement ).tabIndex >= 0 && tag !== 'a' ) return true;
					return getComputedStyle( element ).cursor === 'pointer';
				};
				const signature = ( element: Element ) =>
					`${ element.tagName.toLowerCase() }|${ ( element.getAttribute( 'role' ) || '' ).toLowerCase() }`;
				const isPageRoot = ( element: Element | null ) => {
					if ( ! element ) return true;
					const tag = element.tagName.toLowerCase();
					if ( [ 'html', 'body', 'main' ].includes( tag ) ) return true;
					const role = ( element.getAttribute( 'role' ) || '' ).toLowerCase();
					return [ 'main', 'document' ].includes( role );
				};
				const isExplicitContainer = ( element: Element ) => {
					const role = ( element.getAttribute( 'role' ) || '' ).toLowerCase();
					return [ 'tablist', 'radiogroup', 'listbox', 'list', 'menu', 'toolbar', 'grid', 'tree' ].includes(
						role
					);
				};
				const isStrong = ( root: Element, members: Element[] ) =>
					isExplicitContainer( root ) ||
					members.every( ( member ) => ( member.getAttribute( 'role' ) || '' ).toLowerCase() === 'tab' ) ||
					members.some( ( member ) => member.hasAttribute( 'aria-selected' ) );
				const collectSelectables = (): Element[] => {
					const semantic = Array.from(
						document.querySelectorAll(
							'button, [role="button"], [role="tab"], [role="option"], [role="radio"], [role="menuitem"], [role="menuitemradio"], [aria-selected], [aria-pressed], [tabindex]:not([tabindex="-1"])'
						)
					);
					const seen = new Set( semantic );
					const extra: Element[] = [];
					let scanned = 0;
					for ( const element of Array.from( document.querySelectorAll( 'body *' ) ) ) {
						if ( scanned++ >= limits.maxCandidateScan ) break;
						if ( extra.length >= limits.maxPointerCandidates ) break;
						if ( seen.has( element ) ) continue;
						if ( ! looksSelectable( element ) ) continue;
						seen.add( element );
						extra.push( element );
					}
					const unique = [ ...seen ].filter( looksSelectable );
					return unique.filter(
						( element ) => ! unique.some( ( other ) => other !== element && other.contains( element ) )
					);
				};
				const documentOrder = ( a: Element, b: Element ) =>
					a.compareDocumentPosition( b ) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
				const findGroups = ( selectables: Element[] ) => {
					const assigned = new Set< Element >();
					const groups: Array< { root: Element; members: Element[] } > = [];
					for ( const element of selectables ) {
						if ( assigned.has( element ) ) continue;
						let found: { root: Element; members: Element[] } | null = null;
						for (
							let node = element.parentElement;
							node && ! isPageRoot( node );
							node = node.parentElement
						) {
							const peers = selectables.filter(
								( candidate ) => node!.contains( candidate ) && signature( candidate ) === signature( element )
							);
							if ( peers.length >= 2 ) {
								found = { root: node, members: peers };
								break;
							}
						}
						if ( ! found ) continue;
						for ( const member of found.members ) assigned.add( member );
						found.members.sort( documentOrder );
						groups.push( found );
					}
					groups.sort( ( a, b ) => {
						const strong =
							Number( isStrong( b.root, b.members ) ) - Number( isStrong( a.root, a.members ) );
						if ( strong !== 0 ) return strong;
						return documentOrder( a.members[ 0 ], b.members[ 0 ] );
					} );
					return groups;
				};
				const regionCandidates = ( groupRoot: Element, members: Element[] ) => {
					const out: Element[] = [];
					let node: Element | null = groupRoot;
					for ( let depth = 0; depth < 8 && node && node !== document.body; depth++ ) {
						for ( const child of Array.from( node.children ) ) {
							if ( child === groupRoot || groupRoot.contains( child ) || child.contains( groupRoot ) ) {
								continue;
							}
							if ( members.some( ( member ) => child.contains( member ) || member.contains( child ) ) ) {
								continue;
							}
							if ( isChrome( child ) ) continue;
							if ( ! visible( child ) ) continue;
							out.push( child );
						}
						node = node.parentElement;
					}
					return out;
				};
				const currentRoute = () => `${ location.pathname }${ location.search }`;
				/**
				 * A probe click must not leave the page. A committed navigation destroys
				 * this evaluate's execution context, and the capture evidence installed on
				 * the page with it, so a route that was otherwise complete fails.
				 *
				 * Cancelling at `document` -- the last hop before `window` -- lets every
				 * listener the page installed run first, so the set is still driven. Only
				 * the follow-through that navigates is cancelled: other default actions
				 * (a label checking its radio, a summary opening its details) are how some
				 * sets change their region at all.
				 */
				const preventNavigation = ( event: Event ) => {
					if ( event.type === 'submit' ) {
						event.preventDefault();
						return;
					}
					const anchor =
						event.target instanceof Element ? event.target.closest( 'a[href]' ) : null;
					if ( anchor && isNavigable( anchor ) ) event.preventDefault();
				};
				const activate = async (
					element: Element
				): Promise< { ok: true } | { ok: false; error: string; navigated?: boolean } > => {
					const before = currentRoute();
					const beforeState = history.state;
					let clickError: string | undefined;
					document.addEventListener( 'click', preventNavigation );
					document.addEventListener( 'submit', preventNavigation );
					try {
						const click = ( element as HTMLElement ).click;
						if ( typeof click === 'function' ) {
							click.call( element );
						} else {
							element.dispatchEvent(
								new MouseEvent( 'click', {
									bubbles: true,
									cancelable: true,
									composed: true,
									view: window,
								} )
							);
						}
						await wait( limits.settleMs );
					} catch ( error ) {
						clickError = ( error instanceof Error ? error.message : String( error ) ).slice( 0, 500 );
					} finally {
						document.removeEventListener( 'click', preventNavigation );
						document.removeEventListener( 'submit', preventNavigation );
					}
					if ( clickError !== undefined ) return { ok: false, error: clickError };
					if ( currentRoute() !== before ) {
						try {
							history.pushState( beforeState, '', before );
							window.dispatchEvent( new PopStateEvent( 'popstate', { state: beforeState } ) );
						} catch {
							/* ignore */
						}
						return { ok: false, error: 'navigated', navigated: true };
					}
					return { ok: true };
				};
				const snapshotHtml = ( element: Element ) => {
					const clone = element.cloneNode( true ) as Element;
					for ( const unsafe of Array.from( clone.querySelectorAll( 'script,style,noscript,iframe' ) ) ) {
						unsafe.remove();
					}
					for ( const node of [ clone, ...Array.from( clone.querySelectorAll( '*' ) ) ] ) {
						for ( const attribute of Array.from( node.attributes ) ) {
							if ( /^on/i.test( attribute.name ) || attribute.name.startsWith( 'data-lib-selectable' ) ) {
								node.removeAttribute( attribute.name );
							}
						}
					}
					return clone.outerHTML;
				};
				const describeTrigger = ( element: Element ) => {
					const title = element.querySelector( 'title' );
					const label = (
						element.getAttribute( 'aria-label' ) ||
						element.getAttribute( 'title' ) ||
						title?.textContent ||
						element.textContent ||
						element.id ||
						''
					)
						.replace( /\s+/g, ' ' )
						.trim()
						.slice( 0, 40 );
					return {
						selector: sourceSelector( element ),
						tag: element.tagName.toLowerCase(),
						...( element.id ? { id: element.id } : {} ),
						...( element.getAttribute( 'role' )
							? { role: element.getAttribute( 'role' )! }
							: {} ),
						...( label ? { label } : {} ),
					};
				};
				const describeRegion = ( element: Element, html?: string ) => ( {
					selector: element.id
						? `#${ cssEscape( element.id ) }`
						: sourceSelector( element ),
					tag: element.tagName.toLowerCase(),
					...( element.id ? { id: element.id } : {} ),
					...( element.getAttribute( 'role' ) ? { role: element.getAttribute( 'role' )! } : {} ),
					...( html !== undefined ? { html } : {} ),
				} );
				const selectedMember = ( members: Element[] ) => {
					const aria = members.find(
						( member ) =>
							member.getAttribute( 'aria-selected' ) === 'true' ||
							member.getAttribute( 'aria-pressed' ) === 'true' ||
							member.getAttribute( 'aria-current' ) === 'true'
					);
					if ( aria ) return aria;
					const classes = members.map( ( member ) => member.getAttribute( 'class' ) || '' );
					const counts = new Map< string, number >();
					for ( const value of classes ) counts.set( value, ( counts.get( value ) ?? 0 ) + 1 );
					const unique = members.filter( ( _, index ) => counts.get( classes[ index ] ) === 1 );
					return unique.length === 1 ? unique[ 0 ] : undefined;
				};
				const observedSelection = ( element: Element ): boolean | null => {
					for ( const attribute of [ 'aria-selected', 'aria-pressed', 'aria-current' ] ) {
						if ( element.hasAttribute( attribute ) ) return element.getAttribute( attribute ) === 'true';
					}
					if ( element instanceof HTMLInputElement && [ 'checkbox', 'radio' ].includes( element.type ) ) {
						return element.checked;
					}
					return null;
				};
				const describeChoice = ( element: Element, index: number ) => ( {
					index,
					selector: sourceSelector( element ),
					tag: element.tagName.toLowerCase(),
					...( element.id ? { id: element.id } : {} ),
					...( element.getAttribute( 'role' ) ? { role: element.getAttribute( 'role' )! } : {} ),
					...( ( element.getAttribute( 'aria-label' ) || textOf( element ) ).trim()
						? { label: ( element.getAttribute( 'aria-label' ) || textOf( element ) ).replace( /\s+/g, ' ' ).trim().slice( 0, 80 ) }
						: {} ),
					value: element.hasAttribute( 'value' ) ? element.getAttribute( 'value' ) : null,
				} );
				const association = ( root: Element, members: Element[] ) => {
					let label: Element | null = null;
					const labelledBy = root.getAttribute( 'aria-labelledby' );
					if ( labelledBy ) label = document.getElementById( labelledBy.split( /\s+/ )[ 0 ] || '' );
					for ( let parent = root.parentElement; ! label && parent; parent = parent.parentElement ) {
						const siblings = Array.from( parent.children );
						const rootIndex = siblings.indexOf( root );
						if ( rootIndex >= 0 ) {
							label = siblings
								.slice( 0, rootIndex )
								.reverse()
								.find( ( sibling ) => [ 'LABEL', 'LEGEND' ].includes( sibling.tagName ) ) ?? null;
						}
						if ( parent.tagName === 'FIELDSET' ) {
							label ??= parent.querySelector( ':scope > legend' );
						}
						if ( parent === document.body ) break;
					}
					const group = {
						selector: sourceSelector( root ),
						tag: root.tagName.toLowerCase(),
						...( root.id ? { id: root.id } : {} ),
						...( root.getAttribute( 'aria-label' ) ? { label: root.getAttribute( 'aria-label' )! } : {} ),
						...( label ? { label: textOf( label ), labelSelector: sourceSelector( label ) } : {} ),
						...( root.closest( 'form' ) ? { formSelector: sourceSelector( root.closest( 'form' )! ) } : {} ),
					};
					return {
						group,
						choices: members.map( describeChoice ),
					};
				};
				const snapshotChoiceGroup = ( root: Element, members: Element[] ) => {
					const clone = root.cloneNode( true ) as Element;
					const candidates = Array.from( clone.querySelectorAll( members[ 0 ]?.tagName.toLowerCase() || '*' ) )
						.filter( ( candidate ) =>
							( candidate.getAttribute( 'role' ) || '' ).toLowerCase() ===
							( members[ 0 ]?.getAttribute( 'role' ) || '' ).toLowerCase()
						);
					candidates.slice( 0, members.length ).forEach( ( candidate, index ) =>
						candidate.setAttribute( 'data-dla-choice-index', String( index ) )
					);
					for ( const unsafe of Array.from( clone.querySelectorAll( 'script,style,noscript,iframe' ) ) ) unsafe.remove();
					for ( const node of [ clone, ...Array.from( clone.querySelectorAll( '*' ) ) ] ) {
						for ( const attribute of Array.from( node.attributes ) ) {
							if ( /^on/i.test( attribute.name ) || attribute.name.startsWith( 'data-lib-selectable' ) )
								node.removeAttribute( attribute.name );
						}
					}
					return clone.outerHTML;
				};
				/* source actions restore choice groups below; cloned markup cannot restore listeners or closure state */
				const records: RawSelectableRecord[] = [];
				const deadline = Date.now() + limits.maxDriveMs;
				const groups = findGroups( collectSelectables() );

				let capturedSets = 0;
				let probedGroups = 0;
				for ( const group of groups ) {
					if ( capturedSets >= limits.maxSets ) break;
					if ( probedGroups >= limits.maxProbeGroups ) break;
					probedGroups++;
					const candidates = regionCandidates( group.root, group.members );
					const setRecord = ( index: number ) => ( {
						selector: sourceSelector( group.root ),
						size: group.members.length,
						index,
					} );
					const pushOutcome = (
						status: RawSelectableRecord[ 'status' ],
						index: number,
						extra: Partial< RawSelectableRecord > = {}
					) => {
						records.push( {
							status,
							trigger: describeTrigger( group.members[ index ] ?? group.members[ 0 ] ),
							set: setRecord( index ),
							...extra,
						} );
					};

					if ( Date.now() >= deadline ) {
						pushOutcome( 'no-dialog', 0, { error: 'time budget spent' } );
						break;
					}

					const initialFp = candidates.map( fingerprint );
					const initialText = candidates.map( textOf );
					const initialHtml = candidates.map( ( candidate ) => candidate.innerHTML );
					const toggleGroup = group.members.every( ( member ) => member.hasAttribute( 'aria-pressed' ) );
					const initialGroupHtml = snapshotChoiceGroup( group.root, group.members );
					const initialSelected = group.members.map( observedSelection );
					const observations: Array< {
						fps: string[];
						texts: string[];
						groupHtml: string;
						selected: Array< boolean | null >;
					} > = [];
					let navigated = false;
					let discoveryError: { index: number; error: string } | undefined;
					let restorationError: string | undefined;
					let restorationIndex: number | undefined;
					const restoreChoiceGroup = async (): Promise< boolean > => {
						const sameChoiceState = ( actual: string, expected: string ) => {
							const normalize = ( html: string ) =>
								html.replace( / style="([^"]*)"/g, ( _, value: string ) =>
									` style="${ value.replace( /\s*([:;,])\s*/g, '$1' ).replace( /;$/, '' ) }"`
								);
							return normalize( actual ) === normalize( expected );
						};
						if ( sameChoiceState( snapshotChoiceGroup( group.root, group.members ), initialGroupHtml ) ) return true;
						const restoreLimit = Math.min( group.members.length, limits.maxMembers );
						if ( toggleGroup ) {
							for ( let pass = 0; pass < 2; pass++ ) {
								for ( let index = 0; index < restoreLimit; index++ ) {
									if ( observedSelection( group.members[ index ]! ) === initialSelected[ index ] ) continue;
									const result = await activate( group.members[ index ]! );
									if ( ! result.ok && result.navigated ) navigated = true;
								}
								if ( sameChoiceState( snapshotChoiceGroup( group.root, group.members ), initialGroupHtml ) ) return true;
							}
						}
						if ( restorationIndex !== undefined && restorationIndex < restoreLimit ) {
							const result = await activate( group.members[ restorationIndex ]! );
							if ( result.ok && sameChoiceState( snapshotChoiceGroup( group.root, group.members ), initialGroupHtml ) ) return true;
							if ( ! result.ok && result.navigated ) navigated = true;
							restorationIndex = undefined;
						}
						for ( let index = 0; index < restoreLimit && Date.now() < deadline; index++ ) {
							const result = await activate( group.members[ index ]! );
							if ( ! result.ok ) {
								restorationError = result.error;
								if ( result.navigated ) navigated = true;
								continue;
							}
							if ( sameChoiceState( snapshotChoiceGroup( group.root, group.members ), initialGroupHtml ) ) {
								restorationIndex = index;
								return true;
							}
						}
						restorationError ??= 'source actions did not restore the initial choice state';
						return false;
					};

					const probeLimit = Math.min( group.members.length, 4 );
					for ( let index = 0; index < probeLimit && Date.now() < deadline; index++ ) {
						if ( ! ( await restoreChoiceGroup() ) ) {
							discoveryError ??= {
								index,
								error: restorationError ?? 'source actions did not restore the initial choice state',
							};
							break;
						}
						const result = await activate( group.members[ index ] );
						if ( ! result.ok ) {
							discoveryError ??= { index, error: result.error };
							if ( result.navigated ) {
								navigated = true;
								break;
							}
							continue;
						}
						observations.push( {
							fps: candidates.map( fingerprint ),
							texts: candidates.map( textOf ),
							groupHtml: snapshotChoiceGroup( group.root, group.members ),
							selected: group.members.map( observedSelection ),
						} );
					}

					let regionIdx = -1;
					let bestRange = 0;
					const minTextRange = 24;
					for ( let index = 0; index < candidates.length; index++ ) {
						const texts = [ initialText[ index ], ...observations.map( ( obs ) => obs.texts[ index ] ) ];
						const fps = new Set( [ initialFp[ index ], ...observations.map( ( obs ) => obs.fps[ index ] ) ] );
						if ( fps.size < 2 ) continue;
						const range =
							Math.max( ...texts.map( ( text ) => text.length ) ) -
							Math.min( ...texts.map( ( text ) => text.length ) );
						if ( range >= minTextRange && range > bestRange ) {
							bestRange = range;
							regionIdx = index;
						}
					}

					if ( navigated ) {
						pushOutcome( 'click-failed', discoveryError?.index ?? 0, {
							error: discoveryError?.error ?? 'navigated',
						} );
						continue;
					}
					const choiceGroupChanged = observations.some( ( observation ) => observation.groupHtml !== initialGroupHtml );
					const choiceMetadata = choiceGroupChanged ? association( group.root, group.members ) : undefined;
					const sameMemberParent = group.members.every(
						( member ) => member.parentElement === group.members[ 0 ]?.parentElement
					);
					const shouldCaptureChoice = Boolean(
						choiceGroupChanged &&
						sameMemberParent &&
						( regionIdx < 0 || toggleGroup || choiceMetadata?.group.label )
					);
					if ( shouldCaptureChoice ) {
						const drivenCount = Math.min( group.members.length, limits.maxMembers );
						const choiceRecordStart = records.length;
						let replay: 'activation-determined' | 'unsupported' = 'activation-determined';
						let replayReason: string | undefined;
						const transitions = new Map< number, string >();
						const capturedIndexes = new Set< number >();
						for ( let index = 0; index < Math.min( observations.length, drivenCount ); index++ ) {
							const observation = observations[ index ]!;
							transitions.set( index, observation.groupHtml );
							capturedIndexes.add( index );
							pushOutcome( 'captured', index, {
								choiceGroup: {
									...choiceMetadata!,
									transition: {
										selectedIndex: index,
										selected: observation.selected,
										html: observation.groupHtml,
									},
									replay: 'activation-determined',
									restoration: 'unverified',
									coverage: 'partial',
								},
							} );
						}
						for ( let index = observations.length; index < drivenCount && Date.now() < deadline; index++ ) {
							if ( ! ( await restoreChoiceGroup() ) ) {
								replay = 'unsupported';
								replayReason ??= restorationError ?? 'source actions did not restore the initial choice state';
								break;
							}
							const result = await activate( group.members[ index ] );
							if ( ! result.ok ) {
								pushOutcome( 'click-failed', index, { error: result.error } );
								if ( result.navigated ) navigated = true;
								continue;
							}
							const after = snapshotChoiceGroup( group.root, group.members );
							const selected = group.members.map( observedSelection );
							const transition = { selectedIndex: index, selected, html: after };
							transitions.set( index, after );
							capturedIndexes.add( index );
							pushOutcome( 'captured', index, {
								choiceGroup: {
									...choiceMetadata!,
									transition,
									replay: 'activation-determined',
									restoration: 'unverified',
									coverage: 'partial',
								},
							} );
						}
						const verifyHistory = async ( history: number[], name: string ): Promise< void > => {
							if ( replay === 'unsupported' ) return;
							if ( ! ( await restoreChoiceGroup() ) ) {
								replay = 'unsupported';
								replayReason ??= restorationError ?? 'source actions did not restore the initial choice state';
								return;
							}
							for ( const index of history ) {
								const result = await activate( group.members[ index ]! );
								if ( ! result.ok ) {
									replay = 'unsupported';
									replayReason ??= `${ name} activation failed: ${ result.error }`;
									return;
								}
								if ( snapshotChoiceGroup( group.root, group.members ) !== transitions.get( index ) ) {
									replay = 'unsupported';
									replayReason ??= `${ name} activation was history-dependent`;
									return;
								}
							}
						};
						if ( capturedIndexes.size !== group.members.length ) {
							replay = 'unsupported';
							replayReason ??= 'choice group drive was truncated';
						}
						if ( replay === 'activation-determined' && capturedIndexes.size === group.members.length ) {
							await verifyHistory( [ 0, 0 ], 'repeated' );
							await verifyHistory( group.members.length > 1 ? [ 0, 1, 0 ] : [ 0, 0 ], 'alternate' );
						}
						const restored = await restoreChoiceGroup();
						const coverage = capturedIndexes.size === group.members.length ? 'complete' : 'partial';
						if ( records.length === choiceRecordStart ) {
							pushOutcome( 'click-failed', 0, {
								error: replayReason ?? 'choice group could not be restored for capture',
							} );
						}
						for ( const record of records.slice( choiceRecordStart ) ) {
							if ( ! record.choiceGroup ) continue;
							record.choiceGroup.replay = replay;
							record.choiceGroup.replayReason = replayReason;
							record.choiceGroup.restoration = restored ? 'verified' : 'unverified';
							record.choiceGroup.coverage = coverage;
						}
						group.root.removeAttribute( 'data-lib-selectable-region' );
						capturedSets++;
						continue;
					}
					if ( regionIdx < 0 ) {
						if ( discoveryError && observations.length === 0 ) {
							pushOutcome( 'click-failed', discoveryError.index, { error: discoveryError.error } );
						} else {
							pushOutcome( 'no-dialog', 0, {
								error: candidates.length === 0 ? 'no shared-region candidate' : 'shared region did not vary',
							} );
						}
						continue;
					}

					const region = candidates[ regionIdx ];
					region.setAttribute( 'data-lib-selectable-region', 'true' );
					const original = selectedMember( group.members );
					const drivenCount = Math.min( group.members.length, limits.maxMembers );

					for ( let index = 0; index < drivenCount && Date.now() < deadline; index++ ) {
						const member = group.members[ index ];
						const liveRegion =
							document.querySelector( '[data-lib-selectable-region]' ) ?? region;
						const before = fingerprint( liveRegion );
						const wasSelected =
							member.getAttribute( 'aria-selected' ) === 'true' ||
							member.getAttribute( 'aria-pressed' ) === 'true' ||
							member === original;
						const result = await activate( member );
						if ( ! result.ok ) {
							pushOutcome( 'click-failed', index, { error: result.error } );
							if ( result.navigated ) {
								navigated = true;
								break;
							}
							continue;
						}
						const afterRegion =
							document.querySelector( '[data-lib-selectable-region]' ) ?? liveRegion;
						const after = fingerprint( afterRegion );
						if ( after === before && ! wasSelected ) {
							pushOutcome( 'no-dialog', index, {
								region: describeRegion( afterRegion ),
								error: 'member did not change the shared region',
							} );
							continue;
						}
						pushOutcome( 'captured', index, {
							region: describeRegion( afterRegion, snapshotHtml( afterRegion ) ),
						} );
					}

					const restoreTarget =
						document.querySelector( '[data-lib-selectable-region]' ) ?? region;
					if ( original && Date.now() < deadline ) await activate( original );
					else restoreTarget.innerHTML = initialHtml[ regionIdx ];
					restoreTarget.removeAttribute( 'data-lib-selectable-region' );
					capturedSets++;
					if ( navigated ) continue;
				}

				return records;
			},
			{
				maxSets,
				maxMembers,
				maxDriveMs,
				settleMs,
				maxCandidateScan,
				maxPointerCandidates,
				maxProbeGroups,
			}
		);
		raw = Array.isArray( result ) ? ( result as RawSelectableRecord[] ) : [];
	} catch ( error ) {
		return [
			toInteraction(
				{
					status: 'click-failed',
					trigger: { selector: 'html', tag: 'html' },
					set: { selector: 'html', size: 0, index: 0 },
					error: ( error instanceof Error ? error.message : String( error ) ).slice( 0, 500 ),
				},
				maxHtmlBytes
			),
		];
	}

	return raw.map( ( record ) => toInteraction( record, maxHtmlBytes ) );
}

function toInteraction(
	record: RawSelectableRecord,
	maxHtmlBytes: number
): CapturedDialogInteraction {
	const bounded =
		record.region?.html !== undefined ? boundHtml( record.region.html, maxHtmlBytes ) : undefined;
	const choiceHtml = record.choiceGroup?.transition.html;
	const boundedChoice = choiceHtml !== undefined ? boundHtml( choiceHtml, maxHtmlBytes ) : undefined;
	return {
		status: record.status,
		kind: record.choiceGroup ? CHOICE_GROUP_KIND : SELECTABLE_SET_KIND,
		trigger: {
			selector: record.trigger.selector,
			tag: record.trigger.tag,
			...( record.trigger.id ? { id: record.trigger.id } : {} ),
			...( record.trigger.role ? { role: record.trigger.role } : {} ),
			ariaHaspopup: '',
			...( record.region?.id ? { ariaControls: record.region.id } : {} ),
			...( record.trigger.label ? { label: record.trigger.label } : {} ),
			dataBindings: {},
		},
		...( bounded && record.region
			? {
					dialog: {
						selector: record.region.selector,
						tag: record.region.tag,
						...( record.region.id ? { id: record.region.id } : {} ),
						...( record.region.role ? { role: record.region.role } : {} ),
						ariaModal: false,
						html: bounded.html,
						htmlBytes: bounded.bytes,
						htmlTruncated: bounded.truncated,
					},
			  }
			: {} ),
		set: record.set,
		...( record.choiceGroup && boundedChoice
			? {
					choiceGroup: {
						group: record.choiceGroup.group,
						choices: record.choiceGroup.choices,
						transition: {
							selectedIndex: record.choiceGroup.transition.selectedIndex,
							selected: record.choiceGroup.transition.selected,
							html: boundedChoice.html,
							htmlBytes: boundedChoice.bytes,
							htmlTruncated: boundedChoice.truncated,
						},
						replay: record.choiceGroup.replay,
						...( record.choiceGroup.replayReason
							? { replayReason: record.choiceGroup.replayReason }
							: {} ),
						restoration: record.choiceGroup.restoration,
						coverage: record.choiceGroup.coverage,
					},
			  }
			: {} ),
		...( record.error ? { error: record.error } : {} ),
	};
}

function boundHtml(
	html: string,
	maxBytes: number
): { html: string; bytes: number; truncated: boolean } {
	const bytes = Buffer.byteLength( html );
	if ( bytes <= maxBytes ) return { html, bytes, truncated: false };
	return { html: Buffer.from( html ).subarray( 0, maxBytes ).toString(), bytes, truncated: true };
}
