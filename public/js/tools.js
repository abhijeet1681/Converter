// ============================================================================
//  TOOL CATALOG — pure data. Shared by the browser app AND server.js (SEO pages,
//  sitemap). To add a converter: add an entry here + a function in an engine.
//  Fields: id, cat, title, desc, accept, engine, fn, params, options, mode
//  mode 'each' = every file converted separately, 'all' = all files -> one result
// ============================================================================
export const SITE_NAME = 'ConvertHub';

export const CATEGORIES = [
  { id: 'image', name: 'Image', icon: '🖼️', desc: 'Convert, resize and compress JPG, PNG, WEBP, HEIC, SVG, AVIF, GIF, BMP, TIFF and ICO.' },
  { id: 'pdf', name: 'PDF', icon: '📕', desc: 'Merge, split, compress, rotate, watermark, number and convert PDF files.' },
  { id: 'document', name: 'Documents', icon: '📝', desc: 'Word, PowerPoint, OpenDocument, RTF, Markdown, HTML and text conversions.' },
  { id: 'spreadsheet', name: 'Excel & Data', icon: '📊', desc: 'Convert XLSX, XLS, CSV, JSON, ODS and HTML tables.' },
  { id: 'audio', name: 'Audio', icon: '🎵', desc: 'Convert and trim MP3, WAV, M4A, AAC, OGG, FLAC, OPUS and WMA.' },
  { id: 'video', name: 'Video', icon: '🎬', desc: 'Convert, compress, trim and mute MP4, WEBM, MOV, AVI, MKV — or turn video into GIF/MP3.' },
  { id: 'archive', name: 'Archive & Utilities', icon: '🧰', desc: 'Create and extract ZIP files, Base64 encode/decode and file checksums.' },
  { id: 'ai', name: 'AI Tools', icon: '✨', desc: 'Summarise, translate and simplify documents, extract key points, and turn audio or video into text or subtitles — all with a private AI running on this server.' },
];

const L = {
  jpg: 'JPG', png: 'PNG', webp: 'WEBP', heic: 'HEIC', svg: 'SVG', gif: 'GIF', bmp: 'BMP', avif: 'AVIF', tiff: 'TIFF', ico: 'ICO',
  mp3: 'MP3', wav: 'WAV', m4a: 'M4A', aac: 'AAC', ogg: 'OGG', flac: 'FLAC', opus: 'OPUS', wma: 'WMA',
  mp4: 'MP4', webm: 'WEBM', mov: 'MOV', avi: 'AVI', mkv: 'MKV', flv: 'FLV', wmv: 'WMV', '3gp': '3GP',
};
const A = {
  jpg: '.jpg,.jpeg,.jfif,.pjpeg', png: '.png', webp: '.webp', heic: '.heic,.heif', svg: '.svg', gif: '.gif', bmp: '.bmp,.dib',
  avif: '.avif', tiff: '.tif,.tiff', ico: '.ico',
  image: 'image/*,.heic,.heif,.tif,.tiff,.svg,.ico,.avif,.jfif',
  mp3: '.mp3', wav: '.wav', m4a: '.m4a', aac: '.aac', ogg: '.ogg,.oga', flac: '.flac', opus: '.opus', wma: '.wma',
  audio: 'audio/*,.mp3,.wav,.m4a,.aac,.ogg,.oga,.flac,.opus,.wma,.aiff,.aif,.amr',
  mp4: '.mp4,.m4v', webm: '.webm', mov: '.mov', avi: '.avi', mkv: '.mkv', flv: '.flv', wmv: '.wmv', '3gp': '.3gp',
  video: 'video/*,.mp4,.m4v,.webm,.mov,.avi,.mkv,.flv,.wmv,.3gp,.mpeg,.mpg,.ts,.mts',
  pdf: '.pdf', excel: '.xlsx,.xlsm,.xls,.xlsb,.ods', csv: '.csv,.tsv,.txt', json: '.json',
  sheet: '.xlsx,.xlsm,.xls,.xlsb,.ods,.csv,.tsv,.json',
  office: '.doc,.docx,.odt,.rtf,.ppt,.pptx,.pps,.ppsx,.odp,.xls,.xlsx,.ods,.wpd',
};

const tools = [];
const add = t => tools.push({ multiple: true, mode: 'each', params: {}, options: [], keywords: '', ...t });
const POPULAR = new Set(['jpg-to-png', 'png-to-jpg', 'heic-to-jpg', 'webp-to-png', 'image-converter', 'compress-image', 'resize-image',
  'pdf-to-jpg', 'jpg-to-pdf', 'merge-pdf', 'compress-pdf', 'split-pdf', 'word-to-pdf', 'excel-to-csv', 'csv-to-excel',
  'video-to-mp3', 'audio-converter', 'video-converter', 'compress-video', 'mp4-to-gif', 'mov-to-mp4', 'create-zip']);

// ---------------------------------------------------------------- IMAGE
const IMG_TARGETS = [['jpg', 'JPG'], ['png', 'PNG'], ['webp', 'WEBP'], ['gif', 'GIF'], ['bmp', 'BMP'], ['ico', 'ICO (favicon, multi-size)']];
const imgOpts = (first = []) => [...first,
  { id: 'quality', label: 'Quality', type: 'range', min: 0.1, max: 1, step: 0.05, default: 0.9, showIf: { to: ['jpg', 'webp', 'same'] } },
  { id: 'width', label: 'Width (px)', type: 'number', min: 1, placeholder: 'Original' },
  { id: 'height', label: 'Height (px)', type: 'number', min: 1, placeholder: 'Original' },
  { id: 'background', label: 'Background colour', type: 'color', default: '#ffffff', help: 'Fills transparent areas (JPG/BMP have no transparency).', showIf: { to: ['jpg', 'bmp', 'same'] } },
];

add({ id: 'image-converter', cat: 'image', title: 'Image Converter', engine: 'image', fn: 'convert', accept: A.image,
  desc: 'Convert any image (JPG, PNG, WEBP, HEIC, SVG, AVIF, TIFF, GIF, BMP) to JPG, PNG, WEBP, GIF, BMP or ICO — in bulk.',
  options: imgOpts([{ id: 'to', label: 'Convert to', type: 'select', default: 'png', choices: IMG_TARGETS }]), keywords: 'photo picture format' });

const IMG_PAIRS = [['jpg', 'png'], ['png', 'jpg'], ['webp', 'png'], ['webp', 'jpg'], ['png', 'webp'], ['jpg', 'webp'], ['heic', 'jpg'],
  ['heic', 'png'], ['svg', 'png'], ['svg', 'jpg'], ['png', 'ico'], ['jpg', 'ico'], ['gif', 'png'], ['gif', 'jpg'], ['bmp', 'png'],
  ['bmp', 'jpg'], ['png', 'bmp'], ['avif', 'png'], ['avif', 'jpg'], ['tiff', 'jpg'], ['tiff', 'png'], ['png', 'gif'], ['jpg', 'gif'], ['ico', 'png']];
for (const [a, b] of IMG_PAIRS) {
  add({ id: `${a}-to-${b}`, cat: 'image', title: `${L[a]} to ${L[b]}`, engine: 'image', fn: 'convert', accept: A[a], params: { to: b },
    desc: `Convert ${L[a]} images to ${L[b]} instantly. Batch conversion, resizing and quality control — files never leave your device.`,
    options: imgOpts(), keywords: `${a === 'jpg' ? 'jpeg' : ''} ${b === 'jpg' ? 'jpeg' : ''} ${b === 'ico' ? 'favicon icon' : ''}` });
}
add({ id: 'resize-image', cat: 'image', title: 'Resize Image', engine: 'image', fn: 'convert', accept: A.image, params: { to: 'same', suffix: 'resized' },
  desc: 'Resize images by pixels or percentage while keeping the aspect ratio. Works in bulk.', keywords: 'scale dimensions smaller bigger',
  options: [
    { id: 'scale', label: 'Scale', type: 'select', default: '100', choices: [['100', 'Use width/height below'], ['75', '75%'], ['50', '50%'], ['25', '25%']] },
    { id: 'width', label: 'Width (px)', type: 'number', min: 1, placeholder: 'Auto' },
    { id: 'height', label: 'Height (px)', type: 'number', min: 1, placeholder: 'Auto' },
    { id: 'keepAspect', label: 'Keep aspect ratio', type: 'checkbox', default: true },
    { id: 'quality', label: 'Quality', type: 'range', min: 0.1, max: 1, step: 0.05, default: 0.92 },
  ] });
add({ id: 'compress-image', cat: 'image', title: 'Compress Image', engine: 'image', fn: 'convert', accept: A.image, cta: 'Compress',
  params: { suffix: 'compressed', keepSmaller: true }, keywords: 'reduce size optimize smaller kb',
  desc: 'Reduce image file size by up to 90% with smart quality settings. If a file is already optimal, the original is kept.',
  options: [
    { id: 'to', label: 'Output format', type: 'select', default: 'same', choices: [['same', 'Same as input'], ['jpg', 'JPG'], ['webp', 'WEBP (smallest)']] },
    { id: 'quality', label: 'Quality', type: 'range', min: 0.1, max: 1, step: 0.05, default: 0.7 },
    { id: 'width', label: 'Max width (px)', type: 'number', min: 1, placeholder: 'Keep original' },
  ] });
add({ id: 'rotate-image', cat: 'image', title: 'Rotate & Flip Image', engine: 'image', fn: 'convert', accept: A.image, params: { to: 'same', suffix: 'rotated', quality: 0.95 },
  desc: 'Rotate images by 90°, 180° or 270° and flip them horizontally or vertically.', keywords: 'turn mirror',
  options: [
    { id: 'rotate', label: 'Rotate', type: 'select', default: '90', choices: [['0', 'No rotation'], ['90', '90° clockwise'], ['180', '180°'], ['270', '90° counter-clockwise']] },
    { id: 'flipH', label: 'Flip horizontally', type: 'checkbox', default: false },
    { id: 'flipV', label: 'Flip vertically', type: 'checkbox', default: false },
  ] });
add({ id: 'grayscale-image', cat: 'image', title: 'Black & White Image', engine: 'image', fn: 'convert', accept: A.image,
  params: { to: 'same', grayscale: true, suffix: 'bw', quality: 0.95 }, desc: 'Convert colour photos to black & white (grayscale) in one click.', keywords: 'grayscale greyscale monochrome' });
add({ id: 'remove-exif', cat: 'image', title: 'Remove Image Metadata', engine: 'image', fn: 'convert', accept: A.image,
  params: { to: 'same', suffix: 'clean' }, desc: 'Strip EXIF data (GPS location, camera info, dates) from photos before sharing them.', keywords: 'exif gps privacy metadata',
  options: [{ id: 'quality', label: 'Quality', type: 'range', min: 0.5, max: 1, step: 0.01, default: 0.95 }] });

// ---------------------------------------------------------------- PDF
const PAGES = { id: 'pages', label: 'Pages', type: 'text', default: 'all', placeholder: 'all, 1-3, 5, 8-last, odd, even' };
const PAGE_LAYOUT = [
  { id: 'pageSize', label: 'Page size', type: 'select', default: 'fit', choices: [['fit', 'Same as image'], ['a4', 'A4'], ['letter', 'US Letter'], ['legal', 'US Legal']] },
  { id: 'orientation', label: 'Orientation', type: 'select', default: 'auto', choices: [['auto', 'Automatic'], ['portrait', 'Portrait'], ['landscape', 'Landscape']], showIf: { pageSize: ['a4', 'letter', 'legal'] } },
  { id: 'margin', label: 'Margin', type: 'select', default: '0', choices: [['0', 'None'], ['20', 'Small'], ['40', 'Large']] },
];
for (const fmt of ['jpg', 'png']) {
  add({ id: `pdf-to-${fmt}`, cat: 'pdf', title: `PDF to ${L[fmt]}`, engine: 'pdf', fn: 'pdfToImages', accept: A.pdf, params: { format: fmt },
    desc: `Convert every PDF page into a high-quality ${L[fmt]} image. Choose resolution and pages.`, keywords: 'pdf image picture',
    options: [{ id: 'dpi', label: 'Resolution', type: 'select', default: '150', choices: [['72', '72 DPI (screen)'], ['150', '150 DPI (good)'], ['220', '220 DPI (high)'], ['300', '300 DPI (print)']] }, PAGES,
      ...(fmt === 'jpg' ? [{ id: 'quality', label: 'Quality', type: 'range', min: 0.3, max: 1, step: 0.05, default: 0.9 }] : [])] });
}
add({ id: 'jpg-to-pdf', cat: 'pdf', title: 'JPG to PDF', engine: 'pdf', fn: 'imagesToPdf', accept: A.jpg, mode: 'all', cta: 'Create PDF',
  desc: 'Combine JPG photos into one PDF. Reorder pages, pick page size and margins.', options: PAGE_LAYOUT, keywords: 'jpeg photos pdf' });
add({ id: 'image-to-pdf', cat: 'pdf', title: 'Image to PDF', engine: 'pdf', fn: 'imagesToPdf', accept: A.image, mode: 'all', cta: 'Create PDF',
  desc: 'Turn PNG, JPG, WEBP, HEIC and other images into a single PDF document.', options: PAGE_LAYOUT, keywords: 'png heic webp pdf' });
add({ id: 'png-to-pdf', cat: 'pdf', title: 'PNG to PDF', engine: 'pdf', fn: 'imagesToPdf', accept: A.png, mode: 'all', cta: 'Create PDF',
  desc: 'Convert PNG images (with transparency) into a PDF document.', options: PAGE_LAYOUT });
add({ id: 'merge-pdf', cat: 'pdf', title: 'Merge PDF', engine: 'pdf', fn: 'mergePdf', accept: A.pdf, mode: 'all', minFiles: 2, cta: 'Merge PDFs',
  desc: 'Combine multiple PDF files into one. Drag to reorder with the arrow buttons.', keywords: 'combine join' });
add({ id: 'split-pdf', cat: 'pdf', title: 'Split PDF', engine: 'pdf', fn: 'splitPdf', accept: A.pdf, multiple: false, cta: 'Split PDF',
  desc: 'Split a PDF into single pages, fixed chunks or custom page ranges.', keywords: 'separate divide',
  options: [
    { id: 'splitMode', label: 'Split mode', type: 'select', default: 'each', choices: [['each', 'Every page → separate PDF'], ['every', 'Every N pages'], ['ranges', 'Custom ranges (one PDF per range)']] },
    { id: 'every', label: 'Pages per file', type: 'number', min: 1, default: '2', showIf: { splitMode: ['every'] } },
    { id: 'ranges', label: 'Ranges', type: 'text', placeholder: 'e.g. 1-3, 4-6, 7-last', showIf: { splitMode: ['ranges'] }, required: true },
  ] });
add({ id: 'extract-pdf-pages', cat: 'pdf', title: 'Extract PDF Pages', engine: 'pdf', fn: 'extractPages', accept: A.pdf, multiple: false, cta: 'Extract',
  desc: 'Pick the pages you need and save them as a new PDF.', options: [{ ...PAGES, default: '', placeholder: 'e.g. 1, 3-5, 9', required: true }] });
add({ id: 'remove-pdf-pages', cat: 'pdf', title: 'Remove PDF Pages', engine: 'pdf', fn: 'removePages', accept: A.pdf, multiple: false, cta: 'Remove pages',
  desc: 'Delete unwanted pages from a PDF.', keywords: 'delete', options: [{ id: 'pages', label: 'Pages to remove', type: 'text', placeholder: 'e.g. 2, 5-7', required: true }] });
add({ id: 'organize-pdf', cat: 'pdf', title: 'Reorder PDF Pages', engine: 'pdf', fn: 'organizePdf', accept: A.pdf, multiple: false, cta: 'Reorder',
  desc: 'Rearrange, duplicate or reverse the pages of a PDF by typing the new order.', keywords: 'organize sort order',
  options: [{ id: 'order', label: 'New page order', type: 'text', placeholder: 'e.g. 3, 1, 2, 4-last  or  last-1 (reverse)', required: true }] });
add({ id: 'rotate-pdf', cat: 'pdf', title: 'Rotate PDF', engine: 'pdf', fn: 'rotatePdf', accept: A.pdf,
  desc: 'Rotate all or selected PDF pages permanently.', keywords: 'turn',
  options: [{ id: 'angle', label: 'Rotation', type: 'select', default: '90', choices: [['90', '90° clockwise'], ['180', '180°'], ['270', '90° counter-clockwise']] }, PAGES] });
add({ id: 'compress-pdf', cat: 'pdf', title: 'Compress PDF', engine: 'pdf', fn: 'compressPdf', accept: A.pdf, cta: 'Compress',
  desc: 'Shrink scanned or image-heavy PDFs for email and uploads. Pages are re-rendered as optimized images.', keywords: 'reduce size smaller',
  options: [{ id: 'level', label: 'Compression', type: 'select', default: 'medium', choices: [['low', 'Low (best quality)'], ['medium', 'Recommended'], ['high', 'Extreme (smallest)']] }] });
add({ id: 'pdf-to-word', cat: 'pdf', title: 'PDF to Word', engine: 'pdf', fn: 'pdfToWord', accept: A.pdf,
  desc: 'Convert PDF to an editable Word document (DOCX). Keeps text and paragraphs — fast, private, in your browser.', keywords: 'docx doc editable microsoft', options: [PAGES] });
add({ id: 'pdf-to-text', cat: 'pdf', title: 'PDF to Text', engine: 'pdf', fn: 'pdfToText', accept: A.pdf,
  desc: 'Extract all selectable text from a PDF into a .txt file.', keywords: 'txt extract', options: [PAGES] });
add({ id: 'watermark-pdf', cat: 'pdf', title: 'Watermark PDF', engine: 'pdf', fn: 'watermarkPdf', accept: A.pdf,
  desc: 'Stamp a diagonal text watermark like CONFIDENTIAL or DRAFT on every page.', keywords: 'stamp confidential',
  options: [
    { id: 'text', label: 'Watermark text', type: 'text', default: 'CONFIDENTIAL', required: true },
    { id: 'size', label: 'Font size', type: 'number', min: 8, default: '60' },
    { id: 'opacity', label: 'Opacity', type: 'range', min: 0.05, max: 1, step: 0.05, default: 0.2 },
    { id: 'color', label: 'Colour', type: 'color', default: '#e5484d' }, PAGES,
  ] });
add({ id: 'pdf-page-numbers', cat: 'pdf', title: 'Add Page Numbers', engine: 'pdf', fn: 'pageNumbers', accept: A.pdf,
  desc: 'Add page numbers to a PDF with your choice of position and format.', keywords: 'numbering',
  options: [
    { id: 'position', label: 'Position', type: 'select', default: 'bottom-center', choices: [['bottom-center', 'Bottom centre'], ['bottom-right', 'Bottom right'], ['bottom-left', 'Bottom left'], ['top-center', 'Top centre'], ['top-right', 'Top right']] },
    { id: 'format', label: 'Format', type: 'select', default: 'n', choices: [['n', '1'], ['page-n', 'Page 1'], ['n-of', '1 / 10'], ['page-n-of', 'Page 1 of 10']] },
    { id: 'size', label: 'Font size', type: 'number', min: 6, default: '11' },
    { id: 'start', label: 'Start at number', type: 'number', min: 0, default: '1' },
  ] });

// ---------------------------------------------------------------- DOCUMENTS
const OFFICE = [
  ['word-to-pdf', 'Word to PDF', '.docx,.doc,.odt,.rtf', 'pdf', 'Convert Word documents (DOCX, DOC, ODT, RTF) to PDF with exact layout.'],
  ['powerpoint-to-pdf', 'PowerPoint to PDF', '.pptx,.ppt,.pps,.ppsx,.odp', 'pdf', 'Convert PowerPoint presentations to PDF.'],
  ['excel-to-pdf', 'Excel to PDF', '.xlsx,.xls,.ods,.csv', 'pdf', 'Convert Excel spreadsheets to print-ready PDF.'],
  ['office-to-pdf', 'Office to PDF', A.office, 'pdf', 'Convert any Office or OpenDocument file to PDF.'],
  ['doc-to-docx', 'DOC to DOCX', '.doc', 'docx', 'Upgrade old Word 97-2003 .doc files to modern .docx.'],
  ['odt-to-docx', 'ODT to DOCX', '.odt', 'docx', 'Convert OpenDocument text (LibreOffice) to Microsoft Word.'],
  ['docx-to-odt', 'DOCX to ODT', '.docx', 'odt', 'Convert Microsoft Word to OpenDocument text.'],
  ['rtf-to-docx', 'RTF to DOCX', '.rtf', 'docx', 'Convert Rich Text Format to Word DOCX.'],
  ['ppt-to-pptx', 'PPT to PPTX', '.ppt', 'pptx', 'Upgrade old PowerPoint .ppt files to .pptx.'],
];
for (const [id, title, accept, to, desc] of OFFICE) {
  add({ id, title, accept, desc, cat: 'document', engine: 'doc', fn: 'officeConvert', params: { to, fallback: id === 'word-to-pdf' }, server: true, keywords: 'office microsoft libreoffice' });
}
add({ id: 'word-to-html', cat: 'document', title: 'Word to HTML', engine: 'doc', fn: 'docxToHtml', accept: '.docx',
  desc: 'Convert DOCX documents to clean, semantic HTML (images embedded).', keywords: 'web page' });
add({ id: 'word-to-text', cat: 'document', title: 'Word to Text', engine: 'doc', fn: 'docxToText', accept: '.docx', desc: 'Extract plain text from Word DOCX files.', keywords: 'txt' });
add({ id: 'markdown-to-html', cat: 'document', title: 'Markdown to HTML', engine: 'doc', fn: 'markdownToHtml', accept: '.md,.markdown,.txt',
  desc: 'Convert Markdown (headings, lists, tables, code) into a styled HTML page.', keywords: 'md readme' });
add({ id: 'html-to-text', cat: 'document', title: 'HTML to Text', engine: 'doc', fn: 'htmlToText', accept: '.html,.htm', desc: 'Strip tags and get readable plain text from HTML files.' });
add({ id: 'txt-to-pdf', cat: 'document', title: 'Text to PDF', engine: 'pdf', fn: 'txtToPdf', accept: '.txt,.text,.log,.md,.csv,.json,.xml,.ini,.yml,.yaml',
  desc: 'Convert plain text, logs and code files into a neatly paginated PDF (Latin characters).', keywords: 'txt',
  options: [
    { id: 'font', label: 'Font', type: 'select', default: 'sans', choices: [['sans', 'Helvetica'], ['serif', 'Times'], ['mono', 'Courier (code)']] },
    { id: 'fontSize', label: 'Font size', type: 'number', min: 6, default: '11' },
    { id: 'pageSize', label: 'Page size', type: 'select', default: 'a4', choices: [['a4', 'A4'], ['letter', 'US Letter']] },
  ] });

// ---------------------------------------------------------------- SPREADSHEETS
const SHEET_TARGETS = [['xlsx', 'XLSX (Excel)'], ['xls', 'XLS (Excel 97-2003)'], ['ods', 'ODS (OpenDocument)'], ['csv', 'CSV'], ['tsv', 'TSV'], ['json', 'JSON'], ['html', 'HTML table']];
const sheetOpts = (first = []) => [...first,
  { id: 'sheets', label: 'Sheets', type: 'select', default: 'all', choices: [['all', 'All sheets'], ['first', 'First sheet only']], showIf: { to: ['csv', 'tsv', 'json', 'html'] } },
  { id: 'delimiter', label: 'CSV delimiter', type: 'select', default: ',', choices: [[',', 'Comma ,'], [';', 'Semicolon ;'], ['|', 'Pipe |']], showIf: { to: ['csv'] } },
  { id: 'bom', label: 'Excel-friendly UTF-8 (BOM)', type: 'checkbox', default: true, showIf: { to: ['csv', 'tsv'] } },
];
add({ id: 'spreadsheet-converter', cat: 'spreadsheet', title: 'Spreadsheet Converter', engine: 'sheet', fn: 'convert', accept: A.sheet,
  desc: 'Convert between XLSX, XLS, ODS, CSV, TSV, JSON and HTML tables — all sheets supported.',
  options: sheetOpts([{ id: 'to', label: 'Convert to', type: 'select', default: 'xlsx', choices: SHEET_TARGETS }]) });
const SHEET_PAIRS = [
  ['excel-to-csv', 'Excel to CSV', A.excel, 'csv'], ['csv-to-excel', 'CSV to Excel', A.csv, 'xlsx'], ['excel-to-json', 'Excel to JSON', A.excel, 'json'],
  ['json-to-excel', 'JSON to Excel', A.json, 'xlsx'], ['csv-to-json', 'CSV to JSON', A.csv, 'json'], ['json-to-csv', 'JSON to CSV', A.json, 'csv'],
  ['xls-to-xlsx', 'XLS to XLSX', '.xls', 'xlsx'], ['xlsx-to-xls', 'XLSX to XLS', '.xlsx,.xlsm', 'xls'], ['ods-to-xlsx', 'ODS to XLSX', '.ods', 'xlsx'],
  ['xlsx-to-ods', 'XLSX to ODS', '.xlsx,.xlsm,.xls', 'ods'], ['excel-to-html', 'Excel to HTML', A.excel, 'html'], ['csv-to-tsv', 'CSV to TSV', '.csv', 'tsv'],
];
for (const [id, title, accept, to] of SHEET_PAIRS) {
  add({ id, title, accept, cat: 'spreadsheet', engine: 'sheet', fn: 'convert', params: { to }, options: sheetOpts(),
    desc: `${title} converter — fast, private and supports multiple sheets, Unicode and large files.`, keywords: 'xlsx spreadsheet data' });
}

// ---------------------------------------------------------------- AUDIO
const AUDIO_TARGETS = [['mp3', 'MP3'], ['wav', 'WAV'], ['m4a', 'M4A (AAC)'], ['aac', 'AAC'], ['ogg', 'OGG Vorbis'], ['flac', 'FLAC (lossless)'], ['opus', 'OPUS']];
const TRIM = [
  { id: 'start', label: 'Start time', type: 'text', placeholder: 'e.g. 0:30 (optional)' },
  { id: 'end', label: 'End time', type: 'text', placeholder: 'e.g. 2:15 (optional)' },
];
const audioOpts = (first = []) => [...first,
  { id: 'bitrate', label: 'Bitrate', type: 'select', default: '192k', choices: [['96k', '96 kbps'], ['128k', '128 kbps'], ['192k', '192 kbps'], ['256k', '256 kbps'], ['320k', '320 kbps']], showIf: { to: ['mp3', 'm4a', 'aac', 'ogg', 'opus', 'same'] } },
  { id: 'sampleRate', label: 'Sample rate', type: 'select', default: '', choices: [['', 'Original'], ['22050', '22.05 kHz'], ['44100', '44.1 kHz'], ['48000', '48 kHz']] },
  { id: 'channels', label: 'Channels', type: 'select', default: '', choices: [['', 'Original'], ['1', 'Mono'], ['2', 'Stereo']] },
  { id: 'volume', label: 'Volume', type: 'select', default: '1', choices: [['0.5', '50%'], ['0.75', '75%'], ['1', '100% (original)'], ['1.5', '150%'], ['2', '200%']] },
  ...TRIM,
];
add({ id: 'audio-converter', cat: 'audio', title: 'Audio Converter', engine: 'media', fn: 'convertAudio', accept: A.audio,
  desc: 'Convert any audio file to MP3, WAV, M4A, AAC, OGG, FLAC or OPUS with bitrate, volume and trim controls.', keywords: 'music sound',
  options: audioOpts([{ id: 'to', label: 'Convert to', type: 'select', default: 'mp3', choices: AUDIO_TARGETS }]) });
const AUDIO_PAIRS = [['mp3', 'wav'], ['wav', 'mp3'], ['m4a', 'mp3'], ['aac', 'mp3'], ['ogg', 'mp3'], ['flac', 'mp3'], ['opus', 'mp3'], ['wma', 'mp3'],
  ['wav', 'flac'], ['flac', 'wav'], ['mp3', 'ogg'], ['mp3', 'm4a'], ['mp3', 'aac'], ['m4a', 'wav']];
for (const [a, b] of AUDIO_PAIRS) {
  add({ id: `${a}-to-${b}`, cat: 'audio', title: `${L[a]} to ${L[b]}`, engine: 'media', fn: 'convertAudio', accept: A[a], params: { to: b },
    desc: `Convert ${L[a]} audio to ${L[b]} in your browser. Choose bitrate, channels and trim — no upload needed.`, options: audioOpts(), keywords: 'music song' });
}
add({ id: 'audio-cutter', cat: 'audio', title: 'Audio Cutter', engine: 'media', fn: 'convertAudio', accept: A.audio, params: { to: 'same', suffix: 'cut' }, cta: 'Cut audio',
  desc: 'Trim audio files to the exact part you need — great for ringtones and clips.', keywords: 'trim ringtone clip',
  options: [{ ...TRIM[0], required: true }, TRIM[1]] });

// ---------------------------------------------------------------- VIDEO
const VIDEO_TARGETS = [['mp4', 'MP4 (H.264)'], ['webm', 'WEBM (VP8)'], ['mov', 'MOV'], ['mkv', 'MKV'], ['avi', 'AVI'], ['gif', 'Animated GIF']];
const videoOpts = (first = []) => [...first,
  { id: 'quality', label: 'Quality', type: 'select', default: 'medium', choices: [['high', 'High (larger file)'], ['medium', 'Balanced'], ['low', 'Small file']], showIf: { to: ['mp4', 'webm', 'mov', 'mkv', 'avi'] } },
  { id: 'resolution', label: 'Resolution', type: 'select', default: 'keep', choices: [['keep', 'Original'], ['1080', '1080p'], ['720', '720p'], ['480', '480p'], ['360', '360p']], showIf: { to: ['mp4', 'webm', 'mov', 'mkv', 'avi'] } },
  { id: 'speed', label: 'Encoding speed', type: 'select', default: 'veryfast', choices: [['ultrafast', 'Fastest'], ['veryfast', 'Fast'], ['medium', 'Best compression (slow)']], showIf: { to: ['mp4', 'mov', 'mkv'] } },
  { id: 'mute', label: 'Remove audio', type: 'checkbox', default: false, showIf: { to: ['mp4', 'webm', 'mov', 'mkv', 'avi'] } },
  { id: 'fps', label: 'GIF frame rate', type: 'select', default: '12', choices: [['8', '8 fps'], ['12', '12 fps'], ['15', '15 fps'], ['24', '24 fps']], showIf: { to: ['gif'] } },
  { id: 'gifWidth', label: 'GIF width', type: 'select', default: '480', choices: [['320', '320 px'], ['480', '480 px'], ['640', '640 px'], ['800', '800 px'], ['keep', 'Original']], showIf: { to: ['gif'] } },
  ...TRIM,
];
add({ id: 'video-converter', cat: 'video', title: 'Video Converter', engine: 'media', fn: 'convertVideo', accept: A.video + ',.gif',
  desc: 'Convert videos to MP4, WEBM, MOV, MKV, AVI or GIF. Change resolution and quality, trim or remove audio.', keywords: 'movie clip',
  options: videoOpts([{ id: 'to', label: 'Convert to', type: 'select', default: 'mp4', choices: VIDEO_TARGETS }]) });
const VIDEO_PAIRS = [['mp4', 'webm'], ['webm', 'mp4'], ['mov', 'mp4'], ['avi', 'mp4'], ['mkv', 'mp4'], ['flv', 'mp4'], ['wmv', 'mp4'], ['3gp', 'mp4'],
  ['mp4', 'mov'], ['mp4', 'avi'], ['mp4', 'mkv'], ['mp4', 'gif'], ['webm', 'gif'], ['mov', 'gif'], ['gif', 'mp4'], ['gif', 'webm']];
for (const [a, b] of VIDEO_PAIRS) {
  add({ id: `${a}-to-${b}`, cat: 'video', title: `${L[a]} to ${L[b]}`, engine: 'media', fn: 'convertVideo', accept: A[a], params: { to: b },
    desc: `Convert ${L[a]} to ${L[b]} privately in your browser using FFmpeg — no upload, no watermark.`, options: videoOpts(), keywords: 'video movie' });
}
add({ id: 'video-to-gif', cat: 'video', title: 'Video to GIF', engine: 'media', fn: 'convertVideo', accept: A.video, params: { to: 'gif' },
  desc: 'Turn any video clip into a high-quality animated GIF with optimized colours.', options: videoOpts(), keywords: 'animated meme' });
add({ id: 'compress-video', cat: 'video', title: 'Compress Video', engine: 'media', fn: 'convertVideo', accept: A.video, cta: 'Compress',
  params: { to: 'mp4', suffix: 'compressed' }, desc: 'Reduce video file size for WhatsApp, email and uploads while keeping good quality.', keywords: 'reduce size smaller whatsapp',
  options: [
    { id: 'quality', label: 'Compression', type: 'select', default: 'low', choices: [['medium', 'Light'], ['low', 'Strong (recommended)']] },
    { id: 'resolution', label: 'Max resolution', type: 'select', default: '720', choices: [['keep', 'Original'], ['1080', '1080p'], ['720', '720p'], ['480', '480p'], ['360', '360p']] },
    { id: 'speed', label: 'Encoding speed', type: 'select', default: 'veryfast', choices: [['ultrafast', 'Fastest'], ['veryfast', 'Fast'], ['medium', 'Smallest file (slow)']] },
    { id: 'mute', label: 'Remove audio', type: 'checkbox', default: false },
  ] });
add({ id: 'trim-video', cat: 'video', title: 'Trim Video', engine: 'media', fn: 'trimVideo', accept: A.video, cta: 'Trim',
  desc: 'Cut a section out of a video. Fast mode keeps original quality without re-encoding.', keywords: 'cut clip',
  options: [{ ...TRIM[0], required: true }, TRIM[1], { id: 'precise', label: 'Frame-accurate (re-encode, slower)', type: 'checkbox', default: false }] });
add({ id: 'mute-video', cat: 'video', title: 'Remove Audio from Video', engine: 'media', fn: 'muteVideo', accept: A.video, cta: 'Remove audio',
  desc: 'Remove the sound track from a video instantly — no quality loss.', keywords: 'mute silent' });
add({ id: 'video-to-mp3', cat: 'video', title: 'Video to MP3', engine: 'media', fn: 'convertAudio', accept: A.video, params: { to: 'mp3' },
  desc: 'Extract the audio track from any video and save it as MP3.', options: audioOpts(), keywords: 'extract audio music' });
add({ id: 'mp4-to-mp3', cat: 'video', title: 'MP4 to MP3', engine: 'media', fn: 'convertAudio', accept: A.mp4, params: { to: 'mp3' },
  desc: 'Convert MP4 videos to MP3 audio files.', options: audioOpts(), keywords: 'extract audio' });
add({ id: 'extract-audio', cat: 'video', title: 'Extract Audio from Video', engine: 'media', fn: 'convertAudio', accept: A.video,
  desc: 'Save the sound of a video as MP3, WAV, M4A, OGG or FLAC.', options: audioOpts([{ id: 'to', label: 'Audio format', type: 'select', default: 'mp3', choices: AUDIO_TARGETS }]) });

// ---------------------------------------------------------------- ARCHIVE & UTILITIES
add({ id: 'create-zip', cat: 'archive', title: 'Create ZIP', engine: 'files', fn: 'createZip', accept: '*', mode: 'all', cta: 'Create ZIP',
  desc: 'Compress any files into a single ZIP archive.', keywords: 'compress archive',
  options: [
    { id: 'name', label: 'ZIP name', type: 'text', default: 'archive' },
    { id: 'level', label: 'Compression', type: 'select', default: '6', choices: [['0', 'None (fastest)'], ['6', 'Normal'], ['9', 'Maximum']] },
  ] });
add({ id: 'extract-zip', cat: 'archive', title: 'Extract ZIP', engine: 'files', fn: 'extractZip', accept: '.zip', cta: 'Extract',
  desc: 'Open ZIP files and download the files inside — no software needed.', keywords: 'unzip open archive' });
add({ id: 'file-to-base64', cat: 'archive', title: 'File to Base64', engine: 'files', fn: 'fileToBase64', accept: '*',
  desc: 'Encode any file (images, fonts, PDFs) as Base64 / Data URI for HTML, CSS or APIs.', keywords: 'encode data uri image',
  options: [{ id: 'format', label: 'Output', type: 'select', default: 'dataurl', choices: [['dataurl', 'Data URI'], ['raw', 'Raw Base64'], ['css', 'CSS background'], ['html', 'HTML <img>']] }] });
add({ id: 'base64-to-file', cat: 'archive', title: 'Base64 to File', engine: 'files', fn: 'base64ToFile', accept: '.txt,.b64,.base64',
  desc: 'Decode a text file containing Base64 or a Data URI back into the original file.', keywords: 'decode' });
add({ id: 'file-checksum', cat: 'archive', title: 'File Checksum (SHA)', engine: 'files', fn: 'fileChecksum', accept: '*',
  desc: 'Calculate SHA-1, SHA-256 or SHA-512 hashes to verify downloads and file integrity.', keywords: 'hash sha256 verify integrity',
  options: [{ id: 'algo', label: 'Algorithm', type: 'select', default: 'SHA-256', choices: [['SHA-256', 'SHA-256'], ['SHA-1', 'SHA-1'], ['SHA-512', 'SHA-512'], ['all', 'All of them']] }] });

// ---------------------------------------------------------------- AI (local Ollama + Whisper on the server)
const AI_DOCS = '.pdf,.docx,.txt,.md,.markdown,.csv,.json,.html,.htm,.log';
const INDIAN_LANGS = [['en', 'English'], ['hi', 'हिंदी Hindi'], ['mr', 'मराठी Marathi'], ['ta', 'தமிழ் Tamil'], ['te', 'తెలుగు Telugu'], ['gu', 'ગુજરાતી Gujarati'], ['bn', 'বাংলা Bengali'],
  ['kn', 'ಕನ್ನಡ Kannada'], ['ml', 'മലയാളം Malayalam'], ['pa', 'ਪੰਜਾਬੀ Punjabi'], ['ur', 'اردو Urdu'], ['fr', 'French'], ['de', 'German'], ['es', 'Spanish'], ['ar', 'Arabic'], ['zh', 'Chinese'], ['ja', 'Japanese']];
const langOpt = (label = 'Output language') => ({ id: 'lang', label, type: 'select', default: 'en', choices: INDIAN_LANGS });
const fmtOpt = { id: 'format', label: 'Save as', type: 'select', default: 'txt', choices: [['txt', 'Text (.txt)'], ['md', 'Markdown (.md)']] };
const aiBase = { cat: 'ai', engine: 'ai', accept: AI_DOCS, ai: 'llm', keywords: 'ai artificial intelligence gpt llm chatgpt ollama' };
add({ ...aiBase, id: 'ai-summarize', title: 'AI Summarize Document', fn: 'summarize', cta: 'Summarize',
  desc: 'Get a clear summary of any PDF, Word or text file in seconds — in English, Hindi or 15 other languages.', keywords: 'summary tldr short',
  options: [{ id: 'length', label: 'Length', type: 'select', default: 'medium', choices: [['short', 'Short (3-4 sentences)'], ['medium', 'Medium'], ['long', 'Detailed with headings']] }, langOpt(), fmtOpt] });
add({ ...aiBase, id: 'ai-translate', title: 'AI Translate Document', fn: 'translateDoc', cta: 'Translate',
  desc: 'Translate PDF, Word and text documents into Hindi, Marathi, Tamil, Telugu, Gujarati, Bengali and more.', keywords: 'translation hindi marathi tamil language bhasha anuvad',
  options: [{ ...langOpt('Translate into'), default: 'hi' }, fmtOpt] });
add({ ...aiBase, id: 'ai-key-points', title: 'AI Key Points & Action Items', fn: 'keyPoints', cta: 'Extract',
  desc: 'Turn long reports, notices and meeting notes into a bullet list of key points plus action items and deadlines.', keywords: 'bullets notes minutes highlights',
  options: [langOpt(), fmtOpt] });
add({ ...aiBase, id: 'ai-simplify', title: 'AI Simplify (Plain Language)', fn: 'simplify', cta: 'Simplify',
  desc: 'Rewrite legal notices, government circulars and complex documents in simple language anyone can understand.', keywords: 'easy plain explain eli5 legal',
  options: [langOpt(), fmtOpt] });
add({ ...aiBase, id: 'ai-custom', title: 'AI Ask Your Document', fn: 'customPrompt', cta: 'Run AI',
  desc: 'Give any instruction — “list all dates”, “write a reply email”, “make a quiz from this chapter” — and the AI works on your document.', keywords: 'prompt question chat ask',
  options: [{ id: 'instruction', label: 'What should the AI do?', type: 'text', required: true, placeholder: 'e.g. List every amount and date mentioned in this document' }, langOpt(), fmtOpt] });
add({ id: 'ai-transcribe', cat: 'ai', title: 'AI Audio/Video to Text', engine: 'ai', fn: 'transcribe', accept: `${A.audio},${A.video}`, ai: 'whisper', server: true, cta: 'Transcribe',
  desc: 'Convert speech in MP3, WAV, MP4 and other recordings into text — lectures, interviews, voice notes. Supports Indian languages.', keywords: 'speech to text stt whisper voice transcript lecture dictation',
  options: [
    { id: 'lang', label: 'Spoken language', type: 'select', default: 'auto', choices: [['auto', 'Auto-detect'], ...INDIAN_LANGS] },
    { id: 'task', label: 'Output', type: 'select', default: 'transcribe', choices: [['transcribe', 'Same language as spoken'], ['translate', 'Translate to English']] },
    { id: 'format', label: 'Save as', type: 'select', default: 'txt', choices: [['txt', 'Plain text (.txt)'], ['srt', 'Subtitles (.srt)'], ['vtt', 'Web subtitles (.vtt)'], ['json', 'JSON with timestamps']] },
  ] });
add({ id: 'ai-subtitles', cat: 'ai', title: 'AI Generate Subtitles (SRT)', engine: 'ai', fn: 'transcribe', accept: `${A.video},${A.audio}`, ai: 'whisper', server: true, cta: 'Create subtitles',
  desc: 'Automatically create SRT subtitle files for your videos with accurate timestamps — perfect for YouTube, Instagram and lectures.', keywords: 'caption srt youtube closed captions cc',
  params: { format: 'srt' },
  options: [
    { id: 'lang', label: 'Spoken language', type: 'select', default: 'auto', choices: [['auto', 'Auto-detect'], ...INDIAN_LANGS] },
    { id: 'task', label: 'Subtitle language', type: 'select', default: 'transcribe', choices: [['transcribe', 'Same as spoken'], ['translate', 'English']] },
  ] });

POPULAR.add('ai-summarize'); POPULAR.add('ai-translate'); POPULAR.add('ai-transcribe'); POPULAR.add('pdf-to-word');
for (const t of tools) t.popular = POPULAR.has(t.id);
export const TOOLS = tools;
export const TOOL_MAP = new Map(tools.map(t => [t.id, t]));
