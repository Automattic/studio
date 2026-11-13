import { __, sprintf } from '@wordpress/i18n';
import { useState, Fragment, type ReactNode } from 'react';
import { SearchIcon } from '@/lib/icons';
import {
	Button,
	InputGroup,
	InputGroupAddon,
	InputGroupInput,
	PreviewFrame,
	PreviewImage,
} from '@/lib/ui';
import styles from './style.module.css';

export function RemoteSiteCard( {
	name,
	url,
	badges,
	disabled,
	onSelect,
	children,
}: {
	name: string;
	url: string;
	badges?: ReactNode;
	disabled?: boolean;
	onSelect: () => void;
	children?: ReactNode;
} ) {
	return (
		<li className={ styles.site }>
			<Button
				variant="outline"
				layout="row"
				className={ styles.siteRow }
				disabled={ disabled }
				onClick={ onSelect }
			>
				<PreviewFrame className={ styles.siteThumb }>
					<PreviewImage
						src={ `https://s0.wp.com/mshots/v1/${ encodeURIComponent( url ) }?w=600&h=400` }
						alt=""
					/>
				</PreviewFrame>
				<span className={ styles.siteText }>
					<span className={ styles.siteName }>{ name }</span>
					<span className={ styles.siteUrl }>{ url.replace( /^https?:\/\//, '' ) }</span>
				</span>
				<span className={ styles.badges }>{ badges }</span>
			</Button>
			{ children }
		</li>
	);
}

export function RemoteSitePicker< Item >( {
	items,
	getKey,
	getSearchText,
	isAvailable,
	renderItem,
	refreshing,
	disabled,
	onRefresh,
	help,
	availableDescription,
}: {
	items: Item[];
	getKey: ( item: Item ) => string | number;
	getSearchText: ( item: Item ) => string;
	isAvailable: ( item: Item ) => boolean;
	renderItem: ( item: Item ) => ReactNode;
	refreshing: boolean;
	disabled?: boolean;
	onRefresh: () => void;
	help?: ReactNode;
	availableDescription: string;
} ) {
	const [ query, setQuery ] = useState( '' );
	const filtered = items.filter( ( item ) =>
		getSearchText( item ).toLowerCase().includes( query.trim().toLowerCase() )
	);
	const sections = [
		{
			key: 'available',
			title: __( 'Available to connect' ),
			description: availableDescription,
			items: filtered.filter( isAvailable ),
		},
		{
			key: 'unavailable',
			title: __( 'Unavailable' ),
			description: __( 'These sites cannot currently be connected to WordPress Studio.' ),
			items: filtered.filter( ( item ) => ! isAvailable( item ) ),
		},
	];
	return (
		<div className={ styles.sections }>
			<div className={ styles.siteControls }>
				{ ( items.length !== 1 || query.trim() ) && (
					<InputGroup className={ styles.search }>
						<InputGroupAddon>
							<SearchIcon />
						</InputGroupAddon>
						<InputGroupInput
							type="search"
							aria-label={ __( 'Search sites' ) }
							placeholder={ __( 'Search sites' ) }
							value={ query }
							onChange={ ( event ) => setQuery( event.target.value ) }
						/>
					</InputGroup>
				) }
				<div className={ styles.helperLinks }>
					<Button
						type="button"
						variant="ghost"
						size="2xs"
						disabled={ disabled || refreshing }
						onClick={ onRefresh }
					>
						{ refreshing ? __( 'Refreshing…' ) : __( 'Refresh list' ) }
					</Button>
					{ help && (
						<>
							<span aria-hidden="true">·</span>
							{ help }
						</>
					) }
				</div>
			</div>
			{ filtered.length === 0 ? (
				<div className={ styles.state } role="status">
					<p>
						{ sprintf(
							/* translators: %s is the site search query. */
							__( 'No sites match “%s”.' ),
							query
						) }
					</p>
				</div>
			) : (
				<div className={ styles.sections }>
					{ sections.map(
						( section ) =>
							section.items.length > 0 && (
								<section key={ section.key } className={ styles.section }>
									<div className={ styles.sectionHeader }>
										<h2>{ section.title }</h2>
										<p>{ section.description }</p>
									</div>
									<ul className={ styles.siteList }>
										{ section.items.map( ( item ) => (
											<Fragment key={ getKey( item ) }>{ renderItem( item ) }</Fragment>
										) ) }
									</ul>
								</section>
							)
					) }
				</div>
			) }
		</div>
	);
}
