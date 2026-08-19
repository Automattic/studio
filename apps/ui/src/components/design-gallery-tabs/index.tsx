import { __, sprintf } from '@wordpress/i18n';
import { chevronDown, grid, layout } from '@wordpress/icons';
import { privateApis } from '@wordpress/theme';
import { Icon } from '@wordpress/ui';
import { clsx } from 'clsx';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import * as Tabs from '@/components/tabs';
import { unlock } from '@/lock-unlock';
import styles from './style.module.css';
import type { DesignDirectionGroup } from '@/components/design-gallery/group-artifacts';

const { ThemeProvider } = unlock( privateApis );

interface DesignGalleryTabsProps {
	groups: DesignDirectionGroup[];
	selectedGroupId: string;
	activeArtifactId?: string;
	onSelectVersion: ( artifactId: string ) => void;
}

interface IndicatorPosition {
	left: number;
	width: number;
}

interface MenuPosition {
	top: number;
	left: number;
}

export function DesignGalleryTabs( {
	groups,
	selectedGroupId,
	activeArtifactId,
	onSelectVersion,
}: DesignGalleryTabsProps ) {
	const listRef = useRef< HTMLDivElement | null >( null );
	const activeTabRef = useRef< HTMLButtonElement | null >( null );
	const menuRef = useRef< HTMLDivElement | null >( null );
	const [ indicator, setIndicator ] = useState< IndicatorPosition | null >( null );
	const [ menuPosition, setMenuPosition ] = useState< MenuPosition | null >( null );
	const activeGroup = groups.find( ( group ) => group.id === selectedGroupId );
	const measureIndicator = useCallback( () => {
		const active = listRef.current?.querySelector< HTMLElement >( '[aria-selected="true"]' );
		if ( ! active ) return;
		const next = { left: active.offsetLeft, width: active.offsetWidth };
		setIndicator( ( current ) =>
			current?.left === next.left && current.width === next.width ? current : next
		);
	}, [] );

	useLayoutEffect( measureIndicator, [ measureIndicator, selectedGroupId, groups ] );
	useLayoutEffect( () => {
		const list = listRef.current;
		if ( ! list || typeof ResizeObserver === 'undefined' ) return;
		const observer = new ResizeObserver( measureIndicator );
		observer.observe( list );
		return () => observer.disconnect();
	}, [ measureIndicator ] );

	useEffect( () => {
		if ( ! menuPosition ) return;
		const closeOnOutsidePointer = ( event: PointerEvent ) => {
			const target = event.target as Node;
			if ( menuRef.current?.contains( target ) || activeTabRef.current?.contains( target ) ) return;
			setMenuPosition( null );
		};
		const closeOnEscape = ( event: KeyboardEvent ) => {
			if ( event.key !== 'Escape' ) return;
			setMenuPosition( null );
			activeTabRef.current?.focus();
		};
		document.addEventListener( 'pointerdown', closeOnOutsidePointer );
		document.addEventListener( 'keydown', closeOnEscape );
		menuRef.current?.querySelector< HTMLButtonElement >( '[aria-checked="true"]' )?.focus();
		return () => {
			document.removeEventListener( 'pointerdown', closeOnOutsidePointer );
			document.removeEventListener( 'keydown', closeOnEscape );
		};
	}, [ menuPosition ] );

	return (
		<>
			<Tabs.List ref={ listRef } className={ styles.list }>
				<span
					className={ clsx( styles.indicator, indicator && styles.indicatorReady ) }
					aria-hidden="true"
					style={
						indicator
							? { transform: `translateX(${ indicator.left }px)`, width: indicator.width }
							: { opacity: 0 }
					}
				/>
				<Tabs.Tab tabId="all" aria-label={ __( 'All options' ) }>
					<span className={ styles.tabIcon } aria-hidden="true">
						<Icon icon={ grid } size={ 16 } />
					</span>
					<span className={ styles.tabTitle }>{ __( 'All options' ) }</span>
				</Tabs.Tab>
				{ groups.map( ( group ) => {
					const hasVersions = group.artifacts.length > 1;
					const isActive = group.id === selectedGroupId;
					return (
						<Tabs.Tab
							key={ group.id }
							ref={ isActive ? activeTabRef : undefined }
							tabId={ group.id }
							aria-label={ group.label }
							aria-haspopup={ isActive && hasVersions ? 'menu' : undefined }
							aria-expanded={ isActive && hasVersions ? !! menuPosition : undefined }
							onClick={
								isActive && hasVersions
									? ( event ) => {
											if ( menuPosition ) {
												setMenuPosition( null );
												return;
											}
											const rect = event.currentTarget.getBoundingClientRect();
											setMenuPosition( { top: rect.bottom + 4, left: rect.left + rect.width / 2 } );
									  }
									: undefined
							}
						>
							<span className={ styles.tabIcon } aria-hidden="true">
								<Icon icon={ layout } size={ 16 } />
							</span>
							<span className={ styles.tabTitle }>{ group.label }</span>
							{ isActive && hasVersions ? (
								<span className={ styles.versionChevron } aria-hidden="true">
									<Icon icon={ chevronDown } size={ 12 } />
								</span>
							) : null }
						</Tabs.Tab>
					);
				} ) }
			</Tabs.List>
			{ menuPosition && activeGroup && typeof document !== 'undefined'
				? createPortal(
						<ThemeProvider density="compact">
							<div
								ref={ menuRef }
								className={ styles.versionMenu }
								role="menu"
								aria-label={ __( 'Versions' ) }
								style={ menuPosition }
							>
								<span className={ styles.versionMenuLabel }>{ __( 'Versions' ) }</span>
								{ activeGroup.artifacts.map( ( artifact, index ) => (
									<button
										key={ artifact.id }
										type="button"
										role="menuitemradio"
										aria-checked={ artifact.id === activeArtifactId }
										className={ styles.versionMenuItem }
										onClick={ () => {
											onSelectVersion( artifact.id );
											setMenuPosition( null );
										} }
									>
										<span className={ styles.versionCheck } aria-hidden="true">
											{ artifact.id === activeArtifactId ? '✓' : '' }
										</span>
										{ sprintf(
											// translators: %d is the version number of a design direction.
											__( 'Version %d' ),
											index + 1
										) }
									</button>
								) ) }
							</div>
						</ThemeProvider>,
						document.body
				  )
				: null }
		</>
	);
}
