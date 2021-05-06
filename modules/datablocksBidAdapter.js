import { registerBidder } from '../src/adapters/bidderFactory.js';
import { config } from '../src/config.js';
import * as utils from '../src/utils.js';
import { BANNER, NATIVE } from '../src/mediaTypes.js';
import { getStorageManager } from '../src/storageManager.js';
import { ajax } from '../src/ajax.js';
export const storage = getStorageManager();

const NATIVE_ID_MAP = {};
const NATIVE_PARAMS = {
  title: {
    id: 1,
    name: 'title'
  },
  icon: {
    id: 2,
    type: 1,
    name: 'img'
  },
  image: {
    id: 3,
    type: 3,
    name: 'img'
  },
  body: {
    id: 4,
    name: 'data',
    type: 2
  },
  sponsoredBy: {
    id: 5,
    name: 'data',
    type: 1
  },
  cta: {
    id: 6,
    type: 12,
    name: 'data'
  },
  body2: {
    id: 7,
    name: 'data',
    type: 10
  },
  rating: {
    id: 8,
    name: 'data',
    type: 3
  },
  likes: {
    id: 9,
    name: 'data',
    type: 4
  },
  downloads: {
    id: 10,
    name: 'data',
    type: 5
  },
  displayUrl: {
    id: 11,
    name: 'data',
    type: 11
  },
  price: {
    id: 12,
    name: 'data',
    type: 6
  },
  salePrice: {
    id: 13,
    name: 'data',
    type: 7
  },
  address: {
    id: 14,
    name: 'data',
    type: 9
  },
  phone: {
    id: 15,
    name: 'data',
    type: 8
  }
};

Object.keys(NATIVE_PARAMS).forEach((key) => {
  NATIVE_ID_MAP[NATIVE_PARAMS[key].id] = key;
});

// DEFINE THE PREBID BIDDER SPEC
export const spec = {
  supportedMediaTypes: [BANNER, NATIVE],
  code: 'datablocks',

  // DATABLOCKS SCOPED OBJECT
  db_obj: {metrics_host: 'prebid.datablocks.net', metrics: [], metrics_timer: null, metrics_queue_time: 1000, vis_optout: false, source_id: 0},

  // STORE THE DATABLOCKS BUYERID IN STORAGE
  store_dbid: function(dbid) {
    let stored = false;

    // CREATE 1 YEAR EXPIRY DATE
    let d = new Date();
    d.setTime(Date.now() + (365 * 24 * 60 * 60 * 1000));

    // TRY TO STORE IN COOKIE
    if (storage.cookiesAreEnabled) {
      storage.setCookie('_db_dbid', dbid, d.toUTCString(), 'None', null);
      stored = true;
    }

    // TRY TO STORE IN LOCAL STORAGE
    if (storage.localStorageIsEnabled) {
      storage.setDataInLocalStorage('_db_dbid', dbid);
      stored = true;
    }

    return stored;
  },

  // FETCH DATABLOCKS BUYERID FROM STORAGE
  get_dbid: function() {
    let dbId = '';
    if (storage.cookiesAreEnabled) {
      dbId = storage.getCookie('_db_dbid') || '';
    }

    if (!dbId && storage.localStorageIsEnabled) {
      dbId = storage.getDataFromLocalStorage('_db_dbid') || '';
    }
    return dbId;
  },

  // STORE SYNCS IN STORAGE
  store_syncs: function(syncs) {
    if (storage.localStorageIsEnabled) {
      let syncObj = {};
      syncs.forEach(sync => {
        syncObj[sync.id] = sync.uid;
      });

      // FETCH EXISTING SYNCS AND MERGE NEW INTO STORAGE
      let storedSyncs = this.get_syncs();
      storage.setDataInLocalStorage('_db_syncs', JSON.stringify(Object.assign(storedSyncs, syncObj)));

      return true;
    }
  },

  // GET SYNCS FROM STORAGE
  get_syncs: function() {
    if (storage.localStorageIsEnabled) {
      let syncData = storage.getDataFromLocalStorage('_db_syncs');
      if (syncData) {
        return JSON.parse(syncData);
      } else {
        return {};
      }
    } else {
      return {};
    }
  },

  // ADD METRIC DATA TO THE METRICS RESPONSE QUEUE
  queue_metric: function(metric) {
    if (typeof metric === 'object') {
      // PUT METRICS IN THE QUEUE
      this.db_obj.metrics.push(metric);

      // RESET PREVIOUS TIMER
      if (this.db_obj.metrics_timer) {
        clearTimeout(this.db_obj.metrics_timer);
      }

      // SETUP THE TIMER TO FIRE BACK THE DATA
      let scope = this;
      this.db_obj.metrics_timer = setTimeout(function() {
        scope.send_metrics();
      }, this.db_obj.metrics_queue_time);

      return true;
    } else {
      return false;
    }
  },

  // POST CONSOLIDATED METRICS BACK TO SERVER
  send_metrics: function() {
    // POST TO SERVER
    ajax(`https://${this.db_obj.metrics_host}/a/pb/`, null, JSON.stringify(this.db_obj.metrics), {method: 'POST', withCredentials: true});

    // RESET THE QUEUE OF METRIC DATA
    this.db_obj.metrics = [];

    return true;
  },

  // GET BASIC CLIENT INFORMATION
  get_client_info: function () {
    let botTest = new BotClientTests();
    let win = utils.getWindowTop();
    return {
      'wiw': win.innerWidth,
      'wih': win.innerHeight,
      'saw': screen ? screen.availWidth : null,
      'sah': screen ? screen.availHeight : null,
      'scd': screen ? screen.colorDepth : null,
      'sw': screen ? screen.width : null,
      'sh': screen ? screen.height : null,
      'whl': win.history.length,
      'wxo': win.pageXOffset,
      'wyo': win.pageYOffset,
      'wpr': win.devicePixelRatio,
      'is_bot': botTest.doTests(),
      'is_hid': win.document.hidden,
      'vs': win.document.visibilityState
    };
  },

  // LISTEN FOR GPT VIEWABILITY EVENTS
  get_viewability: function(bid) {
    // ONLY RUN ONCE IF PUBLISHER HAS OPTED IN
    if (!this.db_obj.vis_optout && !this.db_obj.vis_run) {
      this.db_obj.vis_run = true;

      // ADD GPT EVENT LISTENERS
      let scope = this;
      if (utils.isGptPubadsDefined()) {
        if (typeof window['googletag'].pubads().addEventListener == 'function') {
          window['googletag'].pubads().addEventListener('impressionViewable', function(event) {
            scope.queue_metric({type: 'slot_view', source_id: scope.db_obj.source_id, auction_id: bid.auctionId, div_id: event.slot.getSlotElementId(), slot_id: event.slot.getSlotId().getAdUnitPath()});
          });
          window['googletag'].pubads().addEventListener('slotRenderEnded', function(event) {
            scope.queue_metric({type: 'slot_render', source_id: scope.db_obj.source_id, auction_id: bid.auctionId, div_id: event.slot.getSlotElementId(), slot_id: event.slot.getSlotId().getAdUnitPath()});
          })
        }
      }
    }
  },

  // VALIDATE THE BID REQUEST
  isBidRequestValid: function(bid) {
    // SET GLOBAL VARS FROM BIDDER CONFIG
    this.db_obj.source_id = bid.params.source_id;
    if (bid.params.vis_optout) {
      this.db_obj.vis_optout = true;
    }

    return !!(bid.params.source_id && bid.mediaTypes && (bid.mediaTypes.banner || bid.mediaTypes.native));
  },

  // GENERATE THE RTB REQUEST
  buildRequests: function(validRequests, bidderRequest) {
    // RETURN EMPTY IF THERE ARE NO VALID REQUESTS
    if (!validRequests.length) {
      return [];
    }

    // CONVERT PREBID NATIVE REQUEST OBJ INTO RTB OBJ
    function createNativeRequest(bid) {
      const assets = [];
      if (bid.nativeParams) {
        Object.keys(bid.nativeParams).forEach((key) => {
          if (NATIVE_PARAMS[key]) {
            const {name, type, id} = NATIVE_PARAMS[key];
            const assetObj = type ? {type} : {};
            let {len, sizes, required, aspect_ratios: aRatios} = bid.nativeParams[key];
            if (len) {
              assetObj.len = len;
            }
            if (aRatios && aRatios[0]) {
              aRatios = aRatios[0];
              let wmin = aRatios.min_width || 0;
              let hmin = aRatios.ratio_height * wmin / aRatios.ratio_width | 0;
              assetObj.wmin = wmin;
              assetObj.hmin = hmin;
            }
            if (sizes && sizes.length) {
              sizes = [].concat(...sizes);
              assetObj.w = sizes[0];
              assetObj.h = sizes[1];
            }
            const asset = {required: required ? 1 : 0, id};
            asset[name] = assetObj;
            assets.push(asset);
          }
        });
      }
      return {
        ver: '1.2',
        request: {
          assets: assets,
          context: 1,
          plcmttype: 1,
          ver: '1.2'
        }
      }
    }
    let imps = [];
    // ITERATE THE VALID REQUESTS AND GENERATE IMP OBJECT
    validRequests.forEach(bidRequest => {
      // BUILD THE IMP OBJECT
      let imp = {
        id: bidRequest.bidId,
        tagid: bidRequest.params.tagid || bidRequest.adUnitCode,
        placement_id: bidRequest.params.placement_id || 0,
        secure: window.location.protocol == 'https:',
        insights: utils.deepAccess(bidRequest, `ortb2Imp.ext.data.datablocks`) || {},
        floor: {}
      }

      // CHECK FOR FLOORS
      if (typeof bidRequest.getFloor === 'function') {
        imp.floor = bidRequest.getFloor({
          currency: 'USD',
          mediaType: '*',
          size: '*'
        });
      }

      // BUILD THE SIZES
      if (utils.deepAccess(bidRequest, `mediaTypes.banner`)) {
        let sizes = utils.getAdUnitSizes(bidRequest);
        if (sizes.length) {
          imp.banner = {
            w: sizes[0][0],
            h: sizes[0][1],
            format: sizes.map(size => ({ w: size[0], h: size[1] }))
          };

          // ADD TO THE LIST OF IMP REQUESTS
          imps.push(imp);
        }
      } else if (utils.deepAccess(bidRequest, `mediaTypes.native`)) {
        // ADD TO THE LIST OF IMP REQUESTS
        imp.native = createNativeRequest(bidRequest);
        imps.push(imp);
      }
    });

    // RETURN EMPTY IF THERE WERE NO PROPER ADUNIT REQUESTS TO BE MADE
    if (!imps.length) {
      return [];
    }

    // GENERATE SITE OBJECT
    let site = {
      domain: window.location.host,
      page: bidderRequest.refererInfo.referer,
      schain: validRequests[0].schain || {},
      ext: {
        p_domain: config.getConfig('publisherDomain'),
        rt: bidderRequest.refererInfo.reachedTop,
        frames: bidderRequest.refererInfo.numIframes,
        stack: bidderRequest.refererInfo.stack,
        timeout: config.getConfig('bidderTimeout')
      },
    }

    // ADD REF URL IF FOUND
    if (self === top && document.referrer) {
      site.ref = document.referrer;
    }

    // ADD META KEYWORDS IF FOUND
    let keywords = document.getElementsByTagName('meta')['keywords'];
    if (keywords && keywords.content) {
      site.keywords = keywords.content;
    }

    // GENERATE DEVICE OBJECT
    let device = {
      ip: 'peer',
      ua: window.navigator.userAgent,
      js: 1,
      language: ((navigator.language || navigator.userLanguage || '').split('-'))[0] || 'en',
      buyerid: this.get_dbid() || 0,
      ext: {
        pb_eids: validRequests[0].userIdAsEids || {},
        syncs: this.get_syncs() || {},
        coppa: config.getConfig('coppa') || 0,
        gdpr: bidderRequest.gdprConsent || {},
        usp: bidderRequest.uspConsent || {},
        client_info: this.get_client_info(),
        ortb2: config.getConfig('ortb2') || {}
      }
    };

    let sourceId = validRequests[0].params.source_id || 0;
    let host = validRequests[0].params.host || 'prebid.datablocks.net';

    // RETURN WITH THE REQUEST AND PAYLOAD
    return {
      method: 'POST',
      url: `https://${sourceId}.${host}/openrtb/?sid=${sourceId}`,
      data: {
        id: bidderRequest.auctionId,
        imp: imps,
        site: site,
        device: device
      },
      options: {
        withCredentials: true
      }
    };
  },

  // INITIATE USER SYNCING
  getUserSyncs: function(options, rtbResponse, gdprConsent) {
    const syncs = [];
    let bidResponse = rtbResponse[0].body;
    let scope = this;

    // LISTEN FOR SYNC DATA FROM IFRAME TYPE SYNC
    window.addEventListener('message', function (event) {
      if (event.data.sentinel && event.data.sentinel === 'dblks_syncData') {
        // STORE FOUND SYNCS
        if (event.data.syncs) {
          scope.store_syncs(event.data.syncs);
        }
      }
    });

    // POPULATE GDPR INFORMATION
    let gdprData = {
      gdpr: 0,
      gdprConsent: ''
    }
    if (typeof gdprConsent === 'object') {
      if (typeof gdprConsent.gdprApplies === 'boolean') {
        gdprData.gdpr = Number(gdprConsent.gdprApplies);
        gdprData.gdprConsent = gdprConsent.consentString;
      } else {
        gdprData.gdprConsent = gdprConsent.consentString;
      }
    }

    // EXTRACT BUYERID COOKIE VALUE FROM BID RESPONSE AND PUT INTO STORAGE
    let dbBuyerId = this.get_dbid() || '';
    if (bidResponse.ext && bidResponse.ext.buyerid) {
      dbBuyerId = bidResponse.ext.buyerid;
      this.store_dbid(dbBuyerId);
    }

    // EXTRACT USERSYNCS FROM BID RESPONSE
    if (bidResponse.ext && bidResponse.ext.syncs) {
      bidResponse.ext.syncs.forEach(sync => {
        if (checkValid(sync)) {
          syncs.push(addParams(sync));
        }
      })
    }

    // APPEND PARAMS TO SYNC URL
    function addParams(sync) {
      // PARSE THE URL
      let url = new URL(sync.url);
      let urlParams = Object.assign({}, Object.fromEntries(url.searchParams));

      // APPLY EXTRA VARS
      urlParams.gdpr = gdprData.gdpr;
      urlParams.gdprConsent = gdprData.gdprConsent;
      urlParams.bidid = bidResponse.bidid;
      urlParams.id = bidResponse.id;
      urlParams.uid = dbBuyerId;

      // REBUILD URL
      sync.url = `${url.origin}${url.pathname}?${Object.keys(urlParams).map(key => key + '=' + encodeURIComponent(urlParams[key])).join('&')}`;

      // RETURN THE REBUILT URL
      return sync;
    }

    // ENSURE THAT THE SYNC TYPE IS VALID AND HAS PERMISSION
    function checkValid(sync) {
      if (!sync.type || !sync.url) {
        return false;
      }
      switch (sync.type) {
        case 'iframe':
          return options.iframeEnabled;
        case 'image':
          return options.pixelEnabled;
        default:
          return false;
      }
    }
    return syncs;
  },

  // DATABLOCKS WON THE AUCTION - REPORT SUCCESS
  onBidWon: function(bid) {
    this.queue_metric({type: 'bid_won', source_id: bid.params[0].source_id, req_id: bid.requestId, slot_id: bid.adUnitCode, auction_id: bid.auctionId, size: bid.size, cpm: bid.cpm, pb: bid.adserverTargeting.hb_pb, rt: bid.timeToRespond, ttl: bid.ttl});
  },

  // TARGETING HAS BEEN SET
  onSetTargeting: function(bid) {
    // LISTEN FOR VIEWABILITY EVENTS
    this.get_viewability(bid);
  },

  // PARSE THE RTB RESPONSE AND RETURN FINAL RESULTS
  interpretResponse: function(rtbResponse, bidRequest) {
    // CONVERT NATIVE RTB RESPONSE INTO PREBID RESPONSE
    function parseNative(native) {
      const {assets, link, imptrackers, jstracker} = native;
      const result = {
        clickUrl: link.url,
        clickTrackers: link.clicktrackers || [],
        impressionTrackers: imptrackers || [],
        javascriptTrackers: jstracker ? [jstracker] : []
      };

      (assets || []).forEach((asset) => {
        const {id, img, data, title} = asset;
        const key = NATIVE_ID_MAP[id];
        if (key) {
          if (!utils.isEmpty(title)) {
            result.title = title.text
          } else if (!utils.isEmpty(img)) {
            result[key] = {
              url: img.url,
              height: img.h,
              width: img.w
            }
          } else if (!utils.isEmpty(data)) {
            result[key] = data.value;
          }
        }
      });

      return result;
    }

    let bids = [];
    let resBids = utils.deepAccess(rtbResponse, 'body.seatbid') || [];
    resBids.forEach(bid => {
      let resultItem = {requestId: bid.id, cpm: bid.price, creativeId: bid.crid, currency: bid.currency || 'USD', netRevenue: true, ttl: bid.ttl || 360};

      let mediaType = utils.deepAccess(bid, 'ext.mtype') || '';
      switch (mediaType) {
        case 'banner':
          bids.push(Object.assign({}, resultItem, {mediaType: BANNER, width: bid.w, height: bid.h, ad: bid.adm}));
          break;

        case 'native':
          let nativeResult = JSON.parse(bid.adm);
          bids.push(Object.assign({}, resultItem, {mediaType: NATIVE, native: parseNative(nativeResult.native)}));
          break;

        default:
          break;
      }
    })

    return bids;
  }
};

// DETECT BOTS
export class BotClientTests {
  constructor() {
    this.tests = {
      headless_chrome: function() {
        if (self.navigator) {
          if (self.navigator.webdriver) {
            return true;
          }
        }

        return false;
      },
      user_agent: function() {
        try {
          var re = new RegExp('(googlebot\/|bot|Googlebot-Mobile|Googlebot-Image|Google favicon|Mediapartners-Google|bingbot|slurp|java|wget|curl|Commons-HttpClient|Python-urllib|libwww|httpunit|nutch|phpcrawl|msnbot|jyxobot|FAST-WebCrawler|FAST Enterprise Crawler|biglotron|teoma|convera|seekbot|gigablast|exabot|ngbot|ia_archiver|GingerCrawler|webmon |httrack|webcrawler|grub.org|UsineNouvelleCrawler|antibot|netresearchserver|speedy|fluffy|bibnum.bnf|findlink|msrbot|panscient|yacybot|AISearchBot|IOI|ips-agent|tagoobot|MJ12bot|dotbot|woriobot|yanga|buzzbot|mlbot|yandexbot|purebot|Linguee Bot|Voyager|CyberPatrol|voilabot|baiduspider|citeseerxbot|spbot|twengabot|postrank|turnitinbot|scribdbot|page2rss|sitebot|linkdex|Adidxbot|blekkobot|ezooms|dotbot|Mail.RU_Bot|discobot|heritrix|findthatfile|europarchive.org|NerdByNature.Bot|sistrix crawler|ahrefsbot|Aboundex|domaincrawler|wbsearchbot|summify|ccbot|edisterbot|seznambot|ec2linkfinder|gslfbot|aihitbot|intelium_bot|facebookexternalhit|yeti|RetrevoPageAnalyzer|lb-spider|sogou|lssbot|careerbot|wotbox|wocbot|ichiro|DuckDuckBot|lssrocketcrawler|drupact|webcompanycrawler|acoonbot|openindexspider|gnam gnam spider|web-archive-net.com.bot|backlinkcrawler|coccoc|integromedb|content crawler spider|toplistbot|seokicks-robot|it2media-domain-crawler|ip-web-crawler.com|siteexplorer.info|elisabot|proximic|changedetection|blexbot|arabot|WeSEE:Search|niki-bot|CrystalSemanticsBot|rogerbot|360Spider|psbot|InterfaxScanBot|Lipperhey SEO Service|CC Metadata Scaper|g00g1e.net|GrapeshotCrawler|urlappendbot|brainobot|fr-crawler|binlar|SimpleCrawler|Livelapbot|Twitterbot|cXensebot|smtbot|bnf.fr_bot|A6-Indexer|ADmantX|Facebot|Twitterbot|OrangeBot|memorybot|AdvBot|MegaIndex|SemanticScholarBot|ltx71|nerdybot|xovibot|BUbiNG|Qwantify|archive.org_bot|Applebot|TweetmemeBot|crawler4j|findxbot|SemrushBot|yoozBot|lipperhey|y!j-asr|Domain Re-Animator Bot|AddThis)', 'i');
          if (re.test(navigator.userAgent)) {
            return true;
          }
          return false;
        } catch (e) {
          return false;
        }
      },

      selenium: function () {
        let response = false;

        if (window && document) {
          let results = [
            'webdriver' in window,
            '_Selenium_IDE_Recorder' in window,
            'callSelenium' in window,
            '_selenium' in window,
            '__webdriver_script_fn' in document,
            '__driver_evaluate' in document,
            '__webdriver_evaluate' in document,
            '__selenium_evaluate' in document,
            '__fxdriver_evaluate' in document,
            '__driver_unwrapped' in document,
            '__webdriver_unwrapped' in document,
            '__selenium_unwrapped' in document,
            '__fxdriver_unwrapped' in document,
            '__webdriver_script_func' in document,
            document.documentElement.getAttribute('selenium') !== null,
            document.documentElement.getAttribute('webdriver') !== null,
            document.documentElement.getAttribute('driver') !== null
          ];

          results.forEach(result => {
            if (result === true) {
              response = true;
            }
          })
        }

        return response;
      },
    }
  }

  doTests() {
    let response = false;
    for (const [, t] of Object.entries(this.tests)) {
      if (t() === true) {
        response = true;
      }
    }
    return response;
  }
}

// INIT OUR BIDDER WITH PREBID
registerBidder(spec);
