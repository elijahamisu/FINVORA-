import { defineConfig } from 'vite';
import { resolve } from 'path';
import fs from 'fs';

// Helper to get all HTML files from a directory
function getHtmlEntries(dir) {
  const entries = {};
  const fullPath = resolve(__dirname, dir);
  
  if (!fs.existsSync(fullPath)) return entries;

  const files = fs.readdirSync(fullPath);
  files.forEach(file => {
    if (file.endsWith('.html')) {
      const name = dir === '.' ? file.replace('.html', '') : `${dir}/${file.replace('.html', '')}`;
      entries[name] = resolve(__dirname, dir, file);
    }
  });
  return entries;
}

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        ...getHtmlEntries('.'),      // Root pages
        ...getHtmlEntries('admin'),  // Admin pages
      },
    },
  },
  server: {
    port: 3000,
    open: true
  }
});
