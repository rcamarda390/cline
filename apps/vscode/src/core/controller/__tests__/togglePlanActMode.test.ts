import { expect } from "chai"
import { describe, it } from "mocha"
import sinon from "sinon"
import { Controller } from "../index"

// Regression: toggling Plan/Act while a task has not sent its first request used to cancel the task and drop its prompt.
function makeController(apiRequestCount: number) {
	const stateManager = {
		setGlobalState: sinon.stub(),
		getApiConfiguration: () => ({}),
		getGlobalSettingsKey: () => false,
	}
	const task = {
		ulid: "test-ulid",
		api: undefined as unknown,
		taskState: { apiRequestCount, isAwaitingPlanResponse: false, didRespondToPlanAskBySwitchingMode: false },
	}
	const fake = {
		stateManager,
		task,
		postStateToWebview: sinon.stub().resolves(),
		cancelTask: sinon.stub(),
	}
	return fake
}

describe("Controller.togglePlanActMode", () => {
	it("does not cancel a task that has not sent its first request", async () => {
		const fake = makeController(0)
		const result = await Controller.prototype.togglePlanActMode.call(fake as any, "act")
		expect(result).to.equal(false)
		expect(fake.cancelTask.called).to.equal(false)
		expect(fake.stateManager.setGlobalState.calledWith("mode", "act")).to.equal(true)
	})

	it("cancels a task that is already running a request", async () => {
		const fake = makeController(2)
		await Controller.prototype.togglePlanActMode.call(fake as any, "plan")
		expect(fake.cancelTask.calledOnce).to.equal(true)
	})
})
