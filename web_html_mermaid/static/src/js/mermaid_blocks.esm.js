/** @odoo-module **/
/* Copyright 2026 Yves Goldberg (Ygol InternetWork)
 * License AGPL-3.0 or later (https://www.gnu.org/licenses/agpl). */

/**
 * Selector of the Mermaid code blocks, whatever produced them:
 * - `pre > code.language-mermaid`: standard Markdown converters
 *   (markdown-it, Python-Markdown, Paste Markdown);
 * - `pre.mermaid`: the convention of Mermaid itself;
 * - `pre.lang-mermaid`: older converters.
 */
export const MERMAID_SELECTOR =
    "pre > code.language-mermaid, pre.mermaid, pre.lang-mermaid";

/** Zero-width spaces and byte order marks the editor may leave in text. */
const INVISIBLE = /[\u200B\uFEFF]/g;
const NBSP = /\u00A0/g;

/** Class of the elements this module adds next to a block (never saved). */
export const RENDERED_SELECTOR = ".o_mermaid_preview, .o_mermaid_diagram";

/**
 * Find the Mermaid blocks of an element, in document order.
 *
 * @param {HTMLElement} root
 * @returns {HTMLPreElement[]} the `pre` element of each block
 */
export function findMermaidBlocks(root) {
    if (!root || !root.querySelectorAll) {
        return [];
    }
    const blocks = [];
    for (const element of root.querySelectorAll(MERMAID_SELECTOR)) {
        const pre = element.tagName === "PRE" ? element : element.parentElement;
        // Reason: a diagram could hold a `pre`; never render inside a render.
        if (!blocks.includes(pre) && !pre.closest(RENDERED_SELECTOR)) {
            blocks.push(pre);
        }
    }
    return blocks;
}

/**
 * Read the Mermaid source of a block.
 *
 * A `pre` edited in Odoo may hold `<br>` for its line breaks, zero-width
 * spaces and non-breaking spaces: they are normalized so that the source is
 * the text the user sees.
 *
 * @param {HTMLPreElement} pre
 * @returns {String}
 */
export function getMermaidSource(pre) {
    let text = pre.textContent;
    if (pre.querySelector("br")) {
        const clone = pre.cloneNode(true);
        for (const br of clone.querySelectorAll("br")) {
            br.replaceWith("\n");
        }
        text = clone.textContent;
    }
    return text.replace(INVISIBLE, "").replace(NBSP, " ").trim();
}
