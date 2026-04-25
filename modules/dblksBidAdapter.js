import { registerBidder } from '../src/adapters/bidderFactory.js';
import { BANNER, VIDEO, NATIVE } from '../src/mediaTypes.js';
import { ortbConverter } from '../libraries/ortbConverter/converter.js';
import { deepAccess, mergeDeep } from '../src/utils.js';

const BIDDER_CODE = 'dblks';
const ENDPOINT_URL = 'https://prebid.dblks.net/openrtb2/auction';
const TTL = 300;

const converter = ortbConverter({
  context: {
    netRevenue: true,
    ttl: TTL,
    nativeRequest: {
      eventtrackers: [
        { event: 1, methods: [1, 2] },  // impression — image + js
        { event: 2, methods: [1] },     // viewable MRC50 — image
      ]
    }
  },

  imp(buildImp, bidRequest, context) {
    const imp = buildImp(bidRequest, context);
    imp.tagid = imp.ext?.gpid || bidRequest.adUnitCode;
    if (!imp.ext?.gpid) {
      imp.ext = imp.ext || {};
      imp.ext.gpid = bidRequest.adUnitCode;
    }
    return imp;
  },

  request(buildRequest, imps, bidderRequest, context) {
    const req = buildRequest(imps, bidderRequest, context);
    mergeDeep(req, { at: 1 });  // first-price auction
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
