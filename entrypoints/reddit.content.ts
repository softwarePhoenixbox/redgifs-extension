import { popupMessage, type PopupLanguage } from '../utils/popup-i18n';
import type { RgRequest, RgResponse } from '../utils/messages';

export default defineContentScript({
  matches: ['*://reddit.com/*', '*://*.reddit.com/*'],
  main(ctx) {
    const PANEL_CLASS = 'rg-reddit-download-tools';
    const MEDIA_ID_RE = /media\.redgifs\.com\/([a-z\d]+)(?:-mobile|-silent)?\.(?:jpg|jpeg|mp4)(?:[?#]|$)/i;
    const WATCH_ID_RE = /redgifs\.com\/(?:watch|ifr)\/([a-z\d]+)/i;
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
        const watchMatch = WATCH_ID_RE.exec(url);
        if (watchMatch?.[1]) return watchMatch[1];
      }
      // Reddit often renders a RedGifs post as a watch-page link rather than
      // exposing the underlying media.redgifs.com URL in the player DOM.
      const textMatch = WATCH_ID_RE.exec(root.innerText || root.textContent || '');
      if (textMatch?.[1]) return textMatch[1];
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

    function redgifsFrameFor(id: string): HTMLIFrameElement | undefined {
      const pending: ParentNode[] = [document];
      const visited = new Set<ParentNode>();
      while (pending.length) {
        const scope = pending.shift()!;
        if (visited.has(scope)) continue;
        visited.add(scope);
        for (const frame of Array.from(scope.querySelectorAll<HTMLIFrameElement>('iframe'))) {
          try {
            const url = new URL(frame.src, location.href);
            const match = /\/ifr\/([\w-]+)/i.exec(url.pathname);
            if (url.hostname.endsWith('redgifs.com') && match?.[1]?.toLowerCase() === id.toLowerCase()) return frame;
          } catch { /* ignore malformed or not-yet-hydrated frames */ }
        }
        for (const element of Array.from(scope.querySelectorAll<HTMLElement>('*'))) {
          if (element.shadowRoot) pending.push(element.shadowRoot);
        }
      }
      return undefined;
    }

    function showRedditChoiceMenu(requestId: string, gifId: string, choices: Array<'hd' | 'sd' | 'image' | 'frame'>): void {
      document.getElementById('rg-reddit-external-quality-menu')?.remove();
      const frame = redgifsFrameFor(gifId);
      const rect = frame?.getBoundingClientRect();
      const width = 154;
      const height = choices.length * 37 + 14;
      let left = rect ? rect.right + 8 : innerWidth - width - 12;
      let top = rect ? rect.top + 8 : 96;
      if (left + width > innerWidth - 8) left = rect ? Math.max(8, rect.left - width - 8) : 8;
      if (left + width > innerWidth - 8 && rect) {
        left = Math.max(8, Math.min(rect.left, innerWidth - width - 8));
        top = rect.bottom + 8;
      }
      top = Math.max(8, Math.min(top, innerHeight - height - 8));

      const menu = document.createElement('div');
      menu.id = 'rg-reddit-external-quality-menu';
      menu.style.cssText = `position:fixed;z-index:2147483647;top:${top}px;left:${left}px;width:${width}px;box-sizing:border-box;display:flex;flex-direction:column;gap:5px;padding:7px;background:#181818;border:1px solid #555;border-radius:7px;box-shadow:0 5px 18px #0009;`;
      const labelFor = (choice: 'hd' | 'sd' | 'image' | 'frame') => t(
        choice === 'hd' ? 'downloadHd' : choice === 'sd' ? 'downloadSd' : choice === 'image' ? 'downloadImage' : 'downloadFrame',
      );
      const dismiss = (event: Event) => {
        if (!menu.contains(event.target as Node)) {
          menu.remove();
          document.removeEventListener('pointerdown', dismiss, true);
        }
      };
      for (const choice of choices) {
        const option = document.createElement('button');
        option.type = 'button';
        option.textContent = labelFor(choice);
        option.style.cssText = 'width:100%;border:0;border-radius:5px;padding:8px 10px;background:#2f6bff;color:#fff;font:bold 12px Arial,sans-serif;cursor:pointer;text-align:center;';
        option.addEventListener('click', event => {
          event.preventDefault();
          event.stopPropagation();
          menu.remove();
          document.removeEventListener('pointerdown', dismiss, true);
          void browser.runtime.sendMessage({ type: 'RG_REDDIT_MENU_SELECTED', requestId, choice });
        }, { once: true });
        menu.appendChild(option);
      }
      document.body.appendChild(menu);
      setTimeout(() => document.addEventListener('pointerdown', dismiss, true), 0);
    }

    browser.runtime.onMessage.addListener((message: RgRequest, _sender, sendResponse) => {
      if (message.type !== 'RG_REDDIT_MENU_SHOW') return undefined;
      showRedditChoiceMenu(message.requestId, message.gifId, message.choices);
      sendResponse({ ok: true } satisfies RgResponse);
      return false;
    });

    function createDownloadButton(): HTMLButtonElement {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'rg-reddit-download-button';
      button.title = t('downloadWithMetadata');
      button.setAttribute('aria-label', t('downloadVideo'));
      button.style.cssText = 'background:transparent;border:0;color:#fff;cursor:pointer;padding:0;display:flex;flex-direction:column;align-items:center;justify-content:center;font:12px Arial,sans-serif;text-shadow:0 1px 3px #000;';
      button.innerHTML = '<svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12m0 0 5-5m-5 5-5-5"/><path d="M5 17v3h14v-3"/></svg>';
      const label = document.createElement('span');
      label.textContent = t('download');
      button.appendChild(label);
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
      tools.style.cssText = 'position:absolute;top:50%;right:10px;transform:translateY(-50%);z-index:2147483646;';

      const download = createDownloadButton();
      download.addEventListener('click', () => {
        const run = (quality: 'hd' | 'sd') => {
          const url = `https://media.redgifs.com/${id}${quality === 'sd' ? '-mobile' : ''}.mp4`;
          download.disabled = true;
          const label = download.querySelector('span');
          if (label) label.textContent = t('preparing');
          void send({ type: 'RG_DOWNLOAD', id, url, quality, title: title ?? undefined, author: author ?? undefined, pageUrl })
            .then(result => {
              if (!result.ok) throw new Error(result.error);
              toast(result.metadata_embedded ? t('downloadStartedMetadata') : (result.metadata_warning ?? t('downloadedWithoutMetadata')), !result.metadata_embedded);
            })
            .catch(error => toast(`✖ ${error instanceof Error ? error.message : t('downloadFailed')}`, true))
            .finally(() => {
              download.disabled = false;
              if (label) label.textContent = t('download');
            });
        };
        if (qualityMode === 'both') showQualityMenu(download, run);
        else run(qualityMode);
      });
      tools.appendChild(download);
      target.appendChild(tools);
    }

    function scan(): void {
      // Downloads are now injected by the RedGifs content script inside its
      // /ifr/<id> frame. Remove any stale Reddit-side overlay to avoid showing
      // a duplicate button outside the video.
      document.querySelectorAll<HTMLElement>(`.${PANEL_CLASS}`).forEach(element => element.remove());
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
