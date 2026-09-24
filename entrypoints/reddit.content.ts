import { popupMessage, type PopupLanguage } from '../utils/popup-i18n';
import type { RgRequest, RgResponse } from '../utils/messages';

export default defineContentScript({
  matches: ['*://*.reddit.com/*'],
  main(ctx) {
    const PANEL_CLASS = 'rg-reddit-download-tools';
    const MEDIA_ID_RE = /media\.redgifs\.com\/([a-z\d]+)(?:-mobile|-silent)?\.(?:jpg|jpeg|mp4)(?:[?#]|$)/i;
    let language: PopupLanguage = 'en';
    let qualityMode: 'hd' | 'sd' | 'both' = 'hd';
    const t = (key: Parameters<typeof popupMessage>[1]) => popupMessage(language, key);

    async function send(request: RgRequest): Promise<RgResponse> {
      try {
        return (await browser.runtime.sendMessage(request)) as RgResponse ?? { ok: false, error: t('backgroundError') };
      } catch {
        return { ok: false, error: t('extensionError') };
      }
    }

    function collectMediaUrls(root: HTMLElement): string[] {
      const urls: string[] = [];
      for (const element of Array.from(root.querySelectorAll<HTMLImageElement | HTMLVideoElement | HTMLSourceElement>('img, video, source'))) {
        if (element instanceof HTMLImageElement) urls.push(element.currentSrc, element.src);
        else if (element instanceof HTMLVideoElement) urls.push(element.currentSrc, element.src, element.poster);
        else urls.push(element.src);
      }
      for (const anchor of Array.from(root.querySelectorAll<HTMLAnchorElement>('a[href*="media.redgifs.com/"]'))) urls.push(anchor.href);
      return urls.filter(Boolean);
    }

    function mediaId(root: HTMLElement): string | null {
      for (const url of collectMediaUrls(root)) {
        const match = MEDIA_ID_RE.exec(url);
        if (match?.[1]) return match[1];
      }
      return null;
    }

    function authorName(root: HTMLElement): string | null {
      const post = root.matches('shreddit-post') ? root : root.querySelector<HTMLElement>('shreddit-post');
      const value = post?.getAttribute('author') ?? root.querySelector<HTMLElement>('[data-testid="post_author_link"]')?.textContent?.trim();
      return value?.replace(/^u\//i, '').trim() || null;
    }

    function postTitle(root: HTMLElement): string | null {
      const post = root.matches('shreddit-post') ? root : root.querySelector<HTMLElement>('shreddit-post');
      const value = post?.getAttribute('post-title') ?? root.querySelector<HTMLElement>('[data-testid="post-title"], h1')?.textContent?.trim();
      return value?.trim() || null;
    }

    function showQualityMenu(anchor: HTMLElement, choose: (quality: 'hd' | 'sd') => void): void {
      document.getElementById('rg-reddit-quality-menu')?.remove();
      const rect = anchor.getBoundingClientRect();
      const menu = document.createElement('div');
      menu.id = 'rg-reddit-quality-menu';
      menu.style.cssText = `position:fixed;z-index:2147483647;top:${Math.min(rect.bottom + 5, innerHeight - 80)}px;left:${Math.max(8, Math.min(rect.left, innerWidth - 130))}px;display:flex;gap:5px;padding:6px;background:#181818;border:1px solid #555;border-radius:7px;box-shadow:0 5px 18px #0009;`;
      const dismiss = (event: Event) => {
        if (!menu.contains(event.target as Node) && event.target !== anchor) {
          menu.remove();
          document.removeEventListener('pointerdown', dismiss, true);
        }
      };
      for (const quality of ['hd', 'sd'] as const) {
        const option = document.createElement('button');
        option.type = 'button';
        option.textContent = quality.toUpperCase();
        option.style.cssText = 'border:0;border-radius:5px;padding:6px 12px;background:#ff4500;color:white;font:bold 12px Arial,sans-serif;cursor:pointer;';
        option.addEventListener('click', event => {
          event.preventDefault();
          event.stopPropagation();
          menu.remove();
          document.removeEventListener('pointerdown', dismiss, true);
          choose(quality);
        }, { once: true });
        menu.appendChild(option);
      }
      document.body.appendChild(menu);
      setTimeout(() => document.addEventListener('pointerdown', dismiss, true), 0);
    }

    function toast(message: string, error = false): void {
      const element = document.createElement('div');
      element.textContent = message;
      element.style.cssText = `position:fixed;right:18px;bottom:18px;z-index:2147483647;padding:10px 14px;border-radius:7px;background:${error ? '#42191b' : '#173c2b'};border:1px solid ${error ? '#e5484d' : '#2ea043'};color:white;font:13px Arial,sans-serif;box-shadow:0 4px 18px #0009;`;
      document.body.appendChild(element);
      setTimeout(() => element.remove(), 3000);
    }

    function createButton(text: string, color: string): HTMLButtonElement {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = text;
      button.style.cssText = `background:${color};color:white;padding:5px 9px;border:0;text-decoration:none;font:bold 11px Arial,sans-serif;border-radius:4px;box-shadow:0 2px 4px #0008;min-width:70px;cursor:pointer;`;
      return button;
    }

    function installOn(root: HTMLElement): void {
      if (root.querySelector(`.${PANEL_CLASS}`)) return;
      const id = mediaId(root);
      if (!id) return;
      const author = authorName(root);
      const title = postTitle(root);
      const pageUrl = location.href;
      const target = root.querySelector<HTMLElement>('[id$="-aspect-ratio"]')
        ?? root.querySelector<HTMLElement>('shreddit-player')
        ?? root.querySelector<HTMLVideoElement>('video')?.parentElement
        ?? root;
      const initialPosition = getComputedStyle(target).position;
      if (initialPosition === 'static') target.style.position = 'relative';

      const tools = document.createElement('div');
      tools.className = PANEL_CLASS;
      tools.style.cssText = 'position:absolute;top:12px;right:12px;display:flex;flex-direction:column;align-items:flex-end;gap:6px;z-index:2147483646;';
      if (author) {
        const authorBadge = document.createElement('div');
        authorBadge.textContent = `👤 @${author}`;
        authorBadge.style.cssText = 'background:#8e44ad;color:white;padding:5px 9px;border-radius:4px;font:bold 11px Arial,sans-serif;box-shadow:0 2px 4px #0008;';
        tools.appendChild(authorBadge);
      }

      const download = createButton(`⬇ ${t('redditDownload')}`, '#ff4500');
      download.title = t('downloadQuality');
      download.addEventListener('click', () => {
        const run = (quality: 'hd' | 'sd') => {
          const url = `https://media.redgifs.com/${id}${quality === 'sd' ? '-mobile' : ''}.mp4`;
          download.disabled = true;
          void send({ type: 'RG_DOWNLOAD', id, url, quality, title: title ?? undefined, author: author ?? undefined, pageUrl })
            .then(result => {
              if (!result.ok) throw new Error(result.error);
              toast(result.metadata_embedded ? t('downloadStartedMetadata') : (result.metadata_warning ?? t('downloadedWithoutMetadata')), !result.metadata_embedded);
            })
            .catch(error => toast(`✖ ${error instanceof Error ? error.message : t('downloadFailed')}`, true))
            .finally(() => { download.disabled = false; });
        };
        if (qualityMode === 'both') showQualityMenu(download, run);
        else run(qualityMode);
      });
      tools.appendChild(download);

      const image = createButton(t('redditImage'), '#3498db');
      image.addEventListener('click', () => {
        const url = `https://media.redgifs.com/${id}-mobile.jpg`;
        image.disabled = true;
        void send({ type: 'RG_DOWNLOAD', id, url, quality: 'image', author: author ?? undefined, pageUrl })
          .then(result => {
            if (!result.ok) throw new Error(result.error);
            toast(t('imageDownloadStarted'));
          })
          .catch(error => toast(`✖ ${error instanceof Error ? error.message : t('downloadFailed')}`, true))
          .finally(() => { image.disabled = false; });
      });
      tools.appendChild(image);
      target.appendChild(tools);
    }

    function scan(): void {
      const posts = Array.from(document.querySelectorAll<HTMLElement>('shreddit-post, [data-testid="post-container"]'));
      if (posts.length) {
        for (const post of posts) installOn(post);
      } else {
        const fallback = document.querySelector<HTMLElement>('shreddit-player')?.parentElement ?? document.body;
        installOn(fallback);
      }
    }

    const observer = new MutationObserver(scan);
    void browser.storage.local.get(['rgLanguage', 'rgDownloadQuality']).then(values => {
      language = values.rgLanguage === 'es' ? 'es' : 'en';
      const mode = values.rgDownloadQuality;
      qualityMode = mode === 'sd' || mode === 'both' ? mode : 'hd';
      scan();
      observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'poster'] });
    });
    browser.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (changes.rgLanguage) language = changes.rgLanguage.newValue === 'es' ? 'es' : 'en';
      if (changes.rgDownloadQuality) {
        const mode = changes.rgDownloadQuality.newValue;
        qualityMode = mode === 'sd' || mode === 'both' ? mode : 'hd';
      }
      document.querySelectorAll<HTMLElement>(`.${PANEL_CLASS}`).forEach(element => element.remove());
      scan();
    });
    ctx.addEventListener(window, 'scroll', scan, { passive: true });
    ctx.onInvalidated(() => observer.disconnect());
  },
});
