/* global fetch */

/**
 * window.fetchClipURL(slug[, force])
 * - slug : e.g. "AgreeableAggressiveAurochsRiPepperonis"
 * - force: true → bypass cache (use after a 401/403)
 */
(function attachFetchClipURL () {
    const TTL   = 55 * 60 * 1000;       // ~55 min – token usually good for 60
    const cache = new Map();            // slug → { url, expires }
    const inflight = new Map();         // slug → Promise to dedupe parallel calls
  
    async function fetchClipURL (slug, force = false) {
      const now = Date.now();
  
      // 1) serve from cache if still fresh
      const entry = cache.get(slug);
      if (!force && entry && entry.expires > now) return entry.url;
  
      // 2) dedupe if another caller is already fetching the same slug
      if (inflight.has(slug)) return inflight.get(slug);
  
      // 3) build persisted-query request
      const body = [{
        operationName: 'VideoAccessToken_Clip',
        variables: { slug },
        extensions: {
          persistedQuery: {
            version: 1,
            sha256Hash: '36b89d2507fce29e5ca551df756d27c1cfe079e2609642b4390aa4c35796eb11'
          }
        }
      }];
  
      const promise = fetch('https://gql.twitch.tv/gql', {
        method: 'POST',
        headers: {
          'Client-Id': 'kimne78kx3ncx6brgo4mv6wki5h1ko',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      })
      .then(r => {
        if (!r.ok) throw new Error('GQL ' + r.status);
        return r.json();
      })
      .then(([{ data }]) => {
        const clip = data.clip;
        if (!clip) throw new Error('Bad GQL response');
  
        // pick “source” quality or highest available
        const best = clip.videoQualities.find(q => q.quality === 'source') ||
                     clip.videoQualities.sort((a, b) => b.frameHeight - a.frameHeight)[0];
  
        const url = `${best.sourceURL}?sig=${clip.playbackAccessToken.signature}` +
                    `&token=${encodeURIComponent(clip.playbackAccessToken.value)}`;
  
        // cache & return
        cache.set(slug, { url, expires: now + TTL });
        return url;
      })
      .finally(() => inflight.delete(slug));
  
      inflight.set(slug, promise);
      return promise;
    }
  
    // expose globally
    window.fetchClipURL = fetchClipURL;
  })();