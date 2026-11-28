export interface PreviewTab {
	thumbnail?: { path: string; image: string };
	id: string;
	path: string | null;
	title: string | null;
}

export interface PreviewTabSplit {
	tabIds: string[];
	weights: number[];
}

export interface PreviewTabWorkspace {
	tabs: PreviewTab[];
	selectedId: string;
	focusRequest: number;
	splits: PreviewTabSplit[];
	recentIds: string[];
}

export function getPreviewTabSplit( workspace: PreviewTabWorkspace, id = workspace.selectedId ) {
	return workspace.splits.find( ( pair ) => pair.tabIds.includes( id ) );
}

export function getPreviewTabGroups( workspace: PreviewTabWorkspace ): PreviewTab[][] {
	const visited = new Set< string >();
	const tabsById = new Map( workspace.tabs.map( ( tab ) => [ tab.id, tab ] ) );
	return workspace.tabs.flatMap( ( tab ) => {
		if ( visited.has( tab.id ) ) return [];
		const ids = getPreviewTabSplit( workspace, tab.id )?.tabIds ?? [ tab.id ];
		ids.forEach( ( id ) => visited.add( id ) );
		return [ ids.map( ( id ) => tabsById.get( id )! ) ];
	} );
}

export function selectPreviewTab( workspace: PreviewTabWorkspace, id: string ) {
	if ( workspace.selectedId === id || ! workspace.tabs.some( ( tab ) => tab.id === id ) )
		return workspace;
	return {
		...workspace,
		selectedId: id,
		recentIds: [ id, ...workspace.recentIds.filter( ( recent ) => recent !== id ) ],
	};
}

export function addPreviewTabToSplit(
	workspace: PreviewTabWorkspace,
	id: string,
	targetId?: string,
	position: 'start' | 'end' = 'end'
): PreviewTabWorkspace {
	const tab = workspace.tabs.find( ( tab ) => tab.id === id );
	if ( ! tab ) return workspace;
	const source = getPreviewTabSplit( workspace, id );
	const besideId =
		targetId ??
		( workspace.selectedId !== id
			? workspace.selectedId
			: workspace.recentIds.find(
					( candidate ) => candidate !== id && ! source?.tabIds.includes( candidate )
			  ) ?? workspace.tabs.find( ( tab ) => tab.id !== id )?.id );
	if ( ! besideId || besideId === id || ! workspace.tabs.some( ( tab ) => tab.id === besideId ) )
		return workspace;
	const destination = getPreviewTabSplit( workspace, besideId );
	if ( destination && source === destination ) return workspace;
	const members = destination?.tabIds ?? [ besideId ];
	const tabIds = position === 'start' ? [ id, ...members ] : [ ...members, id ];
	const tabs = workspace.tabs.filter( ( tab ) => tab.id !== id );
	const anchor = position === 'start' ? members[ 0 ] : members.at( -1 );
	tabs.splice(
		tabs.findIndex( ( tab ) => tab.id === anchor ) + ( position === 'end' ? 1 : 0 ),
		0,
		tab
	);
	const weights = destination?.weights ?? [ 0.5 ];
	const weight = weights.reduce( ( sum, weight ) => sum + weight, 0 ) / weights.length;
	return {
		...selectPreviewTab( workspace, id ),
		tabs,
		focusRequest: workspace.focusRequest + 1,
		splits: [
			...workspace.splits
				.filter( ( split ) => split !== destination )
				.flatMap( ( split ) => removeSplitTabs( split, [ id ] ) ),
			{
				...destination,
				tabIds,
				weights: position === 'start' ? [ weight, ...weights ] : [ ...weights, weight ],
			},
		],
	};
}

export function splitPreviewTabGroups(
	workspace: PreviewTabWorkspace,
	groupIds: readonly string[]
): PreviewTabWorkspace {
	const groups = getPreviewTabGroups( workspace );
	const selected = new Set( groupIds );
	const selectedGroups = groups.filter( ( group ) => selected.has( group[ 0 ].id ) );
	if ( selectedGroups.length < 2 ) return workspace;

	const members = selectedGroups.flat();
	const tabIds = members.map( ( tab ) => tab.id );
	const memberIds = new Set( tabIds );
	const firstGroup = selectedGroups[ 0 ];
	const selectedId = memberIds.has( workspace.selectedId ) ? workspace.selectedId : tabIds[ 0 ];
	return {
		...selectPreviewTab( workspace, selectedId ),
		tabs: groups.flatMap( ( group ) => {
			if ( group === firstGroup ) return members;
			return selected.has( group[ 0 ].id ) ? [] : group;
		} ),
		splits: [
			...workspace.splits.filter( ( split ) => ! memberIds.has( split.tabIds[ 0 ] ) ),
			{ tabIds, weights: tabIds.map( () => 1 ) },
		],
		focusRequest: workspace.focusRequest + 1,
	};
}

function removeSplitTabs( split: PreviewTabSplit, ids: readonly string[] ): PreviewTabSplit[] {
	const tabIds = split.tabIds.filter( ( id ) => ! ids.includes( id ) );
	if ( tabIds.length === split.tabIds.length ) return [ split ];
	if ( tabIds.length < 2 ) return [];
	return [
		{
			tabIds,
			weights: split.weights.filter( ( _, index ) => tabIds.includes( split.tabIds[ index ] ) ),
		},
	];
}

export function separatePreviewTabs( workspace: PreviewTabWorkspace, id: string ) {
	const pair = getPreviewTabSplit( workspace, id );
	return pair
		? {
				...selectPreviewTab( workspace, id ),
				splits: workspace.splits.filter( ( item ) => item !== pair ),
		  }
		: workspace;
}

export function closePreviewTabs(
	workspace: PreviewTabWorkspace,
	ids: readonly string[],
	replacementId: string
): PreviewTabWorkspace {
	const tabs = workspace.tabs.filter( ( tab ) => ! ids.includes( tab.id ) );
	if ( tabs.length === workspace.tabs.length ) return workspace;
	if ( ! tabs.length ) {
		return {
			...workspace,
			tabs: [ { id: replacementId, path: null, title: null } ],
			selectedId: replacementId,
			splits: [],
			recentIds: [ replacementId ],
		};
	}
	const partner = getPreviewTabSplit( workspace )?.tabIds.find( ( id ) => ! ids.includes( id ) );
	const index = workspace.tabs.findIndex( ( tab ) => tab.id === workspace.selectedId );
	const selectedId = ids.includes( workspace.selectedId )
		? partner ??
		  workspace.tabs.slice( index + 1 ).find( ( tab ) => ! ids.includes( tab.id ) )?.id ??
		  tabs[ tabs.length - 1 ].id
		: workspace.selectedId;
	return {
		...workspace,
		tabs,
		selectedId,
		splits: workspace.splits.flatMap( ( split ) => removeSplitTabs( split, ids ) ),
		recentIds: [
			selectedId,
			...workspace.recentIds.filter( ( id ) => id !== selectedId && ! ids.includes( id ) ),
		],
	};
}
