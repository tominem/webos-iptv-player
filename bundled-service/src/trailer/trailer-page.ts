/**
 * The page the app frames to play a movie trailer. YouTube refuses to embed
 * from the app's file:// origin (error 153), so the player sits in this page,
 * served from the service over loopback, and the page relays the player's
 * state to the app and the app's commands to the player.
 */

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

export function isVideoId(value: string): boolean {
  return VIDEO_ID.test(value);
}

const SCRIPT = [
  '(function () {',
  '  var frame = document.getElementById("player");',
  '  var state = -1;',
  '  var ready = false;',
  '  var wantPlay = false;',
  '  function toApp(message) {',
  '    message.source = "iptv-trailer";',
  '    parent.postMessage(JSON.stringify(message), "*");',
  '  }',
  '  function toPlayer(payload) {',
  '    try { frame.contentWindow.postMessage(JSON.stringify(payload), "*"); } catch (e) {}',
  '  }',
  '  window.addEventListener("message", function (event) {',
  '    var data;',
  '    try { data = JSON.parse(event.data); } catch (e) { return; }',
  '    if (event.source === frame.contentWindow) {',
  '      if (data.event === "onReady" || data.event === "initialDelivery") {',
  '        if (!ready) {',
  '          ready = true;',
  '          toApp({ event: "ready" });',
  '          if (wantPlay) toPlayer({ event: "command", func: "playVideo", args: [] });',
  '        }',
  '      } else if (data.event === "onStateChange") {',
  '        state = data.info;',
  '        toApp({ event: "state", state: state });',
  '      } else if (data.event === "onError") {',
  '        toApp({ event: "error", code: data.info });',
  '      } else if (data.event === "infoDelivery" && data.info) {',
  '        var time = { event: "time" };',
  '        if (typeof data.info.currentTime === "number") time.current = data.info.currentTime;',
  '        if (typeof data.info.duration === "number") time.duration = data.info.duration;',
  '        if (time.current !== undefined || time.duration !== undefined) toApp(time);',
  '      }',
  '    } else if (event.source === parent && data.source === "iptv-trailer") {',
  '      if (data.command === "toggle") {',
  '        toPlayer({ event: "command", func: state === 1 ? "pauseVideo" : "playVideo", args: [] });',
  '      } else if (data.command === "play") {',
  '        wantPlay = true;',
  '        if (ready) toPlayer({ event: "command", func: "playVideo", args: [] });',
  '      } else if (data.command === "seek" && typeof data.seconds === "number") {',
  '        toPlayer({ event: "command", func: "seekTo", args: [data.seconds, true], id: 1, channel: "widget" });',
  '      }',
  '    }',
  '  });',
  // The player only answers after this handshake, so it is repeated until it does.
  '  var tries = 0;',
  '  var timer = setInterval(function () {',
  '    toPlayer({ event: "listening", id: 1, channel: "widget" });',
  '    toPlayer({ event: "command", func: "addEventListener", args: ["onStateChange"], id: 1, channel: "widget" });',
  '    toPlayer({ event: "command", func: "addEventListener", args: ["onError"], id: 1, channel: "widget" });',
  '    if (ready || ++tries > 30) clearInterval(timer);',
  '  }, 250);',
  '})();',
].join('\n');

// `autoplay` false loads the player and waits: the app asks for "play" once it wants the trailer.
export function trailerPageHtml(videoId: string, autoplay = true): string {
  const src = 'https://www.youtube.com/embed/' + videoId +
    '?enablejsapi=1&autoplay=' + (autoplay ? '1' : '0') + '&controls=0&rel=0&modestbranding=1&playsinline=1&fs=0&iv_load_policy=3';
  return '<!DOCTYPE html>\n<html><head><meta charset="utf-8"><title>Trailer</title>' +
    '<style>html,body{margin:0;height:100%;background:#000;overflow:hidden}' +
    'iframe{border:0;width:100%;height:100%}</style></head><body>' +
    '<iframe id="player" allow="autoplay; encrypted-media" src="' + src + '"></iframe>' +
    '<script>\n' + SCRIPT + '\n</script></body></html>';
}
