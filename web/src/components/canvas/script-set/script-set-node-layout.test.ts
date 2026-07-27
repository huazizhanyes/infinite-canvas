import { describe, expect, it } from "vitest";

import { isScriptSetExpanded, SCRIPT_SET_COLLAPSED_SIZE, SCRIPT_SET_EXPANDED_SIZE } from "@/components/canvas/script-set/script-set-node-layout";

describe("script set node layout", () => {
    it("uses the persisted expanded state when it exists", () => {
        expect(isScriptSetExpanded({ scriptSetExpanded: true }, SCRIPT_SET_COLLAPSED_SIZE.width, SCRIPT_SET_COLLAPSED_SIZE.height)).toBe(true);
        expect(isScriptSetExpanded({ scriptSetExpanded: false }, SCRIPT_SET_EXPANDED_SIZE.width, SCRIPT_SET_EXPANDED_SIZE.height)).toBe(false);
    });

    it("infers legacy nodes from their dimensions", () => {
        expect(isScriptSetExpanded(undefined, SCRIPT_SET_COLLAPSED_SIZE.width, SCRIPT_SET_COLLAPSED_SIZE.height)).toBe(false);
        expect(isScriptSetExpanded(undefined, SCRIPT_SET_EXPANDED_SIZE.width, SCRIPT_SET_EXPANDED_SIZE.height)).toBe(true);
    });
});
