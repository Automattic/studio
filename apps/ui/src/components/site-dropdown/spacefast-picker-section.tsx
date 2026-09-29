import { __ } from '@wordpress/i18n';
import { plus } from '@wordpress/icons';
import { Icon } from '@wordpress/ui';
import {
	usePublishToSpacefast,
	useSpacefastLogin,
	useSpacefastSignedIn,
	useSpacefastSpaces,
	useSpacefastTeams,
} from '@/data/queries/use-spacefast';
import styles from './publish-picker-view.module.css';
import { stripProtocol } from './utils';
import type { SiteDetails, SpacefastPublishTarget } from '@/data/core';

type Props = {
	site: SiteDetails;
	onClose: () => void;
};

// Publishing to Spacefast exports the site as static files, so the Space only ever
// serves a snapshot: dynamic features (forms, comments, search) don't carry over.
export function SpacefastPickerSection( { site, onClose }: Props ) {
	const { data: signedIn } = useSpacefastSignedIn();
	const login = useSpacefastLogin();
	const spaces = useSpacefastSpaces( !! signedIn );
	const teams = useSpacefastTeams( !! signedIn );
	const publish = usePublishToSpacefast();

	const publishTo = ( target: SpacefastPublishTarget ) => {
		publish.mutate( { siteId: site.id, target } );
		onClose();
	};

	const team = teams.data?.[ 0 ];

	return (
		<>
			<div className={ styles.sectionTitle }>{ __( 'Spacefast (static site)' ) }</div>
			{ ! signedIn ? (
				<button
					type="button"
					className={ styles.create }
					disabled={ login.isPending }
					onClick={ () => login.mutate() }
				>
					<span>
						{ login.isPending
							? __( 'Approve the sign-in in your browser…' )
							: __( 'Connect Spacefast' ) }
					</span>
				</button>
			) : (
				<>
					<div className={ styles.body }>
						{ spaces.isLoading ? (
							<div className={ styles.status }>{ __( 'Loading Spaces…' ) }</div>
						) : (
							<ul className={ styles.list }>
								{ spaces.data?.map( ( space ) => (
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
				</>
			) }
		</>
	);
}
