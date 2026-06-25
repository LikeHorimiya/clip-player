/* global fetch */

/**
 * window.fetchClipURL(slug[, force])
 * - slug : e.g. "SteamySleepyCocoaFeelsBadMan-nFnUmRdbYa7lPGGd"
 * - force: true → bypass cache (use after a 401/403)
 */
(function attachFetchClipURL () {
    const TTL      = 55 * 60 * 1000;
    const cache    = new Map();   // slug → { url, expires }
    const inflight = new Map();   // slug → Promise

    const GQL_QUERY = `query VideoAccessToken_Clip($slug: ID!) {
      clip(slug: $slug) {
        playbackAccessToken(params: {
          platform: "web"
          playerBackend: "mediaplayer"
          playerType: "site"
        }) { signature value }
        videoQualities { quality sourceURL }
      }
    }`;

    async function fetchClipURL (slug, force = false) {
        const now = Date.now();

        const entry = cache.get(slug);
        if (!force && entry && entry.expires > now) return entry.url;

        if (inflight.has(slug)) return inflight.get(slug);

        const body = [{
            operationName: 'VideoAccessToken_Clip',
            variables: { slug },
            query: GQL_QUERY
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
            if (!r.ok) throw new Error('GQL HTTP ' + r.status);
            return r.json();
        })
        .then(([{ data }]) => {
            if (!data || !data.clip) throw new Error('clip not found: ' + slug);

            const { playbackAccessToken, videoQualities } = data.clip;

            // quality は "720", "480" 等の数値文字列 → 数値でソートして最大を選ぶ
            const best = videoQualities
                .slice()
                .sort((a, b) => parseInt(b.quality, 10) - parseInt(a.quality, 10))[0];

            if (!best) throw new Error('no videoQualities for: ' + slug);

            const url = `${best.sourceURL}?sig=${playbackAccessToken.signature}` +
                        `&token=${encodeURIComponent(playbackAccessToken.value)}`;

            cache.set(slug, { url, expires: now + TTL });
            return url;
        })
        .finally(() => inflight.delete(slug));

        inflight.set(slug, promise);
        return promise;
    }

    window.fetchClipURL = fetchClipURL;
})();
