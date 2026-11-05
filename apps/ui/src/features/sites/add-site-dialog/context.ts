import { createContext, useContext } from 'react';
import type { AiModelId, SelectedSiteFolder, SyncSite } from '@/data/core';
import type { ComposerHandle } from '@/features/composer';
import type { SelectedBlueprint } from '@/features/sites/blueprint-selection';
import type { CreateSiteFormDraft, CreateSiteFormError } from '@/features/sites/create-site-form';
import type { AiProviderId } from '@studio/agent/protocol/providers';
import type { Dispatch, SetStateAction } from 'react';

export type SiteBackup = File | { path: string; name: string };

export interface CreatedSetupSite {
	siteId: string;
	chatId?: string;
	brief: ReturnType< ComposerHandle[ 'getSubmission' ] >;
	error?: CreateSiteFormError;
}

export type SetupSource =
	| { type: 'blank' }
	| { type: 'blueprint'; blueprint?: SelectedBlueprint }
	| { type: 'import'; backup?: SiteBackup }
	| { type: 'folder'; folder: SelectedSiteFolder }
	| { type: 'connect'; remote: SyncSite };

interface AddSiteContextValue {
	// Announces long work and locks the dialog until it's cleared.
	setProgress: Dispatch< SetStateAction< string | null > >;
	// Shows the progress the CLI publishes for this site in place of the panel's.
	followSite: ( siteId: string | undefined ) => void;
	// The header's action slot, for a panel's primary buttons.
	actions: HTMLElement | null;
	formActions: HTMLElement | null;
	isBlueprintValid: boolean;
	setIsBlueprintValid: ( isValid: boolean ) => void;
	// Pins a site the dialog created when it was opened from the Pinned group.
	pinNewSite: ( siteId: string ) => void;
	// What was typed in the setup form, kept while Back shows the starting points.
	setupDraft?: CreateSiteFormDraft;
	setSetupDraft: ( draft: CreateSiteFormDraft ) => void;
	source: SetupSource;
	setSource: ( source: SetupSource ) => void;
	folderResetKey: number;
	removeFolder: () => void;
	browseBlueprints: () => void;
	onFile: ( file: File ) => void;
	onFolder: ( path?: string, usePath?: boolean ) => Promise< void >;
	setBlueprintTransferred: ( transferred: boolean ) => void;
	createdSite?: CreatedSetupSite;
	setCreatedSite: Dispatch< SetStateAction< CreatedSetupSite | undefined > >;
	briefDraftKey: string;
	aiChoice?: { model: AiModelId; provider: AiProviderId };
	setAiChoice: ( choice: { model: AiModelId; provider: AiProviderId } ) => void;
}

export const AddSiteContext = createContext< AddSiteContextValue | null >( null );

export function useAddSite(): AddSiteContextValue {
	const value = useContext( AddSiteContext );
	if ( ! value ) throw new Error( 'useAddSite must be used inside the Add site dialog' );
	return value;
}
