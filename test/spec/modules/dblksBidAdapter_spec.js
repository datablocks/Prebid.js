import { expect } from 'chai';
import { spec } from 'modules/dblksBidAdapter.js';
import { BANNER, VIDEO, NATIVE } from 'src/mediaTypes.js';
import { newBidder } from 'src/adapters/bidderFactory.js';
import 'src/prebid.js';
import 'modules/priceFloors.js';
import 'modules/consentManagementTcf.js';
import 'modules/consentManagementUsp.js';
import { hook } from '../../../src/hook.js';
import { addFPDToBidderRequest } from '../../helpers/fpd.js';

const ENDPOINT = 'http://localhost:3000/openrtb2/auction?pbv=$prebid.version$';

function makeBannerBid(overrides = {}) {
  return {
    bidder: 'dblks',
    bidId: 'bid-banner-1',
    adUnitCode: 'banner-div',
    auctionId: 'auction-1',
    transactionId: 'txn-1',
    mediaTypes: {
      banner: { sizes: [[300, 250], [728, 90]] }
    },
    params: {},
    ...overrides
  };
}

function makeVideoBid(overrides = {}) {
  return {
    bidder: 'dblks',
    bidId: 'bid-video-1',
    adUnitCode: 'video-div',
    auctionId: 'auction-1',
    transactionId: 'txn-2',
    mediaTypes: {
      video: {
        context: 'instream',
        playerSize: [640, 480],
        mimes: ['video/mp4'],
        protocols: [2, 3],
        minduration: 5,
        maxduration: 30,
        linearity: 1
      }
    },
    params: {},
    ...overrides
  };
}

function makeNativeBid(overrides = {}) {
  return {
    bidder: 'dblks',
    bidId: 'bid-native-1',
    adUnitCode: 'native-div',
    auctionId: 'auction-1',
    transactionId: 'txn-3',
    mediaTypes: {
      native: {
        title: { required: true, len: 80 },
        image: { required: true }
      }
    },
    // Prebid core derives this from mediaTypes.native before adapters run;
    // buildRequests reads it, so the fixture must carry it too.
    nativeOrtbRequest: {
      ver: '1.2',
      assets: [
        { id: 0, required: 1, title: { len: 80 } },
        { id: 1, required: 1, img: { type: 3 } }
      ]
    },
    params: {},
    ...overrides
  };
}

function makeBidderRequest(overrides = {}) {
  return {
    bidderCode: 'dblks',
    auctionId: 'auction-1',
    bidderRequestId: 'request-1',
    timeout: 3000,
    refererInfo: {
      page: 'https://example.com/article',
      domain: 'example.com'
    },
    ...overrides
  };
}

describe('dblks Bid Adapter', function () {
  before(() => { hook.ready(); });

  const adapter = newBidder(spec);

  describe('inherited functions', function () {
    it('exists and is a function', function () {
      expect(adapter.callBids).to.be.a('function');
    });
  });

  describe('isBidRequestValid', function () {
    it('returns true for a valid banner bid', function () {
      expect(spec.isBidRequestValid(makeBannerBid())).to.be.true;
    });

    it('returns true for a valid video bid', function () {
      expect(spec.isBidRequestValid(makeVideoBid())).to.be.true;
    });

    it('returns true for a valid native bid', function () {
      expect(spec.isBidRequestValid(makeNativeBid())).to.be.true;
    });

    it('returns true with no params object', function () {
      const bid = makeBannerBid();
      delete bid.params;
      expect(spec.isBidRequestValid(bid)).to.be.true;
    });

    it('returns false for banner with no sizes', function () {
      const bid = makeBannerBid();
      bid.mediaTypes.banner.sizes = [];
      expect(spec.isBidRequestValid(bid)).to.be.false;
    });

    it('returns false for video with no mimes', function () {
      const bid = makeVideoBid();
      delete bid.mediaTypes.video.mimes;
      expect(spec.isBidRequestValid(bid)).to.be.false;
    });

    it('returns false for video with no protocols', function () {
      const bid = makeVideoBid();
      delete bid.mediaTypes.video.protocols;
      expect(spec.isBidRequestValid(bid)).to.be.false;
    });
  });

  describe('buildRequests', function () {
    let bannerRequest, videoRequest, nativeRequest, bidderRequest;

    beforeEach(function () {
      bannerRequest = makeBannerBid();
      videoRequest = makeVideoBid();
      nativeRequest = makeNativeBid();
      bidderRequest = makeBidderRequest();
    });

    it('returns a single POST request to the endpoint', function () {
      const reqs = spec.buildRequests([bannerRequest], bidderRequest);
      expect(reqs).to.have.length(1);
      expect(reqs[0].method).to.equal('POST');
      expect(reqs[0].url).to.equal(ENDPOINT);
    });

    it('prepends publisher_id to the endpoint query when params.publisherId is set', function () {
      const bid = makeBannerBid({ params: { publisherId: 1001 } });
      const reqs = spec.buildRequests([bid], bidderRequest);
      expect(reqs[0].url).to.equal(
        'http://localhost:3000/openrtb2/auction?publisher_id=1001&pbv=$prebid.version$'
      );
    });

    it('uses text/plain content type to avoid preflight', function () {
      const reqs = spec.buildRequests([bannerRequest], bidderRequest);
      expect(reqs[0].options.contentType).to.equal('text/plain');
    });

    it('sets auction type to first-price (at=1)', function () {
      const reqs = spec.buildRequests([bannerRequest], bidderRequest);
      expect(reqs[0].data.at).to.equal(1);
    });

    it('sets ext.prebid.ver to the Prebid.js version', function () {
      const reqs = spec.buildRequests([bannerRequest], bidderRequest);
      expect(reqs[0].data.ext.prebid.ver).to.equal('$prebid.version$');
    });

    it('always sets tagid to adUnitCode', function () {
      const bid = makeBannerBid({ ortb2Imp: { ext: { gpid: '/1234/homepage#banner-div' } } });
      const reqs = spec.buildRequests([bid], bidderRequest);
      expect(reqs[0].data.imp[0].tagid).to.equal('banner-div');
    });

    it('sets ext.gpid from ortb2Imp when present', function () {
      const bid = makeBannerBid({ ortb2Imp: { ext: { gpid: '/1234/homepage#banner-div' } } });
      const reqs = spec.buildRequests([bid], bidderRequest);
      expect(reqs[0].data.imp[0].ext.gpid).to.equal('/1234/homepage#banner-div');
    });

    it('falls back ext.gpid to pbadslot when gpid is absent', function () {
      const bid = makeBannerBid({ ortb2Imp: { ext: { data: { pbadslot: '/1234/homepage' } } } });
      const reqs = spec.buildRequests([bid], bidderRequest);
      expect(reqs[0].data.imp[0].ext.gpid).to.equal('/1234/homepage');
    });

    it('falls back ext.gpid to adUnitCode when both gpid and pbadslot are absent', function () {
      const reqs = spec.buildRequests([bannerRequest], bidderRequest);
      expect(reqs[0].data.imp[0].ext.gpid).to.equal('banner-div');
    });

    it('includes a banner imp', function () {
      const reqs = spec.buildRequests([bannerRequest], bidderRequest);
      expect(reqs[0].data.imp[0].banner).to.exist;
    });

    if (FEATURES.VIDEO) {
      it('includes a video imp', function () {
        const reqs = spec.buildRequests([videoRequest], bidderRequest);
        expect(reqs[0].data.imp[0].video).to.exist;
      });
    }

    if (FEATURES.NATIVE) {
      it('includes a native imp', function () {
        const reqs = spec.buildRequests([nativeRequest], bidderRequest);
        expect(reqs[0].data.imp[0].native).to.exist;
      });
    }

    it('batches multiple imps into one request', function () {
      const reqs = spec.buildRequests([bannerRequest, videoRequest, nativeRequest], bidderRequest);
      expect(reqs).to.have.length(1);
      expect(reqs[0].data.imp).to.have.length(3);
    });

    it('sets site.ext.vis to the page visibility state', function () {
      const reqs = spec.buildRequests([bannerRequest], bidderRequest);
      expect(reqs[0].data.site.ext.vis).to.equal(document.visibilityState);
    });

    it('sets site.ext.scroll to the page scroll offset', function () {
      const reqs = spec.buildRequests([bannerRequest], bidderRequest);
      expect(reqs[0].data.site.ext.scroll).to.be.a('number');
    });

    it('sets device.ext.is_bot', function () {
      const reqs = spec.buildRequests([bannerRequest], bidderRequest);
      expect(reqs[0].data.device.ext.is_bot).to.be.oneOf([0, 1]);
    });

    it('sets device.connectiontype', function () {
      const reqs = spec.buildRequests([bannerRequest], bidderRequest);
      expect(reqs[0].data.device.connectiontype).to.be.a('number');
    });

    it('passes GDPR consent into the request', async function () {
      // Consent reaches the ORTB request via the bidderRequest's ortb2
      // fragment, which core builds before adapters run — replicate that.
      const req = await addFPDToBidderRequest(makeBidderRequest({
        gdprConsent: { gdprApplies: true, consentString: 'test-consent' }
      }));
      const reqs = spec.buildRequests([bannerRequest], req);
      const ortb = reqs[0].data;
      expect(ortb.regs?.ext?.gdpr ?? ortb.regs?.gdpr).to.equal(1);
    });
  });

  describe('interpretResponse', function () {
    function makeServerResponse(bid) {
      return {
        body: {
          id: 'resp-1',
          seatbid: [{ seat: 'dblks', bid: [bid] }]
        }
      };
    }

    it('returns empty array for empty response', function () {
      const reqs = spec.buildRequests([makeBannerBid()], makeBidderRequest());
      expect(spec.interpretResponse({}, reqs[0])).to.deep.equal([]);
    });

    it('returns a banner bid response', function () {
      const reqs = spec.buildRequests([makeBannerBid()], makeBidderRequest());
      const impId = reqs[0].data.imp[0].id;
      const bids = spec.interpretResponse(makeServerResponse({
        id: 'bid-1',
        impid: impId,
        price: 1.50,
        crid: 'creative-1',
        adm: '<div>ad</div>',
        adomain: ['advertiser.com'],
        w: 300,
        h: 250,
        mtype: 1
      }), reqs[0]);
      expect(bids).to.have.length(1);
      expect(bids[0].cpm).to.equal(1.50);
      expect(bids[0].width).to.equal(300);
      expect(bids[0].height).to.equal(250);
      expect(bids[0].mediaType).to.equal(BANNER);
      expect(bids[0].meta.advertiserDomains).to.deep.equal(['advertiser.com']);
    });

    if (FEATURES.VIDEO) {
      it('returns a video bid response', function () {
        const reqs = spec.buildRequests([makeVideoBid()], makeBidderRequest());
        const impId = reqs[0].data.imp[0].id;
        const bids = spec.interpretResponse(makeServerResponse({
          id: 'bid-v1',
          impid: impId,
          price: 3.00,
          crid: 'video-creative-1',
          adm: '<VAST version="4.0"></VAST>',
          w: 640,
          h: 480,
          mtype: 2
        }), reqs[0]);
        expect(bids).to.have.length(1);
        expect(bids[0].cpm).to.equal(3.00);
        expect(bids[0].mediaType).to.equal(VIDEO);
      });
    }

    it('populates meta.advertiserDomains from adomain', function () {
      const reqs = spec.buildRequests([makeBannerBid()], makeBidderRequest());
      const impId = reqs[0].data.imp[0].id;
      const bids = spec.interpretResponse(makeServerResponse({
        id: 'bid-2',
        impid: impId,
        price: 2.00,
        crid: 'cr-2',
        adm: '<div>ad</div>',
        adomain: ['brand.com', 'agency.com'],
        w: 728,
        h: 90,
        mtype: 1
      }), reqs[0]);
      expect(bids[0].meta.advertiserDomains).to.deep.equal(['brand.com', 'agency.com']);
    });
  });

  describe('getUserSyncs', function () {
    const SYNC_URL = 'https://sync.dblks.net/usersync';

    it('returns empty array when no sync types enabled', function () {
      expect(spec.getUserSyncs({}, [], null, null, null)).to.deep.equal([]);
    });

    it('returns image pixel when pixelEnabled', function () {
      const syncs = spec.getUserSyncs({ pixelEnabled: true }, []);
      expect(syncs[0].type).to.equal('image');
      expect(syncs[0].url).to.include(SYNC_URL);
    });

    it('returns iframe when iframeEnabled', function () {
      const syncs = spec.getUserSyncs({ iframeEnabled: true }, []);
      expect(syncs[0].type).to.equal('iframe');
    });

    it('appends GDPR params', function () {
      const syncs = spec.getUserSyncs(
        { pixelEnabled: true }, [],
        { gdprApplies: true, consentString: 'abc123' }
      );
      expect(syncs[0].url).to.include('gdpr=1');
      expect(syncs[0].url).to.include('gdpr_consent=abc123');
    });

    it('appends USP param', function () {
      const syncs = spec.getUserSyncs({ pixelEnabled: true }, [], null, '1YNN');
      expect(syncs[0].url).to.include('us_privacy=1YNN');
    });

    it('appends GPP params', function () {
      const syncs = spec.getUserSyncs(
        { pixelEnabled: true }, [], null, null,
        { gppString: 'gpp-str', applicableSections: [7] }
      );
      expect(syncs[0].url).to.include('gpp=gpp-str');
      expect(syncs[0].url).to.include('gpp_sid=7');
    });
  });
});
