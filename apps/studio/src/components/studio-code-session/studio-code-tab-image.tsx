import { __ } from '@wordpress/i18n';
import styles from './studio-code-tab-image.module.css';

const getExampleRequests = () => [
	__( 'Add a contact form' ),
	__( 'Make the header sticky' ),
	__( 'Create a pricing page' ),
	__( 'Fix the mobile menu' ),
	__( 'Add a testimonials section' ),
];

export const StudioCodeTabImage = () => (
	<div className={ styles.stack }>
		{ getExampleRequests().map( ( request ) => (
			<div key={ request } className={ styles.message }>
				{ request }
			</div>
		) ) }
	</div>
);
