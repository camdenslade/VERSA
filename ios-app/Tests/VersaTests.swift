import Testing
@testable import Versa

@Suite("TaskEngine")
struct TaskEngineTests {

    @Test("addTask appends a task")
    @MainActor
    func addTaskAppends() async {
        let engine = TaskEngine(relayURL: URL(string: "ws://localhost:9999/sync")!)
        engine.addTask(content: "Buy milk")
        #expect(engine.tasks.count == 1)
        #expect(engine.tasks[0].content == "Buy milk")
        #expect(engine.tasks[0].isCompleted == false)
    }

    @Test("toggleTask flips isCompleted")
    @MainActor
    func toggleFlips() async {
        let engine = TaskEngine(relayURL: URL(string: "ws://localhost:9999/sync")!)
        engine.addTask(content: "Write tests")
        let id = engine.tasks[0].id
        engine.toggleTask(id)
        #expect(engine.tasks[0].isCompleted == true)
        engine.toggleTask(id)
        #expect(engine.tasks[0].isCompleted == false)
    }

    @Test("reversedString stub returns reversed input")
    @MainActor
    func reverseStub() async {
        let engine = TaskEngine(relayURL: URL(string: "ws://localhost:9999/sync")!)
        #expect(engine.reversedString("hello") == "olleh")
    }
}
