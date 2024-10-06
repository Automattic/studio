import * as Sentry from '@sentry/electron/renderer';
import { speak } from '@wordpress/a11y';
import { __ } from '@wordpress/i18n';
import { ExtraProps } from 'react-markdown';
import { useSiteDetails } from '../hooks/use-site-details';
import { cx } from '../lib/cx';
import { getIpcApi } from '../lib/get-ipc-api';

export default function Anchor( props: JSX.IntrinsicElements[ 'a' ] & ExtraProps ) {
	const { href } = props;
	const { node, className, ...filteredProps } = props;
	const { selectedSite, startServer, loadingServer } = useSiteDetails();

	return (
		<a
			{ ...filteredProps }
			className={ cx(
				className,
				selectedSite && loadingServer[ selectedSite.id ] && 'animate-pulse duration-100 cursor-wait'
			) }
			onClick={ async ( e ) => {
				if ( ! href ) {
					return;
				}

				e.preventDefault();

				const urlForStoppedSite =
					/^https?:\/\/localhost/.test( href ) && selectedSite && ! selectedSite.running;
				if ( urlForStoppedSite ) {
					speak( __( 'Starting the server before opening the site link' ) );
					await startServer( selectedSite?.id );
				}

				try {
					await getIpcApi().openURL( href );
				} catch ( error ) {
					getIpcApi().showErrorMessageBox( {
						title: __( 'Failed to open link' ),
						message: __( 'We were unable to open the link. Please try again.' ),
						error,
					} );
					Sentry.captureException( error );
				}
			} }
		/>
	);
}
