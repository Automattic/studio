import { __ } from '@wordpress/i18n';
import { chevronLeft, plus } from '@wordpress/icons';
import { Icon, IconButton } from '@wordpress/ui';
import {
	usePublishToSpacefast,
	useSpacefastSpaces,
	useSpacefastTeams,
} from '@/data/queries/use-spacefast';
import styles from './publish-picker-view.module.css';
import { stripProtocol } from './utils';
import type { SiteDetails, SpacefastPublishTarget } from '@/data/core';

type Props = {
	site: SiteDetails;
	// Fires once a Space is picked or the back button is pressed, returning the
	// dropdown to its main view.
	onClose: () => void;
};

// Publishing to Spacefast exports the site as static files, so the Space only ever
// serves a snapshot: dynamic features (forms, comments, search) don't carry over.
export function SpacefastPickerView( { site, onClose }: Props ) {
	const spaces = useSpacefastSpaces( true );
	const teams = useSpacefastTeams( true );
	const publish = usePublishToSpacefast();

	const publishTo = ( target: SpacefastPublishTarget ) => {
		publish.mutate( { siteId: site.id, target } );
		onClose();
	};

	const team = teams.data?.[ 0 ];

	return (
		<div className={ styles.picker }>
			<div className={ styles.header }>
				<IconButton
					variant="minimal"
					tone="neutral"
					size="small"
					icon={ chevronLeft }
					label={ __( 'Back' ) }
					onClick={ onClose }
				/>
				<span className={ styles.title }>{ __( 'Publish a static copy to Spacefast' ) }</span>
			</div>
			<div className={ styles.body }>
				{ spaces.isLoading ? (
					<div className={ styles.status }>{ __( 'Loading Spaces…' ) }</div>
				) : spaces.data?.length ? (
					<ul className={ styles.list }>
						{ spaces.data.map( ( space ) => (
							<li key={ space.id }>
								<button
									type="button"
									className={ styles.item }
									onClick={ () => publishTo( { spaceId: space.id } ) }
								>
									<span className={ styles.itemName }>{ space.title }</span>
									<span className={ styles.itemUrl }>{ stripProtocol( space.liveUrl ) }</span>
								</button>
							</li>
						) ) }
					</ul>
				) : (
					<div className={ styles.status }>{ __( 'No Spaces yet.' ) }</div>
				) }
			</div>
			<button
				type="button"
				className={ styles.create }
				disabled={ ! team }
				onClick={ () => team && publishTo( { teamId: team.id, title: site.name } ) }
			>
				<Icon icon={ plus } size={ 16 } />
				<span>{ __( 'Create a new Space' ) }</span>
			</button>
		</div>
	);
}
