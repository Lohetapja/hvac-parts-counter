import { defineConfig, type Plugin } from 'vite';
import { readFileSync, realpathSync } from 'node:fs';
import { resolve, basename, extname, sep } from 'node:path';

// DEVELOPMENT-ONLY local PDF loader. Serves files strictly from local-test-drawings/
// during `npm run dev` so browser automation can load a real drawing without the
// native file picker. `apply: 'serve'` means it is never part of `vite build` and,
// because only configureServer is implemented, it is absent from `vite preview` too.
// The PDF is read from disk on request and streamed back — never copied into public/,
// dist/, source, or base64. Path traversal and non-PDF/outside-dir access are rejected.
function devLocalPdf(): Plugin {
  const MARKER = '/__dev_local_pdf__/';
  const dir = resolve(process.cwd(), 'local-test-drawings');
  return {
    name: 'dev-local-pdf',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url ?? '';
        const at = url.indexOf(MARKER);
        if (at === -1) return next();
        const requested = decodeURIComponent(url.slice(at + MARKER.length).split('?')[0]);
        const name = basename(requested);
        // Reject anything but a bare *.pdf basename (no path components, no traversal).
        if (name !== requested || name.includes('..') || extname(name).toLowerCase() !== '.pdf') {
          res.statusCode = 400; res.end('DEV LOCAL PDF — invalid filename'); return;
        }
        let realDir: string; let realFile: string;
        try { realDir = realpathSync(dir); realFile = realpathSync(resolve(dir, name)); }
        catch { res.statusCode = 404; res.end('DEV LOCAL PDF — file not found in local-test-drawings/'); return; }
        if (realFile !== realDir && !realFile.startsWith(realDir + sep)) {
          res.statusCode = 403; res.end('DEV LOCAL PDF — outside allowed directory'); return;
        }
        server.config.logger.warn(`DEV LOCAL PDF — NOT INCLUDED IN BUILD: serving ${name}`);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('X-Dev-Local-Pdf', 'NOT-IN-BUILD');
        res.setHeader('Cache-Control', 'no-store');
        res.end(readFileSync(realFile));
      });
    },
  };
}

export default defineConfig({
  base: '/hvac-parts-counter/',
  plugins: [devLocalPdf()],
});
