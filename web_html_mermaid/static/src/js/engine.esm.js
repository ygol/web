/** @odoo-module **/
/* Copyright 2026 Yves Goldberg (Ygol InternetWork)
 * License AGPL-3.0 or later (https://www.gnu.org/licenses/agpl). */

/*
 * The only file that knows the diagram engine (Pele). Another engine
 * (mermaid.js) would keep the same interface: `loadEngine()` and
 * `renderInto(element, source)` returning `{update(source), destroy()}`.
 */

import {_t} from "@web/core/l10n/translation";
import {loadJS} from "@web/core/assets";
import {sprintf} from "@web/core/utils/strings";

export const PELE_URL = "/web_html_mermaid/static/lib/pele/pele.global.js";

/** Fixed options of every diagram: no image, links with Pele's safe schemes. */
const RENDER_OPTIONS = {zoom: "auto", images: false};

let enginePromise = null;

/**
 * Load Pele once, from the Odoo server, when a page first needs it.
 *
 * @returns {Promise<Object>} the `pele` global
 */
function loadEngine() {
    if (!enginePromise) {
        enginePromise = loadJS(PELE_URL)
            .then(() => {
                if (!window.pele) {
                    throw new Error("Pele did not load");
                }
                return window.pele;
            })
            .catch((error) => {
                // Reason: a failed load (offline) may succeed on the next page.
                enginePromise = null;
                throw error;
            });
    }
    return enginePromise;
}

/**
 * Readable message of a rendering error.
 *
 * @param {Error} error a PeleError (`line`, `column`) or any error
 * @returns {String}
 */
export function errorMessage(error) {
    const message = (error && error.message) || String(error);
    if (error && error.line) {
        return sprintf(
            _t("Mermaid diagram error (line %s, column %s): %s"),
            error.line,
            error.column || 1,
            message
        );
    }
    return sprintf(_t("Mermaid diagram error: %s"), message);
}

/**
 * Draw a Mermaid source in an element; the engine must be loaded.
 *
 * The element receives an error area, filled with `textContent` only, and a
 * canvas, where Pele inserts the SVG it builds from escaped text.
 *
 * @param {HTMLElement} element
 * @param {String} source
 * @returns {{update: Function, destroy: Function}}
 */
function renderInto(element, source) {
    const doc = element.ownerDocument;
    const canvas = doc.createElement("div");
    canvas.className = "o_mermaid_canvas";
    const errorEl = doc.createElement("div");
    errorEl.className = "o_mermaid_error text-danger d-none";
    errorEl.setAttribute("role", "alert");
    element.replaceChildren(errorEl, canvas);

    let mounted = null;
    const showError = (error) => {
        errorEl.textContent = errorMessage(error);
        errorEl.classList.remove("d-none");
        // Reason: a hidden canvas has no size and Pele would not draw it
        // again; the last good diagram stays, dimmed, under the message.
        canvas.classList.add("o_mermaid_stale");
    };
    const clearError = () => {
        errorEl.textContent = "";
        errorEl.classList.add("d-none");
        canvas.classList.remove("o_mermaid_stale");
    };
    const options = {...RENDER_OPTIONS, onError: showError, onRender: clearError};
    // Reason: whether Pele calls onRender or onError on each update is not
    // part of its documented contract; its `error` property is.
    const showState = () => {
        if (mounted && mounted.error) {
            showError(mounted.error);
        } else {
            clearError();
        }
    };

    try {
        mounted = window.pele.mount(canvas, source, options);
        showState();
    } catch (error) {
        showError(error);
    }
    return {
        update(newSource) {
            try {
                if (mounted) {
                    mounted.update(newSource, options);
                } else {
                    mounted = window.pele.mount(canvas, newSource, options);
                }
                showState();
            } catch (error) {
                showError(error);
            }
        },
        destroy() {
            if (mounted) {
                mounted.destroy();
                mounted = null;
            }
            element.replaceChildren();
        },
    };
}

/**
 * The engine, as one object so that tests can replace its functions.
 */
export const mermaidEngine = {loadEngine, renderInto};
