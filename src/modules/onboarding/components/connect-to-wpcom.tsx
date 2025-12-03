import { __experimentalHeading as Heading, Icon } from '@wordpress/components';
import { check } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import { ArrowIcon } from 'src/components/arrow-icon';
import Button from 'src/components/button';
import offlineIcon from 'src/components/offline-icon';
import { Tooltip } from 'src/components/tooltip';
import { useAuth } from 'src/hooks/use-auth';
import { useOffline } from 'src/hooks/use-offline';
import { getIpcApi } from 'src/lib/get-ipc-api';

export function OnboardingConnectToWpcom( { onSkip }: { onSkip: () => void } ) {
	const { __ } = useI18n();
	const isOffline = useOffline();
	const offlineMessage = __( "You're currently offline." );
	const { authenticate } = useAuth();

	return (
		<div className="h-full flex flex-col">
			<div className="flex flex-col gap-4 my-auto text-pretty">
				<Heading data-testid="onboarding-welcome-title" className="a8c-subtitle text-xl">
					{ __( 'Welcome to WordPress Studio' ) }
				</Heading>

				<div className="text-a8c-gray-70 a8c-body">
					{ __(
						'Start by connecting your WordPress.com account to unlock the full power of WordPress Studio.'
					) }
				</div>

				<div>
					{ [
						__( 'Share preview sites with clients and colleagues' ),
						__( 'Seamlessly sync with WordPress.com and Pressable' ),
						__( 'Get smart suggestions from the Studio Assistant' ),
					].map( ( text ) => (
						<div key={ text } className="text-a8c-gray-70 a8c-body flex items-center">
							<Icon className="fill-a8c-blue-50 me-2 shrink-0" icon={ check } />
							{ text }
						</div>
					) ) }
				</div>

				<Tooltip disabled={ ! isOffline } icon={ offlineIcon } text={ offlineMessage }>
					<Button
						aria-description={ isOffline ? offlineMessage : '' }
						aria-disabled={ isOffline }
						variant="primary"
						onClick={ () => {
							if ( isOffline ) {
								return;
							}
							authenticate();
						} }
					>
						{ __( 'Log in to WordPress.com' ) }
						<ArrowIcon />
					</Button>
				</Tooltip>

				<Tooltip
					disabled={ ! isOffline }
					icon={ offlineIcon }
					text={ offlineMessage }
					placement="bottom-start"
				>
					<div className="text-a8c-gray-70 a8c-body">
						{ __( 'New to WordPress.com?' ) }{ ' ' }
						<Button
							aria-description={ isOffline ? offlineMessage : '' }
							aria-disabled={ isOffline }
							className="!p-0 text-a8c-blue-50 hover:opacity-80 h-auto inline-flex items-center"
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
					</div>
				</Tooltip>
			</div>

			<div className="text-center">
				<Button onClick={ onSkip }>
					{ __( 'Skip' ) }
					{ ' →' }
				</Button>
			</div>
		</div>
	);
}
