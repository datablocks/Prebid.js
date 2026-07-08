import { registerBidder } from '../src/adapters/bidderFactory.js';
import { BANNER, VIDEO, NATIVE } from '../src/mediaTypes.js';
import { ortbConverter } from '../libraries/ortbConverter/converter.js';
import { deepAccess, generateUUID, mergeDeep } from '../src/utils.js';
import { getStorageManager } from '../src/storageManager.js';
import { isSeleniumDetected } from '../libraries/webdriver/webdriver.js';
import { getDevicePixelRatio } from '../libraries/devicePixelRatio/devicePixelRatio.js';
import { getTimeZone } from '../libraries/timezone/timezone.js';
import { isMobile, isConnectedTV } from '../libraries/advangUtils/index.js';
import { isFingerprintingApiDisabled } from '../libraries/fingerprinting/fingerprinting.js';
import { getAdUnitElement } from '../src/utils/adUnits.js';
import { getBoundingClientRect } from '../libraries/boundingClientRect/boundingClientRect.js';

const BIDDER_CODE = 'dblks';
// Page-level override for dev/tunnel testing: set window.DBLKS_ENDPOINT
// before Prebid loads to point the adapter at a non-localhost bidder.
const ENDPOINT_URL = (typeof window !== 'undefined' && window.DBLKS_ENDPOINT) ||
  'http://localhost:3000/openrtb2/auction';
// Same override pattern for the user-sync orchestrator (dev tunnels mint a
// new hostname per session; production is the sync service's public host).
const SYNC_URL = (typeof window !== 'undefined' && window.DBLKS_SYNC_ENDPOINT) ||
  'https://sync.dblks.net/usersync';
const TTL = 300;
const STORAGE_KEY = '_dblks_s';
const SESSION_TIMEOUT_MS = 30 * 60 * 1000;

// Maps Network Information API effectiveType to OpenRTB connectiontype integers.
const CONNECTION_TYPE = { 'slow-2g': 4, '2g': 4, '3g': 5, '4g': 6 };

const storage = getStorageManager({ bidderCode: BIDDER_CODE });

// ─── Session tracking ─────────────────────────────────────────────────────────

function getSessionData() {
  if (!storage.localStorageIsEnabled()) return {};

  const now = Date.now();
  let rec = {};
  try { rec = JSON.parse(storage.getDataFromLocalStorage(STORAGE_KEY)) || {}; } catch (_) {}

  const elapsed = now - (rec.pst || 0);
  const newSession = !rec.sid || elapsed > SESSION_TIMEOUT_MS;

  const updated = {
    uid: rec.uid || generateUUID(),
    sid: newSession ? generateUUID() : rec.sid,
    sst: newSession ? now : rec.sst,
    pst: now,
    purl: window.location.href,
    pct: newSession ? 1 : (rec.pct || 0) + 1,
  };

  try { storage.setDataInLocalStorage(STORAGE_KEY, JSON.stringify(updated)); } catch (_) {}

  return {
    uid: updated.uid,
    sid: updated.sid,
    pct: updated.pct,
    sage: now - updated.sst,
    tbp: newSession ? null : elapsed,
    purl: rec.purl || null,
  };
}

// ─── Page context ─────────────────────────────────────────────────────────────

function getPageContext() {
  const ctx = {};

  // Page visibility — is the tab active?
  try { ctx.vis = window.top.document.visibilityState; } catch (_) { ctx.vis = document.visibilityState; }

  // Scroll depth — pixels from top of page (proxy for ad position relative to fold).
  try { ctx.scroll = window.top.pageYOffset; } catch (_) { ctx.scroll = window.pageYOffset; }

  // Page performance — only available after the load event has fired.
  try {
    const t = window.performance?.timing;
    if (t?.loadEventEnd > 0) {
      ctx.plt = t.loadEventEnd - t.navigationStart; // total page load time
      ctx.ct = t.responseEnd - t.requestStart;      // server connect/response time
      ctx.rt = t.domComplete - t.domLoading;        // DOM render time
    }
  } catch (_) {}

  return ctx;
}

// ─── Device context ───────────────────────────────────────────────────────────

function getDeviceContext() {
  const ctx = {};

  // Device type — standard OpenRTB field (1=mobile/tablet, 2=PC, 3=CTV).
  ctx.devicetype = isMobile() ? 1 : isConnectedTV() ? 3 : 2;

  // Pixel ratio — standard OpenRTB field; identifies retina/HiDPI screens.
  ctx.pxratio = isFingerprintingApiDisabled('devicepixelratio') ? 'disabled' : getDevicePixelRatio(window);

  // Network conditions.
  const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  if (conn) {
    ctx.connectiontype = CONNECTION_TYPE[conn.effectiveType] ?? 0;
    if (conn.downlink != null) ctx.downlink = conn.downlink;
  }

  // Touch points — more reliable than UA for detecting touchscreen devices.
  if (navigator.maxTouchPoints != null) ctx.mtp = navigator.maxTouchPoints;

  // Time zone — geo inference fallback.
  ctx.tz = isFingerprintingApiDisabled('resolvedoptions') ? 'disabled' : (getTimeZone() || undefined);

  // All browser language preferences — more complete than device.language.
  const langs = navigator.languages;
  if (langs?.length) ctx.langb = langs.join(',');

  // Cookie support — addressability signal.
  ctx.cookies = navigator.cookieEnabled ? 1 : 0;

  // Bot / automation detection.
  ctx.is_bot = isFingerprintingApiDisabled('webdriver') ? 'disabled' : (isSeleniumDetected() ? 1 : 0);

  // Device capability signals.
  if (navigator.hardwareConcurrency) ctx.cpu = navigator.hardwareConcurrency;
  if (navigator.deviceMemory) ctx.ram = navigator.deviceMemory;

  return ctx;
}

// ─── ortbConverter ────────────────────────────────────────────────────────────

// Bounding box of the ad unit's DOM element, measured once per bid request
// during buildRequests (getBoundingClientRect is the per-auction cached
// wrapper). Coordinates start viewport-relative in the element's own window
// and are converted to page-absolute by walking window.frameElement upward
// through friendly iframes, adding each containing iframe's rect plus the
// parent window's scroll offsets. `frame` reports the reference frame:
// 'top' when the walk reached the real top window (page-absolute), 'iframe'
// when a cross-origin boundary stopped it (relative to the deepest
// measurable frame). Returns null — omit from the payload — when the
// element is missing or unrendered (all-zero rect).
function getAdUnitCoords(bidRequest) {
  try {
    const element = getAdUnitElement(bidRequest);
    if (!element) {
      return null;
    }
    const rect = getBoundingClientRect(element);
    if (!rect || (rect.top === 0 && rect.left === 0 && rect.width === 0 && rect.height === 0)) {
      return null;
    }
    let win = element.ownerDocument.defaultView;
    let top = rect.top + win.pageYOffset;
    let left = rect.left + win.pageXOffset;
    let frame = 'iframe';
    try {
      let frameElement = win.frameElement;
      while (frameElement != null) {
        const frameRect = getBoundingClientRect(frameElement);
        win = win.parent;
        top += frameRect.top + win.pageYOffset;
        left += frameRect.left + win.pageXOffset;
        frameElement = win.frameElement;
      }
      // frameElement is null both at the real top AND inside a cross-origin
      // iframe; only the former makes the coordinates page-absolute.
      if (win === win.top) {
        frame = 'top';
      }
    } catch (e) {
      // Cross-origin access threw mid-walk: keep what was accumulated,
      // relative to the deepest frame reached.
      frame = 'iframe';
    }
    return {
      top: Math.round(top),
      left: Math.round(left),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      frame,
    };
  } catch (e) {
    return null;
  }
}

const converter = ortbConverter({
  context: {
    netRevenue: true,
    ttl: TTL,
    nativeRequest: {
      eventtrackers: [
        { event: 1, methods: [1, 2] }, // impression — image + js
        { event: 2, methods: [1] },    // viewable MRC50 — image
      ]
    }
  },

  imp(buildImp, bidRequest, context) {
    const imp = buildImp(bidRequest, context);
    imp.tagid = bidRequest.adUnitCode;
    if (!imp.ext?.gpid) {
      imp.ext = imp.ext || {};
      imp.ext.gpid = deepAccess(bidRequest, 'ortb2Imp.ext.data.pbadslot') || bidRequest.adUnitCode;
    }
    const coords = getAdUnitCoords(bidRequest);
    if (coords) {
      imp.ext = imp.ext || {};
      imp.ext.dblks = { coords };
    }
    return imp;
  },

  request(buildRequest, imps, bidderRequest, context) {
    const req = buildRequest(imps, bidderRequest, context);
    const page = getPageContext();
    const device = getDeviceContext();
    const session = getSessionData();

    // Everything dblks-specific rides under a "dblks" key on the relevant
    // ext object, so the server can consume and strip it wholesale before
    // fanning out to exchanges. Spec-level fields (devicetype, langb,
    // numeric pxratio, connectiontype) stay at their OpenRTB positions.
    mergeDeep(req, {
      at: 1,
      ext: {
        dblks: {
          // '$prebid.version$' is substituted with the real version at build time.
          ver: '$prebid.version$',
        }
      },
      site: {
        ext: {
          dblks: {
            vis: page.vis,
            scroll: page.scroll,
            ...(page.plt != null && { plt: page.plt, ct: page.ct, rt: page.rt }),
            ...(session.sid && {
              uid: session.uid,
              sid: session.sid,
              pct: session.pct,
              sage: session.sage,
              ...(session.tbp != null && { tbp: session.tbp }),
              ...(session.purl && { purl: session.purl }),
            }),
          }
        }
      },
      device: {
        devicetype: device.devicetype,
        ...(device.langb && { langb: device.langb }),
        ...(typeof device.pxratio === 'number' && { pxratio: device.pxratio }),
        ...(device.connectiontype != null && { connectiontype: device.connectiontype }),
        ext: {
          dblks: {
            is_bot: device.is_bot,
            cookies: device.cookies,
            ...(typeof device.pxratio === 'string' && { pxratio: device.pxratio }),
            ...(device.mtp != null && { mtp: device.mtp }),
            ...(device.tz != null && { tz: device.tz }),
            ...(device.downlink != null && { downlink: device.downlink }),
            ...(device.cpu && { cpu: device.cpu }),
            ...(device.ram && { ram: device.ram }),
          }
        },
      },
    });

    return req;
  },

  bidResponse(buildBidResponse, bid, context) {
    const bidResponse = buildBidResponse(bid, context);

    // Propagate advertiser domains for brand-safety filtering.
    if (bid.adomain?.length) {
      bidResponse.meta = bidResponse.meta ?? {};
      bidResponse.meta.advertiserDomains = bid.adomain;
    }

    return bidResponse;
  }
});

// ─── Spec ─────────────────────────────────────────────────────────────────────

export const spec = {
  code: BIDDER_CODE,
  aliases: ['dblks2'],
  supportedMediaTypes: [BANNER, VIDEO, NATIVE],

  isBidRequestValid(bid) {
    // Banner needs at least one size.
    if (deepAccess(bid, 'mediaTypes.banner') &&
        !deepAccess(bid, 'mediaTypes.banner.sizes.length')) return false;

    // Video needs mimes and at least one protocol.
    if (deepAccess(bid, 'mediaTypes.video')) {
      const video = bid.mediaTypes.video;
      if (!video.mimes?.length || !video.protocols?.length) return false;
    }

    return true;
  },

  buildRequests(validBidRequests, bidderRequest) {
    const publisherId = validBidRequests[0]?.params?.publisherId;
    // '$prebid.version$' is substituted with the real version at build time.
    const url = `${ENDPOINT_URL}?` +
      (publisherId ? `publisher_id=${publisherId}&` : '') +
      'pbv=$prebid.version$';
    return [{
      method: 'POST',
      url,
      data: converter.toORTB({ bidRequests: validBidRequests, bidderRequest }),
      options: { contentType: 'text/plain' }
    }];
  },

  interpretResponse(serverResponse, request) {
    if (!serverResponse.body) return [];
    return converter.fromORTB({ request: request.data, response: serverResponse.body }).bids;
  },

  getUserSyncs(syncOptions, serverResponses, gdprConsent, uspConsent, gppConsent) {
    if (!syncOptions.pixelEnabled && !syncOptions.iframeEnabled) return [];

    const type = syncOptions.iframeEnabled ? 'iframe' : 'image';
    // type= is explicit: the orchestrator prefers it over Sec-Fetch-Dest
    // sniffing, and an <img> that receives the iframe HTML fires nothing.
    const params = [`type=${type}`];

    if (gdprConsent) {
      // Only claim applicability the CMP actually determined — absent means
      // "no CMP signal" to the sync service, while gdpr=0 asserts non-EU.
      if (typeof gdprConsent.gdprApplies === 'boolean') {
        params.push(`gdpr=${Number(gdprConsent.gdprApplies)}`);
      }
      params.push(`gdpr_consent=${encodeURIComponent(gdprConsent.consentString ?? '')}`);
    }
    if (uspConsent) {
      params.push(`us_privacy=${encodeURIComponent(uspConsent)}`);
    }
    if (gppConsent?.gppString && gppConsent?.applicableSections?.length) {
      params.push(`gpp=${encodeURIComponent(gppConsent.gppString)}`);
      params.push(`gpp_sid=${gppConsent.applicableSections.join(',')}`);
    }

    return [{ type, url: `${SYNC_URL}?${params.join('&')}` }];
  }
};

registerBidder(spec);
