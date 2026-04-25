# Datablocks Bid Adapter

## Overview

| Field          | Value        |
|----------------|--------------|
| Bidder Code    | `dblks`      |
| Media Types    | Banner, Video, Native |
| OpenRTB        | 2.6          |

## Parameters

| Param      | Required | Type   | Description                          |
|------------|----------|--------|--------------------------------------|
| `siteId`   | Yes      | String | Datablocks site/placement identifier |
| `bidFloor` | No       | Number | Minimum bid price (USD CPM)          |

## Ad Unit Examples

### Banner

```javascript
var adUnits = [{
  code: 'banner-div',
  mediaTypes: {
    banner: {
      sizes: [[300, 250], [728, 90], [160, 600]]
    }
  },
  bids: [{
    bidder: 'dblks',
    params: {
      siteId: 'db-acme-001',
      bidFloor: 0.30
    }
  }]
}];
```

### Video

```javascript
var adUnits = [{
  code: 'video-div',
  mediaTypes: {
    video: {
      context:        'instream',
      playerSize:     [640, 480],
      mimes:          ['video/mp4', 'video/webm'],
      protocols:      [2, 3, 5, 6],
      minduration:    5,
      maxduration:    30,
      playbackmethod: [1],
      linearity:      1
    }
  },
  bids: [{
    bidder: 'dblks',
    params: {
      siteId: 'db-acme-001v'
    }
  }]
}];
```

### Native

```javascript
var adUnits = [{
  code: 'native-div',
  mediaTypes: {
    native: {
      title:       { required: true,  len: 80 },
      image:       { required: true,  sizes: [300, 250] },
      body:        { required: false, len: 90 },
      sponsoredBy: { required: true }
    }
  },
  bids: [{
    bidder: 'dblks',
    params: {
      siteId: 'db-acme-001n'
    }
  }]
}];
```

### Multi-format

```javascript
var adUnits = [{
  code: 'multi-format-div',
  mediaTypes: {
    banner: { sizes: [[300, 250], [728, 90]] },
    video: {
      context:    'outstream',
      playerSize: [640, 480],
      mimes:      ['video/mp4'],
      protocols:  [2, 3]
    },
    native: {
      title: { required: true, len: 80 },
      image: { required: true }
    }
  },
  bids: [{
    bidder: 'dblks',
    params: { siteId: 'db-acme-001' }
  }]
}];
```
