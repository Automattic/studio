import { useI18n } from '@wordpress/react-i18n';
import { useEffect, useState } from 'react';
import ProgressBar from './progress-bar';

interface SiteIsBeingCreatedProps {
	siteName: string;
	statusMessage?: string;
}

export function SiteIsBeingCreated( { siteName, statusMessage }: SiteIsBeingCreatedProps ) {
	const { __ } = useI18n();
	const [ currentMessageIndex, setCurrentMessageIndex ] = useState( 0 );

	const statusMessages = [
		__( 'Setting up your new site…' ),
		__( 'Getting everything ready…' ),
		__( 'Almost there…' ),
		__( 'Working on your site…' ),
		__( 'Making progress…' ),
		__( 'Nearly finished' ),
	];

	useEffect( () => {
		const interval = setInterval( () => {
			setCurrentMessageIndex( ( prevIndex ) => {
				const nextIndex = prevIndex + 1;

				return nextIndex >= statusMessages.length ? prevIndex : nextIndex;
			} );
		}, 5000 );

		return () => clearInterval( interval );
	}, [ statusMessages.length ] );

	const displayMessage = statusMessage || statusMessages[ currentMessageIndex ];

	return (
		<div className="flex flex-col w-full h-full app-no-drag-region pt-8 overflow-y-auto justify-center items-center">
			<div className="w-[300px] text-center">
				<div className="text-frame-text a8c-subtitle-small mb-4">{ siteName }</div>
				<ProgressBar className="w-full" />
				<div className="text-a8c-gray-70 a8c-body mt-4">{ displayMessage }</div>
			</div>
		</div>
	);
}
