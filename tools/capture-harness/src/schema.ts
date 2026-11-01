/**
 * The three inputs of a capture, each its own file so any one can be swapped:
 *
 * - a **scene**: the sites Studio opens on and the made-up account data;
 * - a **script**: the shots, each the steps that reach a screen, the crop and
 *   the annotations;
 * - a **look**: the window, color scheme, frame and output sizes.
 *
 * These schemas validate the files and are written out as JSON Schema
 * (`schemas/*.schema.json`, `studio-capture schemas`) for editors and agents.
 */
import { z } from 'zod';

const SLUG = /^[a-z0-9][a-z0-9-]*$/;

// Locators find an element in the Studio window by accessible role and name
// wherever possible. `has` and `within` take another locator.
export interface LocatorSpec {
	role?: string;
	name?: string;
	pattern?: string;
	text?: string;
	css?: string;
	exact?: boolean;
	first?: boolean;
	all?: boolean;
	has?: LocatorSpec;
	within?: LocatorSpec;
}

const LocatorFields: z.ZodType< LocatorSpec > = z
	.object( {
		role: z.string().optional().describe( 'ARIA role, e.g. "button", "dialog", "menuitem"' ),
		name: z
			.string()
			.optional()
			.describe( 'Accessible name; may use {{site.name}} or {{account.name}}' ),
		pattern: z.string().optional().describe( 'Accessible name as a regular expression' ),
		text: z.string().optional().describe( 'Visible text, for elements without a useful role' ),
		css: z
			.string()
			.optional()
			.describe( 'CSS selector; also sees what an open modal hides from role queries' ),
		exact: z.boolean().optional().describe( 'Match the name or text exactly' ),
		first: z.boolean().optional().describe( 'Take the first match' ),
		all: z.boolean().optional().describe( 'Every visible match, framed together (crops only)' ),
		get has() {
			return Locator.optional().describe( 'Keep only matches that contain this element' );
		},
		get within() {
			return Locator.optional().describe( 'Look only inside this element' );
		},
	} )
	.strict()
	.meta( { id: 'LocatorFields' } );

const Locator: z.ZodType< LocatorSpec > = LocatorFields.refine(
	( spec ) => Boolean( spec.role || spec.text || spec.css ),
	{ message: 'A locator needs role, text or css' }
).meta( { id: 'Locator' } );

export const HELPER_NAMES = [
	'openAddSite',
	'closeMenus',
	'openSiteMenu',
	'openSubmenu',
	'clickInPreview',
	'typeText',
	'dragSeparator',
	'discardAnnotations',
	'stubAgentRuns',
	'playAgentTurn',
	'discardSettings',
] as const;

// One object per step, keyed by its verb.
export const STEP_VERBS = {
	waitFor: z
		.object( {
			waitFor: Locator,
			hidden: z.boolean().optional().describe( 'Wait for it to disappear instead' ),
			timeout: z.number().optional(),
			optional: z.boolean().optional().describe( 'Carry on if it never comes' ),
		} )
		.strict(),
	click: z
		.object( { click: Locator, button: z.enum( [ 'left', 'right', 'middle' ] ).optional() } )
		.strict(),
	hover: z.object( { hover: Locator } ).strict(),
	fill: z.object( { fill: Locator, value: z.string(), blur: z.boolean().optional() } ).strict(),
	press: z.object( { press: z.string().describe( 'A key, e.g. "Escape" or "Meta+K"' ) } ).strict(),
	toggle: z
		.object( {
			toggle: z.union( [
				z.string().describe( 'A switch by name' ),
				LocatorFields.describe( 'A locator; its role is switch unless it says' ),
			] ),
			on: z.boolean(),
		} )
		.strict(),
	scrollTo: z
		.object( {
			scrollTo: Locator,
			offset: z.number().optional().describe( 'Pixels below the top of its scroll area' ),
		} )
		.strict(),
	waitForImages: z.object( { waitForImages: Locator } ).strict(),
	setFiles: z
		.object( {
			setFiles: Locator,
			file: z.string().describe( "A file in the scene's `files` folder" ),
		} )
		.strict(),
	wait: z.object( { wait: z.number().describe( 'Milliseconds' ) } ).strict(),
	helper: z
		.object( {
			helper: z.enum( HELPER_NAMES ),
			args: z.array( z.union( [ z.string(), z.number() ] ) ).optional(),
		} )
		.strict(),
} as const;
export type StepVerb = keyof typeof STEP_VERBS;
export const Step = z.union( Object.values( STEP_VERBS ) );
export type Step = z.infer< typeof Step >;

export const ANNOTATION_TYPES = [ 'outline', 'badge', 'arrow' ] as const;
export const Annotation = z.union( [
	z.object( { outline: Locator } ).strict(),
	z.object( { badge: Locator } ).strict().describe( 'Numbered in order' ),
	z
		.object( {
			arrow: Locator,
			from: z
				.enum( [
					'top',
					'bottom',
					'left',
					'right',
					'top-left',
					'top-right',
					'bottom-left',
					'bottom-right',
				] )
				.optional(),
		} )
		.strict(),
] );
export type Annotation = z.infer< typeof Annotation >;

export const Capture = z
	.object( {
		target: z
			.union( [ Locator, z.array( Locator ) ] )
			.optional()
			.describe( 'Crop to this element, or frame several together; the whole window if unset' ),
		pad: z
			.union( [ z.number(), z.tuple( [ z.number(), z.number() ] ) ] )
			.optional()
			.describe( "Margin around the target, or [x, y]; the look's crop.pad if unset" ),
		aspect: z
			.number()
			.optional()
			.describe( "Least width-to-height ratio of a crop; the look's crop.aspect if unset" ),
		settle: z.number().optional().describe( 'Milliseconds to wait before capturing' ),
		keepMouse: z.boolean().optional().describe( 'Leave the pointer and focus where they are' ),
	} )
	.strict();
export type Capture = z.infer< typeof Capture >;

export const Shot = z
	.object( {
		name: z
			.string()
			.regex( SLUG )
			.optional()
			.describe( 'File name of the output; required unless the script is manual' ),
		description: z.string(),
		steps: z.array( Step ).optional().describe( 'What reaches the screen' ),
		capture: Capture.optional(),
		annotate: z
			.array( Annotation )
			.optional()
			.describe( 'Also saves <name>-annotated with these marks' ),
		after: z.array( Step ).optional().describe( 'Undoes the steps for the next shot' ),
		desktopOnly: z
			.boolean()
			.optional()
			.describe( 'Shows something only Studio Desktop has; skipped with the browser driver' ),
		pages: z.array( z.string() ).optional().describe( 'Docs pages that use the shot' ),
		replaces: z.array( z.string() ).optional().describe( 'Uploads the shot replaces' ),
		meta: z.record( z.string(), z.unknown() ).optional().describe( 'Passed through to results' ),
	} )
	.strict();
export type Shot = z.infer< typeof Shot >;

export const Script = z
	.object( {
		$schema: z.string().optional(),
		name: z.string().regex( SLUG ),
		description: z.string(),
		scene: z
			.string()
			.optional()
			.describe( 'Scene to open on: a bundled scene name or a path relative to this file' ),
		look: z.string().optional().describe( 'Look to capture with: a bundled look name or a path' ),
		driver: z
			.enum( [ 'electron', 'browser' ] )
			.optional()
			.describe( 'Front end to drive: the Desktop app (default) or `studio ui` in a browser' ),
		firstRun: z.boolean().optional().describe( 'Start on an empty profile at the Welcome dialog' ),
		signedIn: z.boolean().optional().describe( 'Signed in to WordPress.com (guarded)' ),
		previewSites: z
			.boolean()
			.optional()
			.describe( "List the scene's made-up preview sites (signed in)" ),
		connectedSites: z
			.boolean()
			.optional()
			.describe( "Connect the scene's made-up WordPress.com sites (signed in)" ),
		chats: z.array( z.string() ).optional().describe( 'Chats from the scene to open on' ),
		capture: Capture.optional().describe( 'Defaults for every shot' ),
		manual: z.boolean().optional().describe( 'Shots captured by hand, listed only' ),
		shots: z.array( Shot ).min( 1 ),
	} )
	.strict()
	.superRefine( ( script, ctx ) => {
		if ( script.manual ) {
			return;
		}
		const seen = new Set< string >();
		script.shots.forEach( ( shot, index ) => {
			if ( ! shot.name ) {
				ctx.addIssue( {
					code: 'custom',
					path: [ 'shots', index, 'name' ],
					message: 'A shot needs a name',
				} );
			} else if ( seen.has( shot.name ) ) {
				ctx.addIssue( {
					code: 'custom',
					path: [ 'shots', index, 'name' ],
					message: `Duplicate shot name "${ shot.name }"`,
				} );
			}
			seen.add( shot.name ?? '' );
		} );
	} );
export type Script = z.infer< typeof Script >;

export const SceneSite = z
	.object( {
		id: z
			.string()
			.regex( /^[0-9a-f-]{36}$/i )
			.optional()
			.describe( 'Site id; derived from the slug if unset' ),
		name: z.string(),
		slug: z.string().regex( SLUG ).optional().describe( 'Folder name; derived from the name' ),
		import: z.string().optional().describe( 'A Studio backup to load, relative to the scene' ),
		blueprint: z
			.string()
			.optional()
			.describe( 'A Blueprint to create the site from: a path relative to the scene, or a URL' ),
		design: z.string().optional().describe( "A DESIGN.md to put in the site's folder" ),
		bakedFrom: z.string().optional().describe( 'The Blueprint `bake` made the backup from' ),
	} )
	.strict()
	.refine( ( site ) => ! ( site.import && site.blueprint ), {
		message: 'A site takes import or blueprint, not both',
	} );
export type SceneSite = z.infer< typeof SceneSite >;

export const Scene = z
	.object( {
		$schema: z.string().optional(),
		name: z.string(),
		description: z.string().optional(),
		sites: z
			.array( SceneSite )
			.min( 1 )
			.describe( 'In sidebar order. Sites with import or blueprint start with Studio' ),
		open: z
			.string()
			.optional()
			.describe( 'Slug of the site scripts open on; the first with import or blueprint' ),
		account: z
			.object( {
				wpcomSites: z.string().optional().describe( 'Made-up WordPress.com and Pressable sites' ),
				previewSites: z.string().optional().describe( 'Made-up preview sites' ),
				aiQuota: z.string().optional().describe( 'Made-up AI credits' ),
			} )
			.strict()
			.optional()
			.describe( 'Files answering for the signed-in account, relative to the scene' ),
		chats: z.string().optional().describe( 'Folder of recorded chats (<name>.json)' ),
		agentTurns: z.string().optional().describe( 'Folder of agent runs for playAgentTurn' ),
		files: z.string().optional().describe( 'Folder of files for setFiles steps' ),
	} )
	.strict();
export type Scene = z.infer< typeof Scene >;

const Color = z.string().describe( 'A CSS color' );

export const Look = z
	.object( {
		$schema: z.string().optional(),
		name: z.string(),
		description: z.string().optional(),
		window: z
			.object( { width: z.number().int().positive(), height: z.number().int().positive() } )
			.strict()
			.default( { width: 1440, height: 900 } )
			.describe( "The window's content size, in points" ),
		scale: z.number().positive().default( 2 ).describe( 'Device scale factor of the capture' ),
		appearance: z
			.object( {
				colorScheme: z.enum( [ 'light', 'dark', 'system' ] ).default( 'light' ),
				accentColor: z
					.string()
					.regex( /^#[0-9a-f]{6}$/i )
					.optional(),
				tintIntensity: z.number().min( 0 ).max( 100 ).optional(),
				contrast: z.number().min( 0 ).max( 100 ).optional(),
			} )
			.strict()
			.default( { colorScheme: 'light' } )
			.describe( "Studio's Appearance settings" ),
		windowControls: z
			.boolean()
			.default( true )
			.describe( 'Draw the macOS window buttons, which Electron leaves out of captures' ),
		annotations: z
			.object( { accent: Color.default( '#3858e9' ), halo: Color.default( '#ffffff' ) } )
			.strict()
			.default( { accent: '#3858e9', halo: '#ffffff' } ),
		crop: z
			.object( { pad: z.number().default( 48 ), aspect: z.number().default( 1.5 ) } )
			.strict()
			.default( { pad: 48, aspect: 1.5 } )
			.describe( 'Defaults for cropped shots' ),
		still: z
			.object( {
				format: z.enum( [ 'webp', 'png' ] ).default( 'webp' ),
				quality: z.number().min( 1 ).max( 100 ).default( 90 ),
			} )
			.strict()
			.default( { format: 'webp', quality: 90 } ),
		frame: z
			.object( {
				background: z
					.union( [
						z.enum( [ 'dots', 'dots-light', 'dots-dark' ] ),
						Color,
						z.tuple( [ Color, Color ] ),
					] )
					.default( [ '#F7F7F7', '#F1F1F1' ] )
					.describe(
						"Studio's dot field (`dots` follows the look's color scheme, `dots-light` and `dots-dark` pin one; drawn at the app's size), a color, or a diagonal gradient"
					),
				padding: z
					.union( [ z.number(), z.tuple( [ z.number(), z.number() ] ) ] )
					.default( 0.06 )
					.describe(
						"Margin, as a share of the width on every side, or [x, y] as shares of the width and of the height (equal shares keep the window's proportions)"
					),
				radius: z.number().default( 0.012 ).describe( 'Corner radius, as a share of the width' ),
				shadow: z
					.union( [ z.number().min( 0 ).max( 1 ), z.literal( 'auto' ) ] )
					.default( 0.14 )
					.describe( 'Shadow opacity; `auto` picks one for how light the background is' ),
				blur: z.number().default( 0.015 ).describe( 'Shadow blur, as a share of the width' ),
				hairline: Color.default( 'rgba(0,0,0,0.10)' ).describe(
					'Edge line color; `auto` picks one for how light the background is'
				),
			} )
			.strict()
			.optional()
			.describe( 'Frames each still on a background, for pages where its edges would wash out' ),
		outputs: z
			.array(
				z
					.object( {
						suffix: z.string().regex( /^[a-z0-9-]*$/ ),
						width: z.number().int().positive(),
						height: z.number().int().positive(),
						margin: z
							.number()
							.min( 0 )
							.max( 0.45 )
							.default( 0.08 )
							.describe( 'Least margin, as a share of the canvas' ),
					} )
					.strict()
			)
			.optional()
			.describe( 'Fixed-size canvases the framed still is fitted into, as <name>-<suffix>' ),
		keepRaw: z
			.boolean()
			.default( true )
			.describe( 'Also save the unframed still as <name> when the look frames' ),
		video: z
			.object( {
				formats: z
					.array( z.enum( [ 'webp', 'gif', 'webm', 'mp4' ] ) )
					.default( [ 'webp' ] )
					.describe( 'webp and gif need nothing else; webm and mp4 need ffmpeg' ),
				fps: z.number().int().min( 1 ).max( 30 ).default( 12 ),
				width: z.number().int().positive().default( 1440 ).describe( 'Output width in pixels' ),
				hold: z.number().default( 1500 ).describe( 'Milliseconds to hold the last frame' ),
				cursor: z.boolean().default( true ).describe( 'Draw a pointer and glide it to clicks' ),
				typingDelay: z.number().default( 45 ).describe( 'Milliseconds per typed character' ),
			} )
			.strict()
			.default( {
				formats: [ 'webp' ],
				fps: 12,
				width: 1440,
				hold: 1500,
				cursor: true,
				typingDelay: 45,
			} ),
	} )
	.strict();
export type Look = z.infer< typeof Look >;

export const SCHEMAS = { scene: Scene, script: Script, look: Look } as const;
export type SchemaKind = keyof typeof SCHEMAS;

/** The JSON Schema written to `schemas/<kind>.schema.json`. */
export function jsonSchemaFor( kind: SchemaKind ) {
	return {
		...z.toJSONSchema( SCHEMAS[ kind ], { io: 'input', unrepresentable: 'any' } ),
		$id: `https://github.com/Automattic/studio/tools/capture-harness/schemas/${ kind }.schema.json`,
		title: `Studio capture ${ kind }`,
	};
}

/**
 * Readable messages for a failed parse of `data`, one per problem, with the
 * path into the file. Where a value can take several forms (a step, keyed by
 * its verb), the problems reported are those of the form it has keys of,
 * rather than its mismatch with every other form.
 */
export function describeIssues( error: z.ZodError, data?: unknown ): string[] {
	const where = ( path: PropertyKey[] ) => ( path.length ? path.join( '.' ) : '(root)' );
	const at = ( path: PropertyKey[] ) =>
		path.reduce< unknown >(
			( value, key ) => ( value as Record< PropertyKey, unknown > | undefined )?.[ key ],
			data
		);
	const out: string[] = [];
	const visit = ( issues: z.core.$ZodIssue[], prefix: PropertyKey[] ) => {
		for ( const issue of issues ) {
			const path = [ ...prefix, ...issue.path ];
			if ( issue.code !== 'invalid_union' || ! issue.errors.length ) {
				out.push( `${ where( path ) }: ${ issue.message }` );
				continue;
			}
			const value = at( path );
			let branches = issue.errors;
			if ( value && typeof value === 'object' && ! Array.isArray( value ) ) {
				// A form is meant when the value has some key it knows.
				branches = branches.filter( ( errors ) => {
					const unknown = new Set(
						errors.flatMap( ( e ) =>
							e.code === 'unrecognized_keys' && e.path.length === 0 ? e.keys : []
						)
					);
					return Object.keys( value ).some( ( key ) => ! unknown.has( key ) );
				} );
				if ( ! branches.length ) {
					out.push( `${ where( path ) }: matches none of the forms it can take` );
					continue;
				}
			}
			visit( [ ...branches ].sort( ( a, b ) => a.length - b.length )[ 0 ], path );
		}
	};
	visit( error.issues, [] );
	return out;
}
