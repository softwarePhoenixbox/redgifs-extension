export type DownloadChoice = 'hd' | 'sd' | 'image';

export interface DownloadOptions {
  hd: boolean;
  sd: boolean;
  image: boolean;
}

export const DEFAULT_DOWNLOAD_OPTIONS: DownloadOptions = { hd: true, sd: false, image: false };

export function normalizeDownloadOptions(value: unknown, legacyQuality?: unknown): DownloadOptions {
  if (value && typeof value === 'object') {
    const options = value as Partial<DownloadOptions>;
    return {
      hd: options.hd === true,
      sd: options.sd === true,
      image: options.image === true,
    };
  }
  if (legacyQuality === 'sd') return { hd: false, sd: true, image: false };
  if (legacyQuality === 'both') return { hd: true, sd: true, image: false };
  return DEFAULT_DOWNLOAD_OPTIONS;
}

export function enabledDownloadChoices(options: DownloadOptions): DownloadChoice[] {
  return (['hd', 'sd', 'image'] as const).filter(choice => options[choice]);
}
