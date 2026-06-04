import type {
  DailySnapshot,
  DailySnapshotParams,
  LookupParams,
  MediaMetadata,
  OverviewTranslation,
  OverviewTranslationParams,
} from '../core/types';

export interface MediaProviderPort {
  lookup(params: LookupParams): Promise<MediaMetadata | null>;
  findOverviewTranslation(params: OverviewTranslationParams): Promise<OverviewTranslation | null>;
  buildDailySnapshot(params: DailySnapshotParams): Promise<DailySnapshot>;
}
