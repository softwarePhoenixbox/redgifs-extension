import { HAS_PREMIUM } from './edition';
export type DownloadChoice = 'hd' | 'sd' | 'image' | 'frame';

export interface DownloadOptions {
  hd: boolean;
  sd: boolean;
  image: boolean;
  frame: boolean;
}

// Condición escrita aquí mismo para que el bundler la resuelva al compilar: en `basic` solo queda el video SD
// y desaparecen del paquete las claves y la lógica de HD / JPG / fotograma.
const BASIC = import.meta.env.WXT_EDITION === 'basic';

const SD_ONLY = { sd: true } as DownloadOptions;

export const DEFAULT_DOWNLOAD_OPTIONS: DownloadOptions = BASIC ? SD_ONLY : { hd: true, sd: false, image: false, frame: false };

export function normalizeDownloadOptions(value: unknown, legacyQuality?: unknown): DownloadOptions {
  if (BASIC) return SD_ONLY;
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
export const FREE_DOWNLOAD_OPTIONS: DownloadOptions = BASIC ? SD_ONLY : { hd: false, sd: true, image: false, frame: false };

export function effectiveDownloadOptions(options: DownloadOptions, premium: boolean): DownloadOptions {
  if (BASIC) return SD_ONLY;
  return HAS_PREMIUM && premium ? options : FREE_DOWNLOAD_OPTIONS;
}

export function enabledDownloadChoices(options: DownloadOptions): DownloadChoice[] {
  if (BASIC) return options.sd ? ['sd'] : [];
  return (['hd', 'sd', 'image', 'frame'] as const).filter(choice => options[choice]);
}