export type DownloadChoice = 'hd' | 'sd' | 'image' | 'frame';

export interface DownloadOptions {
  hd: boolean;
  sd: boolean;
  image: boolean;
  frame: boolean;
}

export const DEFAULT_DOWNLOAD_OPTIONS: DownloadOptions = { hd: true, sd: false, image: false, frame: false };

export function normalizeDownloadOptions(value: unknown, legacyQuality?: unknown): DownloadOptions {
  if (value && typeof value === 'object') {
    const options = value as Partial<DownloadOptions>;
    return {
      hd: options.hd === true,
      sd: options.sd === true,
      image: options.image === true,
      frame: options.frame === true,
    };
  }
  if (legacyQuality === 'sd') return { hd: false, sd: true, image: false, frame: false };
  if (legacyQuality === 'both') return { hd: true, sd: true, image: false, frame: false };
  return DEFAULT_DOWNLOAD_OPTIONS;
}

// Plan gratuito: solo video SD. HD, JPG y captura de fotograma son premium.
export const FREE_DOWNLOAD_OPTIONS: DownloadOptions = { hd: false, sd: true, image: false, frame: false };

export function effectiveDownloadOptions(options: DownloadOptions, premium: boolean): DownloadOptions {
  return premium ? options : FREE_DOWNLOAD_OPTIONS;
}

export function enabledDownloadChoices(options: DownloadOptions): DownloadChoice[] {
  return (['hd', 'sd', 'image', 'frame'] as const).filter(choice => options[choice]);
}
