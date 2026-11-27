/** @odoo-module **/
/* Copyright 2026 Yves Goldberg (Ygol InternetWork)
 * License AGPL-3.0 or later (https://www.gnu.org/licenses/agpl). */

import {findMermaidBlocks, getMermaidSource} from "./mermaid_blocks.esm";
import {browser} from "@web/core/browser/browser";
import {mermaidEngine} from "./engine.esm";

export const PREVIEW_CLASS = "o_mermaid_preview";
/** Delay between a change of a source and its new rendering, in ms. */
export const RENDER_DELAY = 300;
const OBSERVER_LABEL = "web_html_mermaid";

/**
 * Whether a node is a preview of this module.
 *
 * @param {Node} node
 * @returns {Boolean}
 */
function isPreview(node) {
    return Boolean(node && node.classList && node.classList.contains(PREVIEW_CLASS));
}

/**
 * Remove the previews from mutation records, so that they never reach the
 * history nor the other participants of a collaborative edition.
 *
 * A record whose target is a preview is dropped; a `childList` record keeps
 * its other added and removed nodes.
 *
 * @param {MutationRecord[]} records
 * @returns {Array} records, or plain objects with the same keys
 */
export function filterPreviewRecords(records) {
    const filtered = [];
    for (const record of records) {
        if (isPreview(record.target)) {
            continue;
        }
        if (record.type !== "childList") {
            filtered.push(record);
            continue;
        }
        const added = [...record.addedNodes];
        const removed = [...record.removedNodes];
        if (!added.some(isPreview) && !removed.some(isPreview)) {
            filtered.push(record);
            continue;
        }
        const addedNodes = added.filter((node) => !isPreview(node));
        const removedNodes = removed.filter((node) => !isPreview(node));
        if (addedNodes.length || removedNodes.length) {
            filtered.push({
                type: record.type,
                target: record.target,
                addedNodes,
                removedNodes,
                previousSibling: record.previousSibling,
                nextSibling: record.nextSibling,
            });
        }
    }
    return filtered;
}

/**
 * Remove the previews from an HTML string.
 *
 * @param {String} html
 * @returns {String}
 */
function stripPreviews(html) {
    // Reason: an inert document, so that nothing in the HTML loads or runs.
    const body = new DOMParser().parseFromString(html, "text/html").body;
    for (const preview of body.querySelectorAll(`.${PREVIEW_CLASS}`)) {
        preview.remove();
    }
    return body.innerHTML;
}

const BLOCK_TAGS = "p, div, pre, li, tr, h1, h2, h3, h4, h5, h6, blockquote";

/**
 * Plain text of an HTML string, keeping its line breaks and blocks.
 *
 * @param {String} html
 * @returns {String}
 */
export function htmlToText(html) {
    const body = new DOMParser().parseFromString(html, "text/html").body;
    for (const br of body.querySelectorAll("br")) {
        br.replaceWith("\n");
    }
    for (const block of body.querySelectorAll(BLOCK_TAGS)) {
        block.append("\n");
    }
    return body.textContent.replace(/\n+$/, "");
}

/**
 * Plugin of the Odoo editor (`editorPlugins` of the wysiwyg): shows the
 * diagram of each Mermaid block just below it, while the source is edited.
 *
 * A preview is a rendering, not content: it is inserted with the editor's
 * observer off, its mutations are filtered out of the history, and it is
 * removed from the saved value and from copied content.
 */
export class MermaidPreviewPlugin {
    /**
     * @param {Object} options
     * @param {OdooEditor} options.editor
     */
    constructor({editor}) {
        this.editor = editor;
        // Reason: plugins are created before the editor sets its editable.
        this.editable = null;
        /** @type {Map<HTMLPreElement, {preview, source, handle}>} */
        this.previews = new Map();
        this.timeout = null;
        this.destroyed = false;

        const filter = editor.options.filterMutationRecords;
        editor.options.filterMutationRecords = (records) =>
            filterPreviewRecords(filter ? filter(records) : records);

        this._onExternalSteps = () => this.scheduleRefresh();
        editor.addEventListener("onExternalHistorySteps", this._onExternalSteps);
        this._onCopy = this._onCopy.bind(this);
    }

    /**
     * Called by the editor at start and after each step.
     */
    sanitizeElement() {
        this.scheduleRefresh();
    }

    /**
     * Called on the copy of the editable that `getValue()` saves.
     *
     * @param {HTMLElement} element
     */
    cleanForSave(element) {
        for (const preview of element.querySelectorAll(`.${PREVIEW_CLASS}`)) {
            preview.remove();
        }
    }

    destroy() {
        this.destroyed = true;
        browser.clearTimeout(this.timeout);
        this.editor.removeEventListener(
            "onExternalHistorySteps",
            this._onExternalSteps
        );
        if (this.editable) {
            this.editable.removeEventListener("copy", this._onCopy);
            this.editable.removeEventListener("cut", this._onCopy);
        }
        for (const item of this.previews.values()) {
            if (item.handle) {
                item.handle.destroy();
            }
        }
        this.previews.clear();
    }

    scheduleRefresh() {
        if (this.destroyed) {
            return;
        }
        browser.clearTimeout(this.timeout);
        this.timeout = browser.setTimeout(() => this.refresh(), RENDER_DELAY);
    }

    /**
     * Bring the previews in line with the blocks of the editable: add the
     * missing ones, render again those whose source changed, remove those
     * whose block is gone.
     *
     * @returns {Promise}
     */
    async refresh() {
        if (this.destroyed || !this.editor.editable) {
            return;
        }
        if (!this.editable) {
            this.editable = this.editor.editable;
            // Reason: the first refresh runs after the editor's constructor,
            // so these listeners come after the editor's own copy listener
            // and clean what it put in the clipboard.
            this.editable.addEventListener("copy", this._onCopy);
            this.editable.addEventListener("cut", this._onCopy);
        }
        let blocks = findMermaidBlocks(this.editable);
        this._withoutObserver(() => this._removeStale(blocks));
        if (!blocks.length) {
            return;
        }
        try {
            await mermaidEngine.loadEngine();
        } catch {
            // The sources stay readable; nothing else to do.
            return;
        }
        if (this.destroyed) {
            return;
        }
        // Reason: the content may have changed while the engine loaded.
        blocks = findMermaidBlocks(this.editable);
        this._withoutObserver(() => {
            this._removeStale(blocks);
            for (const pre of blocks) {
                this._renderBlock(pre);
            }
        });
    }

    /**
     * @param {HTMLPreElement[]} blocks the current blocks
     */
    _removeStale(blocks) {
        for (const [pre, item] of this.previews) {
            if (!blocks.includes(pre)) {
                if (item.handle) {
                    item.handle.destroy();
                }
                item.preview.remove();
                this.previews.delete(pre);
            }
        }
        const known = new Set([...this.previews.values()].map((item) => item.preview));
        for (const preview of this.editable.querySelectorAll(`.${PREVIEW_CLASS}`)) {
            if (!known.has(preview)) {
                preview.remove();
            }
        }
    }

    /**
     * @param {HTMLPreElement} pre
     */
    _renderBlock(pre) {
        let item = this.previews.get(pre);
        if (!item) {
            const preview = this.editor.document.createElement("div");
            preview.className = PREVIEW_CLASS;
            preview.setAttribute("contenteditable", "false");
            preview.setAttribute("data-oe-protected", "true");
            preview.setAttribute("data-oe-transient", "true");
            item = {preview, source: null, handle: null};
            this.previews.set(pre, item);
        }
        if (pre.nextSibling !== item.preview) {
            pre.after(item.preview);
        }
        const source = getMermaidSource(pre);
        if (source === item.source) {
            return;
        }
        item.source = source;
        if (item.handle) {
            item.handle.update(source);
        } else {
            item.handle = mermaidEngine.renderInto(item.preview, source);
        }
    }

    /**
     * Run a DOM change that the editor must not record.
     *
     * @param {Function} callback
     * @returns {any} what the callback returns
     */
    _withoutObserver(callback) {
        this.editor.observerUnactive(OBSERVER_LABEL);
        try {
            return callback();
        } finally {
            this.editor.observerActive(OBSERVER_LABEL);
        }
    }

    /**
     * @param {ClipboardEvent} ev
     */
    _onCopy(ev) {
        const data = ev.clipboardData;
        if (!data) {
            return;
        }
        for (const type of ["text/html", "text/odoo-editor"]) {
            const html = data.getData(type);
            if (html && html.includes(PREVIEW_CLASS)) {
                data.setData(type, stripPreviews(html));
                if (type === "text/html") {
                    data.setData("text/plain", htmlToText(stripPreviews(html)));
                }
            }
        }
    }
}
