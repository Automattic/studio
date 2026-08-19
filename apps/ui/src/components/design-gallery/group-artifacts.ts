import type { DesignArtifact } from '@studio/common/design-project';

export interface DesignDirectionGroup {
	id: string;
	label: string;
	artifacts: DesignArtifact[];
}

function getBaseLabel( label: string ): string {
	return label.replace( /\s+(?:v|version)\s*\d+$/i, '' ).trim();
}

export function groupDesignArtifacts( artifacts: DesignArtifact[] ): DesignDirectionGroup[] {
	const groups: DesignDirectionGroup[] = [];
	const groupByArtifactId = new Map< string, DesignDirectionGroup >();

	for ( const artifact of [ ...artifacts ].sort( ( a, b ) => a.revision - b.revision ) ) {
		const baseLabel = getBaseLabel( artifact.label );
		const parentGroup = artifact.parentArtifactId
			? groupByArtifactId.get( artifact.parentArtifactId )
			: undefined;
		const legacyGroup = artifact.parentArtifactId
			? undefined
			: groups.find(
					( group ) => group.label.toLocaleLowerCase() === baseLabel.toLocaleLowerCase()
			  );
		const group = parentGroup ?? legacyGroup;

		if ( group ) {
			group.artifacts.push( artifact );
			groupByArtifactId.set( artifact.id, group );
			continue;
		}

		const nextGroup = { id: artifact.id, label: baseLabel, artifacts: [ artifact ] };
		groups.push( nextGroup );
		groupByArtifactId.set( artifact.id, nextGroup );
	}

	return groups;
}

export function getLatestArtifact( group: DesignDirectionGroup ): DesignArtifact {
	return group.artifacts[ group.artifacts.length - 1 ];
}
