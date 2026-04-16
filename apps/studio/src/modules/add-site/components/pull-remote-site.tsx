import {
	__experimentalHeading as Heading,
	__experimentalVStack as VStack,
} from '@wordpress/components';
import { check, Icon, wordpress } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import { useState, PropsWithChildren } from 'react';
import { ArrowIcon } from 'src/components/arrow-icon';
import Button from 'src/components/button';
import { IllustrationGrid } from 'src/components/illustration-grid';
import offlineIcon from 'src/components/offline-icon';
import { Tooltip } from 'src/components/tooltip';
import { useAuth } from 'src/hooks/use-auth';
import { useOffline } from 'src/hooks/use-offline';
import { getIpcApi } from 'src/lib/get-ipc-api';
import {
	SitesListContent,
	useSitesQuery,
	type SitesQueryResult,
} from 'src/modules/sync/components/sync-sites-modal-selector';
import { SyncTabImage } from 'src/modules/sync/components/sync-tab-image';
import type { SyncSite } from '@studio/common/types/sync';

function SiteSyncDescription( { children }: PropsWithChildren ) {
	const { __ } = useI18n();
	return (
		<div className="p-8 flex justify-center gap-12">
			<div className="flex flex-col max-w-sm">
				<div className="a8c-subtitle text-pretty">{ __( 'Sign in to get started' ) }</div>
				<div className="max-w-[40ch] text-frame-text-secondary a8c-body mt-2">
					{ __( 'Connect your WordPress.com account to access your sites.' ) }
				</div>
				<div className="mt-5 flex flex-col gap-1">
					{ [
						__( 'Work on your site locally.' ),
						__( 'Sync content, themes, and plugins.' ),
						__( 'Supports staging and production sites.' ),
					].map( ( text ) => (
						<div key={ text } className="text-frame-text-secondary a8c-body flex items-center">
							<Icon className="fill-frame-theme me-2 shrink-0" icon={ check } size={ 20 } />
							{ text }
						</div>
					) ) }
				</div>
				{ children }
			</div>
			<IllustrationGrid>
				<SyncTabImage />
			</IllustrationGrid>
		</div>
	);
}

function NoAuthPullRemoteSiteView() {
	const isOffline = useOffline();
	const { __ } = useI18n();
	const { authenticate } = useAuth();
	const offlineMessage = __( "You're currently offline." );

	return (
		<SiteSyncDescription>
			<div className="mt-8">
				<Tooltip disabled={ ! isOffline } icon={ offlineIcon } text={ offlineMessage }>
					<Button
						aria-description={ isOffline ? offlineMessage : '' }
						aria-disabled={ isOffline }
						variant="primary"
						className="!gap-2"
						onClick={ () => {
							if ( isOffline ) {
								return;
							}
							authenticate();
						} }
					>
						<Icon icon={ wordpress } size={ 20 } />
						{ __( 'Log in with WordPress.com' ) }
					</Button>
				</Tooltip>
			</div>
			<div className="mt-3 text-frame-text-secondary a8c-body">
				<Tooltip
					disabled={ ! isOffline }
					icon={ offlineIcon }
					text={ offlineMessage }
					placement="bottom-start"
				>
					<span>
						{ __( 'New to WordPress.com?' ) }{ ' ' }
						<Button
							aria-description={ isOffline ? offlineMessage : '' }
							aria-disabled={ isOffline }
							className="!p-0 text-frame-theme hover:opacity-80 h-auto inline-flex items-center"
							onClick={ () => {
								if ( isOffline ) {
									return;
								}
								getIpcApi().authenticate( true );
							} }
						>
							{ __( 'Create a free account' ) }
							<ArrowIcon />
						</Button>
					</span>
				</Tooltip>
			</div>
		</SiteSyncDescription>
	);
}

type DebugState =
	| 'real'
	| 'not-auth'
	| 'loading'
	| 'no-sites'
	| 'empty-search'
	| '1-site'
	| '3-sites'
	| 'all-syncable'
	| 'mixed'
	| 'all-upgrade';

function makeSite( overrides: Partial< SyncSite > & { id: number; name: string } ): SyncSite {
	return {
		localSiteId: '',
		url: `https://${ overrides.name.toLowerCase().replace( /\s+/g, '' ) }.com`,
		isStaging: false,
		isPressable: false,
		syncSupport: 'syncable',
		lastPullTimestamp: null,
		lastPushTimestamp: null,
		...overrides,
	};
}

const MOCK_SITES: Record< string, SyncSite[] > = {
	'1-site': [
		makeSite( {
			id: 1,
			name: 'My Portfolio',
			url: 'https://myportfolio.com',
			planName: 'Business',
			siteIconUrl: 'https://secure.gravatar.com/blavatar/abc',
		} ),
	],
	'3-sites': [
		makeSite( { id: 1, name: 'Personal Blog', url: 'https://myblog.com', planName: 'Business' } ),
		makeSite( {
			id: 2,
			name: 'Client Project',
			url: 'https://clientsite.com',
			planName: 'Business',
			isStaging: false,
		} ),
		makeSite( {
			id: 3,
			name: 'Client Project',
			url: 'https://staging.clientsite.com',
			isStaging: true,
			planName: 'Business',
			environmentType: 'staging',
		} ),
	],
	'all-syncable': [
		makeSite( {
			id: 1,
			name: 'Design Studio',
			url: 'https://designstudio.com',
			planName: 'Business',
		} ),
		makeSite( {
			id: 2,
			name: 'Photography',
			url: 'https://photos.example.com',
			planName: 'eCommerce',
		} ),
		makeSite( {
			id: 3,
			name: 'Travel Blog',
			url: 'https://wanderlust.blog',
			planName: 'Business',
		} ),
		makeSite( { id: 4, name: 'Online Store', url: 'https://myshop.com', planName: 'eCommerce' } ),
		makeSite( {
			id: 5,
			name: 'Staging Store',
			url: 'https://staging.myshop.com',
			isStaging: true,
			planName: 'eCommerce',
			environmentType: 'staging',
		} ),
		makeSite( { id: 6, name: 'Company Site', url: 'https://acme.co', planName: 'Business' } ),
	],
	mixed: [
		makeSite( { id: 1, name: 'Main Site', url: 'https://mainsite.com', planName: 'Business' } ),
		makeSite( {
			id: 2,
			name: 'Staging',
			url: 'https://staging.mainsite.com',
			isStaging: true,
			planName: 'Business',
			environmentType: 'staging',
		} ),
		makeSite( {
			id: 3,
			name: 'Side Project',
			url: 'https://sideproject.wordpress.com',
			syncSupport: 'needs-upgrade',
			planName: 'Free',
		} ),
		makeSite( {
			id: 4,
			name: 'Old Blog',
			url: 'https://oldblog.wordpress.com',
			syncSupport: 'needs-upgrade',
			planName: 'Premium',
		} ),
		makeSite( {
			id: 5,
			name: 'Agency Site',
			url: 'https://agency.pressable.com',
			syncSupport: 'needs-transfer',
			isPressable: true,
		} ),
		makeSite( {
			id: 6,
			name: 'Test Site',
			url: 'https://test.wordpress.com',
			syncSupport: 'already-connected',
			planName: 'Business',
		} ),
		makeSite( {
			id: 7,
			name: 'Archived',
			url: 'https://archived.wordpress.com',
			syncSupport: 'unsupported',
		} ),
	],
	'all-upgrade': [
		makeSite( {
			id: 1,
			name: 'Free Blog',
			url: 'https://freeblog.wordpress.com',
			syncSupport: 'needs-upgrade',
			planName: 'Free',
		} ),
		makeSite( {
			id: 2,
			name: 'Personal Site',
			url: 'https://personal.wordpress.com',
			syncSupport: 'needs-upgrade',
			planName: 'Personal',
		} ),
		makeSite( {
			id: 3,
			name: 'Premium Blog',
			url: 'https://premiumblog.wordpress.com',
			syncSupport: 'needs-upgrade',
			planName: 'Premium',
		} ),
	],
};

function DebugStateSwitcher( {
	current,
	onChange,
}: {
	current: DebugState;
	onChange: ( state: DebugState ) => void;
} ) {
	const states: DebugState[] = [
		'real',
		'not-auth',
		'loading',
		'no-sites',
		'empty-search',
		'1-site',
		'3-sites',
		'all-syncable',
		'mixed',
		'all-upgrade',
	];
	return (
		<div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[9999] bg-black/90 text-white rounded-lg p-3 flex flex-col gap-2 items-center">
			<div className="flex flex-wrap gap-1 justify-center">
				{ states.map( ( s ) => (
					<button
						key={ s }
						onClick={ () => onChange( s ) }
						className={ `px-2 py-1 rounded text-[11px] ${
							current === s ? 'bg-white text-black' : 'bg-white/10 hover:bg-white/20'
						}` }
					>
						{ s }
					</button>
				) ) }
			</div>
		</div>
	);
}

export function PullRemoteSite( {
	setSelectedRemoteSite,
	selectedRemoteSite,
}: {
	selectedRemoteSite?: SyncSite;
	setSelectedRemoteSite: ( site?: SyncSite ) => void;
} ) {
	const { __ } = useI18n();
	const { isAuthenticated, user } = useAuth();
	const [ debugState, setDebugState ] = useState< DebugState >( 'real' );

	const realSitesQuery = useSitesQuery( { userId: user?.id } );

	// Override query result based on debug state
	const mockDataState = ( sites: SyncSite[] ): SitesQueryResult => ( {
		...realSitesQuery,
		isLoading: false,
		isFetching: false,
		isSuccess: true,
		sites,
	} );

	let sitesQuery = realSitesQuery;
	if ( debugState === 'loading' ) {
		sitesQuery = {
			...realSitesQuery,
			isLoading: true,
			isFetching: true,
			isSuccess: false,
			sites: [],
		};
	} else if ( debugState === 'no-sites' ) {
		sitesQuery = mockDataState( [] );
	} else if ( debugState === 'empty-search' ) {
		sitesQuery = { ...mockDataState( [] ), searchQuery: 'nonexistent-site-xyz' };
	} else if ( debugState !== 'real' && debugState !== 'not-auth' && MOCK_SITES[ debugState ] ) {
		sitesQuery = mockDataState( MOCK_SITES[ debugState ] );
	}

	const effectiveAuth = debugState === 'not-auth' ? false : isAuthenticated;

	const handleSiteSelect = ( siteId: number ) => {
		const site = sitesQuery.sites.find( ( s ) => s.id === siteId );
		setSelectedRemoteSite( site );
	};

	return (
		<VStack className="w-full h-full" alignment="top" spacing={ effectiveAuth ? 3 : 1 }>
			<div className="text-center">
				<Heading className="text-[32px] text-frame-text" weight={ 500 }>
					{ __( 'Choose a site' ) }
				</Heading>
				<p className="text-sm text-frame-text-secondary mt-1">
					{ __( 'Select a WordPress.com or Pressable site to pull down and work on locally.' ) }
				</p>
			</div>
			{ effectiveAuth ? (
				<VStack className="flex flex-col w-full flex-1 min-h-0 text-frame-text">
					<SitesListContent
						sitesQuery={ sitesQuery }
						selectedSiteId={ selectedRemoteSite?.id || null }
						onSelectSite={ handleSiteSelect }
					/>
				</VStack>
			) : (
				<NoAuthPullRemoteSiteView />
			) }
			<DebugStateSwitcher current={ debugState } onChange={ setDebugState } />
		</VStack>
	);
}
