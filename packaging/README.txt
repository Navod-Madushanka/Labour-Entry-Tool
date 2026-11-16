Pattern-Based Labour Entry Assistant - Windows package
======================================================

No Python needed: everything the tool uses is in this folder.

1. Unzip the whole folder somewhere it can stay, e.g. Documents\LabourEntryTool.
   (Keep the files together: LabourEntryTool.exe needs the _internal folder next to it.)
2. Double-click LabourEntryTool.exe. A black window opens and the tool opens in the browser.
   Keep the window open while you work; close it to stop the tool.
3. Open the month's workbook in Excel and choose it on the start page.

The first time, Windows may say "Windows protected your PC" because the file is not signed:
click "More info", then "Run anyway".

Backups, the change log and your settings are kept in "Labour Entry Tool" in your user folder,
not in this folder, so a newer version can replace this folder without losing anything.

Optional: a config.yaml next to LabourEntryTool.exe (see config.example.yaml in the repository).

Updates: the tool checks GitHub for a newer version every few hours, downloads it and checks its
signature (a download that was not signed by the tool's own build is refused). Nothing about this
PC, you or the workbooks is sent. A bar then says "Version ... is ready": press "Restart and
update", or it installs by itself the next time you start the tool, never in the middle of work.
Only this program folder is replaced (the old one is kept next to it as LabourEntryTool.previous;
config.yaml is carried over); your data folder is never changed, and entries waiting to go to
Excel come back after the restart. The page reloads by itself on the new version.
Turn it off or check by hand with the "Version ..." button at the bottom right of the page.

By hand: download the newer zip, close the tool, and replace this folder with the new one.

Setting up the signing (once, by whoever owns the GitHub repository): run
  LabourEntryTool.exe --make-update-key
and save the line it prints as a GitHub Actions secret named UPDATE_SIGNING_KEY (repository >
Settings > Secrets and variables > Actions > New repository secret). From the next push on, each
build is signed and published as a release, and the tools on the office PCs offer it.
