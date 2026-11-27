- PDF reports, e-mails, the portal and the chatter still show the source of the
  diagrams: only the backend HTML fields are rendered.
- The sandboxed preview of complex HTML (mass mailing) is not rendered.
- The engine is isolated in `static/src/js/engine.esm.js`: mermaid.js could replace Pele
  there without changing the rest of the module.
