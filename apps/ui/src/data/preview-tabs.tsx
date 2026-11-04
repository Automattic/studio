import { SITE_EVENTS } from '@studio/common/lib/cli-events';
import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
	type ReactNode,
} from 'react';
import { useConnector } from '@/data/core';

export interface PreviewTab {
	id: string;
	path: string | null;
	title: string | null;
}
export interface PreviewTabWorkspace {
	tabs: PreviewTab[];
	selectedId: string;
	chatSelected: boolean;
	focusRequest: number;
}
type Workspaces = Record< string, PreviewTabWorkspace >;
const Context = createContext< {
	workspaces: Workspaces;
	update: (
		key: string,
		initial: PreviewTabWorkspace,
		change: ( workspace: PreviewTabWorkspace ) => PreviewTabWorkspace
	) => void;
} | null >( null );
export const previewTabsKey = ( siteId: string, liveUrl?: string ) =>
	`${ siteId }:${ liveUrl ?? 'local' }`;
export function PreviewTabsProvider( { children }: { children: ReactNode } ) {
	const connector = useConnector();
	const [ workspaces, setWorkspaces ] = useState< Workspaces >( {} );
	useEffect(
		() =>
			connector.onSiteEvent( ( event ) => {
				if ( event.event === SITE_EVENTS.DELETED ) {
					setWorkspaces( ( current ) =>
						Object.fromEntries(
							Object.entries( current ).filter(
								( [ key ] ) => ! key.startsWith( `${ event.siteId }:` )
							)
						)
					);
				} else if ( event.event === SITE_EVENTS.UPDATED && ! event.running ) {
					setWorkspaces( ( current ) => {
						const key = previewTabsKey( event.siteId );
						const workspace = current[ key ];
						if ( ! workspace ) return current;
						return {
							...current,
							[ key ]: {
								...workspace,
								tabs: workspace.tabs.map( ( tab ) =>
									tab.id === workspace.selectedId ? { ...tab, path: '/', title: null } : tab
								),
							},
						};
					} );
				}
			} ),
		[ connector ]
	);
	const update = useCallback(
		(
			key: string,
			initial: PreviewTabWorkspace,
			change: ( workspace: PreviewTabWorkspace ) => PreviewTabWorkspace
		) => {
			setWorkspaces( ( current ) => {
				const before = current[ key ] ?? initial;
				const after = change( before );
				return current[ key ] === after ? current : { ...current, [ key ]: after };
			} );
		},
		[]
	);
	const value = useMemo( () => ( { workspaces, update } ), [ workspaces, update ] );
	return <Context.Provider value={ value }>{ children }</Context.Provider>;
}
export function usePreviewTabs( key: string, initialPath = '/' ) {
	const context = useContext( Context );
	if ( ! context ) throw new Error( 'PreviewTabsProvider is required' );
	const initial = useMemo< PreviewTabWorkspace >(
		() => ( {
			tabs: [ { id: `${ key }:initial`, path: initialPath, title: null } ],
			selectedId: `${ key }:initial`,
			chatSelected: false,
			focusRequest: 0,
		} ),
		[ key, initialPath ]
	);
	const workspace = context.workspaces[ key ] ?? initial;
	const updateWorkspace = context.update;
	const update = useCallback(
		( change: ( workspace: PreviewTabWorkspace ) => PreviewTabWorkspace ) =>
			updateWorkspace( key, initial, change ),
		[ updateWorkspace, key, initial ]
	);
	const patch = useCallback(
		( id: string, patch: Partial< Pick< PreviewTab, 'path' | 'title' > > ) =>
			update( ( current ) => {
				const tab = current.tabs.find( ( tab ) => tab.id === id );
				if (
					! tab ||
					Object.entries( patch ).every(
						( [ field, value ] ) => tab[ field as keyof PreviewTab ] === value
					)
				)
					return current;
				return {
					...current,
					tabs: current.tabs.map( ( tab ) => ( tab.id === id ? { ...tab, ...patch } : tab ) ),
				};
			} ),
		[ update ]
	);
	const add = ( path: string | null = null ) => {
		const id = crypto.randomUUID();
		update( ( current ) => ( {
			...current,
			tabs: [ ...current.tabs, { id, path, title: null } ],
			selectedId: id,
			chatSelected: false,
			focusRequest: current.focusRequest + 1,
		} ) );
	};
	const select = ( id: string ) =>
		update( ( current ) =>
			( current.selectedId === id && ! current.chatSelected ) ||
			! current.tabs.some( ( tab ) => tab.id === id )
				? current
				: { ...current, selectedId: id, chatSelected: false }
		);
	const setChatSelected = useCallback(
		( chatSelected: boolean ) =>
			update( ( current ) =>
				current.chatSelected === chatSelected ? current : { ...current, chatSelected }
			),
		[ update ]
	);
	const closeMany = ( ids: readonly string[] ) => {
		const replacementId = crypto.randomUUID();
		update( ( current ) => {
			const index = current.tabs.findIndex( ( tab ) => tab.id === current.selectedId );
			const tabs = current.tabs.filter( ( tab ) => ! ids.includes( tab.id ) );
			if ( tabs.length === current.tabs.length ) return current;
			if ( ! tabs.length ) {
				return {
					...current,
					tabs: [ { id: replacementId, path: null, title: null } ],
					selectedId: replacementId,
				};
			}
			return {
				...current,
				tabs,
				selectedId: ids.includes( current.selectedId )
					? (
							current.tabs.slice( index + 1 ).find( ( tab ) => ! ids.includes( tab.id ) ) ??
							tabs.at( -1 )!
					  ).id
					: current.selectedId,
			};
		} );
	};
	return {
		workspace,
		selected: workspace.tabs.find( ( tab ) => tab.id === workspace.selectedId )!,
		patch,
		add,
		select,
		setChatSelected,
		closeMany,
		update,
	};
}
