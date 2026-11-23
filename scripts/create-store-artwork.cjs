// Reuses the existing vector logo and fictional screenshot fixtures. No mailbox access.
const { chromium } = require('playwright-core');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const out = path.join(root, '.store-output', 'listing-assets');
const screenshots = path.join(out, 'screenshots');
const artwork = path.join(out, 'artwork');

async function main() {
  fs.mkdirSync(artwork, { recursive: true });
  execFileSync(process.execPath, [path.join(__dirname, 'capture-readme-screenshots.cjs')], {
    cwd: root, stdio: 'inherit', windowsHide: true,
    env: { ...process.env, BMAIL_SCREENSHOT_OUTPUT: screenshots, BMAIL_SCREENSHOT_STORE: '1' },
  });
  const logo = fs.readFileSync(path.join(root, 'src-tauri/icons/app.svg'), 'utf8');
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const files = [];
  try {
    for (const [name, width, height, kind] of [
      ['poster-720x1080', 720, 1080, 'poster'],
      ['poster-1440x2160', 1440, 2160, 'poster'],
      ['box-art-1080x1080', 1080, 1080, 'box'],
      ['box-art-2160x2160', 2160, 2160, 'box'],
      ['app-tile-300x300', 300, 300, 'tile'],
    ]) {
      const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
      const tile = kind === 'tile';
      const scale = width / 720;
      await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
        *{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden}
        body{background:#103d43;color:#f4fffc;font-family:'Segoe UI',Arial,sans-serif}
        main{position:relative;width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:${48 * scale}px}
        .halo{position:absolute;width:125%;aspect-ratio:1;border:1px solid #ffffff0b;border-radius:50%;top:32%;left:35%}
        .halo:after{content:'';position:absolute;inset:12%;border:1px solid #ffffff0b;border-radius:50%}
        .content{position:relative;z-index:1;width:100%}
        .logo{width:${tile ? '76%' : kind === 'poster' ? '48%' : '40%'};margin:0 auto ${tile ? 0 : 35 * scale}px}
        svg{display:block;width:100%;height:auto}
        h1{font-size:${64 * scale}px;line-height:1.02;letter-spacing:${-2 * scale}px;font-weight:650;margin:0}
        h1 span{display:block;color:#65dcc5;font-weight:400;margin-top:${10 * scale}px}
        p{font-size:${23 * scale}px;line-height:1.5;color:#d1e6e3;margin:${30 * scale}px 0 0}
        .rule{height:${3 * scale}px;width:${46 * scale}px;background:#35bca6;margin:${36 * scale}px auto}
        .footer{font-size:${13 * scale}px;letter-spacing:${3 * scale}px;color:#a7c9c5;text-transform:uppercase}
      </style></head><body><main>${tile ? '' : '<div class="halo"></div>'}<div class="content">
        <div class="logo">${logo}</div>${tile ? '' : `<h1>Bmail<span>Backup</span></h1><p>Your email.<br>Saved on your computer.</p><div class="rule"></div><div class="footer">Read-only email backups</div>`}
      </div></main></body></html>`);
      await page.screenshot({ path: path.join(artwork, name + '.png') });
      files.push({ file: `artwork/${name}.png`, width, height });
      await page.close();
    }
  } finally { await browser.close(); }
  for (const name of ['home', 'home-dark', 'search', 'backup', 'scheduler', 'activity']) {
    files.push({ file: `screenshots/${name}.png`, width: 1920, height: 1080 });
  }
  for (const item of files) {
    const buffer = fs.readFileSync(path.join(out, item.file));
    if (buffer.toString('hex', 0, 8) !== '89504e470d0a1a0a' || buffer.readUInt32BE(16) !== item.width || buffer.readUInt32BE(20) !== item.height || buffer.length >= 50 * 1024 * 1024) {
      throw new Error(`Invalid PNG dimensions or size: ${item.file}`);
    }
    item.bytes = buffer.length;
  }
  fs.writeFileSync(path.join(out, 'assets.json'), JSON.stringify(files, null, 2) + '\n');
  fs.writeFileSync(path.join(out, 'UPLOAD-GUIDE.txt'), `Bmail Backup Microsoft Store artwork\n\nScreenshots: upload screenshots/home.png, search.png, backup.png and activity.png.\nOptional extra screenshots: home-dark.png and scheduler.png. All use fictional demo mail.\n\nPoster art: upload artwork/poster-1440x2160.png (smaller alternative: poster-720x1080.png).\nBox art: upload artwork/box-art-2160x2160.png (smaller alternative: box-art-1080x1080.png).\nApp tile: upload artwork/app-tile-300x300.png.\n\nOnly upload one size for each artwork slot.\nThe poster dimensions match the Partner Center form supplied by the publisher.\nThese are listing assets, not an updated app package.\n`);
  console.log(`Validated ${files.length} Store PNGs in ${out}`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
