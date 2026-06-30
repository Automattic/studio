import type { RegionSelectionReport } from '@automattic/blocks-engine/theme';
import type { SourceLandmark } from '../../lib/replicate/section-extract.js';

export const LOCAL_CONSERVATION_REPORT_SCHEMA = 1;
export const LOCAL_CONSERVATION_RAIL_LINK_THRESHOLD = 2;
export const LOCAL_CONSERVATION_HARD_FAIL_ARG = 'failOnConservationRailDrop';
export const LOCAL_CONSERVATION_HARD_FAIL_ROLES = ['nav', 'complementary'] as const;

export type LocalConservationStatus = 'pass' | 'warn' | 'fail';
export type LocalConservationHardFailRole = typeof LOCAL_CONSERVATION_HARD_FAIL_ROLES[number];

export interface LocalConservationSummary {
  ok: boolean;
  status: LocalConservationStatus;
  unassignedRegions: number;
  hardFailRegions: number;
  artifact: string;
  railHardFail: {
    enabled: boolean;
    roles: readonly LocalConservationHardFailRole[];
    minLinks: number;
  };
}

export interface LocalConservationRegionAudit {
  schema: typeof LOCAL_CONSERVATION_REPORT_SCHEMA;
  site: string;
  pages: RegionSelectionReport[];
  unassignedRegions: number;
  hardFailRegions: SourceLandmark[];
}
