This module draws the Mermaid code blocks of HTML fields as diagrams.

A Mermaid block is a code block whose language is `mermaid`, as Markdown converters
write it: `<pre><code class="language-mermaid">`, `<pre class="mermaid">` or
`<pre class="lang-mermaid">`. The stored HTML never changes: the diagram is drawn when
the field is displayed.

- In read-only fields, the diagram replaces the code block; a **Source** button shows
  and hides the text.
- In the editor, a preview of the diagram is shown below each block and follows what you
  type. It is not saved, not part of the undo history and not sent to the other people
  editing the same document.

The diagrams are drawn in the browser by [Pele](https://pele.run), shipped with the
module and loaded only on pages that show a Mermaid block. No request leaves the Odoo
server.
