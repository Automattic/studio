import { ProgressBar } from '@wordpress/components';
import { useI18n } from '@wordpress/react-i18n';
import { useEffect, useState } from 'react';

export function SiteIsBeingCreated( { siteName }: { siteName: string } ) {
	const { __ } = useI18n();
	const [ currentMessageIndex, setCurrentMessageIndex ] = useState( 0 );

	const statusMessages = [
		__( 'Creating your site…' ),
		__( 'Preparing your workspace…' ),
		__( 'Setting up your environment…' ),
		__( 'Configuring your site…' ),
		__( 'Installing site components…' ),
		__( 'Optimizing your setup…' ),
		__( 'Customizing your workspace…' ),
		__( 'Enhancing your site…' ),
		__( 'Polishing your environment…' ),
		__( 'Finalizing your site…' ),
	];

	useEffect( () => {
		const interval = setInterval( () => {
			setCurrentMessageIndex( ( prevIndex ) => {
				const nextIndex = prevIndex + 1;

				return nextIndex >= statusMessages.length ? prevIndex : nextIndex;
			} );
		}, 3000 );

		return () => clearInterval( interval );
	}, [ statusMessages.length ] );

	return (
		<div className="flex flex-col w-full h-full app-no-drag-region pt-8 overflow-y-auto justify-center items-center">
			<div className="w-[300px] text-center">
				<div className="text-black a8c-subtitle-small mb-4">{ siteName }</div>
				<ProgressBar className="w-full" />
				<div className="text-a8c-gray-70 a8c-body mt-4">
					{ statusMessages[ currentMessageIndex ] }
				</div>
			</div>
		</div>
	);
}
