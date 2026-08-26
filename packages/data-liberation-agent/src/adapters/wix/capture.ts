import type { AdapterCapture } from '../page-actions.js';

export const capture: AdapterCapture = {
	prepare: async ( page ) => {
		await page.evaluate( async () => {
			const linksByFragment = new Map< string, HTMLAnchorElement[] >();
			for ( const link of document.querySelectorAll< HTMLAnchorElement >( 'a[href]' ) ) {
				let target: URL;
				try {
					target = new URL( link.href, location.href );
				} catch {
					continue;
				}
				if (
					target.origin !== location.origin ||
					target.pathname !== location.pathname ||
					! target.hash
				)
					continue;

				let fragment: string;
				try {
					fragment = decodeURIComponent( target.hash.slice( 1 ) );
				} catch {
					continue;
				}
				// eslint-disable-next-line no-control-regex -- fragment IDs must not carry controls.
				if ( ! fragment || fragment.length > 128 || /[\u0000-\u001f\u007f]/.test( fragment ) )
					continue;
				link.dataset.dlaAnchorFragment = fragment;
				linksByFragment.set( fragment, [ ...( linksByFragment.get( fragment ) ?? [] ), link ] );
			}

			const originalScroll = { x: scrollX, y: scrollY };
			const waitForScroll = async (): Promise< void > => {
				let previous = scrollY;
				let stableFrames = 0;
				for ( let attempt = 0; attempt < 40 && stableFrames < 4; attempt++ ) {
					await new Promise( ( resolve ) => setTimeout( resolve, 50 ) );
					if ( Math.abs( scrollY - previous ) < 1 ) stableFrames++;
					else stableFrames = 0;
					previous = scrollY;
				}
			};
			const markUnresolved = ( links: HTMLAnchorElement[], reason: string ) => {
				for ( const link of links ) link.dataset.dlaAnchorUnresolved = reason;
			};

			let resolvedFragments = 0;
			for ( const [ fragment, links ] of linksByFragment ) {
				if ( resolvedFragments >= 32 ) {
					markUnresolved( links, 'runtime fragment target limit reached' );
					continue;
				}
				resolvedFragments++;
				const authoredTargets = [
					...document.querySelectorAll< HTMLElement >( '[id],a[name]' ),
				].filter(
					( element ) => element.id === fragment || element.getAttribute( 'name' ) === fragment
				);
				if ( authoredTargets.length === 1 ) {
					authoredTargets[ 0 ].dataset.dlaAnchorTarget = fragment;
					continue;
				}
				if ( authoredTargets.length > 1 ) {
					markUnresolved( links, 'multiple authored fragment targets' );
					continue;
				}

				const trigger = links.find( ( link ) => link.getClientRects().length > 0 );
				if ( ! trigger ) {
					markUnresolved( links, 'no rendered fragment trigger' );
					continue;
				}
				// Wix resolves named anchors in its click runtime, so observe the
				// resulting settled section boundary before provider scripts are removed.
				trigger.click();
				await waitForScroll();

				const targetTop = scrollY;
				const candidates = [
					...document.querySelectorAll< HTMLElement >(
						'section,article,main,[role="region"],[data-testid="section-container"]'
					),
				]
					.filter( ( element ) => element.getClientRects().length > 0 )
					.map( ( element ) => ( {
						element,
						top: element.getBoundingClientRect().top + scrollY,
					} ) )
					.sort(
						( left, right ) => Math.abs( left.top - targetTop ) - Math.abs( right.top - targetTop )
					);
				const resolved = candidates[ 0 ];
				if ( ! resolved || Math.abs( resolved.top - targetTop ) > 4 ) {
					markUnresolved( links, 'runtime scroll did not resolve to a section boundary' );
					continue;
				}

				const marker = document.createElement( 'span' );
				marker.id = fragment;
				marker.dataset.dlaAnchorTarget = fragment;
				marker.setAttribute( 'aria-hidden', 'true' );
				marker.style.cssText = `position:absolute;top:${ Math.round(
					resolved.top
				) }px;left:0;width:0;height:0;overflow:hidden;pointer-events:none`;
				document.body.prepend( marker );
			}

			const root = document.documentElement;
			const scrollBehavior = root.style.scrollBehavior;
			root.style.scrollBehavior = 'auto';
			window.scrollTo( originalScroll.x, originalScroll.y );
			root.style.scrollBehavior = scrollBehavior;
		} );
	},
};
