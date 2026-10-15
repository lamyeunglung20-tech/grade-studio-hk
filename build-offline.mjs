import fs from 'node:fs/promises';
const html=await fs.readFile('dist/index.html','utf8');
const css=await fs.readFile('dist/style.css','utf8');
const core=await fs.readFile('dist/core.js','utf8');
const app=await fs.readFile('dist/app.js','utf8');
const icon=await fs.readFile('dist/icon.svg','utf8');
const standalone=html.replace('<link rel="stylesheet" href="style.css">',`<style>${css}</style>`).replace('href="icon.svg"',`href="data:image/svg+xml,${encodeURIComponent(icon)}"`).replace('<script src="core.js"></script><script src="app.js"></script>',`<script>${core}</script><script>${app}</script>`).replace('<a class="text-button" href="offline.html" download="成績分析室.html">下載離線版</a>','<span class="offline-label">離線版</span>').replace('href="./"','href="#"');
await fs.writeFile('dist/offline.html',standalone);
console.log('Offline app bundled successfully.');
