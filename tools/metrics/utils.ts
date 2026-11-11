import fs from 'fs';
import path from 'path';
import type { Locator, Page } from '@playwright/test';

export function median( array ) {
	if ( ! array || ! array.length ) return undefined;

	const numbers = [ ...array ].sort( ( a, b ) => a - b );
	const middleIndex = Math.floor( numbers.length / 2 );

	if ( numbers.length % 2 === 0 ) {
		return ( numbers[ middleIndex - 1 ] + numbers[ middleIndex ] ) / 2;
	}
	return numbers[ middleIndex ];
}

export function getDirSize( dirPath: string ): number {
	let total = 0;
	for ( const entry of fs.readdirSync( dirPath, { withFileTypes: true } ) ) {
		const entryPath = path.join( dirPath, entry.name );
		if ( entry.isDirectory() ) {
			total += getDirSize( entryPath );
		} else if ( entry.isFile() || entry.isSymbolicLink() ) {
			try {
				total += fs.lstatSync( entryPath ).size;
			} catch {
				// Skip entries that can't be stat'd
			}
		}
	}
	return total;
}

type RunningTimes = { studioMetricsRunningSince?: WeakMap< Element, number > };

/**
 * Records in the page when each element's `data-state` last became `running`.
 * Playwright retries an assertion every 500 ms after its first few tries, so a
 * time taken when the assertion passes lands up to 500 ms after the change.
 */
export async function recordRunningTimes( page: Page ): Promise< void > {
	await page.evaluate( () => {
		const runningSince = new WeakMap< Element, number >();
		const note = ( element: Element ) => {
			if ( element.getAttribute( 'data-state' ) !== 'running' ) {
				runningSince.delete( element );
			} else if ( ! runningSince.has( element ) ) {
				runningSince.set( element, Date.now() );
			}
		};
		new MutationObserver( ( mutations ) => {
			for ( const mutation of mutations ) {
				if ( mutation.type === 'attributes' ) {
					note( mutation.target as Element );
				}
				for ( const node of mutation.addedNodes ) {
					if ( node instanceof Element ) {
						[ node, ...node.querySelectorAll( '[data-state]' ) ].forEach( note );
					}
				}
			}
		} ).observe( document.body, {
			subtree: true,
			childList: true,
			attributes: true,
			attributeFilter: [ 'data-state' ],
		} );
		( window as RunningTimes ).studioMetricsRunningSince = runningSince;
	} );
}

/** When the element became `running`, as recorded by `recordRunningTimes`. */
export async function getRunningSince( locator: Locator ): Promise< number > {
	const runningSince = await locator.evaluate(
		( element ) => ( window as RunningTimes ).studioMetricsRunningSince?.get( element )
	);
	if ( runningSince === undefined ) {
		throw new Error( 'No running time was recorded for the element' );
	}
	return runningSince;
}
