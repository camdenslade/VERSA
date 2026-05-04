import Foundation
import Observation

@Observable
@MainActor
final class TaskEngine {

    // MARK: - State
    private(set) var tasks:     [AppTask] = []
    private(set) var lists:     [AppList] = []
    private(set) var syncState: SyncState = .disconnected

    // MARK: - Private
    private let crdt:      VersaCoreEngine
    private let transport: RelayTransport

    init(relayURL: URL? = nil) {
        let relayURL = relayURL ?? TaskEngine.relayURL()
        let clientID = Self.stableClientID()
        crdt      = VersaCoreEngine(clientId: clientID)
        transport = RelayTransport(url: relayURL, clientID: clientID) {
            try await KimbuAuth.shared.token()
        }

        if let saved = Self.loadSnapshot() {
            let crdtRef = crdt
            do {
                try crdtRef.mergeUpdate(bytes: saved)
                tasks = crdtRef.getTasks().map(AppTask.init)
                lists = crdtRef.getLists().map(AppList.init)
            } catch {
                print("[VersaCore] snapshot load failed: \(error)")
            }
        }

        Task { await self.connectAndListen() }
    }

    // MARK: - Task mutations

    func addTask(content: String, listId: String = "default") {
        let ts = Date().millisecondsSince1970
        let task = AppTask(
            id:           UUID().uuidString,
            listId:       listId,
            content:      content,
            isCompleted:  false,
            position:     ts,
            lastModified: ts
        )
        tasks.append(task)
        sendTaskToRust(task)
    }

    func toggleTask(_ id: String) {
        guard let idx = tasks.firstIndex(where: { $0.id == id }) else { return }
        tasks[idx].isCompleted.toggle()
        tasks[idx].lastModified = Date().millisecondsSince1970
        sendTaskToRust(tasks[idx])
    }

    func updateTask(_ id: String, content: String) {
        guard let idx = tasks.firstIndex(where: { $0.id == id }) else { return }
        tasks[idx].content      = content
        tasks[idx].lastModified = Date().millisecondsSince1970
        sendTaskToRust(tasks[idx])
    }

    func deleteTask(_ id: String) {
        tasks.removeAll { $0.id == id }
        let crdtRef   = crdt
        let transport = transport
        Task.detached(priority: .userInitiated) {
            do {
                let diff = try crdtRef.deleteTask(id: id)
                Self.persistSnapshot(crdtRef.snapshot())
                await transport.send(diff)
            } catch {
                print("[VersaCore] delete_task failed: \(error)")
            }
        }
    }

    // MARK: - List mutations

    func addList(name: String) -> String {
        let id = UUID().uuidString
        let list = AppList(id: id, name: name, lastModified: Date().millisecondsSince1970)
        lists.append(list)
        sendListToRust(list)
        return id
    }

    func renameList(_ id: String, name: String) {
        guard let idx = lists.firstIndex(where: { $0.id == id }) else { return }
        lists[idx].name         = name
        lists[idx].lastModified = Date().millisecondsSince1970
        sendListToRust(lists[idx])
    }

    func deleteList(_ id: String) {
        lists.removeAll { $0.id == id }
        // Reassign orphaned tasks to default.
        for idx in tasks.indices where tasks[idx].listId == id {
            tasks[idx].listId       = "default"
            tasks[idx].lastModified = Date().millisecondsSince1970
            sendTaskToRust(tasks[idx])
        }
        let crdtRef   = crdt
        let transport = transport
        Task.detached(priority: .userInitiated) {
            do {
                let diff = try crdtRef.deleteList(id: id)
                Self.persistSnapshot(crdtRef.snapshot())
                await transport.send(diff)
            } catch {
                print("[VersaCore] delete_list failed: \(error)")
            }
        }
    }

    // MARK: - Private

    private func sendTaskToRust(_ task: AppTask) {
        let ffiTask = FfiTask(
            id:           task.id,
            listId:       task.listId,
            content:      task.content,
            isCompleted:  task.isCompleted,
            position:     task.position,
            lastModified: task.lastModified
        )
        let crdtRef   = crdt
        let transport = transport
        Task.detached(priority: .userInitiated) {
            do {
                let diff = try crdtRef.applyTask(task: ffiTask)
                Self.persistSnapshot(crdtRef.snapshot())
                await transport.send(diff)
            } catch {
                print("[VersaCore] apply_task failed: \(error)")
            }
        }
    }

    private func sendListToRust(_ list: AppList) {
        let ffiList = FfiList(id: list.id, name: list.name, lastModified: list.lastModified)
        let crdtRef   = crdt
        let transport = transport
        Task.detached(priority: .userInitiated) {
            do {
                let diff = try crdtRef.applyList(list: ffiList)
                Self.persistSnapshot(crdtRef.snapshot())
                await transport.send(diff)
            } catch {
                print("[VersaCore] apply_list failed: \(error)")
            }
        }
    }

    private func connectAndListen() async {
        syncState = .connecting
        transport.connect()
        for await event in transport.events {
            switch event {
            case .connected:
                syncState = .connected
                let crdtRef   = crdt
                let transport = transport
                Task.detached(priority: .userInitiated) {
                    await transport.send(crdtRef.snapshot())
                }

            case .message(let data):
                let payload = stripHeader(data)
                let crdtRef = crdt
                let result: ([AppTask], [AppList])? = await Task.detached(priority: .userInitiated) {
                    do {
                        try crdtRef.mergeUpdate(bytes: payload)
                        let tasks = crdtRef.getTasks().map(AppTask.init)
                        let lists = crdtRef.getLists().map(AppList.init)
                        Self.persistSnapshot(crdtRef.snapshot())
                        return (tasks, lists)
                    } catch {
                        print("[VersaCore] merge_update failed: \(error)")
                        return nil
                    }
                }.value
                if let (newTasks, newLists) = result {
                    tasks = newTasks
                    lists = newLists
                }

            case .disconnected:
                syncState = .disconnected
                await KimbuAuth.shared.invalidate()
            }
        }
    }

    // MARK: - Persistence

    nonisolated private static var snapshotURL: URL {
        FileManager.default
            .urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("versa.snapshot")
    }

    nonisolated private static func persistSnapshot(_ data: Data) {
        try? FileManager.default.createDirectory(
            at: snapshotURL.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        try? data.write(to: snapshotURL, options: .atomic)
    }

    nonisolated private static func loadSnapshot() -> Data? {
        try? Data(contentsOf: snapshotURL)
    }

    // MARK: - Helpers

    private func stripHeader(_ data: Data) -> Data {
        guard data.count >= 4 else { return data }
        let idLen = Int(UInt32(bigEndian: data.withUnsafeBytes { $0.load(as: UInt32.self) }))
        let offset = 4 + idLen
        guard offset <= data.count else { return data }
        return data.subdata(in: offset..<data.count)
    }

    static func relayURL() -> URL {
        let info   = Bundle.main.infoDictionary ?? [:]
        let host   = (info["RELAY_HOST"] as? String).flatMap { $0.hasPrefix("$") ? nil : $0 } ?? "versa.cslade.space"
        let port   = (info["RELAY_PORT"] as? String).flatMap { $0.hasPrefix("$") ? nil : $0 } ?? "443"
        let scheme = (port == "443") ? "wss" : "ws"
        return URL(string: "\(scheme)://\(host):\(port)/sync") ?? URL(string: "wss://versa.cslade.space:443/sync")!
    }

    static func stableClientID() -> String {
        let key = "versa.client_id"
        if let existing = UserDefaults.standard.string(forKey: key) { return existing }
        let new = UUID().uuidString
        UserDefaults.standard.set(new, forKey: key)
        return new
    }
}

// MARK: - SyncState
enum SyncState { case disconnected, connecting, connected }

// MARK: - App models

struct AppTask: Identifiable {
    var id:           String
    var listId:       String
    var content:      String
    var isCompleted:  Bool
    var position:     Int64
    var lastModified: Int64

    init(_ ffi: FfiTask) {
        id           = ffi.id
        listId       = ffi.listId
        content      = ffi.content
        isCompleted  = ffi.isCompleted
        position     = ffi.position
        lastModified = ffi.lastModified
    }

    init(id: String, listId: String, content: String, isCompleted: Bool, position: Int64, lastModified: Int64) {
        self.id           = id
        self.listId       = listId
        self.content      = content
        self.isCompleted  = isCompleted
        self.position     = position
        self.lastModified = lastModified
    }
}

struct AppList: Identifiable, Hashable {
    var id:           String
    var name:         String
    var lastModified: Int64

    init(_ ffi: FfiList) {
        id           = ffi.id
        name         = ffi.name
        lastModified = ffi.lastModified
    }

    init(id: String, name: String, lastModified: Int64) {
        self.id           = id
        self.name         = name
        self.lastModified = lastModified
    }
}

extension Date {
    var millisecondsSince1970: Int64 {
        Int64((timeIntervalSince1970 * 1000).rounded())
    }
}
