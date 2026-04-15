import semver from 'semver';

export function hasVersionMismatch( version1: string, version2: string ): boolean {
	const coercedVersion1 = semver.coerce( version1 );
	const coercedVersion2 = semver.coerce( version2 );

	return (
		!! coercedVersion1 &&
		!! coercedVersion2 &&
		semver.compare( coercedVersion1, coercedVersion2 ) !== 0
	);
}
