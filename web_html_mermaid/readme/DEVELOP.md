The editor preview is a plugin of the Odoo editor (`editorPlugins` of the wysiwyg):
previews are inserted with the editor observer off, their mutation records are filtered
out of the history, `cleanForSave` removes them from the saved value, and the copy
handler removes them from the clipboard.

To update Pele, replace `static/lib/pele/pele.global.js` with the file of the new npm
release and update `static/lib/pele/README.md` (version and checksum).
