import { describe, expect, it } from "vitest"
import { withJournalId } from "../format"

describe("withJournalId", () => {
	it("returns text unchanged when disabled or no task", () => {
		expect(withJournalId("hi", "7f3a9c21-abcd", false)).toBe("hi")
		expect(withJournalId("hi", undefined, true)).toBe("hi")
	})

	it("prepends an 8-char task header when enabled", () => {
		expect(withJournalId("hi", "7f3a9c21-abcd", true)).toMatch(
			/^\[src=ext \| task=7f3a9c21 \| \d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC[+-]\d{2}:\d{2}\]\nhi$/,
		)
	})
})
