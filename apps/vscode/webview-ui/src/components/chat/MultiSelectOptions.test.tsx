import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import type { ButtonHTMLAttributes } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { MultiSelectOptions } from "./MultiSelectOptions"

const askResponse = vi.hoisted(() => vi.fn())
vi.mock("@/services/grpc-client", () => ({ TaskServiceClient: { askResponse } }))
vi.mock("@vscode/webview-ui-toolkit/react", () => ({
	VSCodeButton: (props: ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props} />,
}))

const options = ["Unit tests", "Integration tests", "Lint"]

describe("MultiSelectOptions", () => {
	beforeEach(() => {
		askResponse.mockReset().mockResolvedValue({})
	})

	it("waits for Submit and sends the final checked options once", () => {
		render(<MultiSelectOptions id="question-a" isActive options={options} />)
		const submit = screen.getByRole("button", { name: "Submit" })
		expect(submit).toBeDisabled()
		fireEvent.click(screen.getByLabelText("Unit tests"))
		fireEvent.click(screen.getByLabelText("Integration tests"))
		fireEvent.click(screen.getByLabelText("Unit tests"))
		fireEvent.click(screen.getByLabelText("Lint"))
		expect(askResponse).not.toHaveBeenCalled()
		fireEvent.click(submit)
		fireEvent.click(submit)
		expect(askResponse).toHaveBeenCalledTimes(1)
		expect(askResponse).toHaveBeenCalledWith(
			expect.objectContaining({
				responseType: "multiSelectResponse",
				text: JSON.stringify({ id: "question-a", indices: [1, 2] }),
			}),
		)
	})

	it("renders saved answers as read-only", () => {
		render(<MultiSelectOptions id="question-a" isActive={false} options={options} selectedOptions={["Lint"]} />)
		expect(screen.getByLabelText("Lint")).toBeChecked()
		expect(screen.getByLabelText("Lint")).toBeDisabled()
		expect(screen.queryByRole("button", { name: "Submit" })).toBeNull()
	})

	it("allows retry after submission fails", async () => {
		askResponse.mockRejectedValueOnce(new Error("Request failed"))
		render(<MultiSelectOptions id="question-a" isActive options={options} />)
		fireEvent.click(screen.getByLabelText("Lint"))
		fireEvent.click(screen.getByRole("button", { name: "Submit" }))
		await screen.findByRole("alert")
		await waitFor(() => expect(screen.getByRole("button", { name: "Submit" })).toBeEnabled())
		fireEvent.click(screen.getByRole("button", { name: "Submit" }))
		expect(askResponse).toHaveBeenCalledTimes(2)
	})
})
