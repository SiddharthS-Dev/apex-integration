Puppeteer HTML → PDF helper

This small helper uses Puppeteer (headless Chromium) to render a local HTML file and save a PDF.

Install (from the `tools` folder):

```powershell
cd tools
npm init -y
npm install puppeteer
```

Generate a PDF:

```powershell
node html-to-pdf.js ../inspironics-bookmarks.html
# or specify output and paper format:
node html-to-pdf.js ../inspironics-bookmarks.html bookmarks.pdf --format=A4
```

Notes:
- Puppeteer will download a compatible Chromium binary the first time you install it.
- The script opens the HTML using a `file:///` URL so local resources and data URIs will load.
- If you want a server endpoint to generate PDFs on demand, I can add a tiny Express wrapper next.