# Copyright 2026 Yves Goldberg (Ygol InternetWork)
# License AGPL-3.0 or later (https://www.gnu.org/licenses/agpl).
{
    "name": "Web HTML Mermaid",
    "summary": "Draw the Mermaid code blocks of HTML fields as diagrams",
    "version": "16.0.1.0.0",
    "category": "Web",
    "author": "Yves Goldberg (Ygol InternetWork),Odoo Community Association (OCA)",
    "maintainers": ["ygol"],
    "website": "https://github.com/OCA/web",
    "license": "AGPL-3",
    "development_status": "Alpha",
    "depends": ["web_editor"],
    "assets": {
        "web.assets_backend": [
            "web_html_mermaid/static/src/js/mermaid_blocks.esm.js",
            "web_html_mermaid/static/src/js/engine.esm.js",
            "web_html_mermaid/static/src/js/mermaid_preview_plugin.esm.js",
            "web_html_mermaid/static/src/js/html_field_patch.esm.js",
            "web_html_mermaid/static/src/scss/html_mermaid.scss",
        ],
        "web.qunit_suite_tests": [
            "web_html_mermaid/static/tests/**/*",
        ],
    },
    "installable": True,
}
