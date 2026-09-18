const fs = require('node:fs')
const path = require('node:path')
const root = path.dirname(require.resolve('lrc-file-parser/package.json'))
for (const name of ['lrc-file-parser.js', 'lrc-file-parser.esm.js']) {
  const file = path.join(root, 'dist', name)
  let source = fs.readFileSync(file, 'utf8')
  if (source.includes('LX_TIMER_GENERATION')) continue
  const start = source.indexOf('const timeoutTools = {', source.indexOf('const noop'))
  const end = source.indexOf('\nconst t_rxp_1', start)
  if (start < 0 || end < 0) throw Error('Unsupported lyric timer version')
  source = source.slice(0, start) + `const timeoutTools = {
    // LX_TIMER_GENERATION: queued native frame callbacks can outlive cancellation.
    generation: 0, invokeTime: 0, animationFrameId: null, timeoutId: null, callback: null,
    thresholdTime: 200,
    run(generation = this.generation) {
        this.animationFrameId = window.requestAnimationFrame(() => {
            if (generation !== this.generation || !this.callback) return;
            this.animationFrameId = null;
            const diff = this.invokeTime - getNow();
            if (diff > 0) {
                if (diff < this.thresholdTime) { this.run(generation); return; }
                this.timeoutId = setTimeout(() => {
                    if (generation !== this.generation || !this.callback) return;
                    this.timeoutId = null;
                    this.run(generation);
                }, diff - this.thresholdTime);
                return;
            }
            this.callback(diff);
        });
    },
    start(callback = noop, timeout = 0) {
        this.clear();
        this.callback = callback;
        this.invokeTime = getNow() + timeout;
        this.run();
    },
    clear() {
        this.generation++;
        if (this.animationFrameId != null) window.cancelAnimationFrame(this.animationFrameId);
        if (this.timeoutId != null) window.clearTimeout(this.timeoutId);
        this.animationFrameId = this.timeoutId = this.callback = null;
    },
};
` + source.slice(end)
  fs.writeFileSync(file, source)
}
