import semver from 'semver';

export function hasVersionMismatch( version1: string | null, version2: string | null ): boolean {
	const coercedVersion1 = semver.coerce( version1 );
	const coercedVersion2 = semver.coerce( version2 );

	return (
		!! coercedVersion1 &&
		!! coercedVersion2 &&
		semver.compare( coercedVersion1, coercedVersion2 ) !== 0
	);
}
