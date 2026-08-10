import { createInterpolateElement } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import { settings } from '@wordpress/icons';
import { Icon } from '@wordpress/ui';
import type { CoachmarkContent } from './types';
import type { ChecklistItemId, OnboardingHintsState } from '@/data/core';

// One getting-started item. `coachmark` is what we show when the user clicks an
// incomplete item — we teach where to click rather than navigating for them.
// `preCompleted` items (e.g. "Create your first site") start checked for
// endowed progress.
export interface ChecklistItemDef {
	id: ChecklistItemId;
	label: () => string;
	coachmark?: CoachmarkContent;
	preCompleted?: boolean;
}

// Resolved item handed to the card renderer.
export interface ChecklistCardItem {
	id: ChecklistItemId;
	label: string;
	completed: boolean;
}

const CREATE_SITE_ITEM: ChecklistItemDef = {
	id: 'create-site',
	label: () => __( 'Create your first site' ),
	preCompleted: true,
};

const FIRST_AGENT_EDIT_ITEM: ChecklistItemDef = {
	id: 'first-agent-edit',
	label: () => __( 'Make a change with chat' ),
	coachmark: {
		anchor: 'composer',
		title: () => __( 'Ask the agent' ),
		description: () =>
			__( 'Describe a change here and the agent makes it. Try "Add an About page."' ),
		placement: { side: 'top', align: 'center' },
	},
};

const VISIT_OVERVIEW_AGENTIC_ITEM: ChecklistItemDef = {
	id: 'visit-overview',
	label: () => __( 'Open your site overview' ),
	coachmark: {
		anchor: 'sidebar-site-row-overview',
		title: () => __( 'Site overview' ),
		description: () =>
			createInterpolateElement(
				__( 'The <icon/> button opens the overview — editor, styles, admin tools, and more.' ),
				{ icon: <Icon icon={ settings } size={ 16 } /> }
			),
		placement: { side: 'right', align: 'center' },
	},
};

const VISIT_OVERVIEW_OVERVIEW_ITEM: ChecklistItemDef = {
	id: 'visit-overview',
	label: () => __( 'Explore your site overview' ),
	coachmark: {
		anchor: 'site-overview-content',
		title: () => __( 'Site overview' ),
		description: () =>
			__( 'Open the editor and admin tools, or duplicate and export your site from here.' ),
		placement: { side: 'right', align: 'center' },
	},
};

const VISIT_SITE_SETTINGS_ITEM: ChecklistItemDef = {
	id: 'visit-site-settings',
	label: () => __( 'Adjust your site settings' ),
	coachmark: {
		anchor: 'site-settings-tab',
		title: () => __( 'Site settings' ),
		description: () =>
			__( 'PHP version, web server, and debugging tools live in the Settings tab.' ),
		placement: { side: 'bottom', align: 'start' },
	},
};

const PUBLISH_ITEM: ChecklistItemDef = {
	id: 'publish-site',
	label: () => __( 'Publish to WordPress.com' ),
	coachmark: {
		anchor: 'publish-button',
		title: () => __( 'Go live' ),
		description: () => __( 'When you’re ready, publish puts your site on WordPress.com.' ),
		placement: { side: 'bottom', align: 'end' },
	},
};

const VISIT_APP_SETTINGS_ITEM: ChecklistItemDef = {
	id: 'visit-app-settings',
	label: () => __( 'Explore settings' ),
	coachmark: {
		anchor: 'sidebar-user-menu',
		title: () => __( 'Settings' ),
		description: () => __( 'Your editor, theme, AI model, and more live in Settings, down here.' ),
		placement: { side: 'top', align: 'start' },
	},
};

export const AGENTIC_CHECKLIST_ITEMS: ChecklistItemDef[] = [
	CREATE_SITE_ITEM,
	FIRST_AGENT_EDIT_ITEM,
	VISIT_OVERVIEW_AGENTIC_ITEM,
	PUBLISH_ITEM,
	VISIT_APP_SETTINGS_ITEM,
];

export const OVERVIEW_CHECKLIST_ITEMS: ChecklistItemDef[] = [
	CREATE_SITE_ITEM,
	VISIT_OVERVIEW_OVERVIEW_ITEM,
	VISIT_SITE_SETTINGS_ITEM,
	PUBLISH_ITEM,
	VISIT_APP_SETTINGS_ITEM,
];

export function getChecklistItems( agenticEnabled: boolean ): ChecklistItemDef[] {
	return agenticEnabled ? AGENTIC_CHECKLIST_ITEMS : OVERVIEW_CHECKLIST_ITEMS;
}

// Pure: resolve each definition to its completed state from persisted hints.
export function deriveChecklistItems(
	defs: ChecklistItemDef[],
	hints: OnboardingHintsState | undefined
): ChecklistCardItem[] {
	const completed = hints?.completedItems ?? {};
	return defs.map( ( def ) => ( {
		id: def.id,
		label: def.label(),
		completed: def.preCompleted === true || Boolean( completed[ def.id ] ),
	} ) );
}

export function isChecklistComplete( items: ChecklistCardItem[] ): boolean {
	return items.length > 0 && items.every( ( item ) => item.completed );
}
