import { useI18n } from '@wordpress/react-i18n';
import { useEffect, useState } from 'react';
import Button from 'src/components/button';
import { useAuth } from 'src/hooks/use-auth';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { NonAuthenticatedAccountTab } from './non-authenticated-account-tab';
import { PromptInfo } from './prompt-info';
import { SnapshotInfo } from './snapshot-info';
import { UserInfo } from './user-info';
import { WapuuScore } from './wapuu-score';
import type { ReactNode } from 'react';

function AccountSection( {
	children,
	description,
	title,
}: {
	children: ReactNode;
	description: string;
	title: string;
} ) {
	return (
		<section className="flex flex-col gap-4">
			<div>
				<h2 className="a8c-subtitle-small">{ title }</h2>
				<p className="mt-1 text-sm text-frame-text-secondary">{ description }</p>
			</div>
			<div className="flex flex-col gap-4">{ children }</div>
		</section>
	);
}

function WordPressOrgAccountInfo() {
	const { __ } = useI18n();
	const [ account, setAccount ] = useState<
		NonNullable< Awaited< ReturnType< IpcApi[ 'getWordPressOrgAccount' ] > > > | undefined
	>();
	const [ isLoading, setIsLoading ] = useState( true );
	const [ isLoggingIn, setIsLoggingIn ] = useState( false );
	const [ isLoggingOut, setIsLoggingOut ] = useState( false );
	const [ error, setError ] = useState< string | undefined >();

	const getWordPressOrgErrorMessage = ( unknownError: unknown, fallback: string ) => {
		const message = unknownError instanceof Error ? unknownError.message : String( unknownError );

		if ( message.includes( 'WordPress.org login was closed before it completed.' ) ) {
			return __( 'WordPress.org login was closed before it completed.' );
		}

		if ( message.includes( 'Timed out waiting for WordPress.org login.' ) ) {
			return __( 'Timed out waiting for WordPress.org login.' );
		}

		return fallback;
	};

	useEffect( () => {
		let isMounted = true;

		void getIpcApi()
			.getWordPressOrgAccount()
			.then( ( savedAccount ) => {
				if ( isMounted ) {
					setAccount( savedAccount );
				}
			} )
			.catch( () => {
				if ( isMounted ) {
					setAccount( undefined );
				}
			} )
			.finally( () => {
				if ( isMounted ) {
					setIsLoading( false );
				}
			} );

		return () => {
			isMounted = false;
		};
	}, [] );

	const onLogin = async () => {
		setError( undefined );
		setIsLoggingIn( true );
		try {
			setAccount( await getIpcApi().loginToWordPressOrg() );
		} catch ( loginError ) {
			setError(
				getWordPressOrgErrorMessage( loginError, __( 'WordPress.org login did not complete.' ) )
			);
		} finally {
			setIsLoggingIn( false );
			setIsLoading( false );
		}
	};

	const onLogout = async () => {
		setError( undefined );
		setIsLoggingOut( true );
		try {
			await getIpcApi().logoutFromWordPressOrg();
			setAccount( undefined );
		} catch ( logoutError ) {
			setError(
				getWordPressOrgErrorMessage( logoutError, __( 'WordPress.org logout did not complete.' ) )
			);
		} finally {
			setIsLoggingOut( false );
		}
	};

	const actionLabel = account ? __( 'Log out' ) : __( 'Log in' );

	return (
		<div className="flex w-full items-start justify-between gap-5 py-1">
			<div className="flex min-w-0 flex-col gap-1">
				<span className="text-sm font-medium text-frame-text">
					{ isLoading && __( 'Checking connection' ) }
					{ ! isLoading && isLoggingIn && __( 'Waiting for WordPress.org login' ) }
					{ ! isLoading && ! isLoggingIn && account && (
						<>
							{ __( 'Connected as' ) } <span>{ account.username }</span>
						</>
					) }
					{ ! isLoading && ! isLoggingIn && ! account && __( 'Not connected' ) }
				</span>
				<span className="text-sm text-frame-text-secondary">
					{ __(
						'WordPress.org uses a separate account for plugin and theme submissions, review state, and SVN releases.'
					) }
				</span>
				{ isLoggingIn && (
					<span className="text-sm text-frame-text-secondary">
						{ __(
							'Complete the WordPress.org login window. If the pineapple checkbox appears, check it before pressing Log In.'
						) }
					</span>
				) }
				{ error && <span className="text-sm text-frame-error">{ error }</span> }
			</div>
			<Button
				variant="secondary"
				className="shrink-0 !gap-3"
				disabled={ isLoading || isLoggingIn || isLoggingOut }
				onClick={ account ? onLogout : onLogin }
			>
				{ isLoggingIn ? __( 'Waiting...' ) : actionLabel }
			</Button>
		</div>
	);
}

export const AccountTab = ( {
	loadingDeletingAllSnapshots,
	activeSnapshotCount,
	isLoadingSnapshotUsage,
	isOffline,
	snapshotQuota,
	onRemoveSnapshots,
	showWordPressOrgAccount = false,
}: {
	loadingDeletingAllSnapshots: boolean;
	activeSnapshotCount: number;
	isLoadingSnapshotUsage: boolean;
	isOffline: boolean;
	snapshotQuota: number;
	onRemoveSnapshots: () => void;
	showWordPressOrgAccount?: boolean;
} ) => {
	const { __ } = useI18n();
	const { isAuthenticated, user, logout } = useAuth();

	const wordpressComAccount = (
		<>
			{ isAuthenticated ? (
				<>
					<UserInfo onLogout={ logout } user={ user } />
					<SnapshotInfo
						isDeleting={ loadingDeletingAllSnapshots || isLoadingSnapshotUsage }
						isDisabled={
							activeSnapshotCount === 0 ||
							isOffline ||
							loadingDeletingAllSnapshots ||
							isLoadingSnapshotUsage
						}
						siteCount={ activeSnapshotCount }
						siteLimit={ snapshotQuota }
						onRemoveSnapshots={ onRemoveSnapshots }
					/>
					<PromptInfo />
					<WapuuScore />
				</>
			) : (
				<NonAuthenticatedAccountTab />
			) }
		</>
	);

	if ( ! showWordPressOrgAccount ) {
		return wordpressComAccount;
	}

	return (
		<div className="flex flex-col gap-7">
			<AccountSection
				title={ __( 'WordPress.com' ) }
				description={ __( 'Used for Studio sync, preview sites, and Studio Code.' ) }
			>
				{ wordpressComAccount }
			</AccountSection>
			<AccountSection
				title={ __( 'WordPress.org' ) }
				description={ __( 'Used separately for plugin and theme publishing workflows.' ) }
			>
				<WordPressOrgAccountInfo />
			</AccountSection>
		</div>
	);
};
