import { mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { captureFailure, captureShot } from './lib/capture.mjs';
import { DEMO_SITE_DIR, ROOT, SCREENSHOTS_DIR, SHOTS_DIR, readJson } from './lib/common.mjs';
import { runSteps } from './lib/steps.mjs';
import { createProfile, launchStudio, readAuthToken } from './lib/studio-app.mjs';
import { seedChats, seedSites, siteMetadata } from './lib/studio-seed.mjs';
import {
	capturePreviews,
	loadAccountRoutes,
	loadPreviewSites,
	loadWpcomSites,
	replaceConnectedSites,
	replacePreviewSites,
	replaceWpcomSites,
} from './lib/wpcom-sites.mjs';

const UPLOADS_URL = 'https://developer.wordpress.com/wp-content/uploads/';

function getArgs() {
	const { values } = parseArgs( {
		options: {
			suite: { type: 'string' },
			only: { type: 'string' },
			out: { type: 'string' },
			'keep-profile': { type: 'boolean', default: false },
			list: { type: 'boolean', default: false },
		},
	} );
	const names = ( value ) =>
		value ? new Set( value.split( ',' ).map( ( s ) => s.trim() ) ) : null;
	return {
		suite: names( values.suite ),
		only: names( values.only ),
		out: values.out ? path.resolve( values.out ) : null,
		keepProfile: values[ 'keep-profile' ],
		list: values.list,
	};
}

function assertKnown( kind, set, known ) {
	const unknown = [ ...( set ?? [] ) ].filter( ( name ) => ! known.includes( name ) );
	if ( unknown.length ) {
		throw new Error( `Unknown ${ kind }(s): ${ unknown.join( ', ' ) }` );
	}
}

/**
 * The first-run flow depends on the one-dialog welcome added after 2.0.4; an
 * older build shows a full-page welcome with a Skip button instead.
 */
async function assertFirstRunWelcome( ctx, version ) {
	const dialog = ctx.w.getByRole( 'dialog', { name: 'Welcome to WordPress Studio' } );
	const oldWelcome = ctx.w.getByRole( 'button', { name: 'Skip' } );
	await dialog.or( oldWelcome ).waitFor();
	if ( await oldWelcome.isVisible() ) {
		throw new Error(
			`Studio ${ version } predates the 2.0 welcome dialog these shots need. ` +
				'Capture from a build of this branch instead (STUDIO_APP_DIR, see README.md).'
		);
	}
}

function formatIndex( { runnable, manual, version, failed } ) {
	const cell = ( list = [] ) => list.map( ( item ) => `\`${ item }\`` ).join( '<br>' ) || '—';
	const lines = [
		`# Studio screenshots`,
		'',
		`Captured from Studio ${ version } by \`npm run screenshots\`, signed out except the signed-in suites (\`signedIn\` in their JSON), which show a WordPress.com account with its email masked.`,
		`Upload to WordPress.com; a file named \`<name>.webp\` becomes \`${ UPLOADS_URL }YYYY/MM/<name>.webp\`.`,
		`Shots with annotations also have a \`<name>-annotated.webp\`.`,
		'',
		'| File | Suite | Shows | Used on | Replaces |',
		'| --- | --- | --- | --- | --- |',
		...runnable.flatMap( ( suite ) =>
			suite.shots.map(
				( shot ) =>
					`| \`${ shot.name }.webp\` | ${ suite.name } | ${ shot.description } | ${ cell(
						shot.pages
					) } | ${ cell( shot.replaces ) } |`
			)
		),
	];
	if ( failed.length ) {
		lines.push(
			'',
			'## Failed in the last run',
			'',
			...failed.map( ( { shot, error } ) => `- \`${ shot.name }\` — ${ error }` )
		);
	}
	if ( manual.length ) {
		lines.push(
			'',
			'## Capture manually',
			'',
			'These need a WordPress.com login, a connected live site, or Studio Code output.',
			'',
			'| Shows | Used on | Replaces |',
			'| --- | --- | --- |',
			...manual.map(
				( shot ) =>
					`| ${ shot.description } | ${ cell( shot.pages ) } | ${ cell( shot.replaces ) } |`
			)
		);
	}
	return lines.join( '\n' ) + '\n';
}

/**
 * Waits for the demo site to be running and its front page showing. Studio's
 * site server occasionally crashes while starting (an undici assertion in the
 * server child process), after which Studio serves its "PHP Error Detected"
 * page in the preview; stopping and starting the site again recovers it.
 */
async function ensureSiteRunning( ctx, site ) {
	const button = ( verb ) =>
		ctx.w.getByRole( 'button', { name: `${ verb } ${ site.name }`, exact: true } ).first();
	const previewTitle = () =>
		ctx.w.evaluate( () => {
			// The element is there before it's attached and can run scripts.
			const webview = document.querySelector( 'webview' );
			return typeof webview?.executeJavaScript === 'function'
				? webview.executeJavaScript( 'document.title' ).catch( () => '' )
				: '';
		} );
	for ( let attempt = 1; ; attempt++ ) {
		await button( 'Stop' ).waitFor( { timeout: 120000 } );
		// After a restart the preview still shows the error page until it reloads.
		let title = '';
		for ( let i = 0; i < 30 && ( ! title || /PHP Error/i.test( title ) ); i++ ) {
			await ctx.w.waitForTimeout( 500 );
			title = ( await previewTitle() ) ?? '';
		}
		if ( title && ! /PHP Error/i.test( title ) ) {
			return;
		}
		if ( attempt >= 3 ) {
			throw new Error(
				`The demo site's server failed to start ${ attempt } times (Studio shows "${ title }").`
			);
		}
		console.log(
			`  The site's server failed to start (Studio shows its PHP error page); starting it again...`
		);
		await button( 'Stop' ).click();
		await button( 'Start' ).waitFor( { timeout: 60000 } );
		await button( 'Start' ).click();
	}
}

async function main() {
	const args = getArgs();
	const files = ( await readdir( SHOTS_DIR ) ).filter( ( f ) => f.endsWith( '.json' ) ).sort();
	const suites = await Promise.all(
		files.map( ( file ) => readJson( path.join( SHOTS_DIR, file ) ) )
	);
	const runnable = suites.filter( ( s ) => ! s.manual );
	const manual = suites.filter( ( s ) => s.manual ).flatMap( ( s ) => s.shots );

	if ( args.list ) {
		for ( const suite of runnable ) {
			console.log(
				`${ suite.name }${ suite.signedIn ? ' (signed in)' : '' }: ${ suite.description }`
			);
			for ( const shot of suite.shots ) {
				console.log( `  ${ shot.name }` );
			}
		}
		return;
	}

	assertKnown(
		'suite',
		args.suite,
		runnable.map( ( s ) => s.name )
	);
	assertKnown(
		'shot',
		args.only,
		runnable.flatMap( ( s ) => s.shots.map( ( shot ) => shot.name ) )
	);
	const selected = runnable.filter(
		( s ) =>
			( ! args.suite || args.suite.has( s.name ) ) &&
			( ! args.only || s.shots.some( ( shot ) => args.only.has( shot.name ) ) )
	);

	const outDir = args.out ?? path.join( SCREENSHOTS_DIR, 'images' );
	await mkdir( outDir, { recursive: true } );

	// Every suite launches Studio afresh, so each feature's shots stand on their
	// own. First-run suites get an empty profile each; the others share one
	// profile with the demo sites, whose running site Studio starts on launch.
	const profiles = [];
	let demo = null;
	if ( selected.some( ( s ) => ! s.firstRun ) ) {
		console.log( 'Creating the demo sites...' );
		const profile = await createProfile();
		profiles.push( profile );
		const sites = await seedSites( profile, DEMO_SITE_DIR );
		const site = sites.find( ( s ) => s.import );
		if ( ! site ) {
			throw new Error(
				'One site in screenshots/demo-site/sites.json must have an `import` backup: the shots open on it.'
			);
		}
		demo = { profile, sites, site };
	}

	// Read before anything launches, so a missing login fails the run up front.
	const authToken = selected.some( ( s ) => s.signedIn ) ? await readAuthToken() : null;
	const accountRoutes = authToken ? await loadAccountRoutes( DEMO_SITE_DIR ) : [];
	// Signed-in suites list made-up WordPress.com sites, not the account's own.
	let wpcom = null;
	if ( selected.some( ( s ) => s.signedIn && ! s.firstRun ) ) {
		const remoteSites = await loadWpcomSites( DEMO_SITE_DIR );
		const previewSites = await loadPreviewSites( DEMO_SITE_DIR, demo.sites );
		console.log( 'Capturing the WordPress.com site thumbnails...' );
		wpcom = {
			remoteSites,
			previewSites,
			previews: await capturePreviews( demo.profile, demo.sites, [
				...remoteSites,
				...previewSites,
			] ),
		};
	}

	let version = null;
	const failed = [];
	let written = 0;
	let unchanged = 0;
	try {
		for ( const suite of selected ) {
			console.log( `\n${ suite.name }: ${ suite.description }` );
			const firstRun = suite.firstRun ?? false;
			let profile = demo?.profile;
			if ( firstRun ) {
				profile = await createProfile();
				profiles.push( profile );
			}
			// Chats a suite opens on (`chats`), recorded under their sites for this launch only.
			const chats = suite.chats
				? await seedChats( profile, DEMO_SITE_DIR, demo.sites, suite.chats )
				: null;
			const studio = await launchStudio( {
				profile,
				firstRun,
				appData: firstRun
					? {}
					: { ...siteMetadata( demo.sites ), aiSessionPlacements: chats?.placements },
				authToken: suite.signedIn ? authToken : null,
				routes: suite.signedIn ? accountRoutes : [],
			} );
			version ??= studio.version;
			if ( suite.signedIn && wpcom ) {
				await replaceWpcomSites( studio, wpcom.remoteSites, wpcom.previews );
				if ( suite.connectedSites ) {
					await replaceConnectedSites(
						studio,
						wpcom.remoteSites,
						demo.sites,
						demo.profile.dirs.sites
					);
				}
				if ( suite.previewSites ) {
					await replacePreviewSites( studio, wpcom.previewSites, wpcom.previews, authToken.id );
				}
			}
			const ctx = {
				app: studio.app,
				w: studio.window,
				profile,
				email: suite.signedIn ? authToken.email : null,
				vars: {
					site: demo?.site,
					account: suite.signedIn ? { name: authToken.displayName } : undefined,
				},
			};
			try {
				if ( firstRun ) {
					await assertFirstRunWelcome( ctx, studio.version );
				} else {
					await ensureSiteRunning( ctx, demo.site );
				}
				for ( const shot of suite.shots ) {
					try {
						await runSteps( ctx, shot.steps );
						if ( ! args.only || args.only.has( shot.name ) ) {
							const capture = { ...suite.capture, ...shot.capture };
							for ( const { file, changed } of await captureShot(
								ctx,
								{ ...shot, capture },
								outDir
							) ) {
								console.log(
									`  ${ changed ? 'saved    ' : 'unchanged' } ${ path.basename( file ) }`
								);
								if ( changed ) {
									written++;
								} else {
									unchanged++;
								}
							}
						}
						await runSteps( ctx, shot.after );
					} catch ( error ) {
						const message = error.message.split( '\n' )[ 0 ];
						const file = await captureFailure( ctx, shot, outDir );
						failed.push( { shot, error: message } );
						console.log( `  FAILED   ${ shot.name }: ${ message }` );
						console.log(
							`  Window saved to ${ path.relative(
								ROOT,
								file
							) }; the rest of this suite depends on this step.`
						);
						break;
					}
				}
			} finally {
				await studio.close();
				await chats?.remove();
			}
		}
	} finally {
		for ( const profile of profiles ) {
			if ( args.keepProfile ) {
				console.log( `\nProfile kept at ${ profile.dirs.root }` );
			} else {
				await profile.remove();
			}
		}
	}

	// The index describes a whole run; a partial one would misreport the rest.
	if ( ! args.suite && ! args.only ) {
		await writeFile(
			path.join( outDir, 'index.md' ),
			formatIndex( { runnable, manual, version, failed } )
		);
	}
	console.log(
		`\n${ written } screenshot(s) written, ${ unchanged } unchanged, in ${ path.relative(
			ROOT,
			outDir
		) }/` + ( failed.length ? `; ${ failed.length } failed` : '' )
	);
	if ( failed.length ) {
		process.exitCode = 1;
	}
}

main().catch( ( err ) => {
	console.error( err );
	process.exit( 1 );
} );
