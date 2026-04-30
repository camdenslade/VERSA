import SwiftUI

struct ContentView: View {
    @Environment(TaskEngine.self) private var engine
    @State private var newTaskText = ""
    @State private var ffiResult   = ""

    var body: some View {
        NavigationStack {
            List {
                // FFI bridge test row
                Section("FFI Bridge Test") {
                    HStack {
                        TextField("Type something…", text: $newTaskText)
                        Button("Reverse") {
                            ffiResult = engine.reversedString(newTaskText)
                        }
                        .buttonStyle(.bordered)
                    }
                    if !ffiResult.isEmpty {
                        Text(ffiResult)
                            .foregroundStyle(.secondary)
                            .font(.caption)
                    }
                }

                // Task list
                Section("Tasks") {
                    ForEach(engine.tasks) { task in
                        TaskRow(task: task) {
                            engine.toggleTask(task.id)
                        }
                    }
                }
            }
            .navigationTitle("Versa")
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button("Add", systemImage: "plus") {
                        engine.addTask(content: "New task \(engine.tasks.count + 1)")
                    }
                }
            }
        }
    }
}

struct TaskRow: View {
    let task:   AppTask
    let toggle: () -> Void

    var body: some View {
        HStack {
            Image(systemName: task.isCompleted ? "checkmark.circle.fill" : "circle")
                .foregroundStyle(task.isCompleted ? .green : .secondary)
                .onTapGesture(perform: toggle)
            Text(task.content)
                .strikethrough(task.isCompleted)
        }
    }
}
