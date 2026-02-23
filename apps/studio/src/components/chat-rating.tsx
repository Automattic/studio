import { __ } from '@wordpress/i18n';
import { thumbsUp, thumbsDown, Icon } from '@wordpress/icons';
import { useState } from 'react';
import Button from 'src/components/button';
import { cx } from 'src/lib/cx';

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

	return (
		<div className={ cx( 'flex items-center gap-1', className ) }>
			{ ( selectedRating === null || selectedRating === 1 ) && (
				<Button
					variant="icon"
					className={ cx(
						selectedRating === 1
							? 'text-a8c-green-50'
							: 'text-a8c-gray-70 hover:!text-a8c-green-50'
					) }
					onClick={ () => handleClick( 1 ) }
					tooltipText={ __( 'Helpful' ) }
				>
					<Icon size={ 18 } icon={ thumbsUp } />
				</Button>
			) }
			{ ( selectedRating === null || selectedRating === 0 ) && (
				<Button
					variant="icon"
					className={ cx(
						selectedRating === 0
							? 'text-a8c-red-50'
							: 'text-a8c-gray-70 hover:!text-a8c-red-50'
					) }
					onClick={ () => handleClick( 0 ) }
					tooltipText={ __( 'Unhelpful' ) }
				>
					<Icon size={ 18 } icon={ thumbsDown } />
				</Button>
			) }
		</div>
	);
};
