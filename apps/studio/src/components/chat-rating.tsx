import { __ } from '@wordpress/i18n';
import { Icon, thumbsUp, thumbsDown } from '@wordpress/icons';
import { SVG, Path } from '@wordpress/primitives';
import { useState } from 'react';
import Button from 'src/components/button';
import { cx } from 'src/lib/cx';

const thumbsUpFilled = (
	<SVG xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
		<Path d="m3 12 1 8h1.5l-1-8H3Zm15.8-2h-4.4l.8-3.6c.3-1.3-.7-2.4-1.9-2.4h-.2c-.6 0-1.2.3-1.6.8l-5 6.6c-.3.4-.4.8-.4 1.2v.2l.7 5.4v.2c.2.9 1 1.5 1.9 1.5h8.2c.9 0 1.7-.6 1.9-1.4l1.8-6c.4-1.3-.6-2.6-1.9-2.6Z" />
	</SVG>
);

const thumbsDownFilled = (
	<SVG xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
		<Path d="M19.8 4h-1.5l1 8h1.5l-1-8ZM17 5.8c-.1-1-1-1.8-2-1.8H6.8c-.9 0-1.7.6-1.9 1.4l-1.8 6C2.7 12.7 3.7 14 5 14h4.4l-.8 3.6c-.3 1.3.7 2.4 1.9 2.4h.2c.6 0 1.2-.3 1.6-.8l5-6.6c.3-.4.5-.9.4-1.5L17 5.7Z" />
	</SVG>
);

interface ChatRatingProps {
	onRate?: ( ratingValue: number ) => void;
	className?: string;
}

export const ChatRating = ( { onRate, className }: ChatRatingProps ) => {
	const [ selectedRating, setSelectedRating ] = useState< number | null >( null );

	const handleClick = ( value: number ) => {
		if ( selectedRating === value ) {
			setSelectedRating( null );
		} else {
			setSelectedRating( value );
			onRate?.( value );
		}
	};

	const isVisible = ( value: number ) => selectedRating === null || selectedRating === value;

	return (
		<div className={ cx( 'flex items-center gap-1', className ) }>
			<div
				className="flex overflow-hidden transition-all duration-200 ease-in-out"
				style={ { maxWidth: isVisible( 1 ) ? 36 : 0, opacity: isVisible( 1 ) ? 1 : 0 } }
			>
				<Button
					variant="icon"
					className={ cx(
						'transition-colors duration-200',
						selectedRating === 1
							? 'text-a8c-green-50'
							: 'text-a8c-gray-70 hover:!text-a8c-green-50'
					) }
					onClick={ () => handleClick( 1 ) }
					tooltipText={ __( 'Helpful' ) }
				>
					<Icon size={ 18 } icon={ selectedRating === 1 ? thumbsUpFilled : thumbsUp } />
				</Button>
			</div>
			<div
				className="flex overflow-hidden transition-all duration-200 ease-in-out"
				style={ { maxWidth: isVisible( 0 ) ? 36 : 0, opacity: isVisible( 0 ) ? 1 : 0 } }
			>
				<Button
					variant="icon"
					className={ cx(
						'transition-colors duration-200',
						selectedRating === 0
							? 'text-a8c-red-50'
							: 'text-a8c-gray-70 hover:!text-a8c-red-50'
					) }
					onClick={ () => handleClick( 0 ) }
					tooltipText={ __( 'Unhelpful' ) }
				>
					<Icon size={ 18 } icon={ selectedRating === 0 ? thumbsDownFilled : thumbsDown } />
				</Button>
			</div>
		</div>
	);
};
