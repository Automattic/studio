import '@studio/ds/theme/tokens.css';
import '@studio/ds/theme/base.css';
import '@/index.css';
import { applyTheme, resolveColorScheme } from '@studio/ds/theme';
import { __ } from '@wordpress/i18n';
import { StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { App } from '@/app';
import { applyUserPreferences } from '@/app/apply-user-preferences';
import { onCaughtError, setupBrowserErrorReporting } from '@/app/error-reporting';
import { loadStartupRouter } from '@/app/load-startup-router';
import { StartupScreen } from '@/app/startup-screen';
import { persistPromise, queryClient } from '@/data/core';
import { createLocalConnector } from '@/data/core/connectors/local';
import { UnsupportedServerError } from '@/data/core/connectors/local/server-version';
import { CloudPlanPicker, CloudSignIn, type EndedPlan } from '@/features/cloud';
import type { Billing } from '@/data/core';

// Studio Cloud entry point. The page and its control plane (`/cloud/*`) share an origin; the
// user's machine, running `studio serve`, is on another, and the `local` connector talks to it
// with the session cookie the machine sets from the control plane's token.

interface CloudSession {
	user: { id: string };
	// Null without a Studio Cloud plan, and then there's no machine either.
	plan: { tier: string } | null;
	// Set when the user's plan ended: their machine waits for a renewal until `keptUntil`.
	ended?: EndedPlan | null;
	machine: { origin: string; ready: boolean } | null;
	token: string | null;
	wpcomToken: string;
}

type ReadyCloudSession = CloudSession & { machine: { origin: string; ready: true } };

// Sessions last an hour; renewing well before keeps requests from failing in between.
const RENEW_SESSION_MS = 20 * 60 * 1000;
const POLL_MS = 2000;

setupBrowserErrorReporting( 'web' );

function signIn( returnTo = window.location.pathname + window.location.search ) {
	window.location.assign( `/cloud/sign-in?return=${ encodeURIComponent( returnTo ) }` );
}

async function signOutOfControl() {
	await fetch( '/cloud/sign-out', { method: 'POST', credentials: 'same-origin' } );
	window.location.assign( '/' );
}

// Before a workspace opens there are no saved preferences: the page follows the system's appearance.
function followSystemAppearance() {
	const apply = () => applyTheme( resolveColorScheme( 'system' ), {} );
	apply();
	window.matchMedia?.( '(prefers-color-scheme: dark)' ).addEventListener( 'change', apply );
}

async function getSession(): Promise< CloudSession | null > {
	const response = await fetch( '/cloud/session', { credentials: 'same-origin' } );
	if ( response.status === 401 ) {
		return null;
	}
	if ( ! response.ok ) {
		throw new Error( `Studio Cloud is unavailable (${ response.status })` );
	}
	return ( await response.json() ) as CloudSession;
}

async function signInToMachine( session: ReadyCloudSession ) {
	const response = await fetch( `${ session.machine.origin }/api/cloud/login`, {
		method: 'POST',
		credentials: 'include',
		headers: { Authorization: `Bearer ${ session.token }` },
	} );
	if ( ! response.ok ) {
		throw new Error( `Couldn’t reach your Studio machine (${ response.status })` );
	}
	// The machine signs in to WordPress.com as the user, like Studio on a computer, for the
	// agent's AI and for publishing.
	const current = await fetch( `${ session.machine.origin }/api/auth/user`, {
		credentials: 'include',
	} ).then( ( user ) => user.json() as Promise< { id: number } | null > );
	if ( String( current?.id ) !== session.user.id ) {
		await fetch( `${ session.machine.origin }/api/auth/login`, {
			method: 'POST',
			credentials: 'include',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify( { token: session.wpcomToken } ),
		} );
	}
}

// WordPress.com's Studio purchases and receipts (`/wpcom/v2/studio-app/billing`).
interface WpcomBilling {
	purchases: {
		product_name: string;
		tier: string | null;
		billing_period: 'monthly' | 'yearly' | null;
		expiry_date: string | null;
		auto_renew: boolean;
		manage_url: string;
		renew_url: string | null;
	}[];
	receipts: {
		id: number;
		date: string;
		amount_text: string;
		items: { product_name: string }[];
		receipt_url: string;
	}[];
}

async function getBilling(): Promise< Billing > {
	const response = await fetch( '/cloud/billing', { credentials: 'same-origin' } );
	if ( ! response.ok ) {
		throw new Error( `GET /cloud/billing failed (${ response.status })` );
	}
	const { purchases, receipts } = ( await response.json() ) as WpcomBilling;
	// Only one plan is active at a time; one superseded by it ended before it.
	const plan = purchases
		.filter( ( purchase ) => purchase.tier && purchase.billing_period )
		.sort( ( a, b ) => ( b.expiry_date ?? '' ).localeCompare( a.expiry_date ?? '' ) )[ 0 ];
	return {
		plan: plan
			? {
					name: plan.product_name,
					period: plan.billing_period!,
					expiresAt: plan.expiry_date,
					autoRenew: plan.auto_renew,
					manageUrl: plan.manage_url,
					renewUrl: plan.renew_url,
			  }
			: null,
		receipts: receipts.map( ( receipt ) => ( {
			id: receipt.id,
			date: receipt.date,
			amount: receipt.amount_text,
			items: receipt.items.map( ( item ) => item.product_name ),
			url: receipt.receipt_url,
		} ) ),
	};
}

const wait = ( ms: number ) => new Promise( ( resolve ) => setTimeout( resolve, ms ) );

const isReady = ( session: CloudSession | null ): session is ReadyCloudSession =>
	!! session?.machine?.ready;

// Signed in without a plan: the plans, and the workspace once checkout on WordPress.com is done.
function showPlans( root: Root, ended: EndedPlan | null ) {
	followSystemAppearance();
	const chosenPlan = new URLSearchParams( window.location.search ).get( 'plan' );
	const render = ( checking: boolean ) =>
		root.render(
			<CloudPlanPicker
				chosenPlan={ chosenPlan }
				ended={ ended }
				checking={ checking }
				onCheck={ () => void check() }
				onSignOut={ () => void signOutOfControl() }
			/>
		);
	const check = async () => {
		render( true );
		const session = await getSession().catch( () => null );
		if ( ! session || session.plan ) {
			window.location.assign( '/' );
			return;
		}
		render( false );
	};
	render( false );
	// Checkout runs in another tab, so coming back is the moment to look again.
	window.addEventListener( 'focus', () => void check() );
}

async function bootstrap() {
	const root = createRoot( document.getElementById( 'root' )!, { onCaughtError } );
	root.render( <StartupScreen /> );

	let session = await getSession();
	if ( ! session ) {
		followSystemAppearance();
		root.render( <CloudSignIn onSignIn={ () => signIn() } /> );
		return;
	}
	if ( ! session.plan ) {
		showPlans( root, session.ended ?? null );
		return;
	}
	while ( ! isReady( session ) ) {
		root.render( <StartupScreen message={ __( 'Setting up your workspace…' ) } /> );
		await wait( POLL_MS );
		session = await getSession();
		if ( ! session ) {
			signIn();
			return;
		}
	}
	// The plan chosen before checkout has done its job.
	if ( new URLSearchParams( window.location.search ).has( 'plan' ) ) {
		window.history.replaceState( null, '', '/' );
	}
	await signInToMachine( session );

	const { origin } = session.machine;
	setInterval( () => {
		void getSession().then( ( renewed ) =>
			isReady( renewed ) ? signInToMachine( renewed ) : window.location.reload()
		);
	}, RENEW_SESSION_MS );

	const connector = createLocalConnector( {
		apiBaseUrl: origin,
		remote: {
			signIn,
			getBilling,
			async signOut() {
				await fetch( `${ origin }/api/cloud/logout`, { method: 'POST', credentials: 'include' } );
				await signOutOfControl();
			},
		},
	} );

	try {
		await connector.init?.();
	} catch ( error ) {
		if ( error instanceof UnsupportedServerError ) {
			// The control plane updates a machine that's behind when it next starts it.
			root.render( <StartupScreen message={ __( 'Updating your workspace…' ) } /> );
			await wait( POLL_MS * 5 );
			window.location.reload();
			return;
		}
		throw error;
	}
	await Promise.all( [ applyUserPreferences( connector ), persistPromise ] );
	const router = await loadStartupRouter( connector, queryClient );

	root.render(
		<StrictMode>
			<App connector={ connector } router={ router } />
		</StrictMode>
	);
}

void bootstrap();
