import { SITE_EVENTS } from '@studio/common/lib/cli-events';
import { QueryClientContext } from '@tanstack/react-query';
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
import {
	closePreviewTabs,
	addPreviewTabToSplit,
	selectPreviewTab,
	separatePreviewTabs,
	splitPreviewTabGroups,
	type PreviewTab,
	type PreviewTabWorkspace,
} from '@/data/preview-tab-state';
import { removeResponsivePreview } from '@/data/responsive-preview';
import { isSiteRestarting } from '@/data/site-restarts';

export type { PreviewTab, PreviewTabWorkspace } from './preview-tab-state';
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
	const queryClient = useContext( QueryClientContext );
	const [ workspaces, setWorkspaces ] = useState< Workspaces >( {} );
	useEffect(
		() =>
			connector.onSiteEvent( ( event ) => {
				if ( event.event === SITE_EVENTS.DELETED ) {
					removeResponsivePreview( event.siteId );
					setWorkspaces( ( current ) =>
						Object.fromEntries(
							Object.entries( current ).filter(
								( [ key ] ) => ! key.startsWith( `${ event.siteId }:` )
							)
						)
					);
				} else if (
					event.event === SITE_EVENTS.UPDATED &&
					! event.running &&
					! isSiteRestarting( queryClient, event.siteId )
				) {
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
		[ connector, queryClient ]
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
export function usePreviewTabs(
	key: string,
	initialPath = '/',
	siteId = key.slice( 0, key.indexOf( ':' ) )
) {
	const context = useContext( Context );
	if ( ! context ) throw new Error( 'PreviewTabsProvider is required' );
	const initial = useMemo< PreviewTabWorkspace >(
		() => ( {
			tabs: [ { id: `${ key }:initial`, path: initialPath, title: null } ],
			selectedId: `${ key }:initial`,
			focusRequest: 0,
			splits: [],
			recentIds: [ `${ key }:initial` ],
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
	const add = useCallback(
		(
			path: string | null = null,
			{ background = false, splitBeside }: { background?: boolean; splitBeside?: string } = {}
		) => {
			const id = crypto.randomUUID();
			update( ( current ) => {
				const next = { ...current, tabs: [ ...current.tabs, { id, path, title: null } ] };
				if ( splitBeside !== undefined ) {
					const split = addPreviewTabToSplit( next, id, splitBeside );
					return split === next ? current : split;
				}
				return background
					? next
					: { ...selectPreviewTab( next, id ), focusRequest: next.focusRequest + 1 };
			} );
		},
		[ update ]
	);
	const select = useCallback(
		( id: string ) => update( ( current ) => selectPreviewTab( current, id ) ),
		[ update ]
	);
	const closeMany = ( ids: readonly string[], { focus = false } = {} ) => {
		const replacementId = crypto.randomUUID();
		ids.forEach( ( id ) => removeResponsivePreview( siteId, id ) );
		update( ( current ) => {
			const next = closePreviewTabs( current, ids, replacementId );
			return focus && next !== current ? { ...next, focusRequest: next.focusRequest + 1 } : next;
		} );
	};
	const addToSplit = ( id: string, position: 'start' | 'end' = 'end' ) =>
		update( ( current ) => addPreviewTabToSplit( current, id, undefined, position ) );
	const splitGroups = ( ids: readonly string[] ) =>
		update( ( current ) => splitPreviewTabGroups( current, ids ) );
	const separate = ( id: string ) => update( ( current ) => separatePreviewTabs( current, id ) );
	return {
		workspace,
		selected: workspace.tabs.find( ( tab ) => tab.id === workspace.selectedId )!,
		patch,
		add,
		select,
		closeMany,
		addToSplit,
		splitGroups,
		separate,
		update,
	};
}
