/**
 * @fileoverview Lever B: notice when a newer build has been deployed and
 * offer a one-click reload, so a long-lived tab doesn't silently run stale
 * code. The running build stamps its own id into the bundle (__BUILD_ID__,
 * injected by vite.config); a small poll fetches the deployed version.json
 * and compares. When they differ, an unobtrusive banner appears. Paired with
 * the persisted result cache (Lever A), the reload it triggers is cheap —
 * results are restored from IndexedDB, not recomputed (unless that deploy
 * bumped the optimizer version).
 */

// vite `define` replaces __BUILD_ID__ with a string literal at build time; the
// typeof guard keeps this safe if it's ever left undefined (e.g. an odd dev
// run).
const CURRENT_BUILD_ID =
  typeof __BUILD_ID__ !== 'undefined' ? __BUILD_ID__ : null;

const POLL_INTERVAL_MS = 5 * 60 * 1000;
const VERSION_URL = `${import.meta.env.BASE_URL || '/'}version.json`;

import { dataUrl } from './utils/data-url.js';
import { getDataSignature } from './manifest.js';

/** Starts the new-build / new-data poll. */
export function startUpdateNotifier() {
  // No id means a dev server (no build), where version.json isn't emitted and
  // there's nothing to update to — so don't poll.
  if (!CURRENT_BUILD_ID) return;

  // Keyed by WHAT was notified (deployed buildId|signature), not a boolean:
  // a dismissed banner used to disable notification for the tab's lifetime,
  // so a SECOND, later deploy could never re-notify — the tab silently ran
  // two-deploys-stale code, the exact failure this module exists to prevent.
  // Re-notifying about the same deploy after dismissal stays suppressed.
  let notifiedKey = null;
  // The data signature this page LOADED (whatever the CDN handed it at
  // startup). A deploy can refresh the bundle while the manifest lags in the
  // CDN cache — or ship new DATA under an unchanged bundle — so the bundle id
  // alone misses data-only staleness.
  const loadedSignature = getDataSignature();

  const check = async () => {
    try {
      const response = await fetch(VERSION_URL, { cache: 'no-store' });
      if (!response.ok) return;
      const { buildId } = await response.json();
      if (buildId && buildId !== CURRENT_BUILD_ID) {
        if (notifiedKey !== `build:${buildId}`) {
          notifiedKey = `build:${buildId}`;
          showUpdateBanner();
        }
        return;
      }
      const deployed = await fetch(dataUrl('manifest.json'), {
        cache: 'no-store',
      });
      if (!deployed.ok) return;
      const deployedSignature = (await deployed.json())?.dataSignature;
      const running = await loadedSignature;
      if (
        deployedSignature &&
        running !== 'unversioned' &&
        deployedSignature !== running &&
        notifiedKey !== `data:${deployedSignature}`
      ) {
        notifiedKey = `data:${deployedSignature}`;
        showUpdateBanner();
      }
    } catch {
      // Offline, dev (404), or transient — just try again next tick.
    }
  };

  const timer = setInterval(check, POLL_INTERVAL_MS);
  // Re-check when the user returns to the tab: deploys often land while it's
  // backgrounded, and this catches them without waiting out the interval.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') check();
  });
  // A first check shortly after load, so a tab opened just before a deploy
  // still learns about it without a full interval's wait.
  setTimeout(check, 15 * 1000);
}

function showUpdateBanner() {
  if (document.getElementById('update-banner')) return;

  const banner = document.createElement('div');
  banner.id = 'update-banner';
  banner.setAttribute('role', 'status');
  banner.style.cssText = [
    'position:fixed',
    'right:16px',
    'bottom:16px',
    'z-index:9999',
    'max-width:320px',
    'display:flex',
    'align-items:center',
    'gap:12px',
    'padding:12px 14px',
    'border:1px solid var(--hairline)',
    'border-radius:var(--radius)',
    'background:var(--bg-surface)',
    'color:var(--text)',
    'font:14px/1.35 system-ui, sans-serif',
  ].join(';');

  const text = document.createElement('span');
  text.textContent = 'A new version is available.';
  text.style.flex = '1';

  const reload = document.createElement('button');
  reload.type = 'button';
  reload.textContent = 'Reload';
  reload.style.cssText = [
    'flex:none',
    'padding:6px 12px',
    'border:1px solid var(--hairline)',
    'border-radius:var(--radius)',
    'background:var(--bg-base)',
    'color:var(--text)',
    'font:inherit',
    'font-weight:600',
    'cursor:pointer',
  ].join(';');
  reload.addEventListener('click', () => window.location.reload());

  const dismiss = document.createElement('button');
  dismiss.type = 'button';
  dismiss.textContent = '×';
  dismiss.setAttribute('aria-label', 'Dismiss');
  dismiss.style.cssText = [
    'flex:none',
    'padding:0 4px',
    'border:0',
    'background:transparent',
    'color:var(--text-muted)',
    'font:20px/1 system-ui, sans-serif',
    'cursor:pointer',
  ].join(';');
  dismiss.addEventListener('click', () => banner.remove());

  banner.append(text, reload, dismiss);
  document.body.appendChild(banner);
}
