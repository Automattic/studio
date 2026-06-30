export type ConservationLeakRole =
  | 'body'
  | 'header'
  | 'nav'
  | 'footer'
  | 'aside'
  | 'complementary'
  | 'region'
  | 'unknown';

export type ConservationLeakReason = 'actionable_region_unplaced';

export interface ConservationLeak {
  selector: string;
  role: ConservationLeakRole;
  pageSlug: string;
  reason: ConservationLeakReason;
}
