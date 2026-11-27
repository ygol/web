/** @odoo-module **/
/* Copyright 2026 Yves Goldberg (Ygol InternetWork)
 * License AGPL-3.0 or later (https://www.gnu.org/licenses/agpl). */

import {findMermaidBlocks, getMermaidSource} from "./mermaid_blocks.esm";
import {onWillUnmount, useEffect} from "@odoo/owl";
import {HtmlField} from "@web_editor/js/backend/html_field";
import {MermaidPreviewPlugin} from "./mermaid_preview_plugin.esm";
import {_t} from "@web/core/l10n/translation";
import {mermaidEngine} from "./engine.esm";
import {patch} from "@web/core/utils/patch";

/**
 * Add the diagram of a block after it, hidden source and a toggle button.
 *
 * @param {HTMLPreElement} pre
 * @returns {{wrapper: HTMLElement, canvas: HTMLElement}}
 */
function insertDiagram(pre) {
    const doc = pre.ownerDocument;
    const wrapper = doc.createElement("div");
    wrapper.className = "o_mermaid_diagram";
    const toggle = doc.createElement("button");
    toggle.type = "button";
    toggle.className = "btn btn-link btn-sm o_mermaid_source_toggle";
    toggle.textContent = _t("Source");
    toggle.title = _t("Show or hide the source of the diagram");
    toggle.setAttribute("aria-pressed", "false");
    toggle.addEventListener("click", () => {
        const hidden = pre.classList.toggle("d-none");
        toggle.setAttribute("aria-pressed", String(!hidden));
    });
    const canvas = doc.createElement("div");
    canvas.className = "o_mermaid_render";
    wrapper.append(toggle, canvas);
    pre.after(wrapper);
    pre.classList.add("d-none");
    return {wrapper, canvas};
}

patch(HtmlField.prototype, "web_html_mermaid", {
    setup() {
        this._super(...arguments);
        /** @type {Map<HTMLPreElement, {wrapper, handle}>} */
        this._mermaidDiagrams = new Map();
        this._mermaidUnmounted = false;
        useEffect(() => {
            this._renderReadonlyMermaid();
        });
        onWillUnmount(() => {
            this._mermaidUnmounted = true;
            this._clearReadonlyMermaid(() => true);
        });
    },

    get wysiwygOptions() {
        const options = this._super(...arguments);
        const plugins = options.editorPlugins || [];
        if (plugins.includes(MermaidPreviewPlugin)) {
            return options;
        }
        return {...options, editorPlugins: [...plugins, MermaidPreviewPlugin]};
    },

    /**
     * Remove the diagrams matching a condition.
     *
     * @param {Function} condition called with the `pre` of each diagram
     */
    _clearReadonlyMermaid(condition) {
        for (const [pre, item] of this._mermaidDiagrams) {
            if (condition(pre)) {
                if (item.handle) {
                    item.handle.destroy();
                }
                if (item.wrapper) {
                    item.wrapper.remove();
                }
                this._mermaidDiagrams.delete(pre);
            }
        }
    },

    /**
     * Replace each Mermaid block of the read-only value by its diagram.
     *
     * Owl rebuilds the read-only element when the value changes: the
     * diagrams of blocks that are gone are dropped, new blocks are drawn,
     * blocks already drawn are left as they are.
     */
    async _renderReadonlyMermaid() {
        const root = this.readonlyElementRef.el;
        this._clearReadonlyMermaid((pre) => !root || !root.contains(pre));
        if (!root) {
            return;
        }
        const blocks = findMermaidBlocks(root).filter(
            (pre) => !this._mermaidDiagrams.has(pre)
        );
        if (!blocks.length) {
            return;
        }
        // Reserve the blocks before waiting, so that a second effect skips them.
        for (const pre of blocks) {
            this._mermaidDiagrams.set(pre, {wrapper: null, handle: null});
        }
        try {
            await mermaidEngine.loadEngine();
        } catch {
            for (const pre of blocks) {
                this._mermaidDiagrams.delete(pre);
            }
            return;
        }
        for (const pre of blocks) {
            const item = this._mermaidDiagrams.get(pre);
            if (!item || this._mermaidUnmounted || !pre.isConnected) {
                this._mermaidDiagrams.delete(pre);
                continue;
            }
            const {wrapper, canvas} = insertDiagram(pre);
            item.wrapper = wrapper;
            item.handle = mermaidEngine.renderInto(canvas, getMermaidSource(pre));
        }
    },
});
