import type {
  DailySnapshot,
  DailySnapshotParams,
  LookupMetadata,
  LookupParams,
  OverviewTranslation,
  OverviewTranslationParams,
} from '../core/types';

export interface MediaProviderPort {
  lookup(params: LookupParams): Promise<LookupMetadata | null>;
  findOverviewTranslation(params: OverviewTranslationParams): Promise<OverviewTranslation | null>;
  buildDailySnapshot(params: DailySnapshotParams): Promise<DailySnapshot>;
}
