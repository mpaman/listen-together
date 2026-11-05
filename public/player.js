// ห่อ YouTube IFrame Player API ให้เหลือแค่คำสั่งที่เราใช้
// docs: https://developers.google.com/youtube/iframe_api_reference

// error ที่แปลว่า "เพลงนี้เล่นในเว็บอื่นไม่ได้" (เป็นทุกเครื่องเหมือนกัน จึงข้ามทั้งห้องได้)
const BLOCKED_ERRORS = new Set([100, 101, 150]);

function loadApi() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  return new Promise((resolve) => {
    window.onYouTubeIframeAPIReady = () => resolve(window.YT);
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    document.head.append(tag);
  });
}

export async function createPlayer(elementId, { onEnded, onBlocked }) {
  const YT = await loadApi();
  let loadedVideoId = null;

  const yt = await new Promise((resolve) => {
    const instance = new YT.Player(elementId, {
      width: '100%',
      height: '100%',
      playerVars: { controls: 0, disablekb: 1, rel: 0, playsinline: 1, iv_load_policy: 3, fs: 0 },
      events: {
        onReady: () => resolve(instance),
        onStateChange: (e) => e.data === YT.PlayerState.ENDED && onEnded(),
        onError: (e) => BLOCKED_ERRORS.has(e.data) && onBlocked(),
      },
    });
  });

  return {
    states: YT.PlayerState,
    loadedVideoId: () => loadedVideoId,
    load(videoId, startSeconds, autoplay) {
      loadedVideoId = videoId;
      const args = { videoId, startSeconds: Math.max(0, startSeconds) };
      if (autoplay) yt.loadVideoById(args);
      else yt.cueVideoById(args);
    },
    unload() {
      loadedVideoId = null;
      yt.stopVideo();
    },
    play: () => yt.playVideo(),
    pause: () => yt.pauseVideo(),
    seek: (seconds) => yt.seekTo(Math.max(0, seconds), true),
    unmute: () => yt.unMute(),
    state: () => yt.getPlayerState(),
    currentTime: () => yt.getCurrentTime() ?? 0,
    duration: () => yt.getDuration() ?? 0,
  };
}
