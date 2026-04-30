import SwiftUI

struct ContentView: View {
    @Environment(TaskEngine.self) private var engine

    var body: some View {
        NavigationStack {
            List {
                ForEach(engine.tasks) { task in
                    TaskRow(task: task) {
                        engine.toggleTask(task.id)
                    }
                }
                .onDelete { offsets in
                    for i in offsets {
                        engine.deleteTask(engine.tasks[i].id)
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
                ToolbarItem(placement: .navigationBarLeading) {
                    HStack(spacing: 4) {
                        Circle()
                            .fill(engine.syncState == .connected ? Color.green : Color.secondary)
                            .frame(width: 8, height: 8)
                        Text(engine.syncState == .connected ? "Live" : "Offline")
                            .font(.footnote)
                            .foregroundStyle(engine.syncState == .connected ? .primary : .secondary)
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
