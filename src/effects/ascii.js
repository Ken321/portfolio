// Keep the original changing 3/2/1 glyph aesthetic without rebuilding thousands
// of DOM spans every frame. Read only the small glyph grid, not a full-size render.
export class AsciiEffect {
  constructor(renderer, chars = '321 ', options = {}) {
    const output = document.createElement('canvas');
    const context = output.getContext('2d');
    const sample = document.createElement('canvas');
    const pixels = sample.getContext('2d', { willReadFrequently: true });
    const palette = options.colorPalette || ['#024b9e', '#217adf', '#72b4ff'];
    const replacements = options.stageReplacementChars || ['2', '1', '0'];
    const resolution = options.resolution || .15;
    let width = 0, height = 0, columns = 0, rows = 0, progress = 0;
    this.domElement = output;
    this.setTransitionProgress = value => { progress = Math.min(1, Math.max(0, value)); };
    this.setSize = (w, h) => {
      w = Math.max(1, Math.floor(w)); h = Math.max(1, Math.floor(h));
      if (w === width && h === height) return;
      width = w; height = h;
      columns = Math.max(1, Math.floor(w * resolution));
      rows = Math.max(1, Math.floor(h * resolution));
      sample.width = columns; sample.height = rows;
      output.width = w; output.height = h;
      renderer.setPixelRatio(1);
      renderer.setSize(columns, rows, false);
      context.font = `${1.7 / resolution}px "Courier New", monospace`;
      context.textBaseline = 'top';
    };
    this.render = (scene, camera) => {
      if (!width || !height) return;
      renderer.render(scene, camera);
      pixels.drawImage(renderer.domElement, 0, 0, columns, rows);
      const data = pixels.getImageData(0, 0, columns, rows).data;
      context.clearRect(0, 0, width, height);
      let index = 0;
      for (let y = 0; y < rows; y += 2) {
        for (let x = 0; x < columns; x++, index++) {
          const offset = (y * columns + x) * 4;
          const brightness = (.3 * data[offset] + .59 * data[offset + 1] + .11 * data[offset + 2]) / 255;
          let charIndex = Math.min(chars.length - 1, Math.floor((1 - brightness) * (chars.length - 1)));
          let char = chars[charIndex];
          if (char === ' ') continue;
          for (let stage = 0; stage < 3; stage++) {
            const random = Math.sin((index * 4 + stage + 1) * 12.9898 + 78.233) * 43758.5453;
            if (Math.max(0, Math.min(1, progress * 3 - stage)) > random - Math.floor(random)) char = replacements[stage];
          }
          context.fillStyle = palette[index % palette.length];
          context.fillText(char, x * width / columns, y * height / rows);
        }
      }
    };
  }
}
