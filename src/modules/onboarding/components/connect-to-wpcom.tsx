import { __experimentalHeading as Heading } from '@wordpress/components';
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
			<div className="flex flex-col items-center gap-6 my-auto">
				<Heading className="text-[32px] text-gray-900 text-center px-10" weight={ 500 }>
					{ __( 'Connect to your WordPress.com account' ) }
				</Heading>

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
						{ __( 'Log in' ) }
						<ArrowIcon />
					</Button>
				</Tooltip>

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
					</span>
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
