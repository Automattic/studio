/**
 * Locators in the shot files are small JSON objects resolved against the
 * Studio window, by accessible name wherever possible:
 *
 *   { "role": "button", "name": "Add site", "exact": true, "first": true }
 *   { "role": "alertdialog", "pattern": "^Overwrite" }
 *   { "text": "Add files", "exact": true }
 *   { "css": "input[type=file]" }                  also sees what an open modal hides from role queries
 *   { "role": "dialog", "has": { "role": "tablist", "name": "Ways to add a site" } }
 *   { "within": { "role": "tabpanel", "name": "Debug" }, "role": "switch", "name": "Xdebug" }
 *   { "role": "menu", "all": true }                                  every match, for a crop
 *
 * Strings may use `{{site.name}}` for the demo site.
 */
export function fill( value, vars ) {
	if ( typeof value !== 'string' ) {
		return value;
	}
	return value.replace( /\{\{\s*([\w.]+)\s*\}\}/g, ( match, key ) => {
		const resolved = key.split( '.' ).reduce( ( obj, part ) => obj?.[ part ], vars );
		if ( resolved === undefined ) {
			throw new Error( `Unknown placeholder ${ match }` );
		}
		return String( resolved );
	} );
}

export function resolveLocator( ctx, spec ) {
	if ( typeof spec !== 'object' || spec === null ) {
		throw new Error( `Locator must be an object, got ${ JSON.stringify( spec ) }` );
	}
	const scope = spec.within ? resolveLocator( ctx, spec.within ) : ctx.w;
	let locator;
	if ( spec.css ) {
		locator = scope.locator( fill( spec.css, ctx.vars ) );
	} else if ( spec.text ) {
		locator = scope.getByText( fill( spec.text, ctx.vars ), { exact: spec.exact } );
	} else if ( spec.role ) {
		locator = scope.getByRole( spec.role, {
			name: spec.pattern ? new RegExp( spec.pattern ) : fill( spec.name, ctx.vars ),
			exact: spec.exact,
		} );
	} else {
		throw new Error( `Locator needs role, text or css: ${ JSON.stringify( spec ) }` );
	}
	if ( spec.has ) {
		locator = locator.filter( { has: resolveLocator( ctx, spec.has ) } );
	}
	return spec.first ? locator.first() : locator;
}

/** The box around `boxes`. */
export function union( boxes ) {
	const x = Math.min( ...boxes.map( ( b ) => b.x ) );
	const y = Math.min( ...boxes.map( ( b ) => b.y ) );
	return {
		x,
		y,
		width: Math.max( ...boxes.map( ( b ) => b.x + b.width ) ) - x,
		height: Math.max( ...boxes.map( ( b ) => b.y + b.height ) ) - y,
	};
}

/**
 * The bounding box of a visible element, for crops and annotations; with
 * `all`, the box around every visible match (a menu and its open submenu).
 */
export async function boundingBoxOf( ctx, spec ) {
	const locator = resolveLocator( ctx, spec );
	await locator.first().waitFor( { state: 'visible' } );
	const boxes = spec.all
		? ( await Promise.all( ( await locator.all() ).map( ( el ) => el.boundingBox() ) ) ).filter(
				Boolean
		  )
		: [ await locator.boundingBox() ].filter( Boolean );
	if ( ! boxes.length ) {
		throw new Error( `Element has no bounding box: ${ JSON.stringify( spec ) }` );
	}
	return union( boxes );
}

/** The one key of `object` that names a verb in `verbs`; steps and annotations are keyed this way. */
export function verbOf( object, verbs, what ) {
	const verb = verbs.find( ( key ) => object[ key ] !== undefined );
	if ( ! verb ) {
		throw new Error( `Unknown ${ what }: ${ JSON.stringify( object ) }` );
	}
	return verb;
}
