import SwiftUI

let defaultList = AppList(id: "default", name: "Tasks", lastModified: 0)

struct ContentView: View {
    @Environment(TaskEngine.self) private var engine
    @State private var selectedListId: String = "default"
    @State private var editingListId:  String? = nil

    private var allLists: [AppList] { [defaultList] + engine.lists }
    private var selectedList: AppList { allLists.first { $0.id == selectedListId } ?? defaultList }

    var body: some View {
        NavigationSplitView {
            ListSidebar(
                lists:          allLists,
                selectedListId: $selectedListId,
                editingListId:  $editingListId,
                taskCount:      { id in engine.tasks.filter { $0.listId == id }.count },
                onAdd:          {
                    let id = engine.addList(name: "New list")
                    selectedListId = id
                    editingListId  = id
                },
                onRename:       { engine.renameList($0, name: $1) },
                onDelete:       { id in
                    engine.deleteList(id)
                    if selectedListId == id { selectedListId = "default" }
                }
            )
            .navigationTitle("Lists")
        } detail: {
            TaskDetail(listId: selectedListId, listName: selectedList.name)
        }
    }
}

// MARK: - Sidebar

struct ListSidebar: View {
    let lists:          [AppList]
    @Binding var selectedListId: String
    @Binding var editingListId:  String?
    let taskCount:  (String) -> Int
    let onAdd:      () -> Void
    let onRename:   (String, String) -> Void
    let onDelete:   (String) -> Void

    @State private var draft = ""

    var body: some View {
        List(lists, selection: $selectedListId) { list in
            HStack {
                if editingListId == list.id {
                    TextField("List name", text: $draft, onCommit: {
                        let trimmed = draft.trimmingCharacters(in: .whitespaces)
                        editingListId = nil
                        if !trimmed.isEmpty { onRename(list.id, trimmed) }
                    })
                    .textFieldStyle(.plain)
                } else {
                    Text(list.name)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .contentShape(Rectangle())
                        .onTapGesture { selectedListId = list.id }
                }
                Spacer()
                Text("\(taskCount(list.id))")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .tag(list.id)
            .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                if list.id != "default" {
                    Button(role: .destructive) { onDelete(list.id) } label: {
                        Label("Delete", systemImage: "trash")
                    }
                    Button {
                        draft         = list.name
                        editingListId = list.id
                    } label: {
                        Label("Rename", systemImage: "pencil")
                    }
                    .tint(.blue)
                }
            }
        }
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button("New list", systemImage: "plus") { onAdd() }
            }
        }
    }
}

// MARK: - Task detail

struct TaskDetail: View {
    @Environment(TaskEngine.self) private var engine
    let listId:   String
    let listName: String

    @State private var showingAddSheet = false
    @State private var newTaskContent  = ""
    @FocusState private var addFieldFocused: Bool

    var tasks: [AppTask] { engine.tasks.filter { $0.listId == listId } }

    var body: some View {
        List {
            ForEach(tasks) { task in
                TaskRow(
                    task:   task,
                    toggle: { engine.toggleTask(task.id) },
                    update: { engine.updateTask(task.id, content: $0) }
                )
            }
            .onDelete { offsets in
                for i in offsets { engine.deleteTask(tasks[i].id) }
            }
        }
        .navigationTitle(listName)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button("Add task", systemImage: "plus") {
                    newTaskContent  = ""
                    showingAddSheet = true
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
        .sheet(isPresented: $showingAddSheet) {
            AddTaskSheet(
                content:  $newTaskContent,
                focused:  $addFieldFocused,
                onCommit: {
                    let trimmed = newTaskContent.trimmingCharacters(in: .whitespaces)
                    showingAddSheet = false
                    if !trimmed.isEmpty { engine.addTask(content: trimmed, listId: listId) }
                },
                onCancel: { showingAddSheet = false }
            )
            .presentationDetents([.height(120)])
            .onAppear { addFieldFocused = true }
        }
    }
}

struct AddTaskSheet: View {
    @Binding var content:  String
    @FocusState.Binding var focused: Bool
    let onCommit: () -> Void
    let onCancel: () -> Void

    var body: some View {
        VStack(spacing: 16) {
            TextField("Task name", text: $content)
                .focused($focused)
                .textFieldStyle(.roundedBorder)
                .submitLabel(.done)
                .onSubmit(onCommit)
            HStack {
                Button("Cancel", role: .cancel, action: onCancel)
                    .foregroundStyle(.secondary)
                Spacer()
                Button("Add", action: onCommit)
                    .bold()
                    .disabled(content.trimmingCharacters(in: .whitespaces).isEmpty)
            }
        }
        .padding()
    }
}

// MARK: - Task row

struct TaskRow: View {
    let task:   AppTask
    let toggle: () -> Void
    let update: (String) -> Void

    @State private var isEditing = false
    @State private var draft     = ""

    var body: some View {
        HStack {
            Image(systemName: task.isCompleted ? "checkmark.circle.fill" : "circle")
                .foregroundStyle(task.isCompleted ? .green : .secondary)
                .onTapGesture(perform: toggle)
            if isEditing {
                TextField("Task", text: $draft, onCommit: commit)
                    .textFieldStyle(.plain)
            } else {
                Text(task.content)
                    .strikethrough(task.isCompleted)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .contentShape(Rectangle())
                    .onTapGesture {
                        draft     = task.content
                        isEditing = true
                    }
            }
        }
    }

    private func commit() {
        let trimmed = draft.trimmingCharacters(in: .whitespaces)
        isEditing = false
        guard !trimmed.isEmpty, trimmed != task.content else { return }
        update(trimmed)
    }
}
