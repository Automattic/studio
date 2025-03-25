import { Guide } from '@wordpress/components';
import { useState } from 'react';

export function WhatsNewModal() {
	const [ isOpen, setIsOpen ] = useState( true );

	if ( ! isOpen ) {
		return null;
	}

	return (
		<Guide
			onFinish={ () => setIsOpen( false ) }
			contentLabel="What's New in Studio"
			pages={ [
				{
					content: (
						<div>
							<h2>Welcome to the latest version of Studio!</h2>
							<p>Let's take a quick tour of what's new.</p>
						</div>
					),
				},
				{
					content: (
						<div>
							<h2>New Feature 1</h2>
							<p>Description of the first new feature...</p>
						</div>
					),
				},
				{
					content: (
						<div>
							<h2>New Feature 2</h2>
							<p>Description of the second new feature...</p>
						</div>
					),
				},
			] }
		/>
	);
}
