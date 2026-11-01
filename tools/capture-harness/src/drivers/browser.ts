/**
 * Drives Studio's browser front end: `studio ui` (the `apps/local` server
 * running in the CLI) serves the same `apps/ui` renderer as the Desktop app,
 * opened here in headless Chromium. It needs no display and no Electron, so
 * it runs in any Linux container. The renderer reaches the server's `/api`,
 * so stubs and the signed-in guard answer there, and agent events go to the
 * page's EventSource as the server would stream them.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { chromium, type BrowserContext, type Route } from 'playwright';
import sharp from 'sharp';
import { cliMain } from '../locate.ts';
import { answerGravatar } from './avatar.ts';
import type { Box } from '../locators.ts';
import type { AgentRunEvent, LaunchOptions, RemoteTrees, Studio, Stubs } from './types.ts';

type Answer = ( match: RegExpExecArray, url: URL ) => unknown;

interface ApiRoute {
	method: string;
	path: RegExp;
	answer: Answer;
}

// Requests the signed-in guard refuses: logging out or in (which would change
// the token), publishing and pulling, connecting sites, changing preview sites,
// and starting an agent run. `BLOCKED_SIGNED_IN_HANDLERS` in guard.ts is the
// Desktop list; these are the same operations in `apps/local`'s API.
const BLOCKED_API: { method: RegExp; path: RegExp; name: string }[] = [
	{ method: /POST/, path: /^\/auth\/(logout|login)$/, name: 'logging in or out' },
	{ method: /DELETE|PATCH/, path: /^\/snapshots(\/.*)?$/, name: 'changing preview sites' },
	{ method: /POST/, path: /^\/sites\/[^/]+\/preview$/, name: 'publishing a preview site' },
	{
		method: /POST|DELETE/,
		path: /^\/sites\/[^/]+\/connected-sites(\/.*)?$/,
		name: 'connecting sites',
	},
	{ method: /POST/, path: /^\/sites\/[^/]+\/(push|pull)$/, name: 'publishing or pulling' },
	{ method: /POST/, path: /^\/sites\/[^/]+\/watch-published-site$/, name: 'watching for a site' },
	{ method: /POST/, path: /^\/sessions\/[^/]+\/messages$/, name: 'starting an agent run' },
];

/** What the signed-in guard calls a request it refuses, if it does. */
export function blockedOperation( method: string, apiPath: string ) {
	return BLOCKED_API.find( ( b ) => b.method.test( method ) && b.path.test( apiPath ) )?.name;
}

/**
 * The AI credits as `/api/quota` serves them: WordPress.com's answer parsed by
 * `studioAssistantQuotaSchema` (packages/common/lib/studio-assistant-quota.ts).
 */
export function parseQuota( raw: Record< string, unknown > ) {
	return {
		costUsage: raw.cost_usage,
		costCap: raw.cost_cap,
		costResetDate: raw.cost_reset_date,
		emailVerified: raw.email_verified ?? true,
		hasPaymentMethod: raw.has_payment_method ?? true,
		studioCodeAiHasAccess: raw.studio_code_ai_has_access,
		studioCodeAiAccess: raw.studio_code_ai_access,
		allowanceRemaining: raw.allowance_remaining,
		purchasedRemaining: raw.purchased_remaining ?? undefined,
		purchasedAtTopUp: raw.purchased_at_top_up ?? undefined,
	};
}

type TopUpOption = { credits: number; display: string };

/**
 * The AI credit top-ups as `/api/top-up-pricing` serves them: WordPress.com's
 * answer parsed by `studioAssistantTopUpPricingSchema`, cheapest first.
 */
const parseTopUpPricing = ( raw: { options: TopUpOption[] } ) => ( {
	options: raw.options
		.map( ( { credits, display } ) => ( { credits, display } ) )
		.sort( ( a, b ) => a.credits - b.credits ),
} );

/** The preview-site usage as `/api/snapshots/usage` serves it (`fetchSnapshotUsage`). */
const previewUsage = ( urls: string[] ) => ( {
	siteCount: urls.length,
	siteLimit: 10,
	siteCreationBlocked: false,
} );

function freePort(): Promise< number > {
	return new Promise( ( resolve, reject ) => {
		const server = createServer();
		server.on( 'error', reject );
		server.listen( 0, '127.0.0.1', () => {
			const address = server.address();
			server.close( () =>
				typeof address === 'object' && address ? resolve( address.port ) : reject()
			);
		} );
	} );
}

/** Starts `studio ui` in the profile and resolves once it serves the app. */
async function startServer( env: NodeJS.ProcessEnv ) {
	const port = await freePort();
	const child = spawn(
		process.execPath,
		[ cliMain(), 'ui', '--no-open', '--port', String( port ) ],
		{
			env,
			stdio: [ 'ignore', 'pipe', 'pipe' ],
		}
	);
	let output = '';
	child.stdout?.on( 'data', ( chunk ) => ( output += chunk ) );
	child.stderr?.on( 'data', ( chunk ) => ( output += chunk ) );
	const url = `http://localhost:${ port }`;
	const exited = new Promise< never >( ( _resolve, reject ) =>
		child.once( 'exit', ( code ) =>
			reject(
				new Error(
					`studio ui exited (${ code }):\n${ output.trim().split( '\n' ).slice( -8 ).join( '\n' ) }`
				)
			)
		)
	);
	const ready = ( async () => {
		for ( let i = 0; i < 300; i++ ) {
			// The server sends the app shell only to page loads.
			const response = await fetch( url, { headers: { Accept: 'text/html' } } ).catch( () => null );
			if ( response?.ok ) {
				const html = await response.text();
				if ( ! /<div id="root"|<script/i.test( html ) ) {
					throw new Error(
						'studio ui serves no app: build it with `npm run cli:build:ui` at the repo root.'
					);
				}
				return;
			}
			await new Promise( ( resolve ) => setTimeout( resolve, 200 ) );
		}
		throw new Error( `studio ui didn't answer on ${ url } within a minute.` );
	} )();
	try {
		await Promise.race( [ ready, exited ] );
	} catch ( error ) {
		child.kill();
		throw error;
	}
	return { url, child };
}

async function stopServer( child: ChildProcess ) {
	if ( child.exitCode !== null ) {
		return;
	}
	const exited = new Promise( ( resolve ) => child.once( 'exit', resolve ) );
	child.kill( 'SIGTERM' );
	await Promise.race( [ exited, new Promise( ( resolve ) => setTimeout( resolve, 5000 ) ) ] );
	if ( child.exitCode === null ) {
		child.kill( 'SIGKILL' );
	}
}

/**
 * One handler for the app's `/api` requests: the latest route registered for
 * a request answers it, as a later stub replaces an earlier one; the rest go
 * to the server.
 */
function apiRouter( context: BrowserContext, origin: string ) {
	const routes: ApiRoute[] = [];
	let guarded = false;
	// The event stream is left alone: an intercepted request would hold it up.
	const isApi = ( url: URL ) =>
		url.origin === origin && url.pathname.startsWith( '/api/' ) && url.pathname !== '/api/events';
	const ready = context.route( isApi, async ( route: Route ) => {
		const request = route.request();
		const url = new URL( request.url() );
		const path = url.pathname.replace( /^\/api/, '' );
		const block = guarded ? blockedOperation( request.method(), path ) : undefined;
		for ( const entry of routes ) {
			const match = entry.method === request.method() ? entry.path.exec( path ) : null;
			if ( match ) {
				return route.fulfill( { json: entry.answer( match, url ) ?? null } );
			}
		}
		if ( block ) {
			return route.fulfill( {
				status: 403,
				json: { error: `${ block } is blocked while capturing signed in` },
			} );
		}
		return route.fallback();
	} );
	return {
		ready,
		answer( method: string, path: RegExp, answer: Answer ) {
			routes.unshift( { method, path, answer } );
		},
		guard() {
			guarded = true;
		},
	};
}

// Keeps every EventSource the app opens, so agent events can be played into it.
const EVENT_SOURCES = () => {
	const Original = window.EventSource;
	const sources: EventSource[] = [];
	( window as unknown as { __captureEventSources: EventSource[] } ).__captureEventSources = sources;
	window.EventSource = class extends Original {
		constructor( ...args: ConstructorParameters< typeof EventSource > ) {
			super( ...args );
			sources.push( this );
		}
	};
};

export async function launchBrowser( {
	profile,
	look,
	authToken,
	avatar,
	account,
}: LaunchOptions ): Promise< Studio > {
	const server = await startServer( profile.env );
	const browser = await chromium.launch().catch( async ( error: Error ) => {
		await stopServer( server.child );
		throw new Error(
			`${
				error.message.split( '\n' )[ 0 ]
			}\nInstall Chromium with \`npx playwright install chromium\` (\`npx studio-capture setup\`).`
		);
	} );
	const { colorScheme } = look.appearance;
	const context = await browser.newContext( {
		viewport: look.window,
		deviceScaleFactor: look.scale,
		colorScheme: colorScheme === 'system' ? null : colorScheme,
		locale: 'en-US',
	} );
	await context.addInitScript( EVENT_SOURCES );
	const api = apiRouter( context, server.url );
	await api.ready;
	if ( authToken ) {
		api.guard();
		// The page only reads from WordPress.com; the server holds the token.
		await context.route( 'https://public-api.wordpress.com/**', ( route ) =>
			route.request().method() === 'GET' ? route.fallback() : route.abort()
		);
	}
	if ( avatar !== undefined ) {
		await answerGravatar( context, avatar );
	}
	if ( account?.aiQuota ) {
		const quota = parseQuota( account.aiQuota as Record< string, unknown > );
		api.answer( 'GET', /^\/quota$/, () => quota );
	}
	if ( account?.aiTopUpPricing ) {
		const pricing = parseTopUpPricing( account.aiTopUpPricing as { options: TopUpOption[] } );
		api.answer( 'GET', /^\/top-up-pricing$/, () => pricing );
	}
	if ( account?.previewSiteUrls ) {
		const usage = previewUsage( account.previewSiteUrls );
		api.answer( 'GET', /^\/snapshots\/usage$/, () => usage );
	}

	const page = await context.newPage();
	try {
		await page.goto( server.url, { waitUntil: 'domcontentloaded' } );
	} catch ( error ) {
		await browser.close();
		await stopServer( server.child );
		throw error;
	}

	let lastRun: { runId: string; sessionId: string } | undefined;
	const stubs: Stubs = {
		async syncableSites( sites ) {
			api.answer( 'GET', /^\/wpcom\/syncable-sites$/, () => sites );
		},
		async previewSites( snapshots ) {
			api.answer( 'GET', /^\/snapshots$/, () => snapshots );
		},
		async connectedSites( connected, trees: RemoteTrees, hosting ) {
			api.answer( 'GET', /^\/wpcom\/connected-sites$/, () => connected );
			api.answer( 'GET', /^\/sites\/([^/]+)\/connected-sites$/, ( match ) =>
				connected.filter( ( site ) => site.localSiteId === decodeURIComponent( match[ 1 ] ) )
			);
			api.answer( 'GET', /^\/wpcom\/sites\/[^/]+\/hosting-php-version$/, () => hosting.phpVersion );
			api.answer( 'GET', /^\/wpcom\/sites\/[^/]+\/latest-rewind-id$/, () => hosting.rewindId );
			api.answer(
				'GET',
				/^\/wpcom\/sites\/[^/]+\/remote-file-tree$/,
				( _match, url ) => trees[ url.searchParams.get( 'path' ) ?? '' ] ?? {}
			);
		},
		async agentRuns() {
			api.answer( 'POST', /^\/sessions\/([^/]+)\/messages$/, ( match ) => {
				lastRun = {
					runId: `capture-run-${ Date.now() }`,
					sessionId: decodeURIComponent( match[ 1 ] ),
				};
				return { runId: lastRun.runId };
			} );
		},
		lastAgentRun: async () => lastRun,
		async sendAgentEvent( payload: AgentRunEvent ) {
			await page.evaluate(
				( data ) => {
					const sources = ( window as unknown as { __captureEventSources?: EventSource[] } )
						.__captureEventSources;
					for ( const source of sources ?? [] ) {
						source.dispatchEvent( new MessageEvent( 'message', { data } ) );
					}
				},
				JSON.stringify( { channel: 'agent', payload } )
			);
		},
	};

	return {
		driver: 'browser',
		window: page,
		version: await cliVersion( profile.env ),
		stubs,
		screenshot: ( clip?: Box ) => page.screenshot( { clip, type: 'png' } ),
		windowButtonPosition: async () => null,
		async inPreviews< T >( code: string ) {
			const appOrigin = new URL( server.url ).origin;
			const out: { result: T; offset: { x: number; y: number } }[] = [];
			for ( const element of await page.locator( 'iframe' ).elementHandles() ) {
				const frame = await element.contentFrame();
				const box = await element.boundingBox();
				if ( ! frame || ! box || new URL( frame.url() || appOrigin ).origin === appOrigin ) {
					continue;
				}
				const result = ( await frame.evaluate( code ).catch( () => null ) ) as T;
				out.push( { result, offset: { x: box.x, y: box.y } } );
			}
			return out;
		},
		async startFrames( { fps, width } ) {
			const frames: { at: number; jpeg: Buffer }[] = [];
			const start = Date.now();
			let running = true;
			const loop = ( async () => {
				while ( running ) {
					const began = Date.now();
					try {
						const jpeg = await page.screenshot( { type: 'jpeg', quality: 90 } );
						const { width: shot = 0 } = await sharp( jpeg ).metadata();
						frames.push( {
							at: began - start,
							jpeg:
								shot > width
									? await sharp( jpeg ).resize( width ).jpeg( { quality: 90 } ).toBuffer()
									: jpeg,
						} );
					} catch {
						// The page can be mid-navigation; take the next frame.
					}
					await new Promise( ( resolve ) =>
						setTimeout( resolve, Math.max( 0, 1000 / fps - ( Date.now() - began ) ) )
					);
				}
			} )();
			return async () => {
				running = false;
				await loop;
				return frames;
			};
		},
		async close() {
			await browser.close().catch( () => {} );
			await stopServer( server.child );
		},
	};
}

async function cliVersion( env: NodeJS.ProcessEnv ) {
	return new Promise< string >( ( resolve ) => {
		const child = spawn( process.execPath, [ cliMain(), '--version' ], { env } );
		let out = '';
		child.stdout.on( 'data', ( chunk ) => ( out += chunk ) );
		child.on( 'close', () => resolve( out.trim().split( '\n' ).pop() ?? '' ) );
		child.on( 'error', () => resolve( '' ) );
	} );
}
