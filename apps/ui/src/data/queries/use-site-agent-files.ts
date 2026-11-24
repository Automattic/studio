import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useConnector } from '@/data/core';
import type { SiteAgentFileKind } from '@/data/core';
import type { SkillSlashCommand } from '@studio/agent/protocol/slash-commands';

export const SITE_AGENT_FILES_QUERY_KEY = [ 'site-agent-files' ] as const;
export const GLOBAL_SKILLS_QUERY_KEY = [ 'global-skills' ] as const;

export function useSiteAgentFiles( siteId: string, kind: SiteAgentFileKind ) {
	const connector = useConnector();
	return useQuery( {
		queryKey: [ ...SITE_AGENT_FILES_QUERY_KEY, siteId, kind ],
		queryFn: () => connector.getSiteAgentFiles( siteId, kind ),
	} );
}

// A skill of the user's in the composer's `/` menu.
export type UserSkillCommand = SkillSlashCommand & {
	// It works on all sites, not only this chat's.
	global?: boolean;
};

// The user's skills an agent can load in a chat, as the composer's `/` menu lists them: the
// site's own and the ones for all sites, or only those in a chat without a local site.
export function useUserSkillCommands( siteId: string | undefined ): UserSkillCommand[] {
	const connector = useConnector();
	const { data: siteSkills } = useQuery( {
		queryKey: [ ...SITE_AGENT_FILES_QUERY_KEY, siteId, 'skills' ],
		queryFn: () => connector.getSiteAgentFiles( siteId ?? '', 'skills' ),
		enabled: !! siteId,
	} );
	const { data: globalSkills } = useQuery( {
		queryKey: GLOBAL_SKILLS_QUERY_KEY,
		queryFn: () => connector.getGlobalSkills(),
		enabled: ! siteId && connector.capabilities.globalSkills,
	} );
	return useMemo( () => {
		const skills = siteId
			? ( siteSkills ?? [] ).map( ( skill ) => ( { ...skill, global: !! skill.globalSource } ) )
			: ( globalSkills ?? [] ).map( ( skill ) => ( { ...skill, global: true } ) );
		return skills
			.filter(
				( skill, index ) =>
					skill.enabled &&
					skill.description &&
					skills.findIndex( ( { id, enabled } ) => enabled && id === skill.id ) === index
			)
			.map( ( skill ) => ( {
				name: skill.id,
				displayName: skill.displayName,
				description: skill.description,
				global: skill.global,
			} ) );
	}, [ siteId, siteSkills, globalSkills ] );
}

// Switches files on or off, or uninstalls one, then re-reads the site.
export function useUpdateSiteAgentFiles( siteId: string, kind: SiteAgentFileKind ) {
	const connector = useConnector();
	const queryClient = useQueryClient();
	return useMutation( {
		mutationFn: async (
			change: { ids: string[]; enabled: boolean } | { remove: string }
		): Promise< void > => {
			if ( 'remove' in change ) {
				await connector.removeSiteAgentFile( siteId, kind, change.remove );
				return;
			}
			for ( const id of change.ids ) {
				await connector.setSiteAgentFileEnabled( siteId, kind, id, change.enabled );
			}
		},
		onSettled: () =>
			queryClient.invalidateQueries( {
				queryKey: [ ...SITE_AGENT_FILES_QUERY_KEY, siteId, kind ],
			} ),
	} );
}
