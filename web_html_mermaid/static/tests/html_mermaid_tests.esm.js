/** @odoo-module **/
/* Copyright 2026 Yves Goldberg (Ygol InternetWork)
 * License AGPL-3.0 or later (https://www.gnu.org/licenses/agpl). */
/* global QUnit */

import {
    MermaidPreviewPlugin,
    filterPreviewRecords,
    htmlToText,
} from "@web_html_mermaid/js/mermaid_preview_plugin.esm";
import {PELE_URL, errorMessage, mermaidEngine} from "@web_html_mermaid/js/engine.esm";
import {
    click,
    getFixture,
    makeDeferred,
    mockTimeout,
    nextTick,
    patchWithCleanup,
} from "@web/../tests/helpers/utils";
import {
    findMermaidBlocks,
    getMermaidSource,
} from "@web_html_mermaid/js/mermaid_blocks.esm";
import {makeView, setupViewRegistries} from "@web/../tests/views/helpers";
import {HtmlField} from "@web_editor/js/backend/html_field";
import {insertText} from "@web_editor/js/editor/odoo-editor/test/utils";
import {registry} from "@web/core/registry";
import {setSelection} from "@web_editor/js/editor/odoo-editor/src/utils/utils";

/**
 * Placeholder of the fake bus methods.
 *
 * @returns {null}
 */
function noop() {
    return null;
}
const FLOW = "graph TD\n  A --> B";
const BLOCK = `<pre><code class="language-mermaid">${FLOW}</code></pre>`;

/**
 * Parse an HTML string into a detached element.
 *
 * @param {String} html
 * @returns {HTMLElement}
 */
function parse(html) {
    const div = document.createElement("div");
    div.innerHTML = html;
    return div;
}

/**
 * Replace the engine by a double that writes the source in a fake SVG.
 *
 * @returns {Object} counters of the calls
 */
function fakeEngine() {
    const calls = {load: 0, render: 0, update: 0, destroy: 0};
    patchWithCleanup(mermaidEngine, {
        async loadEngine() {
            calls.load++;
        },
        renderInto(element, source) {
            calls.render++;
            const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
            svg.setAttribute("data-src", source);
            element.replaceChildren(svg);
            return {
                update(newSource) {
                    calls.update++;
                    svg.setAttribute("data-src", newSource);
                },
                destroy() {
                    calls.destroy++;
                    element.replaceChildren();
                },
            };
        },
    });
    return calls;
}

/**
 * Load the real engine.
 *
 * The test setup of Odoo mocks `loadJS` for `static/lib` files: the script
 * is added here, and `loadEngine` waits for it.
 *
 * @returns {Promise} resolved once the script is loaded
 */
function realEngine() {
    const loaded = window.pele
        ? Promise.resolve()
        : new Promise((resolve, reject) => {
              const script = document.createElement("script");
              script.src = PELE_URL;
              script.onload = resolve;
              script.onerror = reject;
              document.head.appendChild(script);
          });
    patchWithCleanup(mermaidEngine, {
        loadEngine: () => loaded.then(() => window.pele),
    });
    return loaded;
}

QUnit.module("web_html_mermaid", (hooks) => {
    let serverData = null;
    let target = null;

    hooks.beforeEach(() => {
        serverData = {
            models: {
                partner: {
                    fields: {txt: {string: "txt", type: "html", trim: true}},
                    records: [],
                },
            },
        };
        target = getFixture();
        setupViewRegistries();
        // Reason: web_editor removes the html field of the test registry.
        registry.category("fields").add("html", HtmlField, {force: true});
        // Reason: modules installed with this one (web_refresh_from_backend)
        // listen to the bus in the form controller; the test env has no bus.
        const services = registry.category("services");
        if (!services.contains("bus_service")) {
            services.add("bus_service", {
                start: () => ({
                    addChannel: noop,
                    deleteChannel: noop,
                    addEventListener: noop,
                    removeEventListener: noop,
                    subscribe: noop,
                    send: noop,
                    start: noop,
                }),
            });
        }
    });

    /**
     * Open a form with the html field and return its editor and plugin.
     *
     * @param {String} value
     * @returns {Promise<{editor, plugin}>}
     */
    async function openEditor(value) {
        serverData.models.partner.records = [{id: 1, txt: value}];
        let wysiwyg = null;
        const started = makeDeferred();
        patchWithCleanup(HtmlField.prototype, {
            async startWysiwyg() {
                await this._super(...arguments);
                wysiwyg = this.wysiwyg;
                started.resolve();
            },
        });
        await makeView({
            type: "form",
            resId: 1,
            resModel: "partner",
            serverData,
            arch: `<form><field name="txt" widget="html"/></form>`,
        });
        await started;
        const editor = wysiwyg.odooEditor;
        editor.testMode = true;
        const plugin = editor._plugins.find((p) => p instanceof MermaidPreviewPlugin);
        return {wysiwyg, editor, plugin};
    }

    /**
     * Open a form with the html field read-only.
     *
     * @param {String} value
     */
    async function openReadonly(value) {
        serverData.models.partner.records = [{id: 1, txt: value}];
        await makeView({
            type: "form",
            resId: 1,
            resModel: "partner",
            serverData,
            arch: `<form><field name="txt" widget="html" readonly="1"/></form>`,
        });
        await nextTick();
        await nextTick();
    }

    QUnit.module("blocks");

    QUnit.test("the three markups are found, other code is ignored", (assert) => {
        const root = parse(`
            <pre class="codehilite"><code class="language-mermaid">a</code></pre>
            <pre><code class="language-python">print(1)</code></pre>
            <pre class="mermaid">b</pre>
            <pre class="lang-mermaid"><code>c</code></pre>
            <pre>plain</pre>`);
        const blocks = findMermaidBlocks(root);
        assert.deepEqual(
            blocks.map((pre) => pre.textContent),
            ["a", "b", "c"]
        );
    });

    QUnit.test("the source is normalized", (assert) => {
        const root = parse(
            `<pre class="mermaid">\u200Bgraph TD<br>A\u00A0--&gt; B<br></pre>`
        );
        assert.strictEqual(
            getMermaidSource(root.querySelector("pre")),
            "graph TD\nA --> B"
        );
    });

    QUnit.test("a rendered element is never searched again", (assert) => {
        const root = parse(
            `<div class="o_mermaid_preview"><pre class="mermaid">x</pre></div>`
        );
        assert.strictEqual(findMermaidBlocks(root).length, 0);
    });

    QUnit.test("error message gives line and column", (assert) => {
        const error = Object.assign(new Error("Unexpected token"), {
            line: 2,
            column: 5,
        });
        const message = errorMessage(error);
        assert.ok(message.includes("2"), message);
        assert.ok(message.includes("5"), message);
        assert.ok(message.includes("Unexpected token"), message);
    });

    QUnit.module("read-only");

    QUnit.test(
        "a block is replaced by its diagram, Source toggles it",
        async (assert) => {
            const calls = fakeEngine();
            await openReadonly(`<p>before</p>${BLOCK}<p>after</p>`);
            const pre = target.querySelector(".o_readonly pre");
            assert.ok(pre.classList.contains("d-none"), "the source is hidden");
            assert.containsOnce(target, ".o_mermaid_diagram svg");
            assert.strictEqual(
                target.querySelector(".o_mermaid_diagram svg").getAttribute("data-src"),
                FLOW
            );
            assert.strictEqual(pre.nextElementSibling.className, "o_mermaid_diagram");
            assert.strictEqual(calls.render, 1);
            await click(target, ".o_mermaid_source_toggle");
            assert.notOk(pre.classList.contains("d-none"), "the source is shown");
            await click(target, ".o_mermaid_source_toggle");
            assert.ok(pre.classList.contains("d-none"), "the source is hidden again");
        }
    );

    QUnit.test("no block: the engine is not loaded", async (assert) => {
        const calls = fakeEngine();
        await openReadonly(`<p>no diagram</p><pre><code>x</code></pre>`);
        assert.strictEqual(calls.load, 0);
        assert.containsNone(target, ".o_mermaid_diagram");
    });

    QUnit.test("an invalid source shows its error (real engine)", async (assert) => {
        await realEngine();
        await openReadonly(
            `<p>keep me</p><pre class="mermaid">notadiagram\n  x</pre><p>end</p>`
        );
        await mermaidEngine.loadEngine();
        await nextTick();
        const error = target.querySelector(".o_mermaid_error");
        assert.ok(error, "an error area exists");
        assert.notOk(error.classList.contains("d-none"), "the error is visible");
        assert.ok(error.textContent.length > 0, error.textContent);
        assert.strictEqual(
            target.querySelector(".o_readonly p").textContent,
            "keep me"
        );
        assert.containsN(target, ".o_readonly p", 2);
    });

    QUnit.test("a valid source is drawn as SVG (real engine)", async (assert) => {
        await realEngine();
        await openReadonly(BLOCK);
        await mermaidEngine.loadEngine();
        await nextTick();
        assert.containsOnce(target, ".o_mermaid_diagram svg");
        const error = target.querySelector(".o_mermaid_error");
        assert.ok(error.classList.contains("d-none"), `no error: ${error.textContent}`);
    });

    QUnit.test("a fixed source clears its error (real engine)", async (assert) => {
        await realEngine();
        await mermaidEngine.loadEngine();
        const element = document.createElement("div");
        target.appendChild(element);
        const handle = mermaidEngine.renderInto(element, FLOW);
        const error = element.querySelector(".o_mermaid_error");
        assert.ok(error.classList.contains("d-none"), "valid: no error");
        handle.update("graph TD\n  A[x]  F -");
        assert.notOk(error.classList.contains("d-none"), "invalid: error shown");
        handle.update(FLOW);
        assert.ok(error.classList.contains("d-none"), `fixed: ${error.textContent}`);
        assert.ok(element.querySelector(".o_mermaid_canvas svg"), "drawn again");
        assert.notOk(
            element
                .querySelector(".o_mermaid_canvas")
                .classList.contains("o_mermaid_stale")
        );
        handle.destroy();
        assert.strictEqual(element.childNodes.length, 0);
    });

    QUnit.module("editor");

    QUnit.test("a preview follows each block, protected", async (assert) => {
        fakeEngine();
        const {editor, plugin} = await openEditor(`${BLOCK}<p>x</p>${BLOCK}`);
        await plugin.refresh();
        const previews = editor.editable.querySelectorAll(".o_mermaid_preview");
        assert.strictEqual(previews.length, 2);
        for (const preview of previews) {
            assert.strictEqual(preview.previousSibling.tagName, "PRE");
            assert.strictEqual(preview.getAttribute("contenteditable"), "false");
            assert.strictEqual(preview.getAttribute("data-oe-protected"), "true");
            assert.ok(preview.querySelector("svg"));
        }
    });

    QUnit.test(
        "the preview is rendered again only when the source changes",
        async (assert) => {
            const calls = fakeEngine();
            const {editor, plugin} = await openEditor(BLOCK);
            await plugin.refresh();
            await plugin.refresh();
            assert.strictEqual(calls.render, 1);
            assert.strictEqual(calls.update, 0, "same source: no new rendering");
            const code = editor.editable.querySelector("code");
            await setSelection(code.firstChild, code.firstChild.length);
            await insertText(editor, "C");
            await plugin.refresh();
            assert.strictEqual(calls.update, 1);
            assert.strictEqual(
                editor.editable
                    .querySelector(".o_mermaid_preview svg")
                    .getAttribute("data-src"),
                `${FLOW}C`
            );
        }
    );

    QUnit.test("a step of the editor schedules the rendering", async (assert) => {
        const calls = fakeEngine();
        const {plugin} = await openEditor(BLOCK);
        const {advanceTime} = mockTimeout();
        plugin.sanitizeElement();
        assert.strictEqual(calls.render, 0, "not before the delay");
        await advanceTime(300);
        await nextTick();
        assert.strictEqual(calls.render, 1);
    });

    QUnit.test("the saved value has no preview", async (assert) => {
        fakeEngine();
        const value = `<p>a</p>${BLOCK}<p>b</p>`;
        const {wysiwyg, plugin, editor} = await openEditor(value);
        const before = wysiwyg.getValue();
        await plugin.refresh();
        assert.containsOnce(editor.editable, ".o_mermaid_preview");
        assert.strictEqual(wysiwyg.getValue(), before);
        assert.notOk(wysiwyg.getValue().includes("mermaid_preview"));
        assert.notOk(wysiwyg.getValue().includes("<svg"));
    });

    QUnit.test("undo restores the source and keeps one preview", async (assert) => {
        fakeEngine();
        const {editor, plugin} = await openEditor(`${BLOCK}<p>x</p>`);
        await plugin.refresh();
        const stepsBefore = editor._historySteps.length;
        const code = editor.editable.querySelector("code");
        await setSelection(code.firstChild, code.firstChild.length);
        await insertText(editor, "C");
        editor.historyStep();
        await plugin.refresh();
        assert.strictEqual(code.textContent, `${FLOW}C`);
        editor.historyUndo();
        await plugin.refresh();
        assert.strictEqual(editor.editable.querySelector("code").textContent, FLOW);
        assert.containsOnce(editor.editable, ".o_mermaid_preview");
        const recorded = editor._historySteps
            .slice(stepsBefore)
            .flatMap((step) => step.mutations)
            .filter((mutation) => JSON.stringify(mutation.node || "").includes("svg"));
        assert.strictEqual(recorded.length, 0, "no rendering in the history");
    });

    QUnit.test("a removed block loses its preview", async (assert) => {
        const calls = fakeEngine();
        const {editor, plugin} = await openEditor(`${BLOCK}<p>x</p>`);
        await plugin.refresh();
        editor.editable.querySelector("pre").remove();
        await plugin.refresh();
        assert.containsNone(editor.editable, ".o_mermaid_preview");
        assert.strictEqual(calls.destroy, 1);
    });

    QUnit.test("copied content has no preview", async (assert) => {
        fakeEngine();
        const {editor, plugin} = await openEditor(`<p>a</p>${BLOCK}<p>b</p>`);
        await plugin.refresh();
        const paragraphs = editor.editable.querySelectorAll("p");
        const range = document.createRange();
        range.setStart(paragraphs[0].firstChild, 0);
        range.setEnd(paragraphs[1].firstChild, 1);
        const selection = document.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        const clipboardData = new DataTransfer();
        editor.editable.dispatchEvent(
            new ClipboardEvent("copy", {clipboardData, bubbles: true, cancelable: true})
        );
        const html = clipboardData.getData("text/html");
        assert.ok(html.includes("language-mermaid"), "the source is copied");
        assert.notOk(html.includes("o_mermaid_preview"), "the preview is not");
        assert.notOk(clipboardData.getData("text/odoo-editor").includes("<svg"));
    });

    QUnit.test("copied plain text keeps its lines", (assert) => {
        assert.strictEqual(
            htmlToText("<p>a</p><pre>graph TD<br>A --&gt; B</pre><p>b</p>"),
            "a\ngraph TD\nA --> B\nb"
        );
    });

    QUnit.test("records of previews are filtered out", (assert) => {
        const parent = document.createElement("div");
        const preview = document.createElement("div");
        preview.className = "o_mermaid_preview";
        const para = document.createElement("p");
        const records = filterPreviewRecords([
            {
                type: "childList",
                target: parent,
                addedNodes: [preview],
                removedNodes: [],
            },
            {
                type: "childList",
                target: parent,
                addedNodes: [preview, para],
                removedNodes: [],
            },
            {type: "attributes", target: preview, attributeName: "class"},
            {type: "characterData", target: para},
        ]);
        assert.strictEqual(records.length, 2);
        assert.deepEqual(records[0].addedNodes, [para]);
        assert.strictEqual(records[1].type, "characterData");
    });
});
