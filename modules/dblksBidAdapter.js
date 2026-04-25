import { registerBidder } from '../src/adapters/bidderFactory.js';
import { BANNER, VIDEO, NATIVE } from '../src/mediaTypes.js';
import { ortbConverter } from '../libraries/ortbConverter/converter.js';
import { deepAccess, mergeDeep } from '../src/utils.js';
import { isSeleniumDetected } from '../libraries/webdriver/webdriver.js';
import { getDevicePixelRatio } from '../libraries/devicePixelRatio/devicePixelRatio.js';
import { getTimeZone } from '../libraries/timezone/timezone.js';
import { isMobile, isConnectedTV } from '../libraries/advangUtils/index.js';
import { isFingerprintingApiDisabled } from '../libraries/fingerprinting/fingerprinting.js';

const BIDDER_CODE = 'dblks';
const ENDPOINT_URL = 'https://prebid.dblks.net/openrtb2/auction';
const TTL = 300;

// Maps Network Information API effectiveType to OpenRTB connectiontype integers.
const CONNECTION_TYPE = { 'slow-2g': 4, '2g': 4, '3g': 5, '4g': 6 };

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
    return imp;
  },

  request(buildRequest, imps, bidderRequest, context) {
    const req = buildRequest(imps, bidderRequest, context);
    const page = getPageContext();
    const device = getDeviceContext();

    mergeDeep(req, {
      at: 1,
      site: {
        ext: {
          vis: page.vis,
          scroll: page.scroll,
          ...(page.plt != null && { plt: page.plt, ct: page.ct, rt: page.rt }),
        }
      },
      device: {
        devicetype: device.devicetype,
        ...(device.langb && { langb: device.langb }),
        // pxratio is a standard OpenRTB float — only set it when we have a real value.
        ...(typeof device.pxratio === 'number' && { pxratio: device.pxratio }),
        ...(device.connectiontype != null && { connectiontype: device.connectiontype }),
        ext: {
          is_bot: device.is_bot,
          cookies: device.cookies,
          // When pxratio is blocked, surface the marker in ext so the server can distinguish
          // "disabled by publisher" from "device does not expose this value".
          ...(typeof device.pxratio === 'string' && { pxratio: device.pxratio }),
          ...(device.mtp != null && { mtp: device.mtp }),
          ...(device.tz != null && { tz: device.tz }),
          ...(device.downlink != null && { downlink: device.downlink }),
          ...(device.cpu && { cpu: device.cpu }),
          ...(device.ram && { ram: device.ram }),
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

export const spec = {
  code: BIDDER_CODE,
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
    return [{
      method: 'POST',
      url: ENDPOINT_URL,
      data: converter.toORTB({ bidRequests: validBidRequests, bidderRequest }),
      options: { contentType: 'text/plain' }
    }];
  },

  interpretResponse(serverResponse, request) {
    if (!serverResponse.body) return [];
    return converter.fromORTB({ request: request.data, response: serverResponse.body });
  },

  getUserSyncs(syncOptions, serverResponses, gdprConsent, uspConsent, gppConsent) {
    if (!syncOptions.pixelEnabled && !syncOptions.iframeEnabled) return [];

    const type = syncOptions.iframeEnabled ? 'iframe' : 'image';
    const params = [];

    if (gdprConsent) {
      params.push(`gdpr=${gdprConsent.gdprApplies ? 1 : 0}`);
      params.push(`gdpr_consent=${encodeURIComponent(gdprConsent.consentString ?? '')}`);
    }
    if (uspConsent) {
      params.push(`us_privacy=${encodeURIComponent(uspConsent)}`);
    }
    if (gppConsent?.gppString && gppConsent?.applicableSections?.length) {
      params.push(`gpp=${encodeURIComponent(gppConsent.gppString)}`);
      params.push(`gpp_sid=${gppConsent.applicableSections.join(',')}`);
    }

    const qs = params.length ? `?${params.join('&')}` : '';
    return [{ type, url: `https://sync.dblks.net/usersync${qs}` }];
  }
};

registerBidder(spec);
