import { SHIPPED_SKILL_IDS } from '@studio/common/lib/skill-draft';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useConnector } from '@/data/core';
import type { SiteAgentFile, SiteAgentFileKind } from '@/data/core';
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

// The user's skills an agent can load in a chat, as the composer's `/` menu lists them: the
// site's own and the ones for all sites, or only those in a chat without a local site. The
// WordPress skills Studio copied into the site are left out: agents load those themselves.
export function useUserSkillCommands( siteId: string | undefined ): SkillSlashCommand[] {
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
			: ( globalSkills ?? [] )
					// The ones in `~/.agents/skills` show through their link in Studio's folder.
					.filter( ( skill ) => skill.source === 'studio' )
					.map( ( skill ) => ( { ...skill, global: true } ) );
		return skills
			.filter(
				( skill, index ) =>
					skill.enabled &&
					skill.description &&
					( skill.global || ! SHIPPED_SKILL_IDS.includes( skill.id ) ) &&
					skills.findIndex( ( { id, enabled } ) => enabled && id === skill.id ) === index
			)
			.map( ( skill ) => ( {
				name: skill.id,
				displayName: skill.displayName,
				description: skill.description,
			} ) );
	}, [ siteId, siteSkills, globalSkills ] );
}

// Switches files on or off, or uninstalls one, then re-reads the site. A switch shows its new
// state at once; the changes run one after the other, and the site is re-read after the last.
export function useUpdateSiteAgentFiles( siteId: string, kind: SiteAgentFileKind ) {
	const connector = useConnector();
	const queryClient = useQueryClient();
	const queryKey = [ ...SITE_AGENT_FILES_QUERY_KEY, siteId, kind ];
	const mutationKey = [ 'update-site-agent-files', siteId, kind ];
	return useMutation( {
		mutationKey,
		scope: { id: mutationKey.join( '/' ) },
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
		onMutate: async ( change ) => {
			if ( 'remove' in change ) {
				return;
			}
			await queryClient.cancelQueries( { queryKey } );
			queryClient.setQueryData< SiteAgentFile[] >(
				queryKey,
				( files ) =>
					files?.map( ( file ) =>
						change.ids.includes( file.id )
							? { ...file, enabled: change.enabled, installed: file.installed || change.enabled }
							: file
					)
			);
		},
		// A re-read while another change waits would show that change undone for a moment.
		onSettled: () =>
			queryClient.isMutating( { mutationKey } ) === 1
				? queryClient.invalidateQueries( { queryKey } )
				: undefined,
	} );
}
