import { __experimentalHeading as Heading, CheckboxControl, Icon } from '@wordpress/components';
import { createInterpolateElement } from '@wordpress/element';
import { check } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import { ArrowIcon } from 'src/components/arrow-icon';
import Button from 'src/components/button';
import offlineIcon from 'src/components/offline-icon';
import { Tooltip } from 'src/components/tooltip';
import { useAuth } from 'src/hooks/use-auth';
import { useOffline } from 'src/hooks/use-offline';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { getLocalizedLink } from 'src/lib/get-localized-link';
import { useI18nLocale } from 'src/stores';

export function OnboardingConnectToWpcom( {
	onSkip,
	analyticsEnabled,
	onAnalyticsEnabledChange,
}: {
	onSkip: () => void;
	analyticsEnabled: boolean;
	onAnalyticsEnabledChange: ( value: boolean ) => void;
} ) {
	const { __ } = useI18n();
	const isOffline = useOffline();
	const offlineMessage = __( "You're currently offline." );
	const { authenticate } = useAuth();
	const locale = useI18nLocale();

	return (
		<div className="h-full min-h-0 flex flex-col">
			<div className="flex flex-col gap-4 flex-1 justify-center text-pretty min-h-0">
				<Heading data-testid="onboarding-welcome-title" className="a8c-subtitle text-xl">
					{ __( 'Welcome to WordPress Studio' ) }
				</Heading>

				<div className="text-frame-text-secondary a8c-body">
					{ __(
						'Start by connecting your WordPress.com account to unlock the full power of WordPress Studio.'
					) }
				</div>

				<div>
					{ [
						__( 'Share preview sites with clients and colleagues' ),
						__( 'Seamlessly sync with WordPress.com and Pressable' ),
						__( 'Get smart suggestions from Studio Code' ),
					].map( ( text ) => (
						<div key={ text } className="text-frame-text-secondary a8c-body flex items-start">
							<Icon className="fill-frame-theme me-2 mt-0.5 shrink-0" icon={ check } />
							{ text }
						</div>
					) ) }
				</div>

				<div data-testid="onboarding-legal" className="text-frame-text-secondary text-xs leading-4">
					{ createInterpolateElement(
						__(
							'By continuing, you agree to our <tos_link>Terms of Service</tos_link> and have read our <privacy_link>Privacy Policy</privacy_link>.'
						),
						{
							tos_link: (
								<Button
									className="learn-more-link !p-0 h-auto !text-xs"
									variant="link"
									onClick={ () => getIpcApi().openURL( getLocalizedLink( locale, 'a8cTos' ) ) }
								/>
							),
							privacy_link: (
								<Button
									className="learn-more-link !p-0 h-auto !text-xs"
									variant="link"
									onClick={ () =>
										getIpcApi().openURL( getLocalizedLink( locale, 'a8cPrivacyPolicy' ) )
									}
								/>
							),
						}
					) }
				</div>

				<div className="flex flex-row gap-2 items-center">
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
					<Button variant="secondary" onClick={ onSkip }>
						{ __( 'Skip' ) }
						<span aria-hidden className="ml-1">
							{ '\u2192' }
						</span>
					</Button>
				</div>

				<Tooltip
					disabled={ ! isOffline }
					icon={ offlineIcon }
					text={ offlineMessage }
					placement="bottom-start"
				>
					<div className="text-frame-text-secondary a8c-body">
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
					</div>
				</Tooltip>
			</div>

			<div className="shrink-0 -mx-6">
				<CheckboxControl
					__nextHasNoMarginBottom
					id="onboarding-analytics-toggle"
					className="onboarding-analytics-checkbox"
					label={ __( 'Help improve Studio by sharing anonymous usage statistics' ) }
					checked={ analyticsEnabled }
					onChange={ onAnalyticsEnabledChange }
				/>
			</div>
		</div>
	);
}
