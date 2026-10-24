/**
 * RWB website: Ronin Maintenance guides
 * Lists every PDF in the "RWB Maintenance" Google Drive folder for roninwb.in/maintenance.html
 * (and the Guides tab of the RWB App). New PDFs show up within a minute of uploading.
 *
 * HOW TO UPDATE (keeps the same web address, so the website needs no change):
 *  1. Open the existing Maintenance Apps Script project (script.google.com → My projects).
 *  2. Select everything in Code.gs, delete it, paste this whole file, click Save.
 *  3. Click Deploy → Manage deployments → the pencil (Edit) icon → Version: "New version" → Deploy.
 *     (Do NOT choose "New deployment": that creates a different link.)
 *  4. Make sure the Drive folder is shared as "Anyone with the link: Viewer", so visitors can read the PDFs.
 *
 * Tip: write a short summary of a guide in the PDF's Drive "Description" (right-click the file →
 * File information → Details → Description). It shows under the title on the website.
 */
const FOLDER_ID = '1cZImj5bucDsUbZO2DpDRIU3kPyY4WrNT';   // the "RWB Maintenance" folder

function doGet() {
  const out = [];
  const folder = DriveApp.getFolderById(FOLDER_ID);
  const add = f => {
    if (f.isTrashed()) return;
    const type = f.getMimeType();
    if (type !== MimeType.PDF && !/\.pdf$/i.test(f.getName())) return;
    out.push({
      id: f.getId(),
      name: f.getName(),
      date: f.getDateCreated().toISOString(),
      description: f.getDescription() || ''
    });
  };
  // PDFs directly in the folder, plus one level of sub-folders
  const files = folder.getFiles();
  while (files.hasNext()) add(files.next());
  const subs = folder.getFolders();
  while (subs.hasNext()) { const fs = subs.next().getFiles(); while (fs.hasNext()) add(fs.next()); }
  out.sort((a, b) => b.date.localeCompare(a.date));   // newest first
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

/** Run this once from the editor (select "test" → Run) to check the folder and see what the website will get. */
function test() {
  const res = JSON.parse(doGet().getContent());
  Logger.log(res.length + ' PDF(s) found:');
  res.forEach(p => Logger.log('• ' + p.name + '  (' + p.date.slice(0, 10) + ')'));
}
