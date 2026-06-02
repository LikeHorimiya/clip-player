/* player-app.js
 * !clips  → 発言者作成クリップ優先ランダム再生
 * !clip   → 完全ランダム再生（作成者無視）
 *
 * 選択ロジック:
 * !clips:
 *   1. 発言者作成 かつ クールダウン外 → あればその中からランダム
 *   2. 全クリップ かつ クールダウン外 → あればその中からランダム
 *   3. 全クリップ（クールダウン無視） → ランダム
 *
 * !clip:
 *   1. 全クリップ かつ クールダウン外 → あればその中からランダム
 *   2. 全クリップ（クールダウン無視） → ランダム
 *
 * 再生開始時点から24時間クールダウン開始。
 * 割り込み停止時もクールダウンを記録。
 * 再生中に !clip/!clips が来たら即停止して次を再生。
 * tmi.js 不使用 - WebSocket で直接 Twitch IRC に接続
 */
(function () {
  'use strict';

  /* ── 設定 ── */
  const CHAT_CHANNEL  = 'ai_chai';
  const CLIP_CHANNEL  = 'ai_chai';
  const CLIPS_API_URL = 'twitch-clips-api.mcray971.workers.dev'; // ← WorkerのURLに変更
  const TRIGGER_PRIO  = '!clips';
  const TRIGGER_RAND  = '!clip';
  const VOLUME        = 1.0;
  const COOLDOWN_MS   = 24 * 60 * 60 * 1000;

  /* ── DOM ── */
  const video    = document.getElementById('player');
  const statusEl = document.getElementById('status');

  /* ── 状態 ── */
  let allClips    = [];
  let isPlaying   = false;
  let currentClip = null;    // 現在再生中のクリップ
  const playedAt  = new Map(); // slug → クールダウン開始時刻(ms)

  /* ── ユーティリティ ── */
  function hideStatus() {
    if (statusEl) statusEl.classList.add('hide');
  }

  function rand(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  function isAvailable(clip) {
    const t = playedAt.get(clip.slug);
    return !t || (Date.now() - t) >= COOLDOWN_MS;
  }

  /* ── クールダウン記録（再生開始・停止どちらでも呼ぶ） ── */
  function recordPlayed(clip) {
    if (!clip) return;
    playedAt.set(clip.slug, Date.now());
    console.log(`[player] クールダウン記録: ${clip.title}`);
  }

  /* ── 現在の再生を即座に停止してリセット ── */
  function stopCurrent() {
    // 停止時点でもクールダウンを記録
    recordPlayed(currentClip);
    video.onended = null;
    video.onerror = null;
    video.pause();
    video.src   = '';
    isPlaying   = false;
    currentClip = null;
    hideStatus();
  }

  /* ── クリップ一覧取得 ── */
  async function loadClips() {
    try {
      const res  = await fetch(`${CLIPS_API_URL}?channel=${encodeURIComponent(CLIP_CHANNEL)}&period=all&limit=100`);
      if (!res.ok) throw new Error('clips.php HTTP ' + res.status);
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        allClips = data;
        console.log(`[player] ${allClips.length} クリップ取得完了`);
      }
    } catch (e) {
      console.error('[player] クリップ取得失敗:', e);
    }
  }

  /* ── クリップ選択 ── */
  function selectClip(username, mode) {
    if (allClips.length === 0) return null;

    const available = allClips.filter(isAvailable);

    if (mode === 'prio') {
      // ステップ1: 発言者作成 かつ クールダウン外
      const byUserAvail = available.filter(c =>
        c.creator_name && c.creator_name.toLowerCase() === username.toLowerCase()
      );
      if (byUserAvail.length > 0) {
        console.log(`[player] ステップ1: 発言者作成+クールダウン外 (${byUserAvail.length}件)`);
        return rand(byUserAvail);
      }

      // ステップ2: 全クリップ かつ クールダウン外
      if (available.length > 0) {
        console.log(`[player] ステップ2: 全クリップ+クールダウン外 (${available.length}件)`);
        return rand(available);
      }

      // ステップ3: 全クリップ（クールダウン無視）
      console.log(`[player] ステップ3: 全クリップ+クールダウン無視 (${allClips.length}件)`);
      return rand(allClips);

    } else {
      // !clip
      // ステップ1: 全クリップ かつ クールダウン外
      if (available.length > 0) {
        console.log(`[player] ステップ1: 全クリップ+クールダウン外 (${available.length}件)`);
        return rand(available);
      }

      // ステップ2: 全クリップ（クールダウン無視）
      console.log(`[player] ステップ2: 全クリップ+クールダウン無視 (${allClips.length}件)`);
      return rand(allClips);
    }
  }

  /* ── 1クリップ再生 ── */
  async function playOneClip(clip) {
    isPlaying   = true;
    currentClip = clip;

    let url;
    try {
      url = await window.fetchClipURL(clip.slug);
    } catch (err) {
      console.warn('[player] fetchClipURL失敗:', err);
      isPlaying   = false;
      currentClip = null;
      return;
    }

    if (!isPlaying) return;

    video.src         = url;
    video.currentTime = 0;
    video.volume      = VOLUME;
    video.muted       = false;

    video.onended = () => {
      recordPlayed(currentClip);
      video.src   = '';
      isPlaying   = false;
      currentClip = null;
      hideStatus();
      console.log(`[player] 再生終了: ${clip.title}`);
    };

    video.onerror = () => {
      if (!isPlaying) return;
      console.warn('[player] video error, force re-fetch');
      window.fetchClipURL(clip.slug, true)
        .then(fresh => {
          if (!isPlaying) return;
          video.src = fresh;
          return video.play();
        })
        .catch(() => {
          isPlaying   = false;
          currentClip = null;
          hideStatus();
        });
    };

    const onPlaying = () => {
      hideStatus();
      video.removeEventListener('playing', onPlaying);
    };
    video.addEventListener('playing', onPlaying);

    try {
      await video.play();
    } catch (_) {
      try {
        video.muted = true;
        await video.play();
        video.muted  = false;
        video.volume = VOLUME;
      } catch (e2) {
        console.error('[player] 再生失敗:', e2);
        isPlaying   = false;
        currentClip = null;
        hideStatus();
      }
    }
  }

  /* ── チャットメッセージ処理 ── */
  function handleMessage(displayName, message) {
    const text = message.trim();

    let mode = null;
    if (text === TRIGGER_PRIO)      mode = 'prio';
    else if (text === TRIGGER_RAND) mode = 'rand';
    else return;

    const username = displayName || 'unknown';
    console.log(`[player] トリガー検出(${mode}): ${username} が "${text}" を送信`);

    if (allClips.length === 0) {
      console.warn('[player] クリップ未取得');
      return;
    }

    // 先に現在の再生を停止・クールダウン記録してから次のクリップを選ぶ
    if (isPlaying) stopCurrent();

    const clip = selectClip(username, mode);
    if (!clip) return;

    console.log(`[player] 再生: ${clip.title} (creator: ${clip.creator_name || '不明'})`);
    playOneClip(clip);
  }

  /* ── Twitch IRC over WebSocket ── */
  function connectChat() {
    const WS_URL = 'wss://irc-ws.chat.twitch.tv:443';
    let ws;
    let pingInterval;

    function connect() {
      console.log('[player] Twitch IRC 接続中...');
      ws = new WebSocket(WS_URL);

      ws.onopen = () => {
        ws.send('CAP REQ :twitch.tv/tags twitch.tv/commands');
        ws.send('PASS oauth:anonymous_user');
        ws.send('NICK justinfan' + Math.floor(Math.random() * 900000 + 100000));
        ws.send('JOIN #' + CHAT_CHANNEL);

        pingInterval = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) ws.send('PING :tmi.twitch.tv');
        }, 5 * 60 * 1000);

        console.log('[player] チャット接続完了');
      };

      ws.onmessage = (event) => {
        const raw = event.data;

        if (raw.startsWith('PING')) {
          ws.send('PONG :tmi.twitch.tv');
          return;
        }

        if (!raw.includes('PRIVMSG')) return;

        const dnMatch  = raw.match(/display-name=([^;]*)/);
        const msgMatch = raw.match(/PRIVMSG #\S+ :(.+)/);
        if (!msgMatch) return;

        const displayName = dnMatch ? dnMatch[1] : '';
        const message     = msgMatch[1].trim();

        handleMessage(displayName, message);
      };

      ws.onerror = (e) => {
        console.warn('[player] WebSocket エラー:', e);
      };

      ws.onclose = () => {
        console.log('[player] チャット切断 - 5秒後に再接続');
        clearInterval(pingInterval);
        setTimeout(connect, 5000);
      };
    }

    connect();
  }

  /* ── 初期化 ── */
  async function init() {
    await loadClips();
    connectChat();
    setInterval(loadClips, 10 * 60 * 1000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();