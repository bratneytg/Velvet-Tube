(function(){
  const log = window.__log = [];
  window.__DUR = window.__DUR || 14;
  window.YT = { PlayerState: { ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 }, Player: class {
    constructor(el, opts) {
      this.opts = opts; this.timer = null; this.vol = 100; this.state = -1; this.t = 0; this.dur = 0; this.id = null; this.timer = null;
      const host = document.getElementById(el);
      const f = document.createElement('iframe'); f.style.cssText = 'width:100%;height:100%;border:0;background:#123'; host.replaceWith(f); f.id = el; window.__yt = this;
      setTimeout(() => opts.events.onReady({ target: this }), 50);
    }
    set(s) { this.state = s; this.opts.events.onStateChange({ data: s }); }
    loadVideoById(id) {
      clearInterval(this.timer); this.id = id; this.t = 0; this.dur = window.__DUR; log.push(['load', id, Math.round(performance.now())]);
      this.set(3);
      setTimeout(() => {
        if (id.startsWith('FALLA')) { log.push(['error', id]); return this.opts.events.onError({ data: 101 }); }
        if (window.__NOAUTOPLAY) { this.set(5); return; }   // el navegador bloquea el inicio automático
        this.arrancar();
      }, 150);
    }
    arrancar() {
      clearInterval(this.timer); this.set(1);
      this.timer = setInterval(() => { if (this.state === 1) { this.t += 0.1; if (this.t >= this.dur) { this.t = this.dur; clearInterval(this.timer); log.push(['ended', this.id, Math.round(performance.now())]); this.set(0); } } }, 100);
    }
    playVideo() { if (this.state === 5 && !this.timer) return this.arrancar(); this.set(1); if (!this.timer) this.arrancar(); } pauseVideo() { this.set(2); } stopVideo() { clearInterval(this.timer); this.set(5); }
    seekTo(t) { this.t = t; } getCurrentTime() { return this.t; } getDuration() { return this.dur; } getPlayerState() { return this.state; }
    setVolume(v) { if (v !== this.vol) log.push(['vol', v, Math.round(performance.now())]); this.vol = v; } getVolume() { return this.vol; }
  } };
  setTimeout(() => window.onYouTubeIframeAPIReady(), 0);
})();
